# Part 19 — Testing Mail Systems

> Series: `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery`  
> File: `19-testing-mail-systems.md`  
> Scope: Java 8–25, JavaMail `javax.mail`, Jakarta Mail `jakarta.mail`, Jakarta Activation, Spring Boot integration, fake SMTP, MIME assertions, failure simulation, CI-safe E2E testing.

---

## 0. Why This Part Exists

Testing email systems is deceptively difficult.

At first glance, email testing looks simple:

```java
mailService.send("user@example.com", "Welcome", "Hello");
```

But in real systems, that single line hides many correctness dimensions:

- was the email request persisted safely?
- was the SMTP call made only after business transaction commit?
- was the MIME structure valid?
- was the subject encoded correctly?
- were `To`, `Cc`, `Bcc`, `Reply-To`, and envelope sender correct?
- was the HTML body escaped?
- was the text alternative present?
- were attachments named correctly?
- were inline images referenced with matching `cid:` values?
- were large attachments streamed rather than loaded carelessly?
- were timeouts configured?
- was retry classification correct?
- was a permanent recipient rejection not retried forever?
- did the system avoid sending real email during tests?
- could CI verify the result deterministically?
- could a production incident be reproduced locally?

A top-tier engineer does not treat email testing as “mock `send()` and done”.

They test mail systems in layers:

```text
Business intent
   ↓
Notification request model
   ↓
Template rendering
   ↓
MIME composition
   ↓
SMTP client behavior
   ↓
Fake SMTP server capture
   ↓
Outbox/retry state machine
   ↓
Failure classification
   ↓
Observability and audit evidence
```

This part builds that testing model.

---

## 1. Core Mental Model: What Are We Testing?

Email testing should not begin with tools. It should begin with **boundaries**.

A mail subsystem usually has these layers:

```text
+---------------------------------------------------------------+
| Business Use Case                                             |
| "Applicant submitted appeal"                                 |
+---------------------------+-----------------------------------+
                            |
                            v
+---------------------------------------------------------------+
| Notification Application Service                              |
| Decides recipient, template, variables, channel, priority      |
+---------------------------+-----------------------------------+
                            |
                            v
+---------------------------------------------------------------+
| Outbox / Queue / Send Request Store                           |
| Persists intent to send safely                                |
+---------------------------+-----------------------------------+
                            |
                            v
+---------------------------------------------------------------+
| Template Renderer                                             |
| Produces subject, text, HTML                                  |
+---------------------------+-----------------------------------+
                            |
                            v
+---------------------------------------------------------------+
| MIME Composer                                                 |
| Builds MimeMessage / multipart / attachments / headers         |
+---------------------------+-----------------------------------+
                            |
                            v
+---------------------------------------------------------------+
| Mail Gateway                                                  |
| Uses Jakarta Mail / JavaMail / Spring JavaMailSender / API     |
+---------------------------+-----------------------------------+
                            |
                            v
+---------------------------------------------------------------+
| External SMTP Relay / Provider                                |
+---------------------------------------------------------------+
```

Testing everything at one level is a mistake.

You want different tests for different questions.

| Question | Best test style |
|---|---|
| Did the business flow request the right notification? | Unit/application test |
| Did we select the correct template and variables? | Unit/contract test |
| Did rendering escape untrusted data? | Unit/snapshot/security test |
| Did MIME structure contain text + HTML + attachment correctly? | MIME composition test |
| Did JavaMail/Spring send to SMTP correctly? | Integration test with fake SMTP |
| Did retry happen after transient failure? | State machine/integration test |
| Did permanent failure stop retries? | Failure-classification test |
| Did no real email leave CI? | Environment/configuration test |
| Did metrics/audit records appear? | Integration/observability test |

A good test suite does not ask only:

> “Was `send()` called?”

It asks:

> “Was the right communication intent produced, encoded, transported, observed, and recovered from failure safely?”

---

## 2. The Anti-Pattern: Mocking Jakarta Mail Too Deeply

Many teams write tests like this:

```java
Transport transport = mock(Transport.class);
verify(transport).sendMessage(any(Message.class), any(Address[].class));
```

This usually gives false confidence.

Why?

Because most email bugs are not in whether `sendMessage()` was called. Bugs are usually in:

- wrong MIME tree;
- missing text alternative;
- wrong charset;
- bad attachment filename;
- invalid header;
- `Bcc` accidentally exposed;
- no timeout;
- `Reply-To` missing;
- duplicate email after retry;
- HTML content unescaped;
- CID mismatch;
- provider rejection misclassified;
- message sent before transaction commit.

Mocking `Transport` does not catch those.

A better rule:

```text
Mock business boundaries.
Inspect MIME boundaries.
Fake external SMTP boundaries.
Simulate failure boundaries.
```

So, instead of mocking JavaMail internals too deeply, prefer:

1. unit-test your **domain decision**;
2. unit-test your **template renderer**;
3. inspect the actual **MimeMessage**;
4. send to a **fake SMTP server**;
5. simulate SMTP failures using a controlled fake/adapter;
6. test retry/outbox as state transitions.

---

## 3. Testing Pyramid for Mail Systems

A practical mail testing pyramid:

```text
                         +-----------------------+
                         | Real provider smoke   |
                         | Optional, restricted  |
                         +-----------+-----------+
                                     |
                    +----------------+----------------+
                    | Fake SMTP integration tests       |
                    | GreenMail / Mailpit / MailHog     |
                    +----------------+----------------+
                                     |
         +---------------------------+---------------------------+
         | Outbox / retry / failure classification tests          |
         +---------------------------+---------------------------+
                                     |
   +---------------------------------+---------------------------------+
   | MIME composition tests: headers, multipart, attachment, charset    |
   +---------------------------------+---------------------------------+
                                     |
+------------------------------------+------------------------------------+
| Unit tests: business decision, template model, variable validation       |
+-------------------------------------------------------------------------+
```

The important part: **real provider tests are not the foundation**.

They are expensive, flaky, rate-limited, potentially unsafe, and sometimes non-deterministic.

Use them sparingly.

---

## 4. What “Correct Email” Means in a Test

A sent email is not simply a string.

It has at least four correctness dimensions:

### 4.1 Semantic Correctness

Does the email represent the correct business intent?

Example:

```text
Case approved        -> approval template
Case rejected        -> rejection template
Appeal submitted     -> acknowledgement template
Password reset       -> short-lived secure link
Document expired     -> reminder template
```

Test examples:

- correct template key;
- correct recipient category;
- correct language;
- correct tenant/application context;
- correct priority;
- correct suppression/preference logic.

### 4.2 MIME Correctness

Does the email have valid internet-message structure?

Test examples:

- subject encoded correctly;
- UTF-8 body preserved;
- `multipart/alternative` contains plain text and HTML;
- `multipart/mixed` wraps attachments;
- `multipart/related` wraps inline images;
- attachment filenames are preserved;
- content IDs match HTML references.

### 4.3 Transport Correctness

Does the application talk to SMTP correctly?

Test examples:

- SMTP host/port from test config;
- auth behavior when required;
- timeout properties set;
- no real SMTP host in test;
- captured message exists in fake SMTP.

### 4.4 Operational Correctness

Does the system behave safely under failure?

Test examples:

- transient failure schedules retry;
- permanent failure stops retry;
- partial recipient failure handled correctly;
- duplicate send prevented where possible;
- queue item locked and released correctly;
- metrics emitted;
- audit record written;
- sensitive data redacted.

---

## 5. Test Data Strategy

Email tests often become fragile because test data is too realistic in the wrong way and not realistic enough in the important way.

Use a deliberate test data matrix.

### 5.1 Address Data

Test these:

```text
normal@example.com
first.last+tag@example.com
USER@EXAMPLE.COM
"Fajar Abdi" <fajar@example.com>
用户@example.com
user@sub.example.co.id
invalid-address
missing-domain@
```

But separate tests:

- address parsing tests;
- business validation tests;
- SMTP rejection tests.

Do not mix all concerns into one giant test.

### 5.2 Subject Data

Test:

```text
Plain ASCII subject
Subject with Indonesian: Persetujuan diperbarui
Subject with emoji: Status berhasil ✅
Very long subject that should fold across headers
Subject containing CRLF injection attempt
```

Dangerous input:

```text
Hello
Bcc: attacker@example.com
```

A test should verify this is rejected or sanitized before reaching header APIs.

### 5.3 Body Data

Test:

```text
Plain text
HTML with escaped user data
HTML with ampersand, quote, less-than, greater-than
Long paragraph
Multilingual body
Template variable missing
Template variable null
```

Untrusted value:

```html
<script>alert('x')</script>
```

Expected rendered output should escape it as text, not execute or inject markup.

### 5.4 Attachment Data

Test:

```text
small PDF
zero-byte file
filename with spaces
filename with Unicode
filename with path traversal attempt
large file boundary
content type mismatch
```

Examples:

```text
report.pdf
case summary.pdf
bukti-pembayaran-ümlaut.pdf
../../secret.txt
invoice.pdf.exe
```

### 5.5 Time Data

Email often contains dates, deadlines, expiry time, or timezone-sensitive text.

Use injected `Clock`:

```java
Clock fixedClock = Clock.fixed(
    Instant.parse("2026-06-18T05:00:00Z"),
    ZoneId.of("Asia/Jakarta")
);
```

Never rely on `Instant.now()` directly inside template logic.

---

## 6. Unit Testing the Notification Decision Layer

This layer should not know Jakarta Mail.

It should answer:

> Given this business event, what notification intent should exist?

Example model:

```java
public final class NotificationRequest {
    private final String idempotencyKey;
    private final String templateCode;
    private final Locale locale;
    private final List<Recipient> recipients;
    private final Map<String, Object> variables;
    private final NotificationPriority priority;

    // constructor, getters
}
```

Unit test:

```java
@Test
void shouldCreateAppealAcknowledgementNotification() {
    AppealSubmitted event = new AppealSubmitted(
        "AP-2026-0001",
        "applicant-123",
        Instant.parse("2026-06-18T04:30:00Z")
    );

    NotificationRequest request = notificationPolicy.forAppealSubmitted(event);

    assertEquals("appeal.acknowledgement.v1", request.getTemplateCode());
    assertEquals("appeal:AP-2026-0001:acknowledgement", request.getIdempotencyKey());
    assertEquals(NotificationPriority.NORMAL, request.getPriority());
    assertEquals(Locale.ENGLISH, request.getLocale());
    assertEquals(1, request.getRecipients().size());
}
```

The key invariant:

```text
Business tests should not need SMTP, MimeMessage, JavaMailSender, or fake mail server.
```

If they do, your business layer is probably coupled to infrastructure.

---

## 7. Unit Testing Template Rendering

Template rendering should be tested separately from SMTP.

A template renderer usually produces:

```java
public final class RenderedEmail {
    private final String subject;
    private final String textBody;
    private final String htmlBody;

    // constructor, getters
}
```

Test example:

```java
@Test
void shouldRenderEscapedApplicantName() {
    Map<String, Object> variables = Map.of(
        "applicantName", "<script>alert('x')</script>",
        "caseNo", "CASE-001"
    );

    RenderedEmail email = renderer.render(
        "case.submitted.v1",
        Locale.ENGLISH,
        variables
    );

    assertTrue(email.getSubject().contains("CASE-001"));
    assertFalse(email.getHtmlBody().contains("<script>"));
    assertTrue(email.getHtmlBody().contains("&lt;script&gt;"));
    assertTrue(email.getTextBody().contains("CASE-001"));
}
```

### 7.1 Template Variable Contract Tests

Templates need schemas.

Bad pattern:

```text
Template expects random Map<String, Object>
Application discovers missing variable at runtime
```

Better pattern:

```java
public final class CaseSubmittedTemplateModel {
    private final String applicantName;
    private final String caseNo;
    private final LocalDate submittedDate;

    // constructor, getters
}
```

Test missing variables:

```java
@Test
void shouldFailWhenRequiredVariableMissing() {
    TemplateValidationException ex = assertThrows(
        TemplateValidationException.class,
        () -> renderer.render("case.submitted.v1", Locale.ENGLISH, Map.of("caseNo", "CASE-001"))
    );

    assertTrue(ex.getMessage().contains("applicantName"));
}
```

### 7.2 Snapshot Testing HTML

HTML email can be large.

Instead of asserting every line manually, store an approved output:

```text
src/test/resources/email-snapshots/case-submitted-v1.en.html
src/test/resources/email-snapshots/case-submitted-v1.en.txt
```

Then compare normalized output.

Normalization should remove unstable values:

- generated timestamp;
- random tracking ID;
- host-specific URL if configured differently;
- line ending differences.

Pseudo-code:

```java
String normalized = normalizeHtml(email.getHtmlBody());
String expected = readResource("email-snapshots/case-submitted-v1.en.html");
assertEquals(expected, normalized);
```

Snapshot tests are useful when:

- templates are manually reviewed;
- layout regressions matter;
- localization changes need traceability;
- compliance requires stable output.

But snapshot tests can become noisy. Use them for stable templates, not volatile marketing experiments.

---

## 8. Unit Testing MIME Composition

The MIME composer takes a rendered email and produces a `MimeMessage`.

Example interface:

```java
public interface MimeMessageComposer {
    MimeMessage compose(Session session, OutboundEmail email) throws MessagingException;
}
```

The goal is to inspect the resulting `MimeMessage` directly.

### 8.1 Minimal Test Session

Jakarta Mail / JavaMail can create a local message without connecting to SMTP.

Jakarta version:

```java
Properties properties = new Properties();
Session session = Session.getInstance(properties);
MimeMessage message = new MimeMessage(session);
```

JavaMail legacy version:

```java
Properties properties = new Properties();
javax.mail.Session session = javax.mail.Session.getInstance(properties);
javax.mail.internet.MimeMessage message = new javax.mail.internet.MimeMessage(session);
```

No SMTP server is needed for MIME composition tests.

### 8.2 Assert Basic Headers

```java
@Test
void shouldComposeBasicHtmlMessage() throws Exception {
    Session session = Session.getInstance(new Properties());

    OutboundEmail email = OutboundEmail.builder()
        .from("System <no-reply@example.com>")
        .to("User <user@example.com>")
        .replyTo("Support <support@example.com>")
        .subject("Case submitted")
        .textBody("Your case was submitted.")
        .htmlBody("<p>Your case was submitted.</p>")
        .build();

    MimeMessage message = composer.compose(session, email);

    assertEquals("Case submitted", message.getSubject());
    assertEquals("System <no-reply@example.com>", message.getFrom()[0].toString());
    assertEquals("User <user@example.com>", message.getRecipients(Message.RecipientType.TO)[0].toString());
    assertEquals("Support <support@example.com>", message.getReplyTo()[0].toString());
}
```

### 8.3 Assert Plain Text Message

```java
@Test
void shouldComposePlainTextUtf8Message() throws Exception {
    Session session = Session.getInstance(new Properties());

    OutboundEmail email = OutboundEmail.builder()
        .from("no-reply@example.com")
        .to("user@example.com")
        .subject("Persetujuan diperbarui")
        .textBody("Status permohonan Anda berhasil diperbarui.")
        .build();

    MimeMessage message = composer.compose(session, email);

    assertEquals("Persetujuan diperbarui", message.getSubject());
    assertTrue(message.isMimeType("text/plain"));
    assertTrue(message.getContentType().toLowerCase(Locale.ROOT).contains("charset=utf-8"));
    assertEquals("Status permohonan Anda berhasil diperbarui.", message.getContent());
}
```

### 8.4 Assert Multipart Alternative

For text + HTML, expected structure:

```text
MimeMessage
└── multipart/alternative
    ├── text/plain
    └── text/html
```

Test:

```java
@Test
void shouldComposeMultipartAlternativeForTextAndHtml() throws Exception {
    Session session = Session.getInstance(new Properties());

    OutboundEmail email = OutboundEmail.builder()
        .from("no-reply@example.com")
        .to("user@example.com")
        .subject("Welcome")
        .textBody("Welcome")
        .htmlBody("<p>Welcome</p>")
        .build();

    MimeMessage message = composer.compose(session, email);

    assertTrue(message.isMimeType("multipart/alternative"));

    MimeMultipart multipart = (MimeMultipart) message.getContent();
    assertEquals(2, multipart.getCount());

    BodyPart text = multipart.getBodyPart(0);
    BodyPart html = multipart.getBodyPart(1);

    assertTrue(text.isMimeType("text/plain"));
    assertTrue(html.isMimeType("text/html"));
    assertEquals("Welcome", text.getContent());
    assertEquals("<p>Welcome</p>", html.getContent());
}
```

### 8.5 Assert Attachment

Expected structure for text/html + attachment:

```text
MimeMessage
└── multipart/mixed
    ├── multipart/alternative
    │   ├── text/plain
    │   └── text/html
    └── application/pdf; name="report.pdf"
```

Test:

```java
@Test
void shouldComposeEmailWithAttachment() throws Exception {
    Session session = Session.getInstance(new Properties());

    byte[] pdf = "%PDF-1.4 fake".getBytes(StandardCharsets.US_ASCII);

    OutboundEmail email = OutboundEmail.builder()
        .from("no-reply@example.com")
        .to("user@example.com")
        .subject("Report")
        .textBody("Please see attached report.")
        .htmlBody("<p>Please see attached report.</p>")
        .attachment(new EmailAttachment(
            "report.pdf",
            "application/pdf",
            pdf
        ))
        .build();

    MimeMessage message = composer.compose(session, email);

    assertTrue(message.isMimeType("multipart/mixed"));

    MimeMultipart mixed = (MimeMultipart) message.getContent();
    assertEquals(2, mixed.getCount());

    BodyPart bodyPart = mixed.getBodyPart(0);
    BodyPart attachmentPart = mixed.getBodyPart(1);

    assertTrue(bodyPart.isMimeType("multipart/alternative"));
    assertEquals(Part.ATTACHMENT, attachmentPart.getDisposition());
    assertEquals("report.pdf", attachmentPart.getFileName());
    assertTrue(attachmentPart.isMimeType("application/pdf"));
}
```

### 8.6 Assert Inline Image

Expected structure:

```text
MimeMessage
└── multipart/related
    ├── multipart/alternative
    │   ├── text/plain
    │   └── text/html with <img src="cid:logo">
    └── image/png; Content-ID: <logo>
```

Test:

```java
@Test
void shouldComposeInlineImageWithMatchingContentId() throws Exception {
    Session session = Session.getInstance(new Properties());

    OutboundEmail email = OutboundEmail.builder()
        .from("no-reply@example.com")
        .to("user@example.com")
        .subject("Inline image")
        .textBody("See logo")
        .htmlBody("<html><body><img src=\"cid:logo\"></body></html>")
        .inlineResource(new InlineResource(
            "logo",
            "logo.png",
            "image/png",
            new byte[] {1, 2, 3}
        ))
        .build();

    MimeMessage message = composer.compose(session, email);

    assertTrue(message.isMimeType("multipart/related"));

    MimeMultipart related = (MimeMultipart) message.getContent();
    BodyPart image = related.getBodyPart(1);

    assertTrue(image.isMimeType("image/png"));
    assertEquals("<logo>", image.getHeader("Content-ID", null));
    assertEquals(Part.INLINE, image.getDisposition());
}
```

### 8.7 Assert No BCC Leakage

BCC is subtle.

At SMTP envelope level, BCC recipients receive the message. But the final message header should not expose them.

Test:

```java
@Test
void shouldNotExposeBccHeaderInSavedMimeMessage() throws Exception {
    Session session = Session.getInstance(new Properties());

    OutboundEmail email = OutboundEmail.builder()
        .from("no-reply@example.com")
        .to("user@example.com")
        .bcc("hidden@example.com")
        .subject("Private")
        .textBody("Hello")
        .build();

    MimeMessage message = composer.compose(session, email);

    assertNull(message.getHeader("Bcc"));
}
```

Implementation detail: depending on how sending is done, BCC may be set on the message before sending and later removed, or recipients may be passed separately to `Transport`. Your architecture should make this explicit.

---

## 9. Helper Utilities for MIME Assertions

MIME tests become painful if every test manually traverses nested parts.

Create test utilities.

Example:

```java
public final class MimeAssertions {

    private MimeAssertions() {
    }

    public static MimeMultipart multipart(Object content) {
        assertTrue(content instanceof MimeMultipart, "Content is not MimeMultipart");
        return (MimeMultipart) content;
    }

    public static BodyPart bodyPart(MimeMultipart multipart, int index) throws MessagingException {
        assertTrue(index < multipart.getCount(), "Missing body part at index " + index);
        return multipart.getBodyPart(index);
    }

    public static void assertMimeType(Part part, String expected) throws MessagingException {
        assertTrue(
            part.isMimeType(expected),
            "Expected MIME type " + expected + " but got " + part.getContentType()
        );
    }

    public static String contentAsString(Part part) throws Exception {
        Object content = part.getContent();
        assertTrue(content instanceof String, "Content is not String");
        return (String) content;
    }
}
```

Then tests become readable:

```java
MimeMultipart mixed = multipart(message.getContent());
BodyPart attachment = bodyPart(mixed, 1);
assertMimeType(attachment, "application/pdf");
```

A top-tier test suite invests in readability. Otherwise MIME tests become too annoying and engineers stop writing them.

---

## 10. Testing Raw MIME Output

Sometimes object-level assertions are not enough.

You may want to inspect raw message output:

```java
ByteArrayOutputStream out = new ByteArrayOutputStream();
message.writeTo(out);
String raw = out.toString(StandardCharsets.UTF_8);
```

Useful assertions:

```java
assertTrue(raw.contains("Content-Type: multipart/alternative"));
assertTrue(raw.contains("Content-Type: text/plain"));
assertTrue(raw.contains("Content-Type: text/html"));
assertTrue(raw.contains("Content-Disposition: attachment"));
assertFalse(raw.contains("Bcc:"));
```

Be careful: raw MIME contains generated boundaries and folded headers, so full-string assertions can be brittle.

Better:

- assert key headers;
- normalize boundaries if snapshotting;
- avoid depending on exact line wrapping unless that is the behavior under test.

---

## 11. Fake SMTP Integration Testing

MIME composition tests prove your message object is correct.

Fake SMTP integration tests prove your application can actually send using SMTP protocol to a server-like endpoint.

Popular options:

- **GreenMail**: embeddable test mail server supporting SMTP/IMAP/POP3.
- **Mailpit**: SMTP testing tool with web UI and API.
- **MailHog**: older but still widely known developer SMTP capture tool.
- **SubEthaSMTP/Wiser-style servers**: lightweight fake SMTP server patterns.
- **Custom fake SMTP**: useful for failure simulation.

GreenMail describes itself as a test suite of email servers for integration testing or sandboxed development, and its project documentation notes support for common protocols such as SMTP, IMAP, and POP3. Mailpit acts as an SMTP server with web UI and API for automated testing. These tools are good because they let your application exercise real SMTP client behavior without sending real email. Sources: GreenMail official docs, GreenMail GitHub, Mailpit official docs.  
References: GreenMail official documentation, GreenMail GitHub, Mailpit official documentation.

---

## 12. GreenMail Integration Test

GreenMail can be embedded inside a JUnit test.

Example dependencies vary by JavaMail/Jakarta Mail generation. Conceptually:

```xml
<dependency>
    <groupId>com.icegreen</groupId>
    <artifactId>greenmail-junit5</artifactId>
    <version>${greenmail.version}</version>
    <scope>test</scope>
</dependency>
```

Example test:

```java
import com.icegreen.greenmail.junit5.GreenMailExtension;
import com.icegreen.greenmail.util.ServerSetupTest;
import jakarta.mail.internet.MimeMessage;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.RegisterExtension;

import java.util.Properties;

import static org.junit.jupiter.api.Assertions.*;

class SmtpIntegrationTest {

    @RegisterExtension
    static GreenMailExtension greenMail = new GreenMailExtension(ServerSetupTest.SMTP);

    @Test
    void shouldSendEmailToFakeSmtpServer() throws Exception {
        int smtpPort = greenMail.getSmtp().getPort();

        Properties props = new Properties();
        props.put("mail.smtp.host", "localhost");
        props.put("mail.smtp.port", String.valueOf(smtpPort));
        props.put("mail.smtp.auth", "false");
        props.put("mail.smtp.connectiontimeout", "3000");
        props.put("mail.smtp.timeout", "3000");
        props.put("mail.smtp.writetimeout", "3000");

        MailGateway gateway = new JakartaMailSmtpGateway(props);

        gateway.send(OutboundEmail.builder()
            .from("no-reply@example.com")
            .to("user@example.com")
            .subject("Integration test")
            .textBody("Hello fake SMTP")
            .build());

        MimeMessage[] received = greenMail.getReceivedMessages();
        assertEquals(1, received.length);
        assertEquals("Integration test", received[0].getSubject());
    }
}
```

This test verifies:

- SMTP configuration is usable;
- no real SMTP is contacted;
- the server receives the message;
- message content can be inspected after transport.

---

## 13. Spring Boot Integration Test with Fake SMTP

Spring Boot can configure mail properties dynamically in test.

Pseudo-example:

```java
@SpringBootTest
class EmailIntegrationTest {

    @RegisterExtension
    static GreenMailExtension greenMail = new GreenMailExtension(ServerSetupTest.SMTP);

    @DynamicPropertySource
    static void mailProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.mail.host", () -> "localhost");
        registry.add("spring.mail.port", () -> greenMail.getSmtp().getPort());
        registry.add("spring.mail.properties.mail.smtp.connectiontimeout", () -> "3000");
        registry.add("spring.mail.properties.mail.smtp.timeout", () -> "3000");
        registry.add("spring.mail.properties.mail.smtp.writetimeout", () -> "3000");
    }

    @Autowired
    NotificationService notificationService;

    @Test
    void shouldSendNotificationThroughSpringMail() throws Exception {
        notificationService.sendWelcomeEmail("user@example.com");

        MimeMessage[] received = greenMail.getReceivedMessages();
        assertEquals(1, received.length);
        assertEquals("Welcome", received[0].getSubject());
    }
}
```

This catches wiring problems:

- wrong Spring property names;
- missing `JavaMailSender` bean;
- wrong encoding;
- template integration issue;
- SMTP port misconfiguration.

Spring’s `JavaMailSender` adds MIME support to Spring’s simpler mail abstraction and provides callback-style `MimeMessagePreparator`; `MimeMessageHelper` is a helper for populating `MimeMessage`, including character encoding support.

---

## 14. Testcontainers with Mailpit

For CI and local reproducibility, containerized fake SMTP is often excellent.

Mailpit exposes:

- SMTP port, commonly `1025`;
- web UI port, commonly `8025`;
- HTTP API for captured messages.

Generic Testcontainers example:

```java
@Testcontainers
@SpringBootTest
class MailpitIntegrationTest {

    @Container
    static GenericContainer<?> mailpit = new GenericContainer<>(DockerImageName.parse("axllent/mailpit:latest"))
        .withExposedPorts(1025, 8025);

    @DynamicPropertySource
    static void mailProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.mail.host", mailpit::getHost);
        registry.add("spring.mail.port", () -> mailpit.getMappedPort(1025));
        registry.add("spring.mail.properties.mail.smtp.connectiontimeout", () -> "3000");
        registry.add("spring.mail.properties.mail.smtp.timeout", () -> "3000");
        registry.add("spring.mail.properties.mail.smtp.writetimeout", () -> "3000");
    }
}
```

Then use Mailpit API to inspect captured messages.

Conceptual flow:

```text
Spring Boot app
   ↓ SMTP localhost:mappedPort
Mailpit container
   ↓ HTTP API
Test assertions
```

Why this is useful:

- same behavior in CI and developer machine;
- no embedded server compatibility issue;
- web UI available for manual debugging;
- API-based assertions possible;
- easy to run with Docker Compose too.

Avoid using `latest` in controlled CI if reproducibility matters. Pin the image tag.

---

## 15. Docker Compose for Manual Local Testing

For local development:

```yaml
services:
  mailpit:
    image: axllent/mailpit:latest
    ports:
      - "1025:1025"
      - "8025:8025"
```

Application test profile:

```yaml
spring:
  mail:
    host: localhost
    port: 1025
    properties:
      mail.smtp.auth: false
      mail.smtp.starttls.enable: false
      mail.smtp.connectiontimeout: 3000
      mail.smtp.timeout: 3000
      mail.smtp.writetimeout: 3000
```

Then open:

```text
http://localhost:8025
```

This is extremely useful for template development.

But do not rely only on manual inspection. Automate key assertions in tests.

---

## 16. Testing SMTP Failure Classification

Fake SMTP capture tools are good for success paths, but failure simulation often needs more control.

You need tests for:

- connection refused;
- connection timeout;
- authentication failure;
- sender rejected;
- recipient rejected;
- message data rejected;
- transient 4xx;
- permanent 5xx;
- partial recipient failure;
- slow write timeout.

### 16.1 Failure Classification Interface

Create a classifier:

```java
public interface MailFailureClassifier {
    ClassifiedMailFailure classify(Exception exception);
}
```

Model:

```java
public final class ClassifiedMailFailure {
    private final MailFailureType type;
    private final boolean retryable;
    private final String providerCode;
    private final String safeMessage;

    // constructor, getters
}
```

Enum:

```java
public enum MailFailureType {
    CONNECTION_FAILED,
    CONNECTION_TIMEOUT,
    AUTHENTICATION_FAILED,
    SENDER_REJECTED,
    RECIPIENT_REJECTED,
    CONTENT_REJECTED,
    RATE_LIMITED,
    PROVIDER_TEMPORARY_FAILURE,
    PROVIDER_PERMANENT_FAILURE,
    UNKNOWN
}
```

Then unit-test classification without needing real SMTP.

### 16.2 Simulating Recipient Failure

SMTP provider-specific exceptions can expose return codes and addresses.

Conceptual test:

```java
@Test
void shouldClassifyPermanentRecipientRejectionAsNonRetryable() {
    Exception exception = smtpAddressFailed(
        "RCPT TO",
        550,
        "5.1.1 User unknown",
        "missing@example.com"
    );

    ClassifiedMailFailure failure = classifier.classify(exception);

    assertEquals(MailFailureType.RECIPIENT_REJECTED, failure.getType());
    assertFalse(failure.isRetryable());
    assertEquals("550", failure.getProviderCode());
}
```

### 16.3 Simulating Transient Failure

```java
@Test
void shouldClassifyTemporaryProviderFailureAsRetryable() {
    Exception exception = smtpSendFailed(
        "DATA",
        451,
        "4.3.0 Temporary local problem"
    );

    ClassifiedMailFailure failure = classifier.classify(exception);

    assertEquals(MailFailureType.PROVIDER_TEMPORARY_FAILURE, failure.getType());
    assertTrue(failure.isRetryable());
}
```

### 16.4 Simulating Auth Failure

```java
@Test
void shouldClassifyAuthenticationFailureAsNonRetryableUntilConfigChanges() {
    Exception exception = new AuthenticationFailedException("535 Authentication failed");

    ClassifiedMailFailure failure = classifier.classify(exception);

    assertEquals(MailFailureType.AUTHENTICATION_FAILED, failure.getType());
    assertFalse(failure.isRetryable());
}
```

Auth failure should usually alert humans rather than retrying aggressively.

---

## 17. Testing Outbox and Retry State Machine

Email retry tests should mostly be state-machine tests.

Example states:

```text
PENDING
PROCESSING
SENT
FAILED_RETRYABLE
FAILED_PERMANENT
DEAD_LETTER
CANCELLED
```

### 17.1 Success Path

```java
@Test
void shouldMovePendingEmailToSentAfterSuccessfulGatewaySend() {
    EmailOutboxItem item = outbox.insert(pendingEmail());
    fakeGateway.willSucceed();

    worker.processOne();

    EmailOutboxItem updated = outbox.findById(item.id());
    assertEquals(EmailStatus.SENT, updated.status());
    assertEquals(1, updated.attemptCount());
    assertNotNull(updated.sentAt());
}
```

### 17.2 Transient Failure Path

```java
@Test
void shouldScheduleRetryAfterTransientFailure() {
    EmailOutboxItem item = outbox.insert(pendingEmail());
    fakeGateway.willFailTransiently("451 temporary failure");

    worker.processOne();

    EmailOutboxItem updated = outbox.findById(item.id());
    assertEquals(EmailStatus.FAILED_RETRYABLE, updated.status());
    assertEquals(1, updated.attemptCount());
    assertTrue(updated.nextAttemptAt().isAfter(clock.instant()));
}
```

### 17.3 Permanent Failure Path

```java
@Test
void shouldStopRetryAfterPermanentFailure() {
    EmailOutboxItem item = outbox.insert(pendingEmail());
    fakeGateway.willFailPermanently("550 user unknown");

    worker.processOne();

    EmailOutboxItem updated = outbox.findById(item.id());
    assertEquals(EmailStatus.FAILED_PERMANENT, updated.status());
    assertEquals(1, updated.attemptCount());
    assertNull(updated.nextAttemptAt());
}
```

### 17.4 Max Attempts

```java
@Test
void shouldMoveToDeadLetterAfterMaxAttempts() {
    EmailOutboxItem item = outbox.insert(
        pendingEmailWithAttempts(4, 5)
    );

    fakeGateway.willFailTransiently("421 service unavailable");

    worker.processOne();

    EmailOutboxItem updated = outbox.findById(item.id());
    assertEquals(EmailStatus.DEAD_LETTER, updated.status());
    assertEquals(5, updated.attemptCount());
}
```

### 17.5 Idempotency Test

```java
@Test
void shouldNotCreateDuplicateOutboxRowsForSameIdempotencyKey() {
    NotificationRequest request = requestWithIdempotencyKey("case:CASE-001:submitted");

    notificationService.enqueue(request);
    notificationService.enqueue(request);

    List<EmailOutboxItem> items = outbox.findByIdempotencyKey("case:CASE-001:submitted");
    assertEquals(1, items.size());
}
```

This is one of the most important production tests.

Duplicate email incidents are common and reputationally painful.

---

## 18. Testing Transaction Boundary

A critical invariant:

```text
Do not send email inside the same transaction before commit.
```

Bad flow:

```text
BEGIN TRANSACTION
  update case status
  send SMTP email
  database commit fails
END
```

Result:

```text
User receives email saying case approved, but DB rollback means case is not approved.
```

Test the correct flow:

```text
BEGIN TRANSACTION
  update case status
  insert outbox row
COMMIT
worker sends email later
```

Integration test idea:

```java
@Test
void shouldNotSendEmailWhenBusinessTransactionRollsBack() {
    fakeSmtp.reset();

    assertThrows(RuntimeException.class, () -> {
        caseService.approveCaseButThrowAfterOutbox("CASE-001");
    });

    assertEquals(0, fakeSmtp.receivedCount());
    assertEquals(0, outbox.countByCaseNo("CASE-001"));
}
```

Another test:

```java
@Test
void shouldSendEmailOnlyAfterCommittedOutboxRowExists() {
    caseService.approveCase("CASE-001");

    assertEquals(1, outbox.countPendingByCaseNo("CASE-001"));
    assertEquals(0, fakeSmtp.receivedCount());

    worker.processOne();

    assertEquals(1, fakeSmtp.receivedCount());
}
```

---

## 19. Testing Partial Recipient Failure

One email may target multiple recipients.

SMTP may accept some recipients and reject others.

Jakarta Mail can expose:

- invalid addresses;
- valid sent addresses;
- valid unsent addresses.

Testing strategy:

```java
@Test
void shouldRecordRecipientLevelFailureForPartialSend() {
    fakeGateway.willPartiallyFail(
        List.of("accepted@example.com"),
        List.of("missing@example.com")
    );

    EmailOutboxItem item = outbox.insert(emailToTwoRecipients());

    worker.processOne();

    RecipientDelivery accepted = deliveryRepo.find(item.id(), "accepted@example.com");
    RecipientDelivery rejected = deliveryRepo.find(item.id(), "missing@example.com");

    assertEquals(RecipientStatus.SENT, accepted.status());
    assertEquals(RecipientStatus.FAILED_PERMANENT, rejected.status());
}
```

This requires your domain model to represent recipient-level delivery, not just message-level delivery.

For simple systems, message-level may be enough.

For regulated systems, recipient-level evidence is often more defensible.

---

## 20. Testing No Real Email Leaves Test Environment

This should be enforced, not trusted.

### 20.1 Configuration Guard

```java
public final class MailEnvironmentGuard {

    public void validate(MailProperties properties, Environment environment) {
        if (environment.acceptsProfiles("test")) {
            if (!isLocalhost(properties.getHost())) {
                throw new IllegalStateException(
                    "Test profile must not use non-local SMTP host: " + properties.getHost()
                );
            }
        }
    }

    private boolean isLocalhost(String host) {
        return "localhost".equalsIgnoreCase(host)
            || "127.0.0.1".equals(host)
            || "::1".equals(host);
    }
}
```

Test:

```java
@Test
void shouldRejectRealSmtpHostInTestProfile() {
    MailProperties props = new MailProperties();
    props.setHost("smtp.gmail.com");

    assertThrows(
        IllegalStateException.class,
        () -> guard.validate(props, testEnvironment())
    );
}
```

### 20.2 Recipient Rewriting in Non-Production

In UAT or staging, you may not want real recipients.

Pattern:

```text
Original recipient: citizen@example.com
Actual SMTP recipient: test-mailbox@example.internal
Header/body marker: Original recipient redacted or audit-only
```

Test:

```java
@Test
void shouldRewriteRecipientOutsideProduction() {
    OutboundEmail rewritten = recipientPolicy.apply(
        environment("uat"),
        emailTo("citizen@example.com")
    );

    assertEquals("uat-mail-capture@example.internal", rewritten.to().get(0).address());
    assertTrue(rewritten.auditMetadata().containsKey("originalRecipientHash"));
}
```

Do not put original PII in subject/body for UAT unless policy allows it.

---

## 21. Testing Observability

Email tests should verify that operational evidence exists.

### 21.1 Logs

Do not over-test exact log text, but test redaction rules.

Example redactor:

```java
@Test
void shouldRedactRecipientEmailInLogs() {
    String log = logFormatter.formatFailure(
        "user@example.com",
        "550 user unknown"
    );

    assertFalse(log.contains("user@example.com"));
    assertTrue(log.contains("recipientHash="));
}
```

### 21.2 Metrics

If using Micrometer:

```java
@Test
void shouldIncrementSuccessMetric() {
    fakeGateway.willSucceed();

    worker.processOne();

    Counter counter = meterRegistry.find("mail.send.attempts")
        .tag("result", "success")
        .counter();

    assertNotNull(counter);
    assertEquals(1.0, counter.count());
}
```

Test failure tags too:

```java
Counter counter = meterRegistry.find("mail.send.attempts")
    .tag("result", "failure")
    .tag("failure_type", "recipient_rejected")
    .counter();
```

Keep metric labels low-cardinality.

Bad metric:

```text
recipient_email=user@example.com
```

Good metric:

```text
failure_type=recipient_rejected
template=case_submitted
channel=email
environment=prod
```

### 21.3 Audit Records

```java
@Test
void shouldWriteAuditRecordForSendAttempt() {
    EmailOutboxItem item = outbox.insert(pendingEmail());
    fakeGateway.willSucceed();

    worker.processOne();

    List<MailAuditRecord> records = auditRepo.findByOutboxId(item.id());

    assertThat(records)
        .extracting(MailAuditRecord::eventType)
        .contains("MAIL_SEND_ATTEMPTED", "MAIL_SEND_ACCEPTED");
}
```

Audit records should answer:

- what was attempted?
- when?
- triggered by whom/what?
- template version?
- recipient category?
- outcome?
- provider response classification?

---

## 22. Testing Attachment Safety

Attachment tests need both correctness and safety checks.

### 22.1 Filename Sanitization

```java
@Test
void shouldRejectPathTraversalFilename() {
    assertThrows(
        InvalidAttachmentException.class,
        () -> attachmentFactory.create("../../secret.txt", "text/plain", bytes("x"))
    );
}
```

### 22.2 Size Limit

```java
@Test
void shouldRejectAttachmentOverConfiguredLimit() {
    byte[] huge = new byte[11 * 1024 * 1024];

    assertThrows(
        AttachmentTooLargeException.class,
        () -> attachmentFactory.create("huge.pdf", "application/pdf", huge)
    );
}
```

### 22.3 MIME Type Mismatch

```java
@Test
void shouldFlagMimeTypeMismatch() {
    byte[] exeLikeBytes = new byte[] { 'M', 'Z', 0, 0 };

    AttachmentValidationResult result = validator.validate(
        "invoice.pdf",
        "application/pdf",
        exeLikeBytes
    );

    assertFalse(result.isAccepted());
    assertEquals("CONTENT_TYPE_MISMATCH", result.reasonCode());
}
```

### 22.4 Stream Reusability

If your attachment uses `InputStream`, test that it can be read when JavaMail writes the message.

Bad pattern:

```java
InputStream stream = uploadedFile.getInputStream();
// stream consumed earlier
// JavaMail later sees empty stream
```

Better: use a `DataSource` that can provide a new stream each time.

Test:

```java
@Test
void dataSourceShouldProvideFreshInputStreamEachTime() throws Exception {
    DataSource dataSource = new ByteArrayDataSource(
        "hello".getBytes(StandardCharsets.UTF_8),
        "text/plain"
    );

    assertEquals("hello", read(dataSource.getInputStream()));
    assertEquals("hello", read(dataSource.getInputStream()));
}
```

---

## 23. Testing Internationalization

Internationalization bugs often appear only in real inboxes.

Still, many can be caught at MIME level.

### 23.1 UTF-8 Subject

```java
@Test
void shouldPreserveUtf8SubjectAfterSerializationAndParsing() throws Exception {
    Session session = Session.getInstance(new Properties());

    MimeMessage original = new MimeMessage(session);
    original.setFrom("no-reply@example.com");
    original.setRecipients(Message.RecipientType.TO, "user@example.com");
    original.setSubject("Persetujuan berhasil diperbarui ✅", StandardCharsets.UTF_8.name());
    original.setText("Isi email", StandardCharsets.UTF_8.name());
    original.saveChanges();

    ByteArrayOutputStream out = new ByteArrayOutputStream();
    original.writeTo(out);

    MimeMessage parsed = new MimeMessage(
        session,
        new ByteArrayInputStream(out.toByteArray())
    );

    assertEquals("Persetujuan berhasil diperbarui ✅", parsed.getSubject());
}
```

### 23.2 Unicode Attachment Filename

```java
@Test
void shouldPreserveUnicodeAttachmentFilename() throws Exception {
    MimeMessage message = composer.compose(
        session,
        emailWithAttachment("bukti-pembayaran-ümlaut.pdf")
    );

    BodyPart attachment = findAttachment(message);

    assertEquals("bukti-pembayaran-ümlaut.pdf", attachment.getFileName());
}
```

### 23.3 Locale-Specific Template

```java
@Test
void shouldRenderIndonesianTemplate() {
    RenderedEmail email = renderer.render(
        "case.submitted.v1",
        Locale.forLanguageTag("id-ID"),
        variables
    );

    assertTrue(email.getSubject().contains("Permohonan"));
    assertTrue(email.getTextBody().contains("Terima kasih"));
}
```

---

## 24. Testing HTML Email More Realistically

HTML email should be tested at several levels.

### 24.1 Structural Assertions

```java
assertTrue(html.contains("<table"));
assertTrue(html.contains("role=\"presentation\""));
assertTrue(html.contains("alt=\""));
assertFalse(html.contains("<script"));
```

### 24.2 Link Assertions

```java
@Test
void shouldUseHttpsLinksOnly() {
    List<String> links = htmlParser.extractLinks(html);

    assertTrue(links.stream().allMatch(link -> link.startsWith("https://")));
}
```

### 24.3 No Localhost Links Outside Local Profile

```java
@Test
void shouldNotRenderLocalhostLinkInUatOrProduction() {
    RenderedEmail email = renderer.render("case.submitted.v1", uatContext, variables);

    assertFalse(email.getHtmlBody().contains("localhost"));
    assertFalse(email.getTextBody().contains("localhost"));
}
```

### 24.4 Required Plain Text Alternative

```java
@Test
void htmlEmailShouldHavePlainTextAlternative() {
    RenderedEmail email = renderer.render("case.submitted.v1", Locale.ENGLISH, variables);

    assertNotBlank(email.getHtmlBody());
    assertNotBlank(email.getTextBody());
}
```

### 24.5 Visual Regression

For high-value templates, you may use email rendering services or browser snapshots. But remember: browser rendering is not the same as Outlook/Gmail rendering.

Automated visual testing is useful, but never assume it fully proves email-client compatibility.

---

## 25. Testing Inbound Mail Parsing

Inbound email tests need a corpus.

Create files:

```text
src/test/resources/mail-corpus/plain-text.eml
src/test/resources/mail-corpus/html-alternative.eml
src/test/resources/mail-corpus/attachment-pdf.eml
src/test/resources/mail-corpus/inline-image.eml
src/test/resources/mail-corpus/nested-message.eml
src/test/resources/mail-corpus/malformed-boundary.eml
src/test/resources/mail-corpus/unknown-charset.eml
src/test/resources/mail-corpus/large-message.eml
```

Test parser:

```java
@Test
void shouldParsePlainTextAndAttachmentFromEml() throws Exception {
    MimeMessage message = loadEml("mail-corpus/attachment-pdf.eml");

    ParsedInboundEmail parsed = parser.parse(message);

    assertEquals("sender@example.com", parsed.from().address());
    assertTrue(parsed.textBody().contains("Please see attached"));
    assertEquals(1, parsed.attachments().size());
    assertEquals("report.pdf", parsed.attachments().get(0).filename());
}
```

Loading `.eml`:

```java
private MimeMessage loadEml(String resource) throws Exception {
    Session session = Session.getInstance(new Properties());
    InputStream input = getClass().getClassLoader().getResourceAsStream(resource);
    assertNotNull(input);
    return new MimeMessage(session, input);
}
```

### 25.1 Parser Safety Tests

```java
@Test
void shouldRejectMessageAboveMaximumSize() {
    MimeMessage message = loadEml("mail-corpus/large-message.eml");

    assertThrows(
        MessageTooLargeException.class,
        () -> parser.parse(message)
    );
}
```

```java
@Test
void shouldLimitNestedMultipartDepth() {
    MimeMessage message = loadEml("mail-corpus/deeply-nested.eml");

    assertThrows(
        MimeDepthExceededException.class,
        () -> parser.parse(message)
    );
}
```

Inbound parsing must be treated as untrusted input parsing.

---

## 26. Testing IMAP/POP3 Retrieval

If your application reads mailboxes, fake server tests are useful.

GreenMail can support IMAP/POP3 flows.

Conceptual test:

```java
@Test
void shouldPollUnreadMessagesFromImapFolder() throws Exception {
    greenMail.setUser("inbox@example.com", "secret");

    greenMail.deliver(createMimeMessage(
        "sender@example.com",
        "inbox@example.com",
        "Inbound test",
        "Hello"
    ));

    MailboxPollResult result = inboxPoller.pollOnce();

    assertEquals(1, result.processedCount());
    assertEquals("Inbound test", result.messages().get(0).subject());
}
```

Test checkpoint behavior:

```java
@Test
void shouldNotProcessSameInboundMessageTwice() {
    inboxPoller.pollOnce();
    inboxPoller.pollOnce();

    assertEquals(1, inboundMessageRepo.countProcessedUniqueMessages());
}
```

Important invariant:

```text
Inbound processing must be idempotent.
```

The same email may be seen again due to polling, flag update failure, network disconnect, or mailbox restore.

---

## 27. Testing Provider Abstraction

If you support SMTP and provider HTTP API, test the abstraction contract.

Interface:

```java
public interface MailGateway {
    MailSendResult send(OutboundEmail email) throws MailGatewayException;
}
```

Contract tests:

```java
interface MailGatewayContractTest {

    MailGateway gateway();
    FakeMailSink sink();

    @Test
    default void shouldSendBasicEmail() {
        gateway().send(basicEmail());

        CapturedEmail email = sink().singleMessage();
        assertEquals("user@example.com", email.to());
        assertEquals("Hello", email.subject());
    }

    @Test
    default void shouldRejectInvalidRecipient() {
        assertThrows(
            MailGatewayException.class,
            () -> gateway().send(emailTo("invalid-address"))
        );
    }
}
```

Then implementations:

```java
class SmtpMailGatewayContractTest implements MailGatewayContractTest { ... }
class SesMailGatewayContractTest implements MailGatewayContractTest { ... }
class SendGridMailGatewayContractTest implements MailGatewayContractTest { ... }
```

This prevents provider-specific behavior from leaking into business code.

---

## 28. Testing Retry Timing with a Fake Clock

Do not test retry timing with `Thread.sleep()`.

Bad:

```java
Thread.sleep(30_000);
worker.processDueItems();
```

Good:

```java
MutableClock clock = new MutableClock(
    Instant.parse("2026-06-18T05:00:00Z"),
    ZoneId.of("Asia/Jakarta")
);
```

Test:

```java
@Test
void shouldProcessEmailOnlyWhenNextAttemptIsDue() {
    EmailOutboxItem item = outbox.insert(failedRetryableAt(
        Instant.parse("2026-06-18T05:10:00Z")
    ));

    clock.setInstant(Instant.parse("2026-06-18T05:09:00Z"));
    worker.processDueItems();
    assertEquals(0, fakeGateway.sendCount());

    clock.setInstant(Instant.parse("2026-06-18T05:10:00Z"));
    worker.processDueItems();
    assertEquals(1, fakeGateway.sendCount());
}
```

Deterministic time is a major quality multiplier.

---

## 29. Testing Concurrency and Locking

Mail workers often run concurrently.

You must ensure the same outbox row is not processed by multiple workers at once.

### 29.1 Single Claim Test

```java
@Test
void shouldClaimPendingEmailOnlyOnceAcrossConcurrentWorkers() throws Exception {
    outbox.insert(pendingEmail());

    ExecutorService executor = Executors.newFixedThreadPool(2);

    Future<?> f1 = executor.submit(() -> worker.processOne());
    Future<?> f2 = executor.submit(() -> worker.processOne());

    f1.get();
    f2.get();

    assertEquals(1, fakeGateway.sendCount());
}
```

This requires real DB locking to test properly.

Mock-based tests cannot prove it.

### 29.2 Stale Processing Lock Test

If a worker crashes while item is `PROCESSING`, you need recovery.

```java
@Test
void shouldRecoverStaleProcessingItem() {
    EmailOutboxItem item = outbox.insert(processingSince(
        Instant.parse("2026-06-18T04:00:00Z")
    ));

    clock.setInstant(Instant.parse("2026-06-18T05:00:00Z"));

    recoveryJob.releaseStaleProcessingItems();

    EmailOutboxItem updated = outbox.findById(item.id());
    assertEquals(EmailStatus.FAILED_RETRYABLE, updated.status());
}
```

Without this, a crash can permanently strand email.

---

## 30. Testing Timeout Configuration

Timeouts are not optional in production.

Test config object:

```java
@Test
void smtpTimeoutsShouldBeConfigured() {
    Properties props = smtpPropertiesFactory.create(config);

    assertEquals("5000", props.getProperty("mail.smtp.connectiontimeout"));
    assertEquals("5000", props.getProperty("mail.smtp.timeout"));
    assertEquals("5000", props.getProperty("mail.smtp.writetimeout"));
}
```

Integration test for connection refused:

```java
@Test
void shouldFailFastWhenSmtpPortClosed() {
    MailGateway gateway = gatewayPointingTo("localhost", unusedPort());

    long start = System.nanoTime();

    assertThrows(MailGatewayException.class, () -> gateway.send(basicEmail()));

    Duration elapsed = Duration.ofNanos(System.nanoTime() - start);
    assertTrue(elapsed.compareTo(Duration.ofSeconds(10)) < 0);
}
```

Do not depend on long real timeouts in CI. Keep test timeouts small.

---

## 31. Testing Security Controls

Security tests for mail should cover:

- header injection;
- HTML escaping;
- unsafe links;
- attachment policy;
- credential redaction;
- recipient rewriting;
- PII logging;
- environment guard.

### 31.1 Header Injection

```java
@Test
void shouldRejectSubjectWithCrLf() {
    OutboundEmail email = OutboundEmail.builder()
        .to("user@example.com")
        .subject("Hello\r\nBcc: attacker@example.com")
        .textBody("Hi")
        .build();

    assertThrows(
        InvalidMailHeaderException.class,
        () -> validator.validate(email)
    );
}
```

### 31.2 Unsafe Link

```java
@Test
void shouldRejectNonHttpsActionLink() {
    Map<String, Object> variables = Map.of(
        "actionUrl", "http://example.com/reset"
    );

    assertThrows(
        UnsafeEmailLinkException.class,
        () -> renderer.render("password.reset.v1", Locale.ENGLISH, variables)
    );
}
```

### 31.3 Credential Redaction

```java
@Test
void shouldRedactSmtpPasswordFromDebugDump() {
    MailConfig config = new MailConfig("smtp.example.com", 587, "app", "secret");

    String dump = config.toSafeDiagnosticString();

    assertTrue(dump.contains("smtp.example.com"));
    assertFalse(dump.contains("secret"));
    assertTrue(dump.contains("password=***"));
}
```

---

## 32. Testing Compliance and Audit Defensibility

In regulated systems, email tests should verify evidence quality.

Example audit model:

```java
public final class MailAuditRecord {
    private final UUID notificationId;
    private final String templateCode;
    private final int templateVersion;
    private final String recipientHash;
    private final String triggeredBy;
    private final Instant attemptedAt;
    private final String outcome;
    private final String failureType;

    // constructor, getters
}
```

Test:

```java
@Test
void auditRecordShouldNotContainRawRecipientAddress() {
    fakeGateway.willFailPermanently("550 user unknown");

    worker.processOne();

    MailAuditRecord audit = auditRepo.findLatest();

    assertFalse(audit.toString().contains("user@example.com"));
    assertNotNull(audit.getRecipientHash());
    assertEquals("case.submitted.v1", audit.getTemplateCode());
    assertEquals("FAILED_PERMANENT", audit.getOutcome());
}
```

Top-tier systems distinguish:

```text
Operational observability ≠ unlimited data exposure
Audit defensibility ≠ storing every sensitive field forever
```

---

## 33. Test Profiles and Configuration Layout

Recommended test profile:

```yaml
mail:
  enabled: true
  mode: fake-smtp
  environment-guard: true
  recipient-rewrite:
    enabled: true
    target: test-capture@example.internal

spring:
  mail:
    host: localhost
    port: 1025
    properties:
      mail.smtp.auth: false
      mail.smtp.starttls.enable: false
      mail.smtp.connectiontimeout: 3000
      mail.smtp.timeout: 3000
      mail.smtp.writetimeout: 3000
```

Recommended production profile:

```yaml
mail:
  enabled: true
  mode: smtp
  recipient-rewrite:
    enabled: false

spring:
  mail:
    host: ${SMTP_HOST}
    port: ${SMTP_PORT}
    username: ${SMTP_USERNAME}
    password: ${SMTP_PASSWORD}
    properties:
      mail.smtp.auth: true
      mail.smtp.starttls.enable: true
      mail.smtp.starttls.required: true
      mail.smtp.connectiontimeout: 5000
      mail.smtp.timeout: 10000
      mail.smtp.writetimeout: 10000
```

Test that production config cannot accidentally use fake mode:

```java
@Test
void productionMustNotUseFakeMailMode() {
    MailProperties props = new MailProperties();
    props.setMode("fake-smtp");

    assertThrows(
        IllegalStateException.class,
        () -> guard.validate(props, productionEnvironment())
    );
}
```

---

## 34. Build Pipeline Strategy

Recommended CI stages:

```text
1. Unit tests
   - business policy
   - template variables
   - validators
   - failure classifier

2. MIME tests
   - message structure
   - charset
   - attachments
   - inline images

3. Integration tests
   - fake SMTP
   - outbox worker
   - retry state machine
   - metrics/audit

4. Optional provider smoke tests
   - restricted branch
   - restricted account
   - safe recipient only
   - rate-limited
```

Do not run real provider tests on every pull request unless you have strong controls.

Provider smoke tests should use:

- allowlisted recipient;
- dedicated test domain/account;
- strict quota;
- no sensitive data;
- clear subject prefix;
- automatic cleanup if inbox is involved.

Example subject prefix:

```text
[CI-SMOKE][DO-NOT-RESPOND] Mail provider connectivity test
```

---

## 35. Recommended Test Suite Structure

```text
src/test/java/
  com/example/mail/
    domain/
      NotificationPolicyTest.java
      RecipientPolicyTest.java
      IdempotencyKeyTest.java

    template/
      TemplateRendererTest.java
      TemplateVariableContractTest.java
      HtmlEscapingTest.java
      EmailSnapshotTest.java

    mime/
      MimeMessageComposerTest.java
      MultipartStructureTest.java
      AttachmentMimeTest.java
      InlineImageMimeTest.java
      InternationalizationMimeTest.java
      BccPrivacyTest.java

    gateway/
      JakartaMailGatewayTest.java
      SpringJavaMailGatewayTest.java
      MailFailureClassifierTest.java
      MailGatewayContractTest.java

    outbox/
      EmailOutboxWorkerTest.java
      RetryPolicyTest.java
      OutboxLockingIntegrationTest.java
      StaleProcessingRecoveryTest.java

    integration/
      GreenMailSmtpIntegrationTest.java
      MailpitContainerIntegrationTest.java
      ObservabilityIntegrationTest.java
      AuditIntegrationTest.java

    inbound/
      InboundMimeParserTest.java
      ImapPollingIntegrationTest.java
      DuplicateInboundProcessingTest.java

src/test/resources/
  email-snapshots/
  mail-corpus/
  templates/
```

This structure communicates architecture.

Tests become documentation.

---

## 36. Common Testing Mistakes

### Mistake 1: Only Mocking `JavaMailSender`

```java
verify(javaMailSender).send(any(MimeMessage.class));
```

This proves little.

Better:

- inspect the `MimeMessage`;
- send to fake SMTP;
- assert captured content.

### Mistake 2: Sending Real Email in Integration Tests

This causes:

- spam;
- accidental PII exposure;
- flaky tests;
- provider quota issues;
- embarrassing customer-facing incidents.

Use fake SMTP by default.

### Mistake 3: Not Testing Failure

Success-path-only email tests miss the most important behavior.

You need tests for:

- temporary failure;
- permanent failure;
- retry exhaustion;
- duplicate prevention;
- stale lock recovery.

### Mistake 4: Treating SMTP Accepted as Delivered

A fake SMTP server accepting a message only proves handoff to the fake server.

It does not prove inbox delivery.

Your domain language should distinguish:

```text
QUEUED
SMTP_ACCEPTED
DELIVERED
BOUNCED
COMPLAINED
OPENED  // if tracked, with caveats
```

### Mistake 5: Not Testing BCC

BCC leakage is a serious privacy issue.

Test it explicitly.

### Mistake 6: Ignoring Charset

ASCII-only tests hide bugs.

Always include non-ASCII subject/body/filename tests.

### Mistake 7: Snapshotting Unstable Output

If templates include generated IDs/timestamps, snapshots will be noisy.

Normalize first.

### Mistake 8: Using `Thread.sleep()` for Retry

Use fake clocks.

### Mistake 9: High-Cardinality Metric Labels

Do not test or implement metrics with raw recipient values.

### Mistake 10: No Environment Guard

A wrong environment variable should not be able to route tests to production SMTP.

---

## 37. Java 8 to Java 25 Testing Considerations

### 37.1 Java 8

Common stack:

```text
javax.mail
javax.activation
JUnit 4 or JUnit 5
GreenMail legacy-compatible setup
Spring Boot 2.x if Spring-based
```

Considerations:

- package namespace is `javax.mail`;
- some modern Jakarta-based libraries may not fit;
- Java 8 date/time is available, so use `Clock`;
- no virtual threads;
- older CI containers may have old TLS defaults.

### 37.2 Java 11

Common issue:

```text
Java EE modules removed from JDK
```

So dependencies must be explicit.

Test classpath should include mail + activation implementation.

### 37.3 Java 17

Common stack:

```text
jakarta.mail or javax.mail depending on framework generation
JUnit 5
Testcontainers
Spring Boot 3 uses jakarta namespace
```

Be careful with mixed namespace dependencies.

### 37.4 Java 21

Additional consideration:

- virtual threads can make blocking SMTP workers easier to scale;
- tests should still enforce backpressure and rate limit;
- do not treat virtual threads as a substitute for provider quota control.

### 37.5 Java 25

The same architectural test principles apply.

The likely differences are ecosystem versions, stronger baseline libraries, and possibly more teams standardizing on Jakarta namespace.

The invariants do not change:

```text
No real email in tests.
MIME must be inspected.
Failure must be classified.
Retry must be deterministic.
Outbox must be idempotent.
Sensitive data must be protected.
```

---

## 38. A Practical Reference Test Plan

For a production-grade transactional mail subsystem, minimum tests:

### Domain

- notification request generated for each business event;
- idempotency key stable;
- recipient preference/suppression applied;
- tenant sender selected correctly.

### Template

- required variables enforced;
- HTML escaped;
- text alternative generated;
- localized output tested;
- snapshot for critical templates.

### MIME

- plain text message;
- HTML message;
- multipart alternative;
- attachment;
- inline image;
- Unicode subject/body/filename;
- BCC not leaked;
- header injection rejected.

### SMTP Integration

- fake SMTP success;
- fake SMTP captured subject/body/headers;
- test config cannot use real SMTP;
- timeout properties present.

### Failure

- transient SMTP failure retryable;
- permanent recipient failure not retryable;
- auth failure alerts/non-retryable;
- max attempt dead-letter;
- stale processing lock recovered;
- partial recipient failure recorded.

### Operational

- metrics emitted;
- audit records written;
- logs redact recipient/credential;
- no high-cardinality metric label;
- queue age/backlog observable.

### Inbound, if applicable

- parse `.eml` corpus;
- attachment extraction;
- duplicate inbound message ignored;
- malformed MIME safe failure;
- max size/depth enforced.

---

## 39. End-to-End Example Scenario

Business case:

```text
A case approval should notify the applicant by email.
```

Test chain:

### 39.1 Business Test

```text
CaseApproved event -> NotificationRequest(template=case.approved.v1)
```

### 39.2 Template Test

```text
case.approved.v1 + variables -> subject/text/html
```

### 39.3 MIME Test

```text
RenderedEmail -> MimeMessage with multipart/alternative
```

### 39.4 Outbox Test

```text
Business transaction inserts outbox row, does not send SMTP directly
```

### 39.5 Worker Integration Test

```text
Worker sends pending outbox row to fake SMTP
```

### 39.6 Failure Test

```text
Fake gateway throws 451 -> item becomes FAILED_RETRYABLE
```

### 39.7 Audit Test

```text
MAIL_SEND_ATTEMPTED and MAIL_SEND_ACCEPTED audit records exist
```

### 39.8 Privacy Test

```text
Logs do not expose raw recipient address
```

This layered approach gives much stronger confidence than one large flaky E2E test.

---

## 40. Design Heuristics for Top-Tier Engineers

Use these heuristics when reviewing mail tests:

1. **A test that only verifies a mock send call is not enough.**
2. **Every critical template should have rendering tests.**
3. **Every non-trivial MIME structure should have structural assertions.**
4. **Every retry policy should be tested with fake time.**
5. **Every production SMTP failure class should have a classifier test.**
6. **Every test environment should be technically prevented from sending real email.**
7. **Every mail worker should have concurrency/locking tests.**
8. **Every audit-sensitive notification should have audit evidence tests.**
9. **Every PII-bearing path should have redaction tests.**
10. **Every inbound parser should be tested against malformed input.**

The difference between a basic implementation and a top-tier implementation is not that the latter knows more API methods.

It is that the latter knows what can go wrong and has tests proving the system behaves safely when it does.

---

## 41. Summary

In this part, we built a testing strategy for Java/Jakarta mail systems.

Key conclusions:

1. Email testing must be layered.
2. Do not over-mock Jakarta Mail internals.
3. Unit-test business notification decisions separately from MIME and SMTP.
4. Template rendering needs escaping, variable, localization, and snapshot tests.
5. MIME composition should be inspected structurally.
6. Fake SMTP tools are essential for integration tests.
7. Real provider tests should be optional and tightly controlled.
8. Retry/outbox behavior should be tested as a deterministic state machine.
9. Failure classification is a first-class testing target.
10. Security, privacy, and audit must be tested explicitly.
11. Inbound mail parsing requires a malicious/malformed corpus.
12. Java 8–25 changes packages and tooling, but not the core testing invariants.

A robust mail subsystem is not proven by “email arrived once on my machine”.

It is proven by a test suite that exercises:

```text
intent -> rendering -> MIME -> SMTP handoff -> retry -> audit -> observability -> failure recovery
```

That is the engineering level expected from a production-grade system.

---

## 42. References

- Jakarta Mail Specification and API documentation.
- Jakarta Mail `MimeMessage`, `MimeMultipart`, `MimeBodyPart`, `Message`, and `Part` API documentation.
- Spring Framework email integration documentation.
- Spring Framework `JavaMailSender` and `MimeMessageHelper` documentation.
- GreenMail official documentation and project repository.
- Mailpit official documentation.
- RFC 5321 — Simple Mail Transfer Protocol.
- RFC 5322 — Internet Message Format.
- RFC 2045–2049 — MIME specifications.

---

## 43. Next Part

Next:

```text
Part 20 — Observability: Logs, Metrics, Tracing, Audit
```

Part 20 will go deeper into operating mail systems in production:

- what to log;
- what never to log;
- correlation ID;
- message ID;
- recipient redaction;
- metrics design;
- alerting;
- tracing;
- audit trail;
- dashboard and incident signals.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./18-spring-boot-modern-java-mail-integration.md">⬅️ Part 18 — Jakarta Mail in Spring Boot and Modern Java Applications</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./20-observability-logs-metrics-tracing-audit.md">Part 20 — Observability: Logs, Metrics, Tracing, Audit ➡️</a>
</div>
