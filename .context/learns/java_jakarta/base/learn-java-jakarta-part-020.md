# learn-java-jakarta-part-020.md

# Bagian 20 — Jakarta Mail (`jakarta.mail`): SMTP, MIME, Attachment, dan Production Email Pipeline

> Target pembaca: Java engineer yang ingin memahami Jakarta Mail bukan sekadar `Transport.send(message)`, tetapi sebagai bagian dari **production communication pipeline**: SMTP, MIME, HTML/plain text, attachment, template rendering, queue-based sending, retry, bounce handling, deliverability, security, observability, throttling, dan audit.
>
> Fokus bagian ini: Jakarta Mail 2.1 API, `Session`, `Message`, `MimeMessage`, `Transport`, `InternetAddress`, `Multipart`, `MimeBodyPart`, attachment, inline image, SMTP properties, authentication, TLS, connection management, email queue, idempotency, retry/DLQ, bounce, suppression list, template versioning, testing, and failure modes.

---

## Daftar Isi

1. [Orientasi: Email Itu Bukan Sekadar Kirim String](#1-orientasi-email-itu-bukan-sekadar-kirim-string)
2. [Mental Model: Jakarta Mail sebagai Mail Client API](#2-mental-model-jakarta-mail-sebagai-mail-client-api)
3. [Jakarta Mail 2.1 dan Package `jakarta.mail`](#3-jakarta-mail-21-dan-package-jakartamail)
4. [Email Pipeline dalam Aplikasi Enterprise](#4-email-pipeline-dalam-aplikasi-enterprise)
5. [Jakarta Mail vs SMTP Provider API vs Spring Mail](#5-jakarta-mail-vs-smtp-provider-api-vs-spring-mail)
6. [Dependency, Provider, dan Runtime](#6-dependency-provider-dan-runtime)
7. [Core Concepts: `Session`, `Message`, `Address`, `Transport`, `Store`, `Folder`](#7-core-concepts-session-message-address-transport-store-folder)
8. [`Session`: Konfigurasi Mail Runtime](#8-session-konfigurasi-mail-runtime)
9. [SMTP Properties](#9-smtp-properties)
10. [Authentication dan TLS](#10-authentication-dan-tls)
11. [`MimeMessage`: Email Message Object](#11-mimemessage-email-message-object)
12. [`InternetAddress`: Address Parsing dan Validation](#12-internetaddress-address-parsing-dan-validation)
13. [Plain Text Email](#13-plain-text-email)
14. [HTML Email](#14-html-email)
15. [Multipart Email: Text + HTML Alternative](#15-multipart-email-text--html-alternative)
16. [Attachment](#16-attachment)
17. [Inline Image dan Content-ID](#17-inline-image-dan-content-id)
18. [Character Encoding dan Internationalization](#18-character-encoding-dan-internationalization)
19. [Headers: Subject, From, Reply-To, Message-ID, Custom Headers](#19-headers-subject-from-reply-to-message-id-custom-headers)
20. [Template Rendering](#20-template-rendering)
21. [Email Contract: Command vs Rendered Message](#21-email-contract-command-vs-rendered-message)
22. [Queue-Based Sending](#22-queue-based-sending)
23. [Retry, Backoff, DLQ, dan Idempotency](#23-retry-backoff-dlq-dan-idempotency)
24. [Bounce Handling](#24-bounce-handling)
25. [Suppression List dan Preference Management](#25-suppression-list-dan-preference-management)
26. [Deliverability: SPF, DKIM, DMARC, Reputation](#26-deliverability-spf-dkim-dmarc-reputation)
27. [Rate Limiting dan Throttling](#27-rate-limiting-dan-throttling)
28. [Transactional vs Marketing Email](#28-transactional-vs-marketing-email)
29. [Security dan Privacy](#29-security-dan-privacy)
30. [Attachment Security](#30-attachment-security)
31. [Inbound Mail: IMAP/POP3, Store, Folder](#31-inbound-mail-imappop3-store-folder)
32. [Email as Integration Boundary](#32-email-as-integration-boundary)
33. [Testing Strategy](#33-testing-strategy)
34. [Observability dan Audit](#34-observability-dan-audit)
35. [Performance Engineering](#35-performance-engineering)
36. [Production Failure Modes](#36-production-failure-modes)
37. [Best Practices dan Anti-Patterns](#37-best-practices-dan-anti-patterns)
38. [Checklist Review](#38-checklist-review)
39. [Case Study 1: Case Approval Notification](#39-case-study-1-case-approval-notification)
40. [Case Study 2: Attachment Besar dan Memory Spike](#40-case-study-2-attachment-besar-dan-memory-spike)
41. [Case Study 3: SMTP Down tapi Business Transaction Harus Tetap Commit](#41-case-study-3-smtp-down-tapi-business-transaction-harus-tetap-commit)
42. [Case Study 4: Bounce dan Suppression List](#42-case-study-4-bounce-dan-suppression-list)
43. [Latihan Bertahap](#43-latihan-bertahap)
44. [Mini Project: Jakarta Mail Production Pipeline Lab](#44-mini-project-jakarta-mail-production-pipeline-lab)
45. [Referensi Resmi](#45-referensi-resmi)

---

# 1. Orientasi: Email Itu Bukan Sekadar Kirim String

Banyak tutorial email berhenti di kode seperti:

```java
Transport.send(message);
```

Dalam production, email jauh lebih kompleks.

Pertanyaan yang harus dijawab:

1. Apakah email dikirim synchronous atau asynchronous?
2. Jika SMTP down, apakah business transaction gagal?
3. Apakah email boleh dikirim dua kali?
4. Bagaimana mencegah duplicate send saat retry?
5. Apakah template versioned?
6. Apakah payload email mengandung PII?
7. Bagaimana attachment dibuat dan divalidasi?
8. Apakah ukuran attachment aman?
9. Bagaimana bounce diproses?
10. Apakah recipient masuk suppression list?
11. Bagaimana rate limit provider?
12. Bagaimana audit membuktikan email dikirim?
13. Bagaimana tracing dari request sampai email?
14. Bagaimana testing tanpa mengirim email nyata?
15. Bagaimana deliverability dikelola?

Jakarta Mail adalah API untuk membangun mail message dan berkomunikasi dengan mail server. Tetapi production email pipeline membutuhkan desain sistem.

## 1.1 Email adalah side effect

Email adalah external side effect.

Seperti payment, SMS, webhook, atau file transfer, email bisa:

- gagal;
- lambat;
- duplicate;
- tertunda;
- diterima tapi masuk spam;
- diterima SMTP tapi bounce kemudian;
- diterima recipient tapi tidak dibaca;
- ditolak karena reputation;
- ditolak karena policy;
- ditolak karena attachment.

Jangan desain email seperti local method call.

## 1.2 Email bukan source of truth

Jangan jadikan email sebagai satu-satunya bukti business state.

Business state harus ada di database/audit.

Email adalah notification/communication channel.

## 1.3 Email harus asynchronous untuk use case penting

Untuk banyak aplikasi enterprise, flow yang lebih aman:

```text
business transaction commit
  ↓
insert outbox/email request
  ↓
worker sends email
  ↓
record delivery attempt
  ↓
retry/DLQ/suppression if needed
```

Bukan:

```text
open DB transaction
  ↓
send SMTP
  ↓
commit DB
```

---

# 2. Mental Model: Jakarta Mail sebagai Mail Client API

Jakarta Mail adalah API client-side untuk mail systems.

Ia menyediakan object model dan protocol abstraction untuk:

- membuat message;
- mengisi header;
- mengisi body;
- attachment;
- MIME;
- mengirim lewat SMTP;
- membaca mail store lewat IMAP/POP3;
- search/filter folder;
- event/listener.

## 2.1 Basic outbound flow

```text
Application
  ↓ create Session
  ↓ create MimeMessage
  ↓ set From/To/Subject/Body
  ↓ Transport sends via SMTP server
  ↓ SMTP server accepts/rejects
  ↓ remote mail infrastructure delivers/bounces
```

## 2.2 Important distinction

`Transport.send()` success biasanya berarti SMTP server menerima message untuk delivery.

Itu tidak selalu berarti recipient membaca email, atau bahkan mailbox final menerima email.

## 2.3 SMTP is store-and-forward

Email delivery melibatkan banyak server.

```text
your app
  ↓
SMTP relay/provider
  ↓
recipient MX server
  ↓
mailbox/spam/quarantine/bounce
```

## 2.4 MIME

Modern email is MIME structured content:

- plain text;
- HTML;
- attachments;
- inline images;
- alternative parts;
- mixed/related multipart;
- encoded headers;
- content transfer encoding.

Jakarta Mail membantu membangun struktur MIME ini.

## 2.5 Jakarta Activation

Attachment/data handling sering melibatkan Jakarta Activation:

- MIME type detection;
- data source;
- data handler.

---

# 3. Jakarta Mail 2.1 dan Package `jakarta.mail`

Jakarta Mail 2.1 menyediakan API untuk membangun mail dan messaging applications secara platform-independent dan protocol-independent.

Package utama:

```java
jakarta.mail
jakarta.mail.internet
jakarta.mail.search
jakarta.mail.event
jakarta.mail.util
```

## 3.1 Namespace modern

Old Java EE:

```java
javax.mail
javax.mail.internet
```

Modern Jakarta:

```java
jakarta.mail
jakarta.mail.internet
```

Migration bukan hanya import; dependency/provider juga harus sesuai.

## 3.2 API dan provider

Jakarta Mail API terdiri dari:

- application-level interface;
- service provider interface.

Application menggunakan API.

Provider menyediakan protocol implementation seperti SMTP/IMAP/POP3.

## 3.3 Java SE dan Jakarta EE

Jakarta Mail dapat dipakai di Java SE sebagai library.

Dalam Jakarta EE runtime, mail session bisa disediakan sebagai resource.

## 3.4 Minimum Java

Jakarta Mail 2.1 page menyebut minimum Java SE 11.

Dalam Jakarta EE 11 platform, runtime baseline Java SE 17 atau lebih tinggi.

## 3.5 Mail 2.2 milestone caution

Ada milestone versi lebih baru di ecosystem, tetapi untuk stable Jakarta EE production, gunakan versi yang didukung runtime target.

---

# 4. Email Pipeline dalam Aplikasi Enterprise

## 4.1 Naive pipeline

```java
public void approveCase(UUID caseId) {
    case.approve();
    repository.save(case);
    mailer.sendApprovalEmail(case); // synchronous
}
```

Problems:

- SMTP failure can break business flow;
- HTTP request waits;
- duplicate risk on retry;
- no audit attempt;
- poor observability;
- no rate control.

## 4.2 Better pipeline

```text
ApproveCaseUseCase
  ↓
DB transaction:
  - update case status
  - insert EmailRequested outbox
  ↓ commit
OutboxRelay
  ↓ publishes to EmailQueue
EmailWorker
  ↓ renders template
  ↓ sends SMTP
  ↓ records attempt/result
  ↓ retry/DLQ if needed
```

## 4.3 Why asynchronous?

Because email is external side effect and not required to block user request in many cases.

## 4.4 Email request record

Store:

```text
email_request_id
template_key
template_version
recipient
subject_data
body_data
business_reference
status
attempt_count
next_attempt_at
created_at
updated_at
```

## 4.5 Delivery attempt record

Store:

```text
email_attempt_id
email_request_id
provider
smtp_status
error_category
message_id
started_at
ended_at
duration_ms
```

## 4.6 Business vs delivery status

Business status:

```text
Case APPROVED
```

Email delivery status:

```text
PENDING / SENT / FAILED / SUPPRESSED / BOUNCED
```

Do not mix.

---

# 5. Jakarta Mail vs SMTP Provider API vs Spring Mail

## 5.1 Jakarta Mail

Standard Java/Jakarta API.

Pros:

- portable;
- low-level control;
- MIME support;
- SMTP/IMAP/POP3 abstraction;
- Jakarta EE integration.

Cons:

- verbose;
- deliverability/bounce/provider features not standardized;
- many SMTP properties.

## 5.2 SMTP provider REST API

Providers like SES/SendGrid/Mailgun/etc often have REST APIs.

Pros:

- templates;
- analytics;
- bounce webhooks;
- suppression;
- DKIM/domain tools;
- rate controls;
- better cloud integration.

Cons:

- provider lock-in;
- API-specific SDK;
- custom auth;
- different error model.

## 5.3 Spring Mail

Spring abstraction around JavaMailSender.

Good in Spring apps.

In pure Jakarta EE, Jakarta Mail direct or CDI wrapper is common.

## 5.4 Decision

Use Jakarta Mail when:

- SMTP relay is standard interface;
- Jakarta EE runtime provides mail session;
- portability matters;
- you need MIME control.

Use provider API when:

- you need provider-specific analytics/bounce/template features;
- SMTP is limited;
- API-based sending is preferred by infra.

## 5.5 Abstract your mail gateway

Application should depend on:

```java
interface EmailGateway {
    SendResult send(RenderedEmail email);
}
```

Implementation can use Jakarta Mail or provider API.

---

# 6. Dependency, Provider, dan Runtime

## 6.1 Maven API dependency

```xml
<dependency>
  <groupId>jakarta.mail</groupId>
  <artifactId>jakarta.mail-api</artifactId>
  <version>2.1.0</version>
</dependency>
```

If Jakarta EE runtime provides it:

```xml
<scope>provided</scope>
```

## 6.2 Implementation dependency

For standalone apps, API only is not enough.

You need implementation, for example Eclipse Angus Mail or runtime-provided provider.

Example concept:

```xml
<dependency>
  <groupId>org.eclipse.angus</groupId>
  <artifactId>angus-mail</artifactId>
  <version>...</version>
</dependency>
```

Use version compatible with Jakarta Mail API.

## 6.3 Jakarta Activation

For attachment/data source handling, you may also need Jakarta Activation implementation.

## 6.4 Jakarta EE mail resource

In Jakarta EE, app server can define mail session resource:

```java
@Resource(lookup = "java:app/mail/NotificationSession")
Session mailSession;
```

or:

```java
@Resource(lookup = "mail/NotificationSession")
Session mailSession;
```

depending server config.

## 6.5 Do not hardcode credentials

Bad:

```java
props.put("mail.smtp.password", "secret");
```

Use secret manager/runtime config.

## 6.6 Provider-specific behavior

SMTP property names are common but provider/runtime may have additional config.

Document.

---

# 7. Core Concepts: `Session`, `Message`, `Address`, `Transport`, `Store`, `Folder`

## 7.1 `Session`

Represents mail session/configuration.

Contains:

- properties;
- authenticator;
- provider lookup;
- debug config.

## 7.2 `Message`

Abstract email/message.

Common implementation:

```java
MimeMessage
```

## 7.3 `Address`

Represents email address.

Common implementation:

```java
InternetAddress
```

## 7.4 `Transport`

Sends messages.

For outbound email, typically SMTP transport.

## 7.5 `Store`

Accesses message store.

For inbound email, typically IMAP/POP3.

## 7.6 `Folder`

Folder/mailbox inside store.

Example:

```text
INBOX
Archive
Sent
```

## 7.7 Mental model

```text
Session: config
MimeMessage: email object
InternetAddress: sender/recipient
Transport: outbound protocol
Store/Folder: inbound mailbox protocol
```

---

# 8. `Session`: Konfigurasi Mail Runtime

## 8.1 Create session manually

```java
Properties props = new Properties();
props.put("mail.smtp.host", "smtp.example.com");
props.put("mail.smtp.port", "587");
props.put("mail.smtp.auth", "true");
props.put("mail.smtp.starttls.enable", "true");

Session session = Session.getInstance(props, new Authenticator() {
    @Override
    protected PasswordAuthentication getPasswordAuthentication() {
        return new PasswordAuthentication(username, password);
    }
});
```

## 8.2 Use container-managed session

```java
@Resource(lookup = "java:app/mail/NotificationSession")
Session session;
```

Prefer this in Jakarta EE if infrastructure provides mail resources.

## 8.3 Session debug

```java
session.setDebug(true);
```

Do not enable in production unless controlled, because debug may expose sensitive info.

## 8.4 Session is configuration object

Do not put per-email mutable business state in session.

## 8.5 Session creation cost

Creating session is usually cheap, but transport connection is not.

For high throughput, manage connections carefully or use provider/runtime pooling if available.

## 8.6 Authenticator

Authenticator supplies credentials when needed.

Secrets should come from secure config.

---

# 9. SMTP Properties

Common SMTP properties:

```properties
mail.smtp.host=smtp.example.com
mail.smtp.port=587
mail.smtp.auth=true
mail.smtp.starttls.enable=true
mail.smtp.starttls.required=true
mail.smtp.connectiontimeout=10000
mail.smtp.timeout=10000
mail.smtp.writetimeout=10000
mail.smtp.ssl.checkserveridentity=true
```

## 9.1 Host/port

Typical:

- 25: server-to-server SMTP, relay/internal;
- 465: implicit TLS SMTP;
- 587: submission with STARTTLS.

Use provider recommendation.

## 9.2 Timeouts

Always configure:

- connection timeout;
- read timeout;
- write timeout.

Without timeouts, sending thread can hang.

## 9.3 STARTTLS

Use:

```properties
mail.smtp.starttls.enable=true
mail.smtp.starttls.required=true
```

If required, connection fails when TLS cannot be negotiated.

## 9.4 Server identity

Use:

```properties
mail.smtp.ssl.checkserveridentity=true
```

to verify server certificate identity where supported.

## 9.5 Debug

```properties
mail.debug=true
```

Use only in safe environments.

## 9.6 Provider-specific properties

Some providers support extra properties.

Document them.

---

# 10. Authentication dan TLS

## 10.1 SMTP AUTH

Most SMTP submission requires authentication.

Authenticator:

```java
Session.getInstance(props, new Authenticator() {
    protected PasswordAuthentication getPasswordAuthentication() {
        return new PasswordAuthentication(user, pass);
    }
});
```

## 10.2 TLS

Use TLS to protect credentials and content in transit to SMTP server.

## 10.3 Implicit TLS vs STARTTLS

Implicit TLS starts encrypted connection from beginning.

STARTTLS upgrades plaintext connection to TLS.

Both can be secure if configured correctly.

## 10.4 Require TLS

Do not silently downgrade.

Use required TLS where possible.

## 10.5 Secret rotation

SMTP credentials should be rotatable without code change.

## 10.6 Principle of least privilege

Use credentials scoped only to mail sending.

## 10.7 Network controls

Restrict outbound SMTP to approved relay/provider.

## 10.8 Avoid open relay

Never run unauthenticated open SMTP relay.

---

# 11. `MimeMessage`: Email Message Object

`MimeMessage` represents MIME-style email message.

## 11.1 Basic construction

```java
MimeMessage message = new MimeMessage(session);
message.setFrom(new InternetAddress("noreply@example.com", "Example App"));
message.setRecipients(Message.RecipientType.TO, InternetAddress.parse("user@example.com"));
message.setSubject("Case approved", StandardCharsets.UTF_8.name());
message.setText("Your case has been approved.", StandardCharsets.UTF_8.name());
message.setSentDate(new Date());

Transport.send(message);
```

## 11.2 Required fields

At minimum:

- From;
- To/Cc/Bcc;
- Subject;
- body;
- date if not set by provider.

## 11.3 Save changes

`saveChanges()` updates headers as needed.

`Transport.send()` may call it if needed.

## 11.4 Message-ID

Provider/message may generate Message-ID.

For audit, store:

- internal emailRequestId;
- generated message ID if available;
- provider response if available.

## 11.5 Do not reuse MimeMessage concurrently

Create message per email.

## 11.6 Bcc

Bcc recipients should not appear in visible headers.

Use API correctly.

---

# 12. `InternetAddress`: Address Parsing dan Validation

## 12.1 Create address

```java
InternetAddress address =
    new InternetAddress("user@example.com", "User Name", StandardCharsets.UTF_8.name());
```

## 12.2 Parse list

```java
InternetAddress[] recipients =
    InternetAddress.parse("a@example.com,b@example.com", true);
```

## 12.3 Strict validation

Use strict parse/validate where appropriate.

```java
address.validate();
```

## 12.4 Validation is not deliverability

Syntax-valid email may still bounce.

## 12.5 International addresses

Email address internationalization is complex.

Provider/server support matters.

## 12.6 Display name encoding

Use constructors/methods that encode personal names correctly.

## 12.7 Avoid header injection

Never concatenate untrusted display name/email into raw headers.

Use `InternetAddress`.

---

# 13. Plain Text Email

## 13.1 Use case

Plain text is simple and accessible.

```java
message.setText(
    "Hello,\n\nYour case has been approved.\n\nRegards,\nSystem",
    StandardCharsets.UTF_8.name()
);
```

## 13.2 Advantages

- low complexity;
- readable everywhere;
- less phishing-looking;
- easy testing;
- accessible.

## 13.3 Limitations

- no styling;
- links less polished;
- less branding.

## 13.4 Best practice

Always include plain text alternative even when sending HTML email.

## 13.5 Line length

Email has old protocol conventions; Jakarta Mail handles much encoding, but template should still be reasonable.

---

# 14. HTML Email

## 14.1 Basic HTML

```java
message.setContent(html, "text/html; charset=UTF-8");
```

## 14.2 HTML email is not web page

Email clients have limited CSS/HTML support.

Avoid:

- complex JS;
- external scripts;
- advanced CSS;
- forms;
- unsafe dynamic HTML.

## 14.3 Escape user content

If template includes user data, HTML-escape it.

Bad:

```html
<p>Hello ${name}</p>
```

if name is unescaped.

## 14.4 Links

Use absolute URLs.

Include tracking parameters only if privacy/compliance allows.

## 14.5 Accessibility

Use semantic markup, alt text, readable contrast.

## 14.6 Dark mode

Email client dark mode can alter colors.

Test.

---

# 15. Multipart Email: Text + HTML Alternative

Best practice for HTML email:

```text
multipart/alternative
  part 1: text/plain
  part 2: text/html
```

## 15.1 Example

```java
MimeBodyPart textPart = new MimeBodyPart();
textPart.setText(textBody, StandardCharsets.UTF_8.name());

MimeBodyPart htmlPart = new MimeBodyPart();
htmlPart.setContent(htmlBody, "text/html; charset=UTF-8");

MimeMultipart alternative = new MimeMultipart("alternative");
alternative.addBodyPart(textPart);
alternative.addBodyPart(htmlPart);

message.setContent(alternative);
```

## 15.2 Order matters

Plain text first, HTML second.

## 15.3 Why alternative?

Email client chooses best supported representation.

## 15.4 Accessibility and deliverability

Plain text alternative improves compatibility and can help deliverability perception.

## 15.5 Testing

Inspect raw MIME output.

---

# 16. Attachment

## 16.1 Basic attachment

```java
MimeBodyPart bodyPart = new MimeBodyPart();
bodyPart.setContent(htmlBody, "text/html; charset=UTF-8");

MimeBodyPart attachment = new MimeBodyPart();
attachment.attachFile(file);

MimeMultipart multipart = new MimeMultipart();
multipart.addBodyPart(bodyPart);
multipart.addBodyPart(attachment);

message.setContent(multipart);
```

## 16.2 Use DataSource for controlled source

```java
DataSource source = new FileDataSource(file);
MimeBodyPart attachment = new MimeBodyPart();
attachment.setDataHandler(new DataHandler(source));
attachment.setFileName(MimeUtility.encodeText(filename, "UTF-8", null));
```

## 16.3 Attachment size

Providers often limit total message size.

Email attachment encoding increases size.

Rule of thumb: base64 inflates roughly 33%.

## 16.4 Do not attach huge files

For large files, send secure download link.

## 16.5 Attachment MIME type

Set content type carefully.

## 16.6 Filename safety

Sanitize filename.

No path traversal.

## 16.7 Virus/malware scan

Scan generated/uploaded attachment before sending.

---

# 17. Inline Image dan Content-ID

## 17.1 Use case

HTML references embedded image:

```html
<img src="cid:logo">
```

## 17.2 MIME structure

Often:

```text
multipart/related
  html part
  image part with Content-ID: <logo>
```

## 17.3 Example concept

```java
MimeBodyPart htmlPart = new MimeBodyPart();
htmlPart.setContent("<img src=\"cid:logo\">", "text/html; charset=UTF-8");

MimeBodyPart imagePart = new MimeBodyPart();
imagePart.attachFile(logoFile);
imagePart.setHeader("Content-ID", "<logo>");
imagePart.setDisposition(MimeBodyPart.INLINE);

MimeMultipart related = new MimeMultipart("related");
related.addBodyPart(htmlPart);
related.addBodyPart(imagePart);

message.setContent(related);
```

## 17.4 Caution

Many clients block images by default.

Inline images increase size.

## 17.5 Alternative

Use hosted images from trusted CDN, but privacy/client loading behavior matters.

## 17.6 Test clients

Test with Gmail, Outlook, Apple Mail, mobile clients if important.

---

# 18. Character Encoding dan Internationalization

## 18.1 Use UTF-8

Always specify UTF-8 for subject/body.

```java
message.setSubject(subject, "UTF-8");
message.setText(text, "UTF-8");
```

## 18.2 Display names

```java
new InternetAddress(email, personalName, "UTF-8");
```

## 18.3 Filename encoding

```java
attachment.setFileName(MimeUtility.encodeText(filename, "UTF-8", null));
```

## 18.4 Locale-aware templates

Use user locale.

```text
template_key = CASE_APPROVED
locale = en-SG / id-ID
```

## 18.5 Timezone

Display dates in recipient/business timezone.

## 18.6 Right-to-left languages

HTML template may need direction handling.

## 18.7 Fallback locale

If translation missing, fallback safely.

---

# 19. Headers: Subject, From, Reply-To, Message-ID, Custom Headers

## 19.1 From

Use verified sender/domain.

```java
message.setFrom(new InternetAddress("noreply@example.com", "Example App"));
```

## 19.2 Reply-To

If recipient should reply to support:

```java
message.setReplyTo(new Address[] {
    new InternetAddress("support@example.com", "Support")
});
```

## 19.3 Subject

Keep concise, no secrets.

## 19.4 Message-ID

Can help threading and diagnostics.

Often generated by mail system.

## 19.5 Custom headers

Use for tracing:

```java
message.setHeader("X-Correlation-ID", correlationId);
message.setHeader("X-Email-Request-ID", emailRequestId);
```

Do not expose secrets.

## 19.6 List-Unsubscribe

For marketing/bulk email, include unsubscribe headers.

## 19.7 Header injection

Never build raw headers from untrusted input.

Use API methods and validate values.

---

# 20. Template Rendering

## 20.1 Template engine

Use template engine:

- FreeMarker;
- Thymeleaf;
- Mustache;
- Pebble;
- server-side rendering library.

## 20.2 Template data object

```java
public record CaseApprovedEmailModel(
    String recipientName,
    String caseNumber,
    String approvalDate,
    URI caseUrl
) {}
```

## 20.3 Avoid rendering in entity

Bad:

```java
case.toEmailHtml()
```

Entity should not know email template.

## 20.4 Template versioning

Store:

```text
template_key
template_version
locale
```

for audit/replay.

## 20.5 Escaping

HTML template must escape dynamic content by default.

## 20.6 Plain text and HTML generated together

Keep both consistent.

## 20.7 Preview

Build preview/dev tool to inspect rendered emails.

## 20.8 Snapshot tests

Test rendered template output with golden files.

---

# 21. Email Contract: Command vs Rendered Message

## 21.1 Email command

Represents intent:

```json
{
  "emailRequestId": "...",
  "templateKey": "CASE_APPROVED",
  "recipient": "user@example.com",
  "locale": "en-SG",
  "model": {
    "caseNumber": "CASE-001"
  }
}
```

## 21.2 Rendered email

Represents final message:

```text
From
To
Subject
Text body
HTML body
Attachments
Headers
```

## 21.3 Store command, not necessarily rendered body

For privacy, you may avoid storing full rendered body if it contains PII.

Alternative:

- store template key/version and model reference;
- store hash of rendered content;
- store minimal audit.

## 21.4 Re-render risk

If template changes, replay may render differently.

Store template version.

## 21.5 Audit requirement

Some regulated systems may need exact copy of sent email.

Then store rendered content securely with retention policy.

## 21.6 Separate model from transport

Application creates email command.

Email service renders and sends.

---

# 22. Queue-Based Sending

## 22.1 Why queue?

Email sending can be slow/unreliable.

Use queue to decouple.

```text
Application → EmailQueue → EmailWorker → SMTP
```

## 22.2 EmailRequested message

```json
{
  "emailRequestId": "uuid",
  "templateKey": "CASE_APPROVED",
  "templateVersion": 3,
  "recipient": "user@example.com",
  "locale": "en-SG",
  "model": {...},
  "correlationId": "uuid",
  "createdAt": "2026-06-12T10:00:00Z"
}
```

## 22.3 Worker responsibilities

- validate request;
- check suppression/preferences;
- render template;
- build MIME;
- send SMTP;
- record attempt;
- retry or fail.

## 22.4 Avoid sending inside DB transaction

Preferred:

```text
commit DB
then async email
```

Unless email sending is truly part of atomic transaction, which is rare.

## 22.5 Idempotency

Worker must ensure same `emailRequestId` is not sent twice accidentally.

## 22.6 Scaling workers

Multiple workers can send concurrently, but respect provider rate limits.

---

# 23. Retry, Backoff, DLQ, dan Idempotency

## 23.1 Retryable failures

Examples:

- SMTP temporary 4xx;
- network timeout;
- provider throttling;
- transient DNS issue;
- connection reset.

## 23.2 Non-retryable failures

Examples:

- invalid recipient format;
- suppressed recipient;
- template missing;
- invalid attachment;
- permanent SMTP 5xx depending code;
- auth failure until config fixed.

## 23.3 Backoff

Use exponential backoff with jitter:

```text
1m, 5m, 15m, 1h, 6h
```

## 23.4 DLQ

After max attempts, move to DLQ/manual review.

## 23.5 Idempotency

Before send:

```text
if email_request.status == SENT:
    no-op
else attempt send
```

But race conditions require transaction/locking.

## 23.6 Provider accepted but app crashed

Hard case:

```text
SMTP accepted message
app crashes before marking SENT
```

Retry may send duplicate.

Mitigations:

- provider idempotency key if available;
- store attempt before send;
- use deterministic Message-ID;
- suppression/dedup at application level;
- tolerate occasional duplicate if business permits;
- mark uncertain status and manual reconcile.

## 23.7 Exactly-once email is hard

Email is external side effect. Aim for controlled duplicate risk and idempotent business semantics.

---

# 24. Bounce Handling

## 24.1 Bounce

Bounce means delivery failed after SMTP acceptance or at recipient mail infrastructure.

Types:

- hard bounce;
- soft bounce;
- block;
- spam complaint;
- out-of-office auto reply.

## 24.2 SMTP send success is not final delivery

Provider may accept message then later generate bounce.

## 24.3 Bounce processing methods

- provider webhook;
- bounce mailbox via IMAP;
- DSN processing;
- provider API polling.

## 24.4 Store bounce event

```text
email_request_id
recipient
bounce_type
smtp_code
reason
received_at
provider_message_id
```

## 24.5 Suppression

Hard bounce should usually suppress future sends to recipient until fixed.

## 24.6 Auto-replies

Do not treat all replies as failure.

## 24.7 Complaints

Spam complaints are serious. Suppress and investigate.

---

# 25. Suppression List dan Preference Management

## 25.1 Suppression list

List of recipients not to send to.

Reasons:

- hard bounce;
- complaint;
- unsubscribe;
- legal request;
- admin suppression;
- invalid address.

## 25.2 Transactional email

Some transactional emails may still be required even if marketing unsubscribed.

Separate preference categories.

## 25.3 Preference model

```text
recipient
category
status: opted_in / opted_out / suppressed
reason
updated_at
```

## 25.4 Check before send

Worker should check preferences/suppression before SMTP.

## 25.5 Audit

Record suppression reason.

## 25.6 Privacy/legal

Respect unsubscribe and data protection requirements.

## 25.7 Don't rely only on provider suppression

Keep internal suppression state if business needs audit/control.

---

# 26. Deliverability: SPF, DKIM, DMARC, Reputation

Jakarta Mail can compose/send email, but deliverability depends on email infrastructure.

## 26.1 SPF

SPF authorizes sending servers for a domain.

## 26.2 DKIM

DKIM signs messages cryptographically.

Usually handled by SMTP provider/relay.

## 26.3 DMARC

DMARC policy tells receivers how to handle SPF/DKIM alignment failures.

## 26.4 Reputation

Reputation affected by:

- bounce rate;
- spam complaints;
- content quality;
- sending volume;
- domain/IP warm-up;
- authentication;
- blocklists.

## 26.5 Jakarta Mail role

Jakarta Mail does not magically improve deliverability.

It builds valid email and sends through configured transport.

## 26.6 Production responsibility

Work with infra/provider to configure:

- verified domain;
- DNS records;
- DKIM signing;
- bounce handling;
- rate limits;
- monitoring.

---

# 27. Rate Limiting dan Throttling

## 27.1 Provider limits

SMTP/provider may limit:

- messages per second;
- messages per day;
- recipients per message;
- concurrent connections;
- attachment size;
- recipient domain rate.

## 27.2 Throttling design

Email worker should enforce:

- global rate limit;
- per-provider limit;
- per-recipient/domain limit;
- per-tenant limit.

## 27.3 Backpressure

If queue grows, do not blindly spawn unlimited senders.

## 27.4 Bulk sending

For bulk campaigns, use provider designed for bulk email.

Jakarta Mail direct SMTP from app may not be suitable.

## 27.5 Retry after throttling

Respect retry-after/provider response if available.

## 27.6 Avoid burst after outage

When SMTP recovers, backlog can create burst.

Use controlled drain.

---

# 28. Transactional vs Marketing Email

## 28.1 Transactional email

Triggered by user/business action.

Examples:

- password reset;
- application submitted;
- case approved;
- payment receipt;
- security alert.

## 28.2 Marketing email

Campaign/promotional.

Examples:

- newsletter;
- product updates;
- offers.

## 28.3 Different rules

Transactional:

- often higher priority;
- legal/business obligation;
- user may not opt out from critical ones;
- strict audit.

Marketing:

- unsubscribe mandatory;
- preference management;
- deliverability/campaign tracking;
- consent.

## 28.4 Separate infrastructure

Often use separate sender domain/IP/pool.

## 28.5 Separate templates and queues

```text
TransactionalEmailQueue
MarketingEmailQueue
```

## 28.6 Avoid mixing

Marketing spike should not delay password reset email.

---

# 29. Security dan Privacy

## 29.1 Email is not secure by default

Email can pass through many servers.

Do not send secrets unless unavoidable.

## 29.2 Sensitive information

Avoid sending:

- passwords;
- full personal data;
- full document content;
- tokens;
- private identifiers;
- internal stack traces.

## 29.3 Password reset

Send short-lived one-time link/token.

Do not send password.

## 29.4 Link security

Links should:

- use HTTPS;
- contain opaque token;
- expire;
- be single-use for sensitive flows;
- not leak PII in URL.

## 29.5 Header leakage

Custom headers may be visible.

Do not put secrets in headers.

## 29.6 Template injection

Escape dynamic content.

## 29.7 Access control for attachments

If sending link instead of attachment, require auth or signed short-lived URL.

## 29.8 Audit retention

Stored emails may contain PII. Apply retention and access control.

---

# 30. Attachment Security

## 30.1 Source validation

Attachment may come from:

- generated PDF;
- uploaded user file;
- database export;
- object storage.

Validate source.

## 30.2 Malware scan

Uploaded attachments should be scanned.

## 30.3 File type allowlist

Use allowlist.

Avoid dangerous types:

- executable;
- macro-enabled documents;
- script files.

## 30.4 Size limit

Set limit per attachment and total email.

## 30.5 Filename sanitization

Remove path separators/control chars.

## 30.6 Content-type mismatch

Do not trust extension only.

Check magic bytes where possible.

## 30.7 Secure link alternative

For sensitive/large files, send link with access control.

## 30.8 Attachment generation idempotency

Generated attachment should be deterministic or stored once per email request.

---

# 31. Inbound Mail: IMAP/POP3, Store, Folder

Jakarta Mail can also read email.

## 31.1 Store

```java
Store store = session.getStore("imap");
store.connect(host, user, pass);
```

## 31.2 Folder

```java
Folder inbox = store.getFolder("INBOX");
inbox.open(Folder.READ_ONLY);
Message[] messages = inbox.getMessages();
```

## 31.3 Use cases

- bounce mailbox processing;
- inbound support tickets;
- email-to-case;
- mailbox monitoring;
- legacy integration.

## 31.4 IMAP vs POP3

IMAP keeps folders on server and supports richer mailbox operations.

POP3 is simpler retrieval.

## 31.5 Inbound security

Inbound email is untrusted input.

Parse defensively:

- attachments;
- HTML;
- spoofed sender;
- huge messages;
- malformed MIME;
- zip bombs;
- phishing content.

## 31.6 Prefer provider webhooks for bounce

If provider offers signed webhooks, that may be better than parsing bounce mailbox.

---

# 32. Email as Integration Boundary

Email is sometimes used as integration transport.

Examples:

- email-to-ticket;
- incoming forms;
- regulatory correspondence;
- automated mailbox ingestion.

## 32.1 Risks

- sender spoofing;
- unreliable structure;
- human formatting changes;
- attachment malware;
- mailbox quota;
- delay;
- duplicate messages;
- threading ambiguity.

## 32.2 Inbound pipeline

```text
poll mailbox / receive webhook
  ↓
deduplicate by Message-ID/provider ID
  ↓
validate sender/signature if any
  ↓
parse MIME safely
  ↓
scan attachments
  ↓
classify
  ↓
create business record
  ↓
archive raw email if required
```

## 32.3 Dedup

Use:

- Message-ID;
- mailbox UID;
- hash;
- provider event ID.

## 32.4 Audit

Keep raw email if required by compliance.

Store securely.

## 32.5 Human ambiguity

Do not over-automate legal/business interpretation without review where necessary.

---

# 33. Testing Strategy

## 33.1 Unit test template rendering

Render template with model.

Assert text/html output.

## 33.2 Snapshot tests

Use golden files for email output.

## 33.3 MIME structure tests

Assert:

- multipart alternative exists;
- text and HTML parts;
- attachment filename;
- content type;
- headers.

## 33.4 Fake SMTP server

Use test SMTP server such as:

- GreenMail;
- MailHog/Mailpit;
- local test container;
- provider sandbox.

## 33.5 Do not send real email in unit tests

Use fake transport or SMTP sandbox.

## 33.6 Integration test

Test actual Jakarta Mail send to fake SMTP.

## 33.7 Retry tests

Simulate SMTP 4xx/timeouts.

## 33.8 Bounce tests

Simulate webhook or bounce mailbox.

## 33.9 Security tests

- header injection;
- HTML injection;
- attachment filename traversal;
- huge attachment;
- invalid recipient.

## 33.10 Deliverability tests

Use provider/domain sandbox for real deliverability checks.

---

# 34. Observability dan Audit

## 34.1 Logs

Log:

- emailRequestId;
- correlationId;
- templateKey/version;
- recipient domain or masked recipient;
- provider;
- attempt number;
- result category;
- duration;
- SMTP status if safe.

Do not log full recipient/body in high-volume logs unless policy allows.

## 34.2 Metrics

Track:

- send requested;
- send success;
- send failure;
- retry count;
- DLQ count;
- bounce count;
- suppression count;
- send latency;
- queue age;
- provider throttle count.

## 34.3 Tracing

Propagate correlation ID from business request to email request and worker.

## 34.4 Audit

Audit important email:

```text
case approval notice sent to applicant
```

Store:

- business reference;
- recipient;
- template;
- timestamp;
- status;
- attempt result.

## 34.5 PII caution

Audit records may contain PII.

Apply access control.

## 34.6 Dashboards

Have dashboard for:

- pending email backlog;
- failed emails;
- DLQ;
- bounce rate;
- provider errors;
- latency percentiles.

---

# 35. Performance Engineering

## 35.1 Connection reuse

Opening SMTP connection per email can be expensive.

Options:

- provider connection pooling if available;
- batch sends;
- worker connection lifecycle;
- app server mail resource.

## 35.2 Threading

Do not spawn unbounded threads for email.

Use bounded executor/queue.

## 35.3 Attachment memory

Avoid loading large attachment fully into memory.

Use streaming/file/object storage.

## 35.4 Template rendering cost

Cache parsed templates.

Do not cache rendered user-specific content unless safe.

## 35.5 Bulk email

Batch carefully.

Respect provider limits.

## 35.6 Backpressure

If provider slow, queue grows.

Set alert and throttle producers/workers.

## 35.7 Timeout

Configure SMTP timeouts.

## 35.8 Garbage

Large MIME messages can allocate heavily.

Monitor memory during attachment-heavy workloads.

---

# 36. Production Failure Modes

## 36.1 SMTP timeout hangs request

Cause:

- synchronous send;
- no timeout.

Fix:

- async queue;
- SMTP timeouts.

## 36.2 Duplicate email

Cause:

- retry after provider accepted message but app didn't mark sent.

Fix:

- idempotency;
- deterministic Message-ID/provider idempotency if available;
- attempt tracking.

## 36.3 Email lost after DB commit

Cause:

- no outbox; send failed after business commit.

Fix:

- outbox/email_request table.

## 36.4 Business transaction rolled back after email sent

Cause:

- send email before DB commit.

Fix:

- send after commit/outbox.

## 36.5 Attachment OOM

Cause:

- readAllBytes for huge attachment.

Fix:

- size limit and streaming.

## 36.6 Header injection

Cause:

- raw concatenated header from user input.

Fix:

- use `InternetAddress`, validate header values.

## 36.7 HTML injection

Cause:

- unescaped user data in template.

Fix:

- autoescape.

## 36.8 Bounce ignored

Cause:

- no bounce pipeline.

Fix:

- webhook/IMAP bounce handling and suppression.

## 36.9 Provider throttling

Cause:

- send too fast.

Fix:

- rate limiter/backoff.

## 36.10 Spam folder

Cause:

- deliverability misconfig/content/reputation.

Fix:

- SPF/DKIM/DMARC, content review, provider monitoring.

## 36.11 Secrets in logs

Cause:

- mail debug enabled or logs headers.

Fix:

- disable debug/mask.

## 36.12 Wrong recipients

Cause:

- environment config uses real email in staging.

Fix:

- recipient override/sandbox in non-prod.

---

# 37. Best Practices dan Anti-Patterns

## 37.1 Best practices

- Use async email pipeline for important flows.
- Use outbox for DB + email request consistency.
- Use UTF-8.
- Send text + HTML alternative.
- Keep email body/subject free of secrets.
- Use secure SMTP/TLS.
- Configure timeouts.
- Sanitize and validate addresses.
- Escape template data.
- Limit attachment size.
- Use DLQ/retry/backoff.
- Track attempts and audit.
- Handle bounces.
- Maintain suppression list.
- Monitor queue/backlog/failures.
- Test with fake SMTP.

## 37.2 Anti-pattern: Send email inside DB transaction

External side effect inside DB transaction is risky.

## 37.3 Anti-pattern: Synchronous email in HTTP request

Leads to latency/failure coupling.

## 37.4 Anti-pattern: No idempotency

Duplicate emails will happen eventually.

## 37.5 Anti-pattern: HTML only

Some clients/security tools prefer plain text alternative.

## 37.6 Anti-pattern: Attach huge files

Use secure link.

## 37.7 Anti-pattern: Store SMTP password in code

Use secret manager/config.

## 37.8 Anti-pattern: Ignore bounce

Hard bounces hurt deliverability.

---

# 38. Checklist Review

## 38.1 Configuration

- [ ] SMTP host/port externalized?
- [ ] Authentication configured securely?
- [ ] STARTTLS/TLS required?
- [ ] Timeouts set?
- [ ] Debug disabled in production?
- [ ] Secrets not committed?

## 38.2 Message construction

- [ ] From verified?
- [ ] Reply-To correct?
- [ ] Recipients validated?
- [ ] Subject encoded UTF-8?
- [ ] Text alternative exists?
- [ ] HTML escaped?
- [ ] Attachments validated?
- [ ] Headers safe?

## 38.3 Pipeline

- [ ] Async queue/outbox?
- [ ] Retry/backoff?
- [ ] DLQ?
- [ ] Idempotency?
- [ ] Attempt tracking?
- [ ] Suppression checked?
- [ ] Bounce handling?

## 38.4 Security/privacy

- [ ] No secrets in body/header/log?
- [ ] PII minimized?
- [ ] Attachment scanned?
- [ ] Link tokens expire?
- [ ] Audit access controlled?

## 38.5 Operations

- [ ] Send success/failure metrics?
- [ ] Queue age/backlog monitored?
- [ ] Bounce rate monitored?
- [ ] Provider throttling monitored?
- [ ] Runbook for DLQ/replay?

---

# 39. Case Study 1: Case Approval Notification

## 39.1 Requirement

When case approved, applicant gets notification email.

## 39.2 Bad design

```java
case.approve();
repository.save(case);
mailService.send(case.applicantEmail(), "Approved");
```

## 39.3 Better design

DB transaction:

```text
update case status APPROVED
insert email_request CASE_APPROVED
commit
```

Worker:

```text
render template
send email
record attempt
mark sent
```

## 39.4 Why?

Case approval should not fail just because SMTP is temporarily down.

## 39.5 Idempotency

Use `email_request_id` unique.

## 39.6 Audit

Record:

```text
CASE_APPROVED_EMAIL requested/sent/failed
```

---

# 40. Case Study 2: Attachment Besar dan Memory Spike

## 40.1 Problem

Generated PDF 50MB attached.

Code:

```java
byte[] pdf = Files.readAllBytes(path);
```

Memory spikes under concurrent sends.

## 40.2 Better

- enforce attachment max size;
- store PDF in object storage;
- send secure download link;
- or stream file via `DataSource`.

## 40.3 Security

- scan file;
- ensure recipient authorized;
- short-lived signed URL if appropriate.

## 40.4 Lesson

Email is poor large-file transport.

---

# 41. Case Study 3: SMTP Down tapi Business Transaction Harus Tetap Commit

## 41.1 Problem

SMTP outage causes user submission failure.

## 41.2 Root cause

Email sent synchronously in use case.

## 41.3 Fix

Use outbox/email queue.

```text
SubmitApplication transaction commits.
Email worker retries notification later.
```

## 41.4 User experience

Show:

```text
Application submitted successfully.
Notification email may arrive shortly.
```

## 41.5 Alert

If email backlog grows, ops is alerted.

---

# 42. Case Study 4: Bounce dan Suppression List

## 42.1 Problem

System keeps emailing invalid address.

Bounce rate increases.

Provider reputation drops.

## 42.2 Fix

Bounce webhook:

```text
hard bounce → mark recipient suppressed
future sends → skip/suppressed
notify user/admin if needed
```

## 42.3 Soft bounce

Retry limited times.

Do not suppress immediately unless repeated/policy.

## 42.4 Audit

Record reason and source.

## 42.5 Lesson

Sending email is not enough. Delivery feedback matters.

---

# 43. Latihan Bertahap

## Latihan 1 — Plain text email

Send plain text email to fake SMTP server.

## Latihan 2 — HTML + text alternative

Build multipart/alternative message.

Inspect raw MIME.

## Latihan 3 — Attachment

Attach small PDF/text file.

Validate filename encoding.

## Latihan 4 — Inline image

Use Content-ID image.

Open in test client.

## Latihan 5 — Timeouts

Simulate slow SMTP server.

Verify timeout works.

## Latihan 6 — Queue email

Use messaging queue to send email asynchronously.

## Latihan 7 — Retry

Simulate temporary SMTP failure.

Retry with backoff.

## Latihan 8 — Idempotency

Send same email request twice.

Ensure only one final email or controlled duplicate handling.

## Latihan 9 — Bounce

Simulate bounce webhook or parse bounce mailbox.

Update suppression list.

## Latihan 10 — Security tests

Test header injection, HTML injection, huge attachment, invalid recipient.

---

# 44. Mini Project: Jakarta Mail Production Pipeline Lab

## 44.1 Goal

Create:

```text
jakarta-mail-production-pipeline-lab/
```

## 44.2 Modules

```text
basic-smtp/
mime-message/
multipart-alternative/
attachment/
inline-image/
template-rendering/
email-queue/
retry-dlq/
bounce-handling/
suppression-list/
observability/
```

## 44.3 Deliverables

```text
README.md
MAIL-MENTAL-MODEL.md
SMTP-CONFIG.md
MIME-STRUCTURE.md
TEMPLATE-DESIGN.md
EMAIL-PIPELINE.md
RETRY-IDEMPOTENCY.md
BOUNCE-SUPPRESSION.md
DELIVERABILITY.md
SECURITY-PRIVACY.md
FAILURE-MODES.md
```

## 44.4 Required experiments

1. Send plain text to fake SMTP.
2. Send HTML + text alternative.
3. Send attachment.
4. Send inline image.
5. Render template with locale.
6. Send via queue worker.
7. Retry transient failure.
8. DLQ permanent failure.
9. Bounce suppresses recipient.
10. Metrics/logs/audit for every send.

## 44.5 Evaluation questions

1. What does `Transport.send()` success really mean?
2. Why send email asynchronously?
3. Why use outbox?
4. How do you prevent duplicate email?
5. What is multipart/alternative?
6. Why avoid huge attachments?
7. What is hard bounce?
8. Why does deliverability need SPF/DKIM/DMARC?
9. Why should templates be versioned?
10. What should never be logged?

---

# 45. Referensi Resmi

Referensi utama:

1. Jakarta Mail 2.1  
   https://jakarta.ee/specifications/mail/2.1/

2. Jakarta Mail 2.1 Specification  
   https://jakarta.ee/specifications/mail/2.1/jakarta-mail-spec-2.1

3. Jakarta Mail API Docs — `jakarta.mail`  
   https://jakarta.ee/specifications/mail/2.1/apidocs/jakarta.mail/jakarta/mail/package-summary

4. `MimeMultipart` API Docs  
   https://jakarta.ee/specifications/mail/2.1/apidocs/jakarta.mail/jakarta/mail/internet/mimemultipart

5. Jakarta Mail Project  
   https://jakartaee.github.io/mail-api/

6. Jakarta Activation 2.1  
   https://jakarta.ee/specifications/activation/2.1/

7. Jakarta EE Platform 11  
   https://jakarta.ee/specifications/platform/11/

8. Jakarta Messaging 3.1  
   https://jakarta.ee/specifications/messaging/3.1/

9. Jakarta Transactions 2.0  
   https://jakarta.ee/specifications/transactions/2.0/

10. Jakarta EE Tutorial  
    https://jakarta.ee/learn/docs/jakartaee-tutorial/current/

---

# Penutup

Jakarta Mail memberi API standard untuk membangun dan mengirim email melalui mail systems.

Mental model ringkas:

```text
Session:
  configuration and provider access

MimeMessage:
  email object

InternetAddress:
  sender/recipient representation

Transport:
  sends via SMTP

Multipart/MimeBodyPart:
  MIME structure for HTML, text, attachments, inline images

Store/Folder:
  inbound mailbox access
```

Namun production email bukan hanya API call.

Production email pipeline membutuhkan:

```text
async queue
outbox
template versioning
UTF-8 and MIME correctness
retry/backoff
DLQ
idempotency
bounce handling
suppression list
deliverability setup
security/privacy controls
observability
audit
```

Prinsip paling penting:

```text
Email sending is an external side effect.
Treat it as unreliable, delayed, duplicate-prone, and observable.
```

Engineer top-tier tidak hanya bisa mengirim email. Ia tahu apa yang terjadi jika SMTP down, jika provider menerima message lalu app crash, jika email bounce besok, jika attachment terlalu besar, jika template mengandung unescaped input, jika suppression list diabaikan, dan jika audit harus membuktikan komunikasi sudah dikirim.

Bagian berikutnya akan membahas **Jakarta Batch (`jakarta.batch`)**: job, step, chunk, batchlet, checkpoint, restartability, partitioning, retry/skip, batch transaction boundary, and production batch processing.
