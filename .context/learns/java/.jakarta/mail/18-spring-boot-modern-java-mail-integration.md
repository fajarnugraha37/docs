# Part 18 — Jakarta Mail in Spring Boot and Modern Java Applications

> Series: `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery`  
> File: `18-spring-boot-modern-java-mail-integration.md`  
> Scope: Java 8–25, Spring Framework, Spring Boot, JavaMail/Jakarta Mail, `JavaMailSender`, `MimeMessageHelper`, configuration, clean architecture, async/outbox integration, testing, observability, and migration from `javax.mail` to `jakarta.mail`.

---

## 0. Posisi Part Ini Dalam Seri

Sampai Part 17, kita sudah melihat email dari beberapa layer:

1. email sebagai distributed system;
2. SMTP/MIME/POP3/IMAP sebagai protocol layer;
3. JavaMail/Jakarta Mail sebagai API abstraction;
4. `Session`, `Transport`, `Store`, `Folder`, `Message` sebagai object model;
5. SMTP timeout, TLS, authentication;
6. MIME message, multipart, attachment, Activation;
7. error taxonomy;
8. reliable delivery dengan outbox, retry, idempotency;
9. bulk sending dan rate limit;
10. security, deliverability, inbound ingestion;
11. container-managed Jakarta Mail di Jakarta EE.

Part ini membahas mode yang sangat umum di enterprise Java modern:

> **Bagaimana memakai Jakarta Mail melalui Spring Boot tanpa kehilangan mental model SMTP/MIME/Jakarta Mail yang sudah kita bangun.**

Di Spring Boot, developer biasanya tidak membuat `jakarta.mail.Session` manual setiap kali ingin mengirim email. Spring menyediakan abstraction:

```java
JavaMailSender mailSender;
```

Kemudian developer membuat `MimeMessage`:

```java
MimeMessage message = mailSender.createMimeMessage();
MimeMessageHelper helper = new MimeMessageHelper(message, true, StandardCharsets.UTF_8.name());
helper.setFrom("noreply@example.com");
helper.setTo("user@example.com");
helper.setSubject("Welcome");
helper.setText("Plain body", "<p>HTML body</p>");
mailSender.send(message);
```

Namun abstraction ini sering disalahpahami. Spring tidak menghapus SMTP, MIME, timeout, TLS, deliverability, retry, duplicate, atau memory issue. Spring hanya memberi adapter yang lebih nyaman.

Mental model utama Part ini:

```text
Spring Boot Application
   |
   | depends on
   v
JavaMailSender abstraction
   |
   | wraps / configures
   v
Jakarta Mail Session + Transport + MimeMessage
   |
   | speaks
   v
SMTP Relay / Provider
   |
   | forwards
   v
Recipient Mail Infrastructure
```

Spring Mail adalah **integration layer**, bukan replacement untuk understanding email.

---

## 1. Apa yang Sebenarnya Disediakan Spring untuk Email?

Spring Framework menyediakan beberapa abstraction penting:

| Komponen | Package | Fungsi |
|---|---|---|
| `MailSender` | `org.springframework.mail` | abstraction sederhana untuk mengirim `SimpleMailMessage` |
| `JavaMailSender` | `org.springframework.mail.javamail` | abstraction untuk JavaMail/Jakarta Mail, termasuk MIME |
| `JavaMailSenderImpl` | `org.springframework.mail.javamail` | implementation berbasis Jakarta Mail `Session` |
| `MimeMessageHelper` | `org.springframework.mail.javamail` | helper untuk mengisi `MimeMessage` dengan text/html/attachment/inline resource |
| `MimeMessagePreparator` | `org.springframework.mail.javamail` | callback untuk mempersiapkan `MimeMessage` sebelum dikirim |

Spring Boot menambahkan auto-configuration:

```text
spring-boot-starter-mail
   |
   v
MailSenderAutoConfiguration
   |
   v
JavaMailSender bean
   |
   v
JavaMailSenderImpl
   |
   v
Jakarta Mail Session
```

Artinya, pada aplikasi Spring Boot, kita biasanya hanya perlu:

1. menambahkan dependency `spring-boot-starter-mail`;
2. mengisi `spring.mail.*` properties;
3. inject `JavaMailSender`;
4. membangun `MimeMessage`;
5. mengirim via `mailSender.send(...)`.

Tetapi untuk production-grade system, itu belum cukup. Kita masih harus mendesain:

- timeout;
- retry;
- outbox;
- async worker;
- template rendering;
- failure classification;
- redaction;
- metrics;
- testing;
- multi-provider routing;
- secret management.

---

## 2. Dependency Matrix: Java 8–25 dan Spring Boot

### 2.1 Spring Boot 2.x vs 3.x

Perubahan besar:

```text
Spring Boot 2.x
   -> Spring Framework 5.x
   -> Java EE / javax namespace
   -> javax.mail.*

Spring Boot 3.x+
   -> Spring Framework 6.x+
   -> Jakarta EE namespace
   -> jakarta.mail.*
```

Ini sangat penting karena mail object tidak kompatibel secara tipe:

```java
javax.mail.internet.MimeMessage      // legacy
jakarta.mail.internet.MimeMessage    // modern
```

Keduanya terlihat mirip, tetapi berbeda package, berbeda binary type.

Kesalahan umum saat migrasi:

```text
java: incompatible types:
javax.mail.internet.MimeMessage cannot be converted to jakarta.mail.internet.MimeMessage
```

Aturan praktis:

| Runtime | Spring | Mail namespace | Catatan |
|---|---|---|---|
| Java 8 + Spring Boot 2.x | Spring 5 | `javax.mail` | legacy stable |
| Java 11/17 + Spring Boot 2.x | Spring 5 | `javax.mail` | masih legacy namespace |
| Java 17/21/25 + Spring Boot 3.x | Spring 6 | `jakarta.mail` | modern Jakarta namespace |

### 2.2 Dependency Spring Boot 2.x

Contoh Maven legacy:

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-mail</artifactId>
</dependency>
```

Pada Boot 2.x, transitive dependency umumnya menuju JavaMail/`javax.mail` generation.

Kode:

```java
import javax.mail.MessagingException;
import javax.mail.internet.MimeMessage;

import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
```

### 2.3 Dependency Spring Boot 3.x+

Maven modern:

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-mail</artifactId>
</dependency>
```

Kode:

```java
import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;

import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
```

Perhatikan: class Spring tetap berada di package `org.springframework.mail...`, tetapi underlying mail type berubah menjadi `jakarta.mail...`.

### 2.4 Dependency Rule yang Aman

Untuk Spring Boot application:

> Jangan menambahkan dependency `jakarta.mail` atau `javax.mail` manual kecuali benar-benar perlu.

Biarkan Spring Boot dependency management memilih versi yang kompatibel.

Anti-pattern:

```xml
<!-- Risiko conflict jika tidak sesuai dengan Boot BOM -->
<dependency>
    <groupId>com.sun.mail</groupId>
    <artifactId>jakarta.mail</artifactId>
    <version>2.0.1</version>
</dependency>
```

Jika memakai Spring Boot 3, cukup starter.

Jika perlu override karena bug/security/provider feature, lakukan sadar:

```xml
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-dependencies</artifactId>
            <version>${spring-boot.version}</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>
```

Lalu override satu library dengan alasan eksplisit dan regression test.

---

## 3. Spring Boot Mail Auto-Configuration

### 3.1 Minimal Configuration

`application.yml`:

```yaml
spring:
  mail:
    host: smtp.example.com
    port: 587
    username: ${SMTP_USERNAME}
    password: ${SMTP_PASSWORD}
    protocol: smtp
    properties:
      mail:
        smtp:
          auth: true
          starttls:
            enable: true
            required: true
          connectiontimeout: 5000
          timeout: 10000
          writetimeout: 10000
```

Key point:

- `spring.mail.host` menjadi SMTP host;
- `spring.mail.port` menjadi SMTP port;
- `spring.mail.username/password` dipakai untuk auth;
- `spring.mail.properties.*` diteruskan ke Jakarta Mail properties;
- timeout harus eksplisit;
- `starttls.required=true` mengurangi risiko fallback ke plaintext.

### 3.2 Kenapa Timeout Wajib?

Tanpa timeout, worker thread bisa stuck lama ketika:

- SMTP host tidak reachable;
- firewall drop packet;
- provider lambat;
- TLS handshake menggantung;
- socket write blocked;
- DNS/network bermasalah.

Dalam mail subsystem, satu stuck send bisa menjadi:

```text
SMTP stuck
   -> worker thread habis
   -> outbox tidak drain
   -> queue age naik
   -> user komplain email tidak sampai
   -> retry storm setelah restart
```

Karena itu konfigurasi production minimum:

```yaml
spring:
  mail:
    properties:
      mail.smtp.connectiontimeout: 5000
      mail.smtp.timeout: 10000
      mail.smtp.writetimeout: 10000
```

Di YAML nested style:

```yaml
spring:
  mail:
    properties:
      mail:
        smtp:
          connectiontimeout: 5000
          timeout: 10000
          writetimeout: 10000
```

### 3.3 TLS Configuration

Port umum:

| Port | Mode | Catatan |
|---:|---|---|
| 25 | SMTP relay / server-to-server | sering diblokir di cloud; bukan default app submission |
| 465 | implicit TLS | TLS dari awal connection |
| 587 | submission + STARTTLS | paling umum untuk aplikasi |

STARTTLS config:

```yaml
spring:
  mail:
    port: 587
    properties:
      mail.smtp.auth: true
      mail.smtp.starttls.enable: true
      mail.smtp.starttls.required: true
```

Implicit TLS:

```yaml
spring:
  mail:
    port: 465
    properties:
      mail.smtp.auth: true
      mail.smtp.ssl.enable: true
```

Jangan campur tanpa paham:

```yaml
# Risky/ambiguous if provider expects STARTTLS on 587
mail.smtp.ssl.enable: true
mail.smtp.starttls.enable: true
```

Pilih sesuai provider.

---

## 4. JavaMailSender Mental Model

### 4.1 Apa Itu `JavaMailSender`?

`JavaMailSender` adalah Spring abstraction di atas Jakarta Mail.

Secara konseptual:

```text
JavaMailSender
   | createMimeMessage()
   v
MimeMessage
   | send(message)
   v
Jakarta Mail Transport
   | SMTP
   v
SMTP provider
```

`JavaMailSender` membantu:

- membuat `MimeMessage`;
- mengirim message;
- menyembunyikan resource handling level rendah;
- menyediakan integration point untuk Spring application.

Tetapi `JavaMailSender` tidak otomatis:

- membuat retry yang benar;
- membuat outbox;
- menjamin deliverability;
- men-debounce duplicate;
- mengklasifikasi SMTP error;
- mencegah PII logging;
- membuat template aman;
- membuat mail sending non-blocking.

### 4.2 `JavaMailSenderImpl`

Spring Boot biasanya membuat bean `JavaMailSenderImpl`.

Contoh manual bean:

```java
@Configuration
public class MailConfig {

    @Bean
    JavaMailSender javaMailSender() {
        JavaMailSenderImpl sender = new JavaMailSenderImpl();
        sender.setHost("smtp.example.com");
        sender.setPort(587);
        sender.setUsername("username");
        sender.setPassword("password");

        Properties props = sender.getJavaMailProperties();
        props.put("mail.smtp.auth", "true");
        props.put("mail.smtp.starttls.enable", "true");
        props.put("mail.smtp.starttls.required", "true");
        props.put("mail.smtp.connectiontimeout", "5000");
        props.put("mail.smtp.timeout", "10000");
        props.put("mail.smtp.writetimeout", "10000");

        return sender;
    }
}
```

Dalam Boot, lebih baik pakai properties kecuali ada alasan kuat untuk custom bean.

### 4.3 Kapan Custom Bean Diperlukan?

Custom bean berguna jika:

1. multi-tenant SMTP routing;
2. dynamic credential;
3. multiple providers;
4. custom `Session`;
5. custom observability wrapper;
6. testing override;
7. secret loaded dari external vault secara runtime.

Tetapi custom bean juga bisa merusak auto-configuration jika tidak hati-hati.

Rule:

> Gunakan Boot auto-config untuk common case. Buat adapter/wrapper sendiri untuk architecture behavior, bukan untuk menulis ulang SMTP plumbing tanpa alasan.

---

## 5. SimpleMailMessage vs MimeMessage

Spring menyediakan dua jalur utama:

```text
SimpleMailMessage
   -> plain text only
   -> no attachment
   -> no HTML multipart
   -> simple notification

MimeMessage
   -> HTML
   -> attachment
   -> inline image
   -> multipart alternative/mixed/related
   -> production email modern
```

### 5.1 SimpleMailMessage

Contoh:

```java
@Service
public class SimpleTextMailService {

    private final JavaMailSender mailSender;

    public SimpleTextMailService(JavaMailSender mailSender) {
        this.mailSender = mailSender;
    }

    public void sendPlainText() {
        SimpleMailMessage message = new SimpleMailMessage();
        message.setFrom("noreply@example.com");
        message.setTo("user@example.com");
        message.setSubject("Notification");
        message.setText("Your request has been submitted.");

        mailSender.send(message);
    }
}
```

Kapan cukup?

- internal simple alert;
- no attachment;
- no branding;
- no HTML;
- no need multipart alternative.

### 5.2 MimeMessage

Untuk production user-facing email, gunakan `MimeMessage`:

```java
@Service
public class HtmlMailService {

    private final JavaMailSender mailSender;

    public HtmlMailService(JavaMailSender mailSender) {
        this.mailSender = mailSender;
    }

    public void sendHtml() throws MessagingException {
        MimeMessage message = mailSender.createMimeMessage();

        MimeMessageHelper helper = new MimeMessageHelper(
                message,
                MimeMessageHelper.MULTIPART_MODE_MIXED_RELATED,
                StandardCharsets.UTF_8.name()
        );

        helper.setFrom("noreply@example.com");
        helper.setTo("user@example.com");
        helper.setSubject("Application Approved");
        helper.setText(
                "Your application has been approved.",
                "<html><body><p>Your application has been <b>approved</b>.</p></body></html>"
        );

        mailSender.send(message);
    }
}
```

---

## 6. MimeMessageHelper Deep Dive

### 6.1 Apa Tujuan `MimeMessageHelper`?

`MimeMessageHelper` adalah convenience wrapper untuk `MimeMessage`.

Tanpa helper, developer harus membuat manual:

- `MimeMultipart`;
- `MimeBodyPart`;
- nested multipart;
- content type;
- charset;
- attachment;
- inline resource.

Dengan helper:

```java
helper.setText(plainText, htmlText);
helper.addAttachment("report.pdf", file);
helper.addInline("logo", resource);
```

Namun helper tetap harus dipakai dengan paham struktur MIME.

### 6.2 Constructor Modes

`MimeMessageHelper` punya beberapa mode multipart. Yang sering muncul:

```java
new MimeMessageHelper(message, false);
new MimeMessageHelper(message, true);
new MimeMessageHelper(message, MimeMessageHelper.MULTIPART_MODE_MIXED_RELATED, "UTF-8");
```

Prinsip:

| Mode | Fungsi |
|---|---|
| no multipart | plain/simple HTML tanpa attachment |
| multipart simple | attachment/basic multipart |
| mixed related | outer mixed untuk attachment, inner related untuk HTML inline resources |

Untuk production HTML + attachment + inline image, pilih eksplisit:

```java
MimeMessageHelper helper = new MimeMessageHelper(
        message,
        MimeMessageHelper.MULTIPART_MODE_MIXED_RELATED,
        StandardCharsets.UTF_8.name()
);
```

### 6.3 Plain + HTML Alternative

Best practice:

```java
helper.setText(plainText, htmlText);
```

Bukan:

```java
helper.setText(htmlText, true); // hanya HTML
```

Kenapa?

- beberapa client/security scanner lebih suka plain fallback;
- accessibility lebih baik;
- deliverability kadang lebih sehat;
- debugging lebih mudah;
- email tetap readable saat HTML blocked.

### 6.4 Attachment

```java
helper.addAttachment("invoice.pdf", new FileSystemResource(file));
```

Atau dari byte array:

```java
helper.addAttachment("invoice.pdf", new ByteArrayResource(bytes), "application/pdf");
```

Namun hati-hati: `ByteArrayResource` berarti seluruh attachment sudah ada di heap.

Untuk file besar, lebih baik:

```java
helper.addAttachment("invoice.pdf", new FileSystemResource(path));
```

Atau custom `InputStreamSource` yang aman, tapi harus repeatable.

### 6.5 Inline Image

HTML:

```html
<img src="cid:logo" alt="Company Logo" />
```

Java:

```java
helper.addInline("logo", new ClassPathResource("mail/logo.png"), "image/png");
```

Penting:

- `Content-ID` harus cocok dengan `cid:`;
- jangan gunakan user-supplied CID mentah;
- ukuran inline image sebaiknya kecil;
- banyak client memblokir remote image, inline image tidak selalu bebas masalah;
- inline image memperbesar message size.

---

## 7. Clean Architecture: Jangan Sebar JavaMailSender ke Semua Service

Kesalahan desain yang sering terjadi:

```text
OrderService
UserService
PaymentService
CaseService
ApprovalService
   semuanya inject JavaMailSender langsung
```

Masalah:

1. SMTP detail bocor ke business layer;
2. template logic tersebar;
3. retry sulit dikontrol;
4. audit tidak konsisten;
5. testing berat;
6. sulit migrasi ke provider API;
7. sulit menerapkan outbox;
8. tidak ada single policy untuk security/redaction.

Desain lebih baik:

```text
Business Module
   |
   | emits domain event / calls NotificationApplicationService
   v
Notification Application Layer
   |
   | creates MailRequest / NotificationCommand
   v
Outbox / Queue
   |
   | consumed by worker
   v
Mail Delivery Adapter
   |
   | uses JavaMailSender
   v
SMTP Provider
```

### 7.1 Domain Interface

```java
public interface NotificationCommandPort {
    void requestEmail(EmailNotificationCommand command);
}
```

Business layer:

```java
@Service
public class ApprovalService {

    private final NotificationCommandPort notifications;

    public ApprovalService(NotificationCommandPort notifications) {
        this.notifications = notifications;
    }

    @Transactional
    public void approveApplication(ApplicationId id) {
        // update domain state
        // persist approval

        notifications.requestEmail(new EmailNotificationCommand(
                "APPLICATION_APPROVED",
                id.value(),
                Map.of("applicationId", id.value())
        ));
    }
}
```

Notice: business service tidak tahu:

- SMTP host;
- MIME;
- `MimeMessageHelper`;
- attachment encoding;
- retry;
- provider.

### 7.2 Infrastructure Adapter

```java
@Component
public class SpringJavaMailDeliveryAdapter implements MailDeliveryPort {

    private final JavaMailSender mailSender;
    private final MailMimeComposer composer;

    public SpringJavaMailDeliveryAdapter(JavaMailSender mailSender,
                                         MailMimeComposer composer) {
        this.mailSender = mailSender;
        this.composer = composer;
    }

    @Override
    public MailDeliveryResult send(ResolvedEmail email) {
        try {
            MimeMessage message = mailSender.createMimeMessage();
            composer.compose(message, email);
            mailSender.send(message);
            return MailDeliveryResult.accepted();
        } catch (MailException ex) {
            return MailDeliveryResult.failed(MailFailureClassifier.classify(ex));
        }
    }
}
```

---

## 8. Recommended Layering for Spring Boot Mail System

Production-grade design:

```text
[Business Use Case]
      |
      v
[Notification Application Service]
      |
      | validate template intent
      | resolve recipient identity
      | persist outbox
      v
[Notification Outbox Table]
      |
      | polled / consumed
      v
[Mail Worker]
      |
      | render template
      | compose MIME
      | classify failure
      | update status
      v
[MailDeliveryPort]
      |
      v
[Spring JavaMailSender Adapter]
      |
      v
[SMTP Relay]
```

Recommended packages:

```text
com.example.notification
  application
    NotificationApplicationService.java
    SendEmailCommand.java
  domain
    EmailNotification.java
    Recipient.java
    TemplateId.java
    NotificationStatus.java
  outbox
    EmailOutboxEntity.java
    EmailOutboxRepository.java
    EmailOutboxWorker.java
  template
    TemplateRenderer.java
    TemplateVariables.java
  mail
    MailDeliveryPort.java
    ResolvedEmail.java
    MailDeliveryResult.java
    SpringJavaMailDeliveryAdapter.java
    MailMimeComposer.java
    MailFailureClassifier.java
  config
    MailProperties.java
    MailConfiguration.java
```

Rule:

> `JavaMailSender` hanya boleh hidup di infrastructure adapter, bukan di business service.

---

## 9. Configuration Design in Spring Boot

### 9.1 Use Boot's `spring.mail.*` for SMTP Plumbing

```yaml
spring:
  mail:
    host: ${SMTP_HOST}
    port: ${SMTP_PORT:587}
    username: ${SMTP_USERNAME}
    password: ${SMTP_PASSWORD}
    protocol: smtp
    default-encoding: UTF-8
    properties:
      mail.smtp.auth: true
      mail.smtp.starttls.enable: true
      mail.smtp.starttls.required: true
      mail.smtp.connectiontimeout: 5000
      mail.smtp.timeout: 10000
      mail.smtp.writetimeout: 10000
```

### 9.2 Use Custom Properties for Domain Policy

Jangan campur business policy ke `spring.mail.*`.

Buat namespace sendiri:

```yaml
app:
  mail:
    enabled: true
    from-address: noreply@example.com
    from-name: Example Service
    reply-to: support@example.com
    max-attempts: 5
    batch-size: 100
    worker-concurrency: 4
    retry:
      initial-delay: 30s
      max-delay: 30m
    audit:
      redact-recipient: true
    templates:
      base-url: https://example.com
```

Binding:

```java
@ConfigurationProperties(prefix = "app.mail")
public class AppMailProperties {
    private boolean enabled = true;
    private String fromAddress;
    private String fromName;
    private String replyTo;
    private int maxAttempts = 5;
    private int batchSize = 100;
    private int workerConcurrency = 4;

    // getters/setters
}
```

Configuration:

```java
@Configuration
@EnableConfigurationProperties(AppMailProperties.class)
public class NotificationConfiguration {
}
```

### 9.3 Why Separate Config?

`spring.mail.*` answers:

> Bagaimana konek ke SMTP?

`app.mail.*` answers:

> Bagaimana aplikasi memperlakukan email sebagai business notification?

Keduanya berbeda layer.

---

## 10. Template Rendering Integration

Spring Mail tidak menyediakan template engine sendiri. Biasanya integrasi dengan:

- Thymeleaf;
- FreeMarker;
- Mustache;
- Pebble;
- custom renderer.

### 10.1 Template Renderer Interface

```java
public interface MailTemplateRenderer {
    RenderedMailTemplate render(TemplateId templateId, Locale locale, Map<String, Object> variables);
}
```

Result:

```java
public record RenderedMailTemplate(
        String subject,
        String plainText,
        String html
) {}
```

### 10.2 Thymeleaf Example

```java
@Component
public class ThymeleafMailTemplateRenderer implements MailTemplateRenderer {

    private final SpringTemplateEngine templateEngine;

    public ThymeleafMailTemplateRenderer(SpringTemplateEngine templateEngine) {
        this.templateEngine = templateEngine;
    }

    @Override
    public RenderedMailTemplate render(TemplateId templateId,
                                       Locale locale,
                                       Map<String, Object> variables) {
        Context context = new Context(locale);
        context.setVariables(variables);

        String baseName = "mail/" + templateId.value();
        String subject = templateEngine.process(baseName + "/subject", context).trim();
        String text = templateEngine.process(baseName + "/text", context);
        String html = templateEngine.process(baseName + "/html", context);

        return new RenderedMailTemplate(subject, text, html);
    }
}
```

### 10.3 Template Safety Rules

1. Escape user-provided variables by default.
2. Do not allow arbitrary HTML from user input unless sanitized.
3. Version templates if regulatory/audit matters.
4. Keep subject template separate from body.
5. Render plain and HTML from same semantic data.
6. Include preview tests.
7. Avoid embedding secrets/token values directly unless short-lived and scoped.

---

## 11. MIME Composer Design

Do not let every service manually configure `MimeMessageHelper`.

Centralize:

```java
@Component
public class MailMimeComposer {

    private final AppMailProperties properties;

    public MailMimeComposer(AppMailProperties properties) {
        this.properties = properties;
    }

    public void compose(MimeMessage message, ResolvedEmail email) throws MessagingException {
        MimeMessageHelper helper = new MimeMessageHelper(
                message,
                MimeMessageHelper.MULTIPART_MODE_MIXED_RELATED,
                StandardCharsets.UTF_8.name()
        );

        helper.setFrom(properties.getFromAddress(), properties.getFromName());
        helper.setTo(email.toArray());

        if (properties.getReplyTo() != null) {
            helper.setReplyTo(properties.getReplyTo());
        }

        helper.setSubject(email.subject());
        helper.setText(email.plainText(), email.html());

        for (MailAttachment attachment : email.attachments()) {
            helper.addAttachment(
                    attachment.safeFileName(),
                    attachment.inputStreamSource(),
                    attachment.contentType()
            );
        }

        for (InlineResource inline : email.inlineResources()) {
            helper.addInline(
                    inline.contentId(),
                    inline.inputStreamSource(),
                    inline.contentType()
            );
        }
    }
}
```

But note: `helper.setFrom(address, personal)` can throw `UnsupportedEncodingException` depending API overload. Some teams wrap it:

```java
private void setFrom(MimeMessageHelper helper, String address, String name) throws MessagingException {
    try {
        helper.setFrom(address, name);
    } catch (UnsupportedEncodingException ex) {
        throw new MessagingException("Invalid from display name", ex);
    }
}
```

### 11.1 Composer Invariants

A good composer enforces:

- UTF-8 always;
- from address from trusted config;
- no raw CRLF in subject/display names;
- no recipient from unvalidated source;
- plain + HTML body always;
- attachment size already checked;
- filename sanitized;
- message ID/correlation header if allowed;
- no debug/secret logging.

Example custom header:

```java
message.setHeader("X-Correlation-ID", email.correlationId());
message.setHeader("X-Notification-ID", email.notificationId());
```

Use custom headers carefully. Some providers strip or rewrite headers.

---

## 12. Exception Model in Spring Mail

Spring wraps lower-level mail exceptions into `MailException` hierarchy.

Common classes:

| Spring exception | Meaning |
|---|---|
| `MailException` | base runtime exception |
| `MailSendException` | failure when sending one or more messages |
| `MailAuthenticationException` | authentication failure |
| `MailParseException` | message construction/parse failure |
| `MailPreparationException` | preparator/callback failure |

Important:

> Spring exceptions are runtime exceptions, while Jakarta Mail exceptions are checked exceptions.

This is convenient, but can hide SMTP-level details if you do not inspect nested causes.

### 12.1 Classifying Spring Mail Failure

```java
public final class MailFailureClassifier {

    private MailFailureClassifier() {}

    public static MailFailure classify(Throwable error) {
        Throwable root = rootCause(error);

        if (error instanceof MailAuthenticationException) {
            return MailFailure.permanent("MAIL_AUTH_FAILED", error.getMessage());
        }

        if (error instanceof MailParseException || error instanceof MailPreparationException) {
            return MailFailure.permanent("MAIL_MESSAGE_INVALID", error.getMessage());
        }

        if (root instanceof java.net.SocketTimeoutException) {
            return MailFailure.retryable("MAIL_TIMEOUT", root.getMessage());
        }

        if (root instanceof java.net.ConnectException) {
            return MailFailure.retryable("MAIL_CONNECT_FAILED", root.getMessage());
        }

        if (root instanceof jakarta.mail.SendFailedException sendFailed) {
            return classifySendFailed(sendFailed);
        }

        // Angus/Sun provider-specific SMTP exceptions may be under nested cause.
        String className = root.getClass().getName();
        if (className.endsWith("SMTPAddressFailedException") || className.endsWith("SMTPSendFailedException")) {
            return classifyBySmtpCodeReflectively(root);
        }

        return MailFailure.retryable("MAIL_SEND_UNKNOWN", error.getMessage());
    }

    private static Throwable rootCause(Throwable t) {
        Throwable current = t;
        while (current.getCause() != null && current.getCause() != current) {
            current = current.getCause();
        }
        return current;
    }
}
```

### 12.2 Do Not Retry Everything

Permanent failure examples:

- invalid recipient syntax;
- unknown recipient with 550;
- authentication rejected due wrong credential;
- invalid MIME message;
- attachment exceeds provider max size;
- policy rejection for content.

Retryable examples:

- 421 service unavailable;
- 450 mailbox temporarily unavailable;
- network timeout;
- connection reset;
- provider rate limit;
- temporary DNS issue.

Spring does not decide this policy for you.

---

## 13. Async Sending: What `@Async` Solves and What It Does Not

A naive improvement:

```java
@Async
public void sendEmailAsync(...) {
    mailSender.send(message);
}
```

This avoids blocking request thread, but it does not solve reliability.

### 13.1 What `@Async` Helps

- caller returns faster;
- SMTP latency moved to background thread;
- simple non-critical notifications become easier.

### 13.2 What `@Async` Does Not Help

- app crashes before send completes;
- no durable retry;
- duplicate sends after manual retry;
- no state machine;
- no queue visibility;
- no dead letter;
- no backpressure beyond thread pool;
- failure can be lost if not captured.

### 13.3 Safe `@Async` Configuration

```java
@Configuration
@EnableAsync
public class AsyncConfig {

    @Bean(name = "mailTaskExecutor")
    public ThreadPoolTaskExecutor mailTaskExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(4);
        executor.setMaxPoolSize(8);
        executor.setQueueCapacity(500);
        executor.setThreadNamePrefix("mail-sender-");
        executor.setWaitForTasksToCompleteOnShutdown(true);
        executor.setAwaitTerminationSeconds(30);
        executor.initialize();
        return executor;
    }
}
```

Usage:

```java
@Async("mailTaskExecutor")
public CompletableFuture<MailDeliveryResult> sendAsync(ResolvedEmail email) {
    MailDeliveryResult result = deliveryPort.send(email);
    return CompletableFuture.completedFuture(result);
}
```

Still: use outbox for critical email.

---

## 14. Outbox Integration in Spring Boot

For critical transactional email, preferred pattern:

```text
Business transaction
   -> update business state
   -> insert email outbox row
   -> commit

Worker transaction
   -> claim pending rows
   -> render and send
   -> update row status
```

### 14.1 Entity Example

```java
@Entity
@Table(name = "email_outbox")
public class EmailOutboxEntity {

    @Id
    private UUID id;

    @Column(nullable = false)
    private String templateId;

    @Column(nullable = false)
    private String recipient;

    @Lob
    @Column(nullable = false)
    private String variablesJson;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private EmailOutboxStatus status;

    @Column(nullable = false)
    private int attemptCount;

    private Instant nextAttemptAt;

    private Instant createdAt;
    private Instant updatedAt;

    private String lastFailureCode;
    private String lastFailureMessage;

    @Version
    private long version;
}
```

### 14.2 Status Model

```java
public enum EmailOutboxStatus {
    PENDING,
    PROCESSING,
    SENT,
    FAILED_RETRYABLE,
    FAILED_PERMANENT,
    DEAD_LETTER,
    CANCELLED
}
```

### 14.3 Worker Skeleton

```java
@Component
public class EmailOutboxWorker {

    private final EmailOutboxRepository repository;
    private final MailTemplateRenderer renderer;
    private final MailDeliveryPort deliveryPort;

    @Scheduled(fixedDelayString = "${app.mail.worker.fixed-delay:5000}")
    public void drain() {
        List<EmailOutboxEntity> batch = repository.claimDueBatch(Instant.now(), 100);

        for (EmailOutboxEntity item : batch) {
            processOne(item.getId());
        }
    }

    @Transactional
    public void processOne(UUID id) {
        EmailOutboxEntity item = repository.findByIdForUpdate(id)
                .orElseThrow();

        if (!item.isProcessable()) {
            return;
        }

        try {
            RenderedMailTemplate rendered = renderer.render(
                    new TemplateId(item.getTemplateId()),
                    item.locale(),
                    item.variables()
            );

            ResolvedEmail email = ResolvedEmail.from(item, rendered);
            MailDeliveryResult result = deliveryPort.send(email);

            if (result.accepted()) {
                item.markSent();
            } else if (result.failure().retryable()) {
                item.markRetryableFailure(result.failure(), nextDelay(item.getAttemptCount()));
            } else {
                item.markPermanentFailure(result.failure());
            }
        } catch (Exception ex) {
            MailFailure failure = MailFailureClassifier.classify(ex);
            if (failure.retryable()) {
                item.markRetryableFailure(failure, nextDelay(item.getAttemptCount()));
            } else {
                item.markPermanentFailure(failure);
            }
        }
    }
}
```

### 14.4 Important Transaction Boundary

Do **not** hold database lock while doing slow SMTP call if volume is high.

Better architecture:

1. transaction A: claim rows quickly;
2. outside transaction: send email;
3. transaction B: update result.

But then you must handle duplicate sends on crash between send and update.

This is the unavoidable side-effect problem.

Design choice:

| Approach | Pros | Cons |
|---|---|---|
| DB lock held during send | simpler status consistency | long lock, poor throughput |
| claim-send-update | scalable | duplicate possible on crash |
| broker with ack | scalable | still duplicate possible |
| provider idempotency key | best if supported | SMTP usually lacks native idempotency |

Conclusion:

> Email sending is an external side effect. Design for at-least-once and minimize duplicates with idempotency keys, dedupe state, and operational controls.

---

## 15. Transactional Event Listener Pattern

A tempting Spring pattern:

```java
@TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
public void onApplicationApproved(ApplicationApprovedEvent event) {
    mailService.sendApprovalEmail(event.applicationId());
}
```

### 15.1 Benefit

- avoids sending before transaction commits;
- keeps business service clean;
- good for low-criticality side effects.

### 15.2 Risk

- if app crashes after commit but before listener runs, email may be lost;
- no durable retry unless listener writes to outbox;
- failure is outside original transaction;
- hidden async behavior if combined with `@Async`.

Better pattern:

```java
@TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
public void onApplicationApproved(ApplicationApprovedEvent event) {
    outboxRepository.save(EmailOutboxEntity.from(event));
}
```

Or simply write outbox row directly inside application service.

---

## 16. Modern Java Considerations: Java 21/25 and Virtual Threads

Jakarta Mail SMTP operations are blocking I/O.

In Java 21+, virtual threads can make blocking easier to scale for I/O-heavy workloads:

```java
ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
```

Spring Boot can also use virtual threads in supported contexts via configuration.

But be careful:

> Virtual threads reduce thread cost; they do not remove SMTP provider limits, socket timeout needs, retry storm risk, or backpressure requirements.

### 16.1 When Virtual Threads Help

- many blocking SMTP sends;
- many IMAP mailbox polls;
- simple I/O-bound worker;
- you want simpler imperative code instead of reactive code.

### 16.2 When Virtual Threads Do Not Help

- provider rate limit is bottleneck;
- attachment reading is memory-heavy;
- template rendering is CPU-heavy;
- database locks are bottleneck;
- SMTP server serializes connection throughput;
- no timeout configured.

### 16.3 Recommended Model

Even with virtual threads:

```text
Bounded work queue
   + bounded concurrency
   + provider rate limiter
   + explicit timeout
   + retry policy
   + metrics
```

Do not use unbounded virtual-thread fan-out:

```java
// Dangerous if batch has 1 million emails
for (Email email : emails) {
    executor.submit(() -> send(email));
}
```

Better:

```text
claim limited batch
apply rate limiter
process with bounded concurrency
observe queue age
```

---

## 17. Spring Retry: Useful but Not Sufficient Alone

Spring Retry can wrap transient send attempts:

```java
@Retryable(
        retryFor = { MailSendException.class },
        maxAttempts = 3,
        backoff = @Backoff(delay = 1000, multiplier = 2.0)
)
public void sendWithRetry(MimeMessage message) {
    mailSender.send(message);
}
```

But this is only in-memory retry.

Problems:

- retry state lost on restart;
- no queue visibility;
- not ideal for long backoff;
- retry may happen inside request path;
- classification may be too coarse;
- can retry permanent failures.

Good use:

- small immediate retry for connection reset;
- transient provider hiccup;
- worker-level local resilience.

Not enough for:

- regulatory notification;
- critical account/security email;
- high volume mail;
- multi-hour retry schedule.

Preferred:

```text
Durable outbox retry
   + optional short local retry for narrow transient failures
```

---

## 18. Testing Spring Mail

### 18.1 Unit Test Composer Without SMTP

Test `MailMimeComposer` by creating `MimeMessage` from a test `Session`:

```java
@Test
void composeHtmlAndPlainTextEmail() throws Exception {
    Session session = Session.getInstance(new Properties());
    MimeMessage message = new MimeMessage(session);

    MailMimeComposer composer = new MailMimeComposer(properties);
    composer.compose(message, sampleResolvedEmail());

    assertThat(message.getSubject()).isEqualTo("Application Approved");
    assertThat(message.getAllRecipients()).hasSize(1);
    assertThat(message.getContentType()).contains("multipart");
}
```

This test does not require SMTP.

### 18.2 Mock JavaMailSender

For application service tests:

```java
@MockBean
JavaMailSender mailSender;
```

But mocking `MimeMessage` can be painful.

Better:

- business service should not depend on `JavaMailSender`;
- mock `NotificationCommandPort` or `MailDeliveryPort`;
- test mail adapter separately.

### 18.3 Fake SMTP Integration Test

Use fake SMTP such as MailHog/Mailpit/GreenMail-style server.

Test flow:

```text
Spring Boot app
   -> JavaMailSender
   -> fake SMTP
   -> assert received message
```

What to assert:

- recipient;
- subject;
- plain text body;
- HTML body;
- attachment count;
- attachment filename;
- content type;
- custom headers.

### 18.4 Testcontainers Pattern

Conceptual test:

```java
@SpringBootTest(properties = {
        "spring.mail.host=localhost",
        "spring.mail.port=${test.smtp.port}",
        "spring.mail.properties.mail.smtp.auth=false",
        "spring.mail.properties.mail.smtp.starttls.enable=false"
})
class MailIntegrationTest {
}
```

In real project, dynamic port is injected via `@DynamicPropertySource`.

### 18.5 Test Failure Cases

Do not only test happy path.

Test:

1. SMTP server unavailable;
2. connection timeout;
3. authentication failure;
4. invalid recipient;
5. large attachment rejection;
6. template rendering failure;
7. bad variable data;
8. duplicate outbox processing;
9. worker crash before status update;
10. retry exhaustion.

---

## 19. Observability in Spring Boot Mail

### 19.1 Logging Boundary

Log at application-level, not raw SMTP transcript by default.

Good log:

```json
{
  "event": "mail_send_attempt",
  "notificationId": "9f7c...",
  "templateId": "APPLICATION_APPROVED",
  "recipientHash": "sha256:...",
  "attempt": 2,
  "provider": "primary-smtp",
  "correlationId": "..."
}
```

Bad log:

```text
Sending email to john.doe@example.com with SMTP password secret123 and body ...
```

### 19.2 Metrics

Expose metrics:

| Metric | Type | Meaning |
|---|---|---|
| `mail.outbox.pending` | gauge | pending queue size |
| `mail.outbox.oldest_age_seconds` | gauge | oldest unsent item age |
| `mail.send.attempts` | counter | send attempts |
| `mail.send.accepted` | counter | SMTP/provider accepted |
| `mail.send.failed` | counter | failed attempts |
| `mail.send.failure` | counter with tag | failure by code |
| `mail.send.latency` | timer | SMTP send latency |
| `mail.retry.scheduled` | counter | retry scheduled |
| `mail.deadletter.total` | counter/gauge | dead-letter items |

### 19.3 Micrometer Wrapper

```java
@Component
public class MeteredMailDeliveryPort implements MailDeliveryPort {

    private final MailDeliveryPort delegate;
    private final MeterRegistry registry;

    public MeteredMailDeliveryPort(MailDeliveryPort delegate, MeterRegistry registry) {
        this.delegate = delegate;
        this.registry = registry;
    }

    @Override
    public MailDeliveryResult send(ResolvedEmail email) {
        Timer.Sample sample = Timer.start(registry);
        try {
            MailDeliveryResult result = delegate.send(email);
            registry.counter("mail.send.result", "status", result.status()).increment();
            return result;
        } catch (RuntimeException ex) {
            registry.counter("mail.send.result", "status", "exception").increment();
            throw ex;
        } finally {
            sample.stop(registry.timer("mail.send.latency"));
        }
    }
}
```

But avoid high-cardinality tags:

- do not tag by email address;
- do not tag by subject;
- do not tag by notification id;
- do not tag by raw error message.

Good tags:

- provider;
- template ID if bounded;
- failure code;
- environment;
- tenant if bounded/allowed.

---

## 20. Spring Boot Actuator Health for Mail

Spring Boot can expose health indicators depending auto-configuration and classpath.

However, mail health check must be designed carefully.

### 20.1 Dangerous Health Check

A health check that connects to SMTP every few seconds can:

- consume provider quota;
- trigger auth alarms;
- add latency;
- fail due transient network issue;
- mark app unhealthy even though core API is fine.

### 20.2 Better Health Model

Separate:

```text
Liveness
   -> app process alive
   -> should not depend on SMTP

Readiness
   -> app can serve traffic
   -> may include mail only if app's primary function requires mail

Mail subsystem health
   -> separate indicator/dashboard
   -> check recent send success, queue age, auth failures
```

Health should answer:

- Is SMTP credential valid?
- Is queue draining?
- Are failures spiking?
- Is provider reachable?

But not necessarily on every Kubernetes liveness probe.

---

## 21. Multi-Provider and Multi-Tenant Routing

Spring Boot's default `JavaMailSender` is single provider.

For advanced systems, you may need:

```text
tenant A -> smtp-a.example.com
tenant B -> smtp-b.example.com
system alerts -> internal relay
customer email -> external provider
bulk -> provider with campaign support
critical security email -> high-priority provider
```

### 21.1 Provider Registry

```java
public interface MailSenderRegistry {
    JavaMailSender resolve(MailRoute route);
}
```

```java
@Component
public class StaticMailSenderRegistry implements MailSenderRegistry {

    private final Map<String, JavaMailSender> senders;

    public StaticMailSenderRegistry(Map<String, JavaMailSender> senders) {
        this.senders = senders;
    }

    @Override
    public JavaMailSender resolve(MailRoute route) {
        JavaMailSender sender = senders.get(route.providerKey());
        if (sender == null) {
            throw new IllegalArgumentException("Unknown mail provider: " + route.providerKey());
        }
        return sender;
    }
}
```

### 21.2 Multiple Beans

```java
@Configuration
public class MultiMailSenderConfig {

    @Bean("primaryMailSender")
    JavaMailSender primaryMailSender() {
        return buildSender("smtp.primary.example.com", 587);
    }

    @Bean("secondaryMailSender")
    JavaMailSender secondaryMailSender() {
        return buildSender("smtp.secondary.example.com", 587);
    }

    private JavaMailSender buildSender(String host, int port) {
        JavaMailSenderImpl sender = new JavaMailSenderImpl();
        sender.setHost(host);
        sender.setPort(port);
        sender.setProtocol("smtp");
        sender.getJavaMailProperties().put("mail.smtp.connectiontimeout", "5000");
        sender.getJavaMailProperties().put("mail.smtp.timeout", "10000");
        sender.getJavaMailProperties().put("mail.smtp.writetimeout", "10000");
        return sender;
    }
}
```

### 21.3 Routing Policy

Do not route ad hoc in business code.

Centralize:

```java
public interface MailRoutingPolicy {
    MailRoute route(ResolvedEmail email);
}
```

Rules may depend on:

- tenant;
- domain;
- template category;
- criticality;
- provider health;
- compliance region;
- user preference;
- failover state.

---

## 22. Provider API vs JavaMailSender in Spring Boot

Some teams start with SMTP and later move to HTTP email provider APIs.

Do not let `JavaMailSender` become your domain boundary.

Use:

```java
public interface MailDeliveryPort {
    MailDeliveryResult send(ResolvedEmail email);
}
```

SMTP implementation:

```java
@Component
class SmtpMailDeliveryAdapter implements MailDeliveryPort {
    private final JavaMailSender mailSender;
}
```

HTTP API implementation:

```java
@Component
class SendGridMailDeliveryAdapter implements MailDeliveryPort {
    private final WebClient webClient;
}
```

Now migration is possible:

```text
Business code
   -> MailDeliveryPort
      -> SMTP adapter today
      -> Provider API adapter tomorrow
```

This is top-tier engineering discipline: depend on capability, not library.

---

## 23. Security in Spring Boot Mail Integration

### 23.1 Secrets

Do not commit:

```yaml
spring:
  mail:
    username: real-user
    password: real-password
```

Use environment/vault/secret manager:

```yaml
spring:
  mail:
    username: ${SMTP_USERNAME}
    password: ${SMTP_PASSWORD}
```

### 23.2 Redaction

Spring logs and exception messages can accidentally expose:

- host;
- username;
- recipient;
- subject;
- body snippet;
- provider response.

Implement centralized failure summary:

```java
public record SafeMailFailureLog(
        String notificationId,
        String templateId,
        String recipientHash,
        String failureCode,
        boolean retryable
) {}
```

### 23.3 Header Injection

Never directly set header values from untrusted input.

Bad:

```java
helper.setSubject(userInputSubject);
```

Better:

```java
helper.setSubject(HeaderSanitizer.safeSubject(rendered.subject()));
```

Sanitizer:

```java
public final class HeaderSanitizer {
    private HeaderSanitizer() {}

    public static String safeSubject(String value) {
        if (value == null || value.isBlank()) {
            return "Notification";
        }
        if (value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0) {
            throw new IllegalArgumentException("Header value contains CR/LF");
        }
        return value.strip();
    }
}
```

### 23.4 Attachment Security

Before calling `helper.addAttachment`, enforce:

- max file size;
- allowed content type;
- filename normalization;
- malware scan if needed;
- no path traversal;
- no executable attachment unless explicitly allowed;
- no sensitive file leak.

---

## 24. Common Mistakes in Spring Boot Mail

### Mistake 1 — No Timeout

Symptom:

```text
mail worker hangs randomly
queue stops draining
thread pool exhausted
```

Fix:

```yaml
spring.mail.properties.mail.smtp.connectiontimeout: 5000
spring.mail.properties.mail.smtp.timeout: 10000
spring.mail.properties.mail.smtp.writetimeout: 10000
```

### Mistake 2 — Sending Inside Business Transaction

Bad:

```java
@Transactional
public void approve() {
    repository.save(entity);
    mailSender.send(message);
}
```

Problem:

- SMTP succeeds but DB rolls back;
- DB lock held while SMTP slow;
- retry can duplicate business action;
- exception semantics become messy.

Fix: outbox.

### Mistake 3 — `@Async` Without Error Handling

Bad:

```java
@Async
public void send() {
    mailSender.send(message);
}
```

Failure may be invisible.

Fix:

- return `CompletableFuture`;
- capture result;
- update outbox;
- add async exception handler;
- metrics.

### Mistake 4 — HTML Only

Bad:

```java
helper.setText(html, true);
```

Better:

```java
helper.setText(plainText, html);
```

### Mistake 5 — Huge ByteArray Attachment

Bad:

```java
byte[] report = generateHugeReport();
helper.addAttachment("report.xlsx", new ByteArrayResource(report));
```

Fix:

- generate to temp file/object storage;
- attach stream/file if allowed;
- or send secure link instead.

### Mistake 6 — Mixing `javax.mail` and `jakarta.mail`

Bad in Boot 3:

```java
import javax.mail.internet.MimeMessage;
```

Correct:

```java
import jakarta.mail.internet.MimeMessage;
```

### Mistake 7 — Business Services Depend on `JavaMailSender`

Bad:

```java
@Service
class PaymentService {
    private final JavaMailSender mailSender;
}
```

Fix:

```java
private final NotificationCommandPort notifications;
```

### Mistake 8 — No Failure Taxonomy

Bad:

```java
catch (Exception e) {
    retryLater();
}
```

Fix:

```java
MailFailure failure = classifier.classify(e);
if (failure.retryable()) scheduleRetry(); else markPermanent();
```

---

## 25. Example: Production-Oriented Spring Boot Mail Module

### 25.1 Public Command

```java
public record SendTemplatedEmailCommand(
        String templateId,
        String recipientEmail,
        Locale locale,
        Map<String, Object> variables,
        String correlationId
) {}
```

### 25.2 Application Service

```java
@Service
public class NotificationApplicationService {

    private final EmailOutboxRepository outboxRepository;

    public NotificationApplicationService(EmailOutboxRepository outboxRepository) {
        this.outboxRepository = outboxRepository;
    }

    @Transactional
    public UUID requestEmail(SendTemplatedEmailCommand command) {
        EmailOutboxEntity outbox = EmailOutboxEntity.pending(
                UUID.randomUUID(),
                command.templateId(),
                command.recipientEmail(),
                command.locale(),
                command.variables(),
                command.correlationId()
        );

        outboxRepository.save(outbox);
        return outbox.getId();
    }
}
```

### 25.3 Worker

```java
@Component
public class EmailOutboxScheduledWorker {

    private final EmailOutboxProcessor processor;

    public EmailOutboxScheduledWorker(EmailOutboxProcessor processor) {
        this.processor = processor;
    }

    @Scheduled(fixedDelayString = "${app.mail.worker-delay:5000}")
    public void run() {
        processor.processDueBatch();
    }
}
```

### 25.4 Processor

```java
@Service
public class EmailOutboxProcessor {

    private final EmailOutboxRepository repository;
    private final MailTemplateRenderer renderer;
    private final MailDeliveryPort deliveryPort;

    public void processDueBatch() {
        List<UUID> ids = repository.claimDueIds(Instant.now(), 50);
        for (UUID id : ids) {
            processOne(id);
        }
    }

    public void processOne(UUID id) {
        EmailOutboxEntity item = repository.findById(id).orElseThrow();

        try {
            RenderedMailTemplate rendered = renderer.render(
                    new TemplateId(item.getTemplateId()),
                    item.getLocale(),
                    item.variablesAsMap()
            );

            ResolvedEmail email = ResolvedEmail.builder()
                    .notificationId(item.getId().toString())
                    .to(item.getRecipientEmail())
                    .subject(rendered.subject())
                    .plainText(rendered.plainText())
                    .html(rendered.html())
                    .correlationId(item.getCorrelationId())
                    .build();

            MailDeliveryResult result = deliveryPort.send(email);

            if (result.accepted()) {
                repository.markSent(id, Instant.now());
            } else {
                repository.markFailure(id, result.failure(), Instant.now());
            }
        } catch (Exception ex) {
            MailFailure failure = MailFailureClassifier.classify(ex);
            repository.markFailure(id, failure, Instant.now());
        }
    }
}
```

### 25.5 Delivery Adapter

```java
@Component
public class SpringJavaMailDeliveryAdapter implements MailDeliveryPort {

    private final JavaMailSender mailSender;
    private final MailMimeComposer composer;

    public SpringJavaMailDeliveryAdapter(JavaMailSender mailSender,
                                         MailMimeComposer composer) {
        this.mailSender = mailSender;
        this.composer = composer;
    }

    @Override
    public MailDeliveryResult send(ResolvedEmail email) {
        try {
            MimeMessage message = mailSender.createMimeMessage();
            composer.compose(message, email);
            mailSender.send(message);
            return MailDeliveryResult.accepted();
        } catch (Exception ex) {
            return MailDeliveryResult.failed(MailFailureClassifier.classify(ex));
        }
    }
}
```

This structure gives:

- clean boundary;
- testability;
- durable retry;
- migration path;
- observability;
- policy centralization.

---

## 26. Spring Boot Mail with OAuth2 SMTP

Some providers require OAuth2 instead of password authentication.

At Jakarta Mail layer, OAuth2 often maps to SASL XOAUTH2 or provider-specific support. In Spring Boot, you usually still configure properties via `spring.mail.properties.*`, but token acquisition/refresh is not automatically solved by Spring Mail.

Conceptual design:

```text
OAuth2 Token Provider
   -> fetch/refresh access token
   -> configure JavaMailSender password/token
   -> send
```

Problem:

- `JavaMailSenderImpl` is usually configured with static username/password;
- OAuth2 token expires;
- token refresh needs lifecycle management;
- concurrent sends must not stampede refresh endpoint.

Better abstraction:

```java
public interface SmtpCredentialProvider {
    SmtpCredential currentCredential();
}
```

Dynamic send:

```java
public class OAuth2JavaMailSenderFactory {

    public JavaMailSender createSender(SmtpCredential credential) {
        JavaMailSenderImpl sender = new JavaMailSenderImpl();
        sender.setHost("smtp.provider.com");
        sender.setPort(587);
        sender.setUsername(credential.username());
        sender.setPassword(credential.accessToken());
        sender.getJavaMailProperties().put("mail.smtp.auth", "true");
        sender.getJavaMailProperties().put("mail.smtp.auth.mechanisms", "XOAUTH2");
        sender.getJavaMailProperties().put("mail.smtp.starttls.enable", "true");
        sender.getJavaMailProperties().put("mail.smtp.starttls.required", "true");
        return sender;
    }
}
```

Production concerns:

1. token cache;
2. early refresh before expiry;
3. refresh lock;
4. token redaction;
5. auth failure classification;
6. fallback/alert if refresh fails.

---

## 27. Native Image / AOT Considerations

For modern Spring Boot applications targeting GraalVM native image/AOT, email can have extra considerations:

- Jakarta Mail provider discovery may rely on service loading;
- template engines may require reflection/resource hints;
- classpath resources for templates/images must be included;
- mailcap/content-type resources may need availability;
- tests should validate native runtime if native deployment is intended.

General guideline:

> Do not assume mail sending works in native image only because JVM tests pass. Build a native smoke test that sends to fake SMTP.

Smoke test should cover:

- create `MimeMessage`;
- render template;
- attach resource;
- send to fake SMTP;
- assert received MIME.

---

## 28. Configuration Profiles

Use profiles for environment-specific SMTP behavior.

### 28.1 Local

```yaml
spring:
  mail:
    host: localhost
    port: 1025
    properties:
      mail.smtp.auth: false
      mail.smtp.starttls.enable: false

app:
  mail:
    enabled: true
    from-address: dev-noreply@example.local
```

### 28.2 Test

```yaml
app:
  mail:
    enabled: false
```

Or route to fake SMTP.

### 28.3 UAT

```yaml
app:
  mail:
    enabled: true
    subject-prefix: "[UAT]"
    allowed-recipient-domains:
      - example.com
```

### 28.4 Production

```yaml
spring:
  mail:
    host: ${SMTP_HOST}
    port: 587
    username: ${SMTP_USERNAME}
    password: ${SMTP_PASSWORD}
    properties:
      mail.smtp.auth: true
      mail.smtp.starttls.enable: true
      mail.smtp.starttls.required: true
      mail.smtp.connectiontimeout: 5000
      mail.smtp.timeout: 10000
      mail.smtp.writetimeout: 10000

app:
  mail:
    enabled: true
    subject-prefix: ""
```

Safety controls for non-prod:

- recipient allowlist;
- subject prefix;
- footer label;
- forced BCC to test mailbox;
- block real external domains;
- template watermark.

---

## 29. Production Checklist for Spring Boot Mail

### Configuration

- [ ] `spring-boot-starter-mail` used.
- [ ] No manual conflicting `javax.mail`/`jakarta.mail` dependency.
- [ ] Timeout configured.
- [ ] STARTTLS or SSL configured correctly.
- [ ] Secrets externalized.
- [ ] Non-prod recipient guard exists.

### Architecture

- [ ] Business services do not inject `JavaMailSender` directly.
- [ ] `MailDeliveryPort` abstraction exists.
- [ ] Critical email uses outbox.
- [ ] Retry policy is durable.
- [ ] Permanent/retryable failure classification exists.
- [ ] Duplicate handling strategy documented.

### MIME

- [ ] UTF-8 enforced.
- [ ] Plain + HTML generated.
- [ ] Attachments size-limited.
- [ ] Filenames sanitized.
- [ ] Inline CID controlled.
- [ ] Header values sanitized.

### Security

- [ ] No SMTP password in logs.
- [ ] Recipients redacted/hashed in logs if required.
- [ ] Attachment scanning policy defined.
- [ ] No untrusted raw HTML injection.
- [ ] TLS required in production.

### Testing

- [ ] Unit test for renderer.
- [ ] Unit test for MIME composer.
- [ ] Integration test with fake SMTP.
- [ ] Failure classification tests.
- [ ] Outbox retry tests.
- [ ] Non-prod guard tests.

### Observability

- [ ] Send attempts metric.
- [ ] Success/failure metric.
- [ ] Failure code metric.
- [ ] Queue depth metric.
- [ ] Oldest pending age metric.
- [ ] Dead letter metric.
- [ ] Correlation ID logged.

---

## 30. Mental Model Akhir

Spring Boot membuat email lebih mudah, tetapi tidak membuat email menjadi sederhana.

Abstraction stack:

```text
Business Event
   -> Notification Command
   -> Outbox Row
   -> Worker
   -> Template Renderer
   -> MIME Composer
   -> MailDeliveryPort
   -> JavaMailSender
   -> Jakarta Mail Session/Transport
   -> SMTP Relay
   -> Mail Infrastructure
```

Spring's role:

```text
Spring Boot
   = wiring + configuration + lifecycle + abstraction

Jakarta Mail
   = mail protocol/message API

SMTP Provider
   = external delivery infrastructure

Your Application
   = reliability + policy + audit + security + user-facing semantics
```

Top 1% engineer distinction:

A normal implementation asks:

> How do I send an email in Spring Boot?

A strong implementation asks:

> What is the invariant of notification delivery, how do I preserve it across transaction boundary, provider failure, retry, duplicate, template change, audit requirement, and migration from SMTP to another provider?

That is the level of thinking expected for enterprise systems.

---

## 31. Ringkasan Part 18

Kita sudah membahas:

1. posisi Spring Boot sebagai integration layer di atas Jakarta Mail;
2. dependency dan namespace difference Boot 2 vs Boot 3;
3. konfigurasi `spring.mail.*`;
4. timeout/TLS/auth yang wajib;
5. `JavaMailSender`, `JavaMailSenderImpl`, `MimeMessageHelper`;
6. `SimpleMailMessage` vs `MimeMessage`;
7. clean architecture boundary;
8. template rendering;
9. centralized MIME composer;
10. Spring exception classification;
11. async sending dan limitasinya;
12. outbox integration;
13. event listener pattern;
14. virtual threads Java 21+;
15. testing with fake SMTP;
16. observability and metrics;
17. health checks;
18. multi-provider routing;
19. SMTP OAuth2 considerations;
20. native image/AOT considerations;
21. production checklist.

---

## 32. Apa yang Tidak Dibahas Mendalam di Part Ini

Agar tidak mengulang part sebelumnya dan menjaga efisiensi:

- detail MIME multipart sudah dibahas di Part 6;
- attachment/Activation detail sudah dibahas di Part 7;
- SMTP TLS/auth low-level detail sudah dibahas di Part 4 dan 13;
- retry/outbox deep detail sudah dibahas di Part 11;
- deliverability SPF/DKIM/DMARC sudah dibahas di Part 14;
- Jakarta EE container-managed session sudah dibahas di Part 17.

Part ini fokus pada:

> bagaimana semua mental model tersebut diterapkan dalam aplikasi Spring Boot modern.

---

## 33. Preview Part Berikutnya

Part berikutnya:

> **Part 19 — Testing Mail Systems: Unit, Integration, Contract, E2E**

Kita akan masuk jauh lebih detail ke:

- unit testing MIME builder;
- verifying multipart structure;
- fake SMTP;
- Testcontainers;
- golden raw MIME files;
- failure simulation;
- contract testing;
- non-flaky E2E email testing;
- testing outbox and retry;
- privacy-safe test data.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 17 — Jakarta Mail in Jakarta EE Containers](./17-jakarta-ee-container-managed-mail.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 19 — Testing Mail Systems](./19-testing-mail-systems.md)
