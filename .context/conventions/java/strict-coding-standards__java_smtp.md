# Strict Coding Standards: Java SMTP / Jakarta Mail

> Purpose: enforce safe, reliable, auditable, and secure email sending from Java applications.
>
> Scope: SMTP submission, Jakarta Mail / JavaMail, MIME email construction, attachments, TLS/STARTTLS, authentication, bounce/error handling, asynchronous sending, retry, and operational observability.
>
> This file is an overlay over:
>
> - `strict-coding-standards__java_security.md`
> - `strict-coding-standards__java_cryptography.md`
> - `strict-coding-standards__java_network.md`
> - `strict-coding-standards__java_io.md`
> - `strict-coding-standards__java_logging.md`
> - `strict-coding-standards__java_telemetry.md`

---

## 1. Terminology

SMTP code often mixes several concepts. The implementation must keep them separate:

1. **Message submission**: application submits mail to an SMTP submission server/MSA, usually authenticated.
2. **SMTP relay/transfer**: MTA-to-MTA delivery on the internet.
3. **Envelope sender**: SMTP `MAIL FROM`, used for bounce handling/SPF alignment.
4. **Header From**: visible `From:` header shown to users.
5. **Reply-To**: address where user replies should go.
6. **Return-Path**: final recorded envelope sender after delivery.
7. **Recipient headers**: `To`, `Cc`, `Bcc` presentation metadata.
8. **Envelope recipients**: actual SMTP `RCPT TO` recipients.

LLM implementations must not treat these as interchangeable.

---

## 2. Non-Negotiable Rules

### MUST

1. Use Jakarta Mail (`jakarta.mail.*`) for new Jakarta EE / modern Java modules.
2. Use legacy JavaMail (`javax.mail.*`) only in legacy modules that already depend on Java EE namespace.
3. Do not mix `javax.mail.*` and `jakarta.mail.*` in one module.
4. Use authenticated SMTP submission endpoint, not open relay behavior.
5. Configure TLS explicitly: STARTTLS required or implicit TLS, according to provider policy.
6. Configure explicit connection, read, and write timeouts.
7. Externalize SMTP host, port, username, sender, and TLS settings through approved config/secrets provider.
8. Validate and normalize email addresses before constructing messages.
9. Use MIME-safe APIs; do not hand-build raw MIME strings.
10. Redact credentials, tokens, and message bodies in logs.
11. Keep email sending outside database transactions unless using an outbox/deferred job pattern.
12. Implement bounded retry and idempotency for email send requests.
13. Capture provider message ID / SMTP response where available.

### MUST NOT

1. Do not hardcode SMTP credentials.
2. Do not disable TLS certificate or hostname validation.
3. Do not send passwords, reset tokens, OTPs, or secrets in logs.
4. Do not put multiple unrelated recipients in one email if privacy requires separation.
5. Do not leak BCC recipients into visible headers.
6. Do not build HTML by string concatenation with unescaped user input.
7. Do not attach user-uploaded files without type, size, and malware/security checks.
8. Do not retry indefinitely.
9. Do not assume `Transport.send()` success means final inbox delivery.
10. Do not block request threads on slow SMTP operations in high-throughput paths without queue/outbox design.

### RESTRICTED

Allowed only with explicit design note:

1. Direct SMTP from application pods to internet MX hosts.
2. Bulk email campaigns.
3. Attachments larger than project-approved threshold.
4. Inline images.
5. Custom `Transport` handling.
6. DKIM signing inside application code.
7. S/MIME or PGP message encryption.
8. Multi-tenant sender identity.
9. Retrying partially successful multi-recipient sends.
10. Logging SMTP debug protocol output.

---

## 3. Version and Namespace Policy

### Modern Jakarta Mail

Use:

```java
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.Session;
import jakarta.mail.Transport;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
```

### Legacy JavaMail

Use only in legacy modules:

```java
import javax.mail.Message;
import javax.mail.Session;
import javax.mail.Transport;
import javax.mail.internet.MimeMessage;
```

Rules:

1. New modules should use `jakarta.mail.*`.
2. If framework/server still requires `javax.mail.*`, document the compatibility reason.
3. Do not use implementation-specific `com.sun.mail.smtp.*` APIs unless a capability is unavailable through standard API and the code is isolated.
4. Do not expose Jakarta Mail classes beyond infrastructure/email adapter layer.

---

## 4. SMTP Submission Configuration

### Required Config Fields

1. `smtp.host`
2. `smtp.port`
3. `smtp.username` or IAM/provider credential mechanism
4. `smtp.password` or secret reference
5. `smtp.from.address`
6. `smtp.envelope.from` / bounce address if supported
7. `smtp.starttls.required` or `smtp.ssl.enable`
8. `smtp.connection.timeout`
9. `smtp.read.timeout`
10. `smtp.write.timeout`
11. `smtp.auth.mechanisms` if provider restricts mechanisms
12. `smtp.debug.enabled` default false

### Example Properties

```java
Properties props = new Properties();
props.put("mail.smtp.host", config.host());
props.put("mail.smtp.port", Integer.toString(config.port()));
props.put("mail.smtp.auth", "true");
props.put("mail.smtp.starttls.enable", "true");
props.put("mail.smtp.starttls.required", "true");
props.put("mail.smtp.connectiontimeout", Long.toString(config.connectionTimeoutMillis()));
props.put("mail.smtp.timeout", Long.toString(config.readTimeoutMillis()));
props.put("mail.smtp.writetimeout", Long.toString(config.writeTimeoutMillis()));
props.put("mail.smtp.ssl.checkserveridentity", "true");
```

Rules:

1. Port 587 with STARTTLS is the default for authenticated submission unless provider mandates 465 implicit TLS.
2. Port 25 must not be used for application submission unless the application is explicitly acting as an MTA/relay inside an approved mail infrastructure.
3. STARTTLS must be required when using 587 on untrusted networks.
4. Implicit TLS must use the correct `smtps`/SSL configuration.
5. Debug output must be disabled in production because protocol logs can expose credentials and message content.

---

## 5. Session and Transport Lifecycle

Rules:

1. `Session` creation must be centralized.
2. `Session` properties must be immutable after construction by convention.
3. Do not create ad hoc `Properties` in every method.
4. For low-volume sending, `Transport.send(message)` may be acceptable.
5. For high-volume sending, use explicit `Transport` lifecycle with connection reuse only if concurrency and provider limits are understood.
6. `Transport` must be closed reliably.
7. Do not share a mutable `MimeMessage` across threads.
8. Do not reuse a `MimeMessage` instance for different recipients unless all headers and envelope recipients are rebuilt safely.

Correct explicit transport pattern:

```java
Transport transport = null;
try {
    transport = session.getTransport("smtp");
    transport.connect(config.host(), config.port(), config.username(), config.password());
    transport.sendMessage(message, message.getAllRecipients());
} finally {
    if (transport != null) {
        try {
            transport.close();
        } catch (MessagingException ignored) {
            // log at debug with no secrets if needed
        }
    }
}
```

---

## 6. Email Request Model

Do not let controllers build `MimeMessage` directly.

Recommended internal model:

```java
public record EmailCommand(
        EmailAddress from,
        EmailAddress envelopeFrom,
        List<EmailAddress> to,
        List<EmailAddress> cc,
        List<EmailAddress> bcc,
        String subject,
        EmailBody body,
        List<EmailAttachment> attachments,
        EmailPurpose purpose,
        String idempotencyKey
) {}
```

Rules:

1. Email command must be validated before SMTP adapter.
2. `to`, `cc`, `bcc` must be privacy-reviewed.
3. `subject` must be bounded length and CR/LF sanitized.
4. Body must distinguish plain text and HTML.
5. Template rendering must occur before SMTP adapter or in a dedicated rendering service.
6. Attachments must use safe filenames and content type.

---

## 7. Address Validation and Header Injection Defense

Rules:

1. Validate email address syntax with `InternetAddress` plus domain/business rules as needed.
2. Reject CR/LF in display names, subject, reply-to, custom headers, filenames, and any user-controlled header field.
3. Do not concatenate raw headers.
4. Use `MimeMessage`/`InternetAddress` APIs for header encoding.
5. Normalize display names and reject control characters.
6. Apply allow-list for sender domains in multi-tenant systems.

Forbidden:

```java
message.setHeader("Subject", userInput); // use setSubject with charset and validation
```

---

## 8. Subject and Body Rules

### Plain Text

1. Use UTF-8.
2. Ensure line length and content are reasonable.
3. Do not include unredacted secrets unless this is an approved one-time secure communication flow.

### HTML

1. Render via approved template engine.
2. Escape user-controlled values contextually.
3. Do not insert raw user HTML unless sanitized through approved sanitizer.
4. Include a plain-text alternative for important transactional email.
5. Do not embed tracking pixels unless policy allows.

Correct MIME alternative:

```java
MimeMultipart alternative = new MimeMultipart("alternative");

MimeBodyPart textPart = new MimeBodyPart();
textPart.setText(textBody, StandardCharsets.UTF_8.name());
alternative.addBodyPart(textPart);

MimeBodyPart htmlPart = new MimeBodyPart();
htmlPart.setContent(htmlBody, "text/html; charset=UTF-8");
alternative.addBodyPart(htmlPart);

message.setContent(alternative);
```

---

## 9. Attachments

Rules:

1. Attachment size limit must be enforced before message construction.
2. Filename must be sanitized and must not contain path separators/control characters.
3. Content type must be detected/validated, not trusted from user input alone.
4. Do not attach executable content unless explicitly approved.
5. Do not load large attachments fully into memory.
6. Attachments from user upload must pass malware/security workflow if required.
7. Sensitive attachments should be avoided; prefer secure download links with expiry and access control.
8. Temporary files must be deleted.

---

## 10. Retry, Idempotency, and Outbox

Email sending is side-effectful.

Rules:

1. Use an outbox/job table for reliable transactional email triggered by database state changes.
2. Commit business transaction first; enqueue/send after commit.
3. Use idempotency key per logical email event.
4. Store send attempt state: pending, sending, sent, failed, suppressed.
5. Retry only transient SMTP/provider errors.
6. Permanent errors must stop retry or move to dead-letter/manual review.
7. Multi-recipient partial success must be handled explicitly.
8. Use bounded retry count and exponential backoff with jitter.
9. Avoid duplicate email by checking idempotency key before sending.

Do not do this:

```java
@Transactional
public void approveCase(CaseId id) {
    repository.approve(id);
    mailSender.send(...); // forbidden: external side effect inside DB transaction
}
```

Prefer:

```java
@Transactional
public void approveCase(CaseId id) {
    repository.approve(id);
    emailOutbox.enqueue(ApprovalEmailRequested.of(id));
}
```

---

## 11. SMTP Error Handling

Rules:

1. Determine retry behavior from SMTP reply code class and provider-specific exception details.
2. 4xx is generally transient; 5xx is generally permanent, but policy may refine.
3. Do not parse human-readable response text as the primary decision mechanism.
4. Preserve sanitized SMTP code and enhanced status code if available.
5. Do not expose provider error details directly to end users.
6. Authentication failure must alert as configuration/security issue.
7. TLS failure must alert as security/configuration issue.
8. Recipient rejection must be reported to business workflow if email is mandatory.

---

## 12. Security and Privacy

### Secrets

1. SMTP password/API key must come from Secrets Manager, Vault, Kubernetes Secret, or approved secret provider.
2. Secret rotation must be supported without code change.
3. Logs must never include credential properties or full protocol debug output in production.

### TLS

1. Use STARTTLS required or implicit TLS.
2. Enable server identity checking where supported.
3. Do not disable certificate validation.
4. Do not pin certificates unless provider rotation process is understood.

### Privacy

1. Use BCC carefully; never expose BCC in headers.
2. Send per-recipient emails when recipient privacy matters.
3. Avoid email content that leaks sensitive internal IDs unless required.
4. Never include raw access tokens in email links; use short-lived, single-use, server-side validated tokens.

---

## 13. Deliverability and Domain Alignment

Rules:

1. Application sender domain must be approved.
2. Header From, envelope sender, DKIM signing domain, SPF, and DMARC alignment must be understood by platform/email team.
3. Do not spoof arbitrary `From` addresses.
4. Bounce address must route to monitored mailbox/webhook if bounce handling matters.
5. Transactional and marketing email streams must be separated if required.
6. Rate limits must follow provider quotas.
7. Bulk sending requires unsubscribe/compliance rules outside this coding standard.

Application code usually should not implement DKIM/SPF/DMARC itself; use provider/platform unless a clear requirement exists.

---

## 14. Observability

Every send attempt should emit:

1. Email purpose/type.
2. Logical idempotency key.
3. Provider/client name.
4. SMTP host alias, not raw credential endpoint if sensitive.
5. Recipient count, not full recipient list by default.
6. Status: sent/failed/retry/suppressed.
7. SMTP status code if available.
8. Duration.
9. Retry count.
10. Provider message ID if available.

Forbidden labels/log fields:

1. Full email body.
2. Attachment content.
3. Access tokens/reset tokens.
4. Full recipient list in high-cardinality metrics.
5. SMTP password/API key.

---

## 15. Testing Rules

### Unit Tests

1. Address validation.
2. Header injection rejection.
3. Subject/body charset.
4. MIME structure for text/html/attachments.
5. Idempotency key behavior.
6. Error classification.

### Integration Tests

Use local SMTP test server/tooling such as GreenMail, MailHog, Mailpit, or testcontainer equivalent.

Required scenarios:

1. Successful send.
2. Authentication failure.
3. TLS required but unavailable.
4. Recipient rejected.
5. Temporary SMTP failure and retry.
6. Attachment limit exceeded.
7. BCC privacy.
8. HTML escaping.
9. Timeout behavior.

Do not use real production SMTP provider in normal CI.

---

## 16. Anti-Patterns

1. Sending email synchronously inside web request path without timeout/backpressure.
2. Sending email inside DB transaction.
3. Hardcoded SMTP password.
4. `mail.debug=true` in production.
5. Raw MIME construction with string concatenation.
6. User input directly in headers.
7. Retrying forever and sending duplicates.
8. Treating successful SMTP submission as guaranteed inbox delivery.
9. Attaching unbounded files from user uploads.
10. Logging full email body for troubleshooting.
11. Using `From` as arbitrary user-supplied address.
12. Mixing marketing/bulk behavior into transactional email adapter.

---

## 17. LLM Implementation Contract

When implementing SMTP/email code, the LLM must provide:

1. Chosen namespace: `jakarta.mail` or `javax.mail`, with reason.
2. SMTP host/port/TLS/auth configuration shape.
3. Timeout settings.
4. Address/header injection validation.
5. MIME structure.
6. Attachment policy.
7. Retry/idempotency/outbox behavior.
8. Logging and telemetry redaction.
9. Failure classification.
10. Tests using local SMTP server or equivalent.
11. Explicit statement that credentials are not hardcoded and TLS validation is not disabled.

---

## 18. Reviewer Checklist

- [ ] Is the namespace correct and not mixed?
- [ ] Is SMTP config externalized?
- [ ] Are timeouts explicit?
- [ ] Is STARTTLS/implicit TLS configured safely?
- [ ] Are credentials obtained from approved secret source?
- [ ] Are headers protected from injection?
- [ ] Are email addresses validated?
- [ ] Are body/template values escaped?
- [ ] Are attachments bounded and sanitized?
- [ ] Is email sending outside DB transaction?
- [ ] Is retry bounded and idempotent?
- [ ] Are SMTP errors classified correctly?
- [ ] Are logs/metrics redacted?
- [ ] Are tests covering SMTP failure modes?

---

## 19. Source Anchors

- Jakarta Mail API: `https://jakarta.ee/specifications/mail/2.1/apidocs/jakarta.mail/jakarta/mail/package-summary`
- Jakarta Mail SMTP Transport: `https://jakartaee.github.io/mail-api/SMTP-Transport`
- RFC 5321 SMTP: `https://datatracker.ietf.org/doc/html/rfc5321`
- RFC 6409 Message Submission: `https://www.rfc-editor.org/rfc/rfc6409.html`
- RFC 3207 STARTTLS for SMTP: `https://datatracker.ietf.org/doc/html/rfc3207`
- RFC 4954 SMTP AUTH: `https://datatracker.ietf.org/doc/html/rfc4954`
- RFC 8461 MTA-STS: `https://datatracker.ietf.org/doc/html/rfc8461`
