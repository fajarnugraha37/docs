# Part 29 — Top 1% Design Review: Evaluating a Mail Subsystem Like an Architect

> Series: `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery`  
> File: `29-top-one-percent-design-review.md`  
> Scope: Java 8–25, JavaMail/`javax.mail`, Jakarta Mail/`jakarta.mail`, Jakarta Activation, SMTP, MIME, operational architecture  
> Audience: senior/backend/platform/architecture engineers who need to review, defend, migrate, and operate enterprise email systems

---

## 0. Executive Summary

Bagian terakhir ini bukan tentang cara menulis `Transport.send(message)`. Itu sudah terlalu kecil.

Bagian ini membahas **cara menilai apakah sebuah mail subsystem layak production, layak diaudit, layak dioperasikan, dan layak dipertahankan bertahun-tahun**.

Top engineer tidak hanya bertanya:

```text
Can the application send email?
```

Mereka bertanya:

```text
Can the system send the right message, to the right recipient, through the right provider,
with the right identity, at the right time, under failure, without leaking data,
without duplicate side effects, while preserving auditability and operator control?
```

Itulah level design review yang ingin dicapai.

---

## 1. What This Final Part Is For

Part sebelumnya sudah membangun fondasi:

1. email sebagai distributed system;
2. SMTP/MIME/IMAP/POP3;
3. JavaMail vs Jakarta Mail;
4. core API;
5. SMTP sending;
6. MIME construction;
7. multipart;
8. attachment dan Jakarta Activation;
9. HTML email;
10. addressing/header semantics;
11. exception model;
12. outbox/retry/idempotency;
13. bulk/rate limit;
14. security;
15. deliverability;
16. inbound mail;
17. parsing;
18. Jakarta EE container;
19. Spring Boot;
20. testing;
21. observability;
22. performance;
23. provider integration;
24. bounce/webhook feedback;
25. template architecture;
26. compliance;
27. advanced MIME/i18n;
28. incident playbook;
29. reference implementation.

Part ini menyatukan semuanya menjadi **framework review**.

Tujuan akhirnya: ketika melihat desain mail subsystem, Anda bisa cepat menemukan:

- hidden coupling;
- wrong abstraction;
- missing timeout;
- unsafe retry;
- duplicate risk;
- privacy leak;
- weak observability;
- poor migration path;
- operational blind spot;
- deliverability misconception;
- audit defensibility gap.

---

## 2. The Core Design Question

Pertanyaan desain yang paling penting:

```text
Is email treated as a reliable, observable, policy-controlled side-effect subsystem,
or merely as a helper utility?
```

Jika email diperlakukan sebagai helper utility, biasanya desainnya seperti ini:

```java
public void approveApplication(Long id) {
    application.approve(id);
    mailService.sendApprovalEmail(id);
}
```

Kelihatannya sederhana, tetapi menyimpan banyak masalah:

- bagaimana jika approval commit berhasil tetapi SMTP gagal?
- bagaimana jika SMTP timeout tetapi sebenarnya email terkirim?
- bagaimana jika request retry dan email terkirim dua kali?
- bagaimana jika recipient invalid?
- bagaimana jika template berubah setelah event terjadi?
- bagaimana jika auditor bertanya bukti email yang dikirim 8 bulan lalu?
- bagaimana jika provider rate-limit?
- bagaimana jika attachment terlalu besar?
- bagaimana jika body mengandung PII dan masuk log?

Design review top-level harus mengubah mental model menjadi:

```text
Business event produces notification intent.
Notification intent is persisted.
A delivery worker attempts external side effect.
Result is classified, observed, retried, audited, and reconciled.
```

---

## 3. The Mail Subsystem Boundary

Mail subsystem yang matang memiliki boundary jelas.

### 3.1 Bad Boundary

```text
Business Service
  -> builds subject
  -> builds HTML
  -> attaches files
  -> chooses SMTP host
  -> calls Jakarta Mail
  -> catches MessagingException
```

Masalah:

- business layer tahu terlalu banyak detail MIME/SMTP;
- template logic tersebar;
- retry sulit;
- audit sulit;
- testing sulit;
- migration provider sulit;
- compliance sulit.

### 3.2 Better Boundary

```text
Business Module
  -> emits NotificationIntent

Notification Application Layer
  -> validates recipient policy
  -> resolves template/version
  -> persists outbox

Mail Rendering Layer
  -> renders text/html
  -> resolves attachments
  -> builds canonical MailRequest

Mail Delivery Layer
  -> Jakarta Mail / provider adapter
  -> classifies result
  -> records attempt

Feedback Layer
  -> bounce/webhook/complaint
  -> updates delivery lifecycle
```

Ini bukan overengineering jika:

- email adalah evidence;
- email berisi keputusan bisnis;
- email dikirim ke customer/public;
- email volume tinggi;
- email harus audited;
- email dipakai di workflow enforcement/case management;
- email terkait SLA/regulatory notice.

---

## 4. Review Lens #1 — Domain Semantics

Pertanyaan pertama bukan teknis.

```text
What does this email mean in the domain?
```

Email bisa berarti banyak hal:

| Email Type | Domain Meaning | Engineering Implication |
|---|---|---|
| OTP / login | authentication support | low latency, short validity, high security |
| password reset | account recovery | anti-abuse, token expiry, no sensitive content |
| approval notice | business decision communication | audit, template version, immutable evidence |
| regulatory warning | formal notice | delivery evidence, retention, escalation |
| receipt | transaction confirmation | idempotency, exact values, localization |
| marketing | campaign communication | unsubscribe, consent, suppression |
| bulk announcement | informational broadcast | rate limit, batching, personalization |
| internal alert | operational notification | dedup, severity, alternative channel |

Top design review selalu dimulai dari domain meaning.

### 4.1 Questions to Ask

```text
1. Is this email informational, transactional, legal, security-sensitive, or marketing?
2. Does the business consider SMTP accepted as enough evidence?
3. Is the email itself the record, or only a pointer to a canonical record?
4. Does the message require retention?
5. Can the user opt out?
6. Can it be resent?
7. Can it be cancelled?
8. Can it be regenerated?
9. Can the template change after the event?
10. Is late delivery harmful?
```

Jika pertanyaan ini tidak dijawab, teknisnya akan salah.

---

## 5. Review Lens #2 — Invariants

Desain mail subsystem yang baik memiliki invariants eksplisit.

Invariant adalah aturan yang harus selalu benar, bahkan saat failure.

### 5.1 Core Invariants

```text
I1. Business transaction must not depend on immediate SMTP success unless explicitly required.
I2. Every external send attempt must be traceable.
I3. Every retry must be bounded.
I4. Every duplicate-risk path must have idempotency control.
I5. No sensitive payload may be logged in raw form.
I6. SMTP accepted is not equivalent to recipient read or inbox placement.
I7. Mail content must be reproducible or archived according to audit policy.
I8. Provider credentials must be environment-scoped and rotatable.
I9. Timeout must be finite.
I10. Failure classification must be normalized before reaching business logic.
I11. Recipient identity must be validated before send.
I12. Attachments must have size/type/security policy.
I13. Operator must be able to pause, drain, replay, and inspect safely.
I14. Template changes must not silently rewrite historical evidence.
I15. Delivery feedback must be idempotent.
```

### 5.2 Why Invariants Matter

Without invariants, review becomes subjective:

```text
This looks fine.
This code seems clean.
This should work.
```

With invariants, review becomes falsifiable:

```text
This design violates I3 because retry has no max attempts.
This design violates I5 because SMTP debug logs headers and body to application logs.
This design violates I9 because JavaMail timeout defaults may be unbounded.
This design violates I14 because old notifications are re-rendered from current templates.
```

---

## 6. Review Lens #3 — State Machine

Email delivery is not a boolean.

Bad model:

```text
sent = true / false
```

Better model:

```text
DRAFTED
PENDING
CLAIMED
RENDERED
SENDING
ACCEPTED_BY_PROVIDER
FAILED_RETRYABLE
FAILED_PERMANENT
SUPPRESSED
BOUNCED_HARD
BOUNCED_SOFT
COMPLAINED
DELIVERED_REPORTED
CANCELLED
DEAD_LETTER
```

You do not always need all states, but you need to know which states are intentionally omitted.

### 6.1 Minimal Transactional State Machine

```text
PENDING
  -> PROCESSING
  -> SENT
  -> FAILED_RETRYABLE
  -> FAILED_PERMANENT
  -> DEAD_LETTER
  -> CANCELLED
```

### 6.2 Regulatory-Grade State Machine

```text
CREATED
  -> TEMPLATE_RESOLVED
  -> RECIPIENT_VALIDATED
  -> CONTENT_RENDERED
  -> QUEUED
  -> SENDING
  -> SMTP_ACCEPTED
  -> PROVIDER_ACCEPTED
  -> DELIVERY_CONFIRMED
  -> BOUNCED
  -> COMPLAINED
  -> SUPPRESSED
  -> CANCELLED
  -> DEAD_LETTER
```

### 6.3 State Review Questions

```text
1. Which states are persisted?
2. Which states are derived?
3. Which transitions are terminal?
4. Which transitions are retriable?
5. Which transitions are reversible?
6. Which transitions require audit entry?
7. Which transitions can arrive asynchronously from webhook/bounce?
8. Which states are visible to business users?
9. Which states are operator-only?
10. Which states trigger escalation?
```

---

## 7. Review Lens #4 — Transaction Boundary

Email is an external side effect. This is the source of many bugs.

### 7.1 Bad Pattern: Send Inside Transaction

```java
@Transactional
public void approve(Long applicationId) {
    Application app = repository.get(applicationId);
    app.approve();
    repository.save(app);

    mailGateway.sendApprovalEmail(app); // external side effect inside transaction
}
```

Failure cases:

| Scenario | Result |
|---|---|
| DB commit fails after SMTP accepted | user receives email for state that did not commit |
| SMTP timeout but DB commits | system says failed, user may receive email anyway |
| transaction rollback after send | irreversible side effect escaped transaction |
| request retry | duplicate email risk |

### 7.2 Better Pattern: Persist Intent

```java
@Transactional
public void approve(Long applicationId) {
    Application app = repository.get(applicationId);
    app.approve();
    repository.save(app);

    notificationOutbox.enqueue(
        NotificationIntent.approvalNotice(app.id(), app.version())
    );
}
```

Then worker sends later:

```text
Outbox Worker
  -> claim pending rows
  -> render
  -> send
  -> classify result
  -> persist attempt
  -> update state
```

### 7.3 Review Rule

```text
If sending email is inside a business DB transaction, require explicit justification.
```

Sometimes synchronous send is acceptable:

- low-criticality admin tool;
- local development;
- best-effort internal notification;
- user explicitly waits for email generation.

But for critical workflow, default should be outbox/queue.

---

## 8. Review Lens #5 — Idempotency and Duplicate Control

Email duplicates are not harmless.

A duplicate email can mean:

- duplicate regulatory notice;
- duplicate payment receipt;
- duplicate password reset confusion;
- duplicate complaint response;
- duplicate appointment confirmation;
- duplicate enforcement warning.

### 8.1 Idempotency Key Design

A mail request should have an idempotency key derived from domain intent:

```text
notification_type + business_entity_id + business_entity_version + recipient + channel
```

Example:

```text
APPLICATION_APPROVED:applicationId=123:version=7:recipient=user@example.com:channel=email
```

### 8.2 Wrong Idempotency Key

```text
UUID.randomUUID()
```

A random UUID identifies a request instance, not a business intent.

### 8.3 Better Table Constraint

```sql
CREATE UNIQUE INDEX ux_notification_intent_idempotency
ON notification_outbox (idempotency_key);
```

### 8.4 Idempotency Review Questions

```text
1. What prevents duplicate notification intent creation?
2. What prevents duplicate worker processing?
3. What happens when SMTP timeout occurs after provider accepted the message?
4. What happens when webhook arrives twice?
5. What happens when operator replays a dead-letter item?
6. Does resend create a new intent or reuse old one?
7. Is idempotency per recipient or per message batch?
```

---

## 9. Review Lens #6 — Failure Classification

Top-level business logic should not know raw `MessagingException` details.

Raw failure:

```text
jakarta.mail.SendFailedException: Invalid Addresses;
nested exception is:
  com.sun.mail.smtp.SMTPAddressFailedException: 550 5.1.1 User unknown
```

Normalized failure:

```json
{
  "category": "RECIPIENT_REJECTED",
  "permanent": true,
  "retryable": false,
  "recipient": "hash:...",
  "smtpCode": 550,
  "enhancedStatus": "5.1.1",
  "providerResponseClass": "MAILBOX_NOT_FOUND"
}
```

### 9.1 Failure Categories

| Category | Typical Cause | Retry? |
|---|---|---|
| CONFIG_ERROR | missing host/port/property | no, until config fixed |
| AUTH_FAILED | invalid credential/OAuth token | no immediate retry storm |
| TLS_FAILED | certificate/trust issue | no blind retry |
| NETWORK_TIMEOUT | connect/read/write timeout | yes with backoff |
| PROVIDER_RATE_LIMIT | quota/throttle | yes with schedule/rate adjustment |
| RECIPIENT_INVALID | malformed email address | no |
| RECIPIENT_REJECTED | mailbox/domain rejection | usually no for 5xx |
| CONTENT_REJECTED | spam/malware/policy rejection | no until content fixed |
| ATTACHMENT_REJECTED | size/type/policy | no until payload fixed |
| PARTIAL_SUCCESS | some recipients accepted | handle per recipient |
| UNKNOWN_TRANSIENT | ambiguous 4xx/network | yes bounded |
| UNKNOWN_PERMANENT | ambiguous 5xx | usually no |

### 9.2 Review Questions

```text
1. Is failure classification explicit?
2. Is retry decision based on category, not exception string only?
3. Are 4xx and 5xx handled differently?
4. Are partial recipient failures represented?
5. Are provider-specific responses normalized?
6. Are unknown errors conservative?
7. Is there max attempt and dead-letter?
```

---

## 10. Review Lens #7 — Address and Identity Semantics

A common weak point: developers confuse SMTP envelope with message headers.

### 10.1 Must Understand

```text
Envelope MAIL FROM     -> bounce path / SPF identity context
Envelope RCPT TO       -> actual SMTP recipients
Header From            -> visible sender
Header Sender          -> actor sending on behalf of From
Header Reply-To        -> where replies go
Header Return-Path     -> usually added by final delivery system
Header Message-ID      -> message identity/threading
Header References      -> threading context
BCC                    -> recipient delivery without visible header disclosure
```

### 10.2 Review Questions

```text
1. Who is the visible sender?
2. Who is the envelope sender?
3. Where do bounces go?
4. Where do replies go?
5. Are BCC recipients hidden correctly?
6. Are no-reply addresses justified?
7. Is multi-tenant sender domain controlled?
8. Is display name user-controlled?
9. Are header values protected against CRLF injection?
10. Is Message-ID generated consistently?
```

### 10.3 Multi-Tenant Sender Risk

If tenant can choose arbitrary `From`:

```text
Tenant A sends as ceo@bank.com
```

That is a phishing platform.

Better:

```text
Tenant sender domain must be verified.
DKIM/SPF alignment must be configured.
From address must be policy-approved.
```

---

## 11. Review Lens #8 — MIME Correctness

Many mail bugs are MIME bugs disguised as rendering bugs.

### 11.1 Correct MIME Structures

Plain text only:

```text
text/plain; charset=UTF-8
```

HTML only:

```text
text/html; charset=UTF-8
```

Plain + HTML:

```text
multipart/alternative
  text/plain
  text/html
```

HTML with inline images:

```text
multipart/related
  multipart/alternative
    text/plain
    text/html
  image/png; Content-ID=<logo>
```

HTML + inline images + attachment:

```text
multipart/mixed
  multipart/related
    multipart/alternative
      text/plain
      text/html
    image/png; Content-ID=<logo>
  application/pdf; Content-Disposition=attachment
```

### 11.2 MIME Review Questions

```text
1. Is plain text alternative available?
2. Is charset explicit?
3. Is HTML placed after plain text inside alternative?
4. Are inline images under related, not mixed only?
5. Are attachments under mixed?
6. Are filenames encoded safely?
7. Are Content-ID references stable?
8. Are large attachments streamed or copied to heap?
9. Are content types derived safely, not blindly trusted?
10. Are malformed inputs handled defensively in inbound parsing?
```

---

## 12. Review Lens #9 — Security Threat Model

Email subsystem is a security boundary because it sends content outside the application perimeter.

### 12.1 Threats

| Threat | Example | Control |
|---|---|---|
| Credential leak | SMTP password in logs | secret manager, redaction |
| STARTTLS downgrade | TLS optional | `starttls.required=true` where appropriate |
| Header injection | user name contains CRLF | sanitize header fields |
| Template injection | unescaped user content in HTML | escaping policy |
| PII leakage | full email body logged | log minimization |
| Attachment malware | user-uploaded attachment forwarded | scanning/quarantine |
| Phishing abuse | arbitrary sender/display name | sender policy |
| Open relay misuse | public endpoint triggers mail | authz/rate limit |
| Token leakage | reset link exposed in logs | redact links/tokens |
| Bounce poisoning | fake webhook/bounce | signature validation/source validation |

### 12.2 Review Questions

```text
1. Where are credentials stored?
2. How are credentials rotated?
3. Are SMTP debug logs disabled or safely redirected?
4. Are user-controlled values inserted into headers?
5. Are templates escaped by default?
6. Are attachments scanned or restricted?
7. Are links signed and short-lived when sensitive?
8. Are webhooks authenticated?
9. Is tenant sender identity verified?
10. Is there abuse throttling?
```

---

## 13. Review Lens #10 — Privacy and Data Minimization

Email is hard to recall. Treat email as external disclosure.

### 13.1 Design Rule

```text
Do not put sensitive data in email unless the business explicitly accepts the disclosure risk.
```

Prefer:

```text
Email: “A document is available. Sign in to view it.”
Portal: authenticated document access.
```

Instead of:

```text
Email: full confidential document attached.
```

### 13.2 Privacy Review Questions

```text
1. Does the email contain PII?
2. Does it contain sensitive case data?
3. Does it contain secrets/tokens?
4. Does it contain attachments?
5. Can the recipient email address be stale or shared?
6. Is there recipient verification before sending?
7. Are logs redacted?
8. Are rendered bodies stored? If yes, encrypted?
9. Is retention period defined?
10. Is right-to-erasure compatible with audit retention?
```

---

## 14. Review Lens #11 — Compliance and Evidence

For regulatory-grade systems, email evidence must be carefully defined.

### 14.1 Evidence Levels

| Evidence | Meaning | Strength |
|---|---|---|
| intent created | system planned to send | weak |
| message rendered | content existed | stronger |
| SMTP accepted | relay/provider accepted | stronger |
| provider event accepted | provider accepted request | stronger for API providers |
| delivery event | provider reports delivered | useful but provider-specific |
| read receipt | recipient/client signal | weak/unreliable |
| user portal access | authenticated user viewed record | often stronger |

### 14.2 Avoid Overclaiming

Do not claim:

```text
User received/read the email.
```

If you only know:

```text
SMTP relay accepted the message.
```

Better audit language:

```text
The system generated notification X and handed it off to SMTP relay Y at time T.
The relay accepted the message with response code 250.
No bounce event had been received as of time T+N.
```

### 14.3 Compliance Review Questions

```text
1. What exactly must be proven?
2. Is rendered content stored or reproducible?
3. Is template version stored?
4. Is recipient address stored in auditable but protected form?
5. Is SMTP/provider response stored?
6. Are attempts immutable?
7. Are operator replays auditable?
8. Is retention defined?
9. Is access to mail audit logs controlled?
10. Does the UI overstate delivery certainty?
```

---

## 15. Review Lens #12 — Observability and Operability

A mail subsystem is not production-ready if operators cannot answer:

```text
What is stuck, why is it stuck, and what can I safely do about it?
```

### 15.1 Required Observability

Logs:

```text
notification_id
correlation_id
template_id
template_version
recipient_hash
provider
attempt_no
state_transition
failure_category
smtp_code
elapsed_ms
```

Metrics:

```text
mail_outbox_pending_total
mail_outbox_oldest_age_seconds
mail_send_attempts_total
mail_send_success_total
mail_send_failure_total{category}
mail_send_latency_seconds
mail_retry_scheduled_total
mail_dead_letter_total
mail_bounce_total{type}
mail_provider_rate_limited_total
```

Traces:

```text
business operation span
  -> notification enqueue span
  -> render span
  -> provider send span
  -> persistence update span
```

Audit:

```text
who/what triggered
when generated
which template/version
which recipient category
which provider
which attempt result
which operator action
```

### 15.2 Operator Controls

A mature system provides:

- pause sending globally;
- pause by template;
- pause by tenant;
- pause by provider;
- replay failed items;
- cancel pending item;
- inspect sanitized payload;
- re-render preview;
- drain queue;
- switch provider;
- lower throughput;
- disable attachments;
- suppress recipient/domain.

### 15.3 Review Questions

```text
1. Can we see backlog size?
2. Can we see oldest pending age?
3. Can we identify failure spikes by category?
4. Can we safely enable debug for one correlation ID?
5. Can we pause sending without redeploy?
6. Can we replay without duplicate storm?
7. Can we distinguish provider outage from template bug?
8. Can support answer user complaint without raw PII exposure?
9. Are dashboards aligned with state machine?
10. Are alerts actionable?
```

---

## 16. Review Lens #13 — Performance and Capacity

Mail is often blocking I/O and externally throttled.

### 16.1 Capacity Model

You need to know:

```text
arrival_rate_per_minute
send_rate_per_minute
provider_quota_per_second
average_latency_ms
p95_latency_ms
worker_count
connection_limit
retry_rate
attachment_size_distribution
queue_depth
```

### 16.2 Simple Throughput Estimate

If average SMTP send latency is 500 ms and each worker sends one message at a time:

```text
one_worker_capacity = 2 messages/sec
10_workers_capacity = 20 messages/sec
```

But provider rate limit may be:

```text
5 messages/sec
```

So 10 workers without throttling cause rate-limit errors.

### 16.3 Review Questions

```text
1. Is throughput controlled by worker count only, or also rate limiter?
2. Are retries competing with fresh sends?
3. Is there per-domain throttling?
4. Are attachment sizes bounded?
5. Are large bodies loaded fully into heap?
6. Is timeout finite?
7. Are virtual threads used appropriately in Java 21+?
8. Is provider quota known and configurable?
9. Is queue backlog growth modeled?
10. Is there backpressure to business modules?
```

---

## 17. Review Lens #14 — Provider Strategy

Jakarta Mail/SMTP is not always the best boundary.

### 17.1 SMTP Relay Is Good When

- portability matters;
- existing enterprise relay exists;
- low/moderate volume;
- simple transactional mail;
- no need for detailed provider telemetry;
- operations team owns relay;
- standard protocol is preferred.

### 17.2 Provider API Is Good When

- bounce/complaint/delivery webhooks are needed;
- high-volume sending;
- template management platform is needed;
- suppression list is managed by provider;
- analytics are important;
- fine-grained provider response is needed;
- multi-region/provider features matter.

### 17.3 Design Abstraction

Do not leak Jakarta Mail into domain code.

```java
public interface MailGateway {
    MailSendResult send(MailEnvelope envelope, RenderedMailContent content);
}
```

Provider-specific implementation:

```text
SmtpMailGateway      -> Jakarta Mail / Angus
SesApiMailGateway    -> HTTP API
SendGridMailGateway  -> HTTP API
MockMailGateway      -> testing
```

### 17.4 Review Questions

```text
1. Is provider choice isolated?
2. Can we migrate from SMTP to API without rewriting domain code?
3. Can we support multiple providers?
4. How is provider failover controlled?
5. Are provider-specific features hidden too much or exposed safely?
6. Are provider webhooks normalized?
7. Is data residency considered?
8. Is cost observable per provider/tenant/template?
9. Is vendor lock-in acceptable?
10. Is there an exit strategy?
```

---

## 18. Review Lens #15 — Template Governance

Template is code-like. Treat it with lifecycle discipline.

### 18.1 Template Metadata

A production template should have:

```text
template_id
template_version
channel
locale
subject_template
text_template
html_template
variable_schema
owner
approval_status
effective_from
effective_to
created_by
approved_by
checksum
```

### 18.2 Template Review Questions

```text
1. Is template version stored on notification?
2. Are variables schema-validated?
3. Are missing variables detected before send?
4. Are templates previewable?
5. Are templates approval-controlled?
6. Is localization supported?
7. Is fallback locale defined?
8. Are old templates retained?
9. Are rendered contents stored or reproducible?
10. Can template changes break old events?
```

### 18.3 Common Mistake

```text
Store only template_id and data, then re-render with current template when auditor asks.
```

That may produce content that differs from what was actually sent.

Better options:

1. store rendered immutable content; or
2. store template version + template snapshot checksum + data snapshot; or
3. store provider raw MIME/body archive where required.

---

## 19. Review Lens #16 — Testing Strategy

Mail systems require tests at multiple layers.

### 19.1 Test Pyramid

```text
Unit Tests
  - address validation
  - template variable validation
  - MIME composer
  - failure classifier
  - retry scheduler

Integration Tests
  - fake SMTP
  - Mailpit/GreenMail
  - database outbox worker
  - attachment handling
  - webhook handling

Contract Tests
  - provider API adapter
  - webhook payload normalization
  - template schema

E2E Tests
  - selected happy path
  - selected failure path
  - no real user email
```

### 19.2 Review Questions

```text
1. Are MIME structures asserted?
2. Are headers asserted?
3. Are attachments asserted by name/type/content?
4. Are timeout/failure cases simulated?
5. Are retry transitions tested?
6. Are duplicate webhook events tested?
7. Are template snapshots tested?
8. Are non-ASCII subjects/filenames tested?
9. Is there a fake SMTP in CI?
10. Are real external sends avoided in normal CI?
```

---

## 20. Review Lens #17 — Migration and Compatibility

Java 8–25 means legacy and modern stacks may coexist.

### 20.1 Compatibility Facts to Respect

- Java 8 legacy systems often use `javax.mail` / `javax.activation`.
- Modern Jakarta stacks use `jakarta.mail` / `jakarta.activation`.
- Jakarta Mail 2.1 targets Jakarta EE 10 and has Java SE 11 minimum according to the Jakarta Mail 2.1 release page.
- Angus Mail is the modern compatible implementation of Jakarta Mail 2.1+.
- Mixing `javax.mail` and `jakarta.mail` types in the same API boundary creates migration pain.

### 20.2 Migration Strategy

Best boundary:

```text
Domain model
  -> custom MailGateway interface
  -> javax implementation for legacy app
  -> jakarta implementation for modern app
```

Avoid exposing either:

```java
public void send(jakarta.mail.internet.MimeMessage message)
```

in business-facing APIs.

### 20.3 Review Questions

```text
1. Does application expose javax/jakarta types in domain interfaces?
2. Are dependencies API-only or implementation included correctly?
3. Is Activation dependency correct?
4. Are there duplicate providers on classpath?
5. Is container providing mail implementation?
6. Is application bundling conflicting implementation?
7. Is Java 8 still required?
8. Is Java 21/25 migration planned?
9. Are tests covering both legacy and modern adapter?
10. Is migration incremental?
```

---

## 21. Review Lens #18 — Cost Model

Email has cost even when SMTP library is free.

### 21.1 Cost Sources

```text
provider send cost
attachment bandwidth
storage for rendered content
queue storage
webhook processing
support investigation time
bounce/complaint management
engineering maintenance
incident cost
deliverability remediation
compliance evidence retrieval
```

### 21.2 Cost Review Questions

```text
1. Is cost tracked per provider?
2. Is cost tracked per tenant/business module?
3. Are large attachments driving cost?
4. Are retries causing hidden cost?
5. Are dead letters accumulating?
6. Are invalid addresses repeatedly attempted?
7. Are templates generating excessive size?
8. Is provider API cheaper/more expensive than relay?
9. Is logging rendered content increasing storage cost?
10. Is support tooling reducing investigation cost?
```

---

## 22. Review Lens #19 — Human Operations and Support

Good architecture includes humans.

Support often receives:

```text
I did not receive the email.
```

The system must help answer without guessing.

### 22.1 Support Investigation Flow

```text
1. Find notification by business entity/user/time.
2. Check intent state.
3. Check rendered status.
4. Check provider handoff status.
5. Check SMTP/provider response.
6. Check bounce/complaint/suppression.
7. Check recipient address used at send time.
8. Check template/version.
9. Check whether resend is allowed.
10. Trigger safe resend or escalation.
```

### 22.2 Review Questions

```text
1. Can support search by business entity?
2. Can support see sanitized recipient info?
3. Can support see current state and attempts?
4. Can support see whether resend is safe?
5. Can support resend without developer/DB access?
6. Are support actions audited?
7. Are PII and body protected from overexposure?
8. Is there a user-safe explanation for failure?
9. Is there escalation path to ops?
10. Are common failure reasons documented?
```

---

## 23. Full Design Review Checklist

Use this as a practical review checklist.

### 23.1 Domain and Policy

```text
[ ] Email type classified: transactional/security/legal/marketing/internal.
[ ] Business meaning documented.
[ ] Delivery evidence requirement defined.
[ ] Resend/cancel policy defined.
[ ] User preference/consent policy defined where relevant.
[ ] Retention policy defined.
```

### 23.2 Architecture Boundary

```text
[ ] Business logic emits notification intent, not raw SMTP call.
[ ] Mail gateway abstraction exists.
[ ] Jakarta Mail/Spring/provider SDK does not leak into domain layer.
[ ] Template/rendering separated from provider sending.
[ ] Bounce/webhook feedback separated from send attempt.
```

### 23.3 Transaction and Reliability

```text
[ ] No critical email send inside DB transaction.
[ ] Outbox/queue exists for critical sends.
[ ] Idempotency key exists and is domain-derived.
[ ] Retry is bounded.
[ ] Backoff and jitter are used.
[ ] Dead-letter state exists.
[ ] Operator replay is controlled and audited.
```

### 23.4 SMTP and Jakarta Mail

```text
[ ] Timeout configured: connect/read/write.
[ ] TLS mode explicit.
[ ] Auth mode explicit.
[ ] Debug output disabled/safely controlled.
[ ] `javax`/`jakarta` dependencies not mixed incorrectly.
[ ] Activation dependency present where needed.
[ ] Provider implementation understood: container or app-bundled.
```

### 23.5 MIME and Content

```text
[ ] Correct multipart structure.
[ ] Plain text alternative exists where appropriate.
[ ] Charset explicit.
[ ] Header injection prevented.
[ ] Filename encoding handled.
[ ] Attachment size/type policy exists.
[ ] Inline images use correct Content-ID strategy.
[ ] Template output escaped safely.
```

### 23.6 Identity and Deliverability

```text
[ ] Header From policy defined.
[ ] Envelope sender/bounce path defined.
[ ] Reply-To policy defined.
[ ] Sender domain verified for tenant/multi-domain sending.
[ ] SPF/DKIM/DMARC ownership clear.
[ ] SMTP accepted not treated as final delivery.
[ ] Bounce/complaint feedback loop defined if needed.
```

### 23.7 Security and Privacy

```text
[ ] Secrets stored in secret manager/config vault.
[ ] Credentials rotatable.
[ ] Logs redacted.
[ ] Sensitive links/tokens redacted.
[ ] Webhooks authenticated.
[ ] Attachments scanned or restricted.
[ ] PII minimized.
[ ] Mail audit access controlled.
```

### 23.8 Observability and Operations

```text
[ ] Correlation ID propagated.
[ ] Notification ID exists.
[ ] Attempt records persisted.
[ ] Metrics exist for queue, success, failure, latency, retry, dead-letter.
[ ] Alerting exists for backlog/failure/auth/rate-limit.
[ ] Dashboard aligned with state machine.
[ ] Pause/drain/replay controls exist.
```

### 23.9 Testing

```text
[ ] MIME composer unit-tested.
[ ] Template rendering snapshot-tested.
[ ] Fake SMTP integration test exists.
[ ] Failure classification tested.
[ ] Retry/dead-letter tested.
[ ] Webhook idempotency tested.
[ ] Non-ASCII/i18n cases tested.
[ ] Large attachment cases tested.
```

### 23.10 Migration and Maintainability

```text
[ ] Java 8 legacy path understood.
[ ] Java 11+ / 17 / 21 / 25 path understood.
[ ] javax-to-jakarta migration boundary defined.
[ ] Provider swap strategy exists.
[ ] Template lifecycle documented.
[ ] ADRs exist for major decisions.
```

---

## 24. Architecture Decision Records to Write

A top-tier team documents major decisions.

Recommended ADRs:

```text
ADR-001: Email delivery uses transactional outbox instead of synchronous SMTP in business transaction.
ADR-002: Mail subsystem exposes provider-neutral MailGateway interface.
ADR-003: Java 8 modules remain on javax.mail; modern modules use jakarta.mail behind adapter boundary.
ADR-004: SMTP accepted state is not represented as delivered/read.
ADR-005: Rendered regulatory notifications are stored immutably for audit.
ADR-006: Provider webhooks are processed idempotently and normalized.
ADR-007: Attachments are restricted by size/type and sensitive documents use secure links by default.
ADR-008: Retry policy uses bounded exponential backoff with jitter and dead-letter.
ADR-009: Multi-tenant sender domains require verification and policy approval.
ADR-010: Mail debug logging is disabled by default and can only be enabled with redaction/scope.
```

---

## 25. Example Review: Weak Design

### 25.1 Proposal

```text
When a case officer approves a case, the service calls MailUtil.send().
MailUtil builds HTML string, attaches PDF, and calls Transport.send().
If exception occurs, it logs error and continues.
```

### 25.2 Review Findings

| Area | Finding |
|---|---|
| transaction | send may happen inside business flow without durable intent |
| retry | no retry, no classification |
| idempotency | duplicate risk on request retry |
| audit | no attempt record, no template version |
| privacy | PDF attachment may contain sensitive data |
| observability | only generic log error |
| timeout | not specified |
| MIME | unknown multipart correctness |
| support | cannot safely resend |
| compliance | cannot prove content sent |

### 25.3 Review Decision

```text
Reject for critical/regulatory use.
Accept only for low-risk internal best-effort notification after adding timeout, redaction, and failure logging.
```

---

## 26. Example Review: Strong Design

### 26.1 Proposal

```text
Business module emits NotificationIntent in same transaction as domain state change.
Outbox table stores idempotency key, template id/version, recipient reference, and payload snapshot.
Worker claims pending rows with bounded concurrency.
Renderer creates text/html MIME content using versioned template.
SMTP adapter sends through configured relay with finite timeouts and TLS required.
Each attempt is persisted with normalized result and sanitized provider response.
Retry uses exponential backoff with jitter and max attempts.
Bounce mailbox/webhook updates delivery state idempotently.
Operators can pause, inspect sanitized status, replay, and dead-letter.
Metrics and alerts cover backlog, failures, latency, retry, and provider errors.
```

### 26.2 Review Findings

| Area | Finding |
|---|---|
| transaction | durable outbox intent |
| retry | bounded and classified |
| idempotency | domain key and uniqueness constraint |
| audit | template version and attempts stored |
| observability | metrics/logs/tracing defined |
| privacy | sanitized logs, secure attachment policy |
| operations | pause/replay/dead-letter |
| migration | provider adapter boundary |

### 26.3 Review Decision

```text
Accept with conditions:
1. define attachment scanning policy;
2. document evidence semantics;
3. test non-ASCII MIME cases;
4. add runbook for provider outage.
```

---

## 27. Maturity Model

### Level 0 — Utility Function

```text
Transport.send() inside service method.
No timeout.
No retry.
No audit.
```

Suitable for: local experiment only.

### Level 1 — Basic Service

```text
MailService abstraction.
SMTP config externalized.
Basic HTML/text support.
Basic exception logging.
```

Suitable for: low-risk internal apps.

### Level 2 — Reliable Transactional Mail

```text
Outbox.
Retry.
Idempotency.
Attempt records.
Timeout.
Testing with fake SMTP.
```

Suitable for: serious business apps.

### Level 3 — Operable Enterprise Mail

```text
Metrics.
Alerts.
Pause/replay/dead-letter.
Template versioning.
Failure classification.
Support tooling.
```

Suitable for: high-volume or customer-facing systems.

### Level 4 — Regulatory-Grade Mail Platform

```text
Evidence model.
Immutable rendered content/snapshot.
Retention policy.
Compliance controls.
Bounce/complaint lifecycle.
Multi-provider strategy.
Access-controlled audit.
```

Suitable for: enforcement, case management, government/regulatory platforms, financial/legal notification systems.

---

## 28. Anti-Patterns Catalog

### 28.1 `MailUtil` God Class

Symptoms:

```text
static methods
hardcoded SMTP
manual string HTML
attachment file access
catch Exception
no tests
```

Fix:

```text
split intent, rendering, gateway, delivery, audit.
```

### 28.2 Boolean Sent Flag

Symptoms:

```text
sent = true
```

Fix:

```text
state machine + attempts.
```

### 28.3 Infinite Retry

Symptoms:

```text
while failed, retry forever
```

Fix:

```text
bounded retry + backoff + dead-letter.
```

### 28.4 Raw Email Body Logging

Symptoms:

```text
log.info("email={}", body)
```

Fix:

```text
log metadata, hash recipient, redact tokens.
```

### 28.5 Template Without Version

Symptoms:

```text
notification stores template_id only
```

Fix:

```text
store template version/checksum/snapshot/rendered content.
```

### 28.6 No Timeout

Symptoms:

```text
SMTP call hangs worker thread indefinitely
```

Fix:

```text
connectiontimeout, timeout, writetimeout.
```

### 28.7 Provider SDK in Domain Layer

Symptoms:

```text
business service imports jakarta.mail.* or provider SDK model
```

Fix:

```text
custom domain-neutral gateway interface.
```

### 28.8 Treating Accepted as Delivered

Symptoms:

```text
UI says Delivered after SMTP 250
```

Fix:

```text
label as Sent/Accepted by provider unless delivery event exists.
```

---

## 29. Final Synthesis: How Top Engineers Think About Mail

A top 1% engineer sees mail system through multiple simultaneous layers:

```text
Protocol Layer
  SMTP, MIME, IMAP, POP3, TLS, status code

API Layer
  JavaMail/Jakarta Mail, Activation, provider adapters

Domain Layer
  notification intent, template, recipient, policy, evidence

Reliability Layer
  outbox, retry, idempotency, queue, dead-letter

Security Layer
  credentials, TLS, header injection, attachment risk, abuse control

Privacy Layer
  PII minimization, redaction, retention, access control

Deliverability Layer
  SPF, DKIM, DMARC, bounce, complaint, suppression

Operations Layer
  metrics, logs, tracing, dashboard, pause/replay, runbook

Compliance Layer
  audit semantics, evidence, retention, defensibility

Migration Layer
  javax/jakarta boundary, provider portability, Java 8–25 compatibility
```

The difference between average and excellent design is not that excellent design sends more email. It is that excellent design knows exactly what it is doing when email succeeds, fails, times out, duplicates, bounces, leaks, delays, or is audited.

---

## 30. Final Reference Architecture

```text
+-----------------------+
| Business Modules      |
| - case approved       |
| - account created     |
| - appeal submitted    |
+-----------+-----------+
            |
            v
+-----------------------+
| Notification Intent   |
| - type                |
| - entity ref          |
| - recipient ref       |
| - idempotency key     |
+-----------+-----------+
            |
            v
+-----------------------+
| Outbox Store          |
| - state               |
| - template version    |
| - payload snapshot    |
| - next attempt        |
+-----------+-----------+
            |
            v
+-----------------------+
| Worker / Scheduler    |
| - claim               |
| - rate limit          |
| - retry               |
| - backpressure        |
+-----------+-----------+
            |
            v
+-----------------------+
| Renderer              |
| - text/html           |
| - MIME structure      |
| - attachments         |
| - i18n                |
+-----------+-----------+
            |
            v
+-----------------------+
| Mail Gateway          |
| - SMTP Jakarta Mail   |
| - provider API        |
| - mock/test           |
+-----------+-----------+
            |
            v
+-----------------------+
| External Provider     |
| - relay/API           |
| - quota               |
| - bounce/webhook      |
+-----------+-----------+
            |
            v
+-----------------------+
| Feedback Processor    |
| - bounce              |
| - complaint           |
| - delivery event      |
| - suppression         |
+-----------+-----------+
            |
            v
+-----------------------+
| Audit/Observability   |
| - attempts            |
| - metrics             |
| - traces              |
| - operator controls   |
+-----------------------+
```

---

## 31. What You Should Be Able To Do After This Series

After completing this series, you should be able to:

1. explain email as distributed side effect, not simple function call;
2. distinguish SMTP envelope from message headers;
3. build correct MIME text/html/multipart/attachment messages;
4. use JavaMail/`javax.mail` and Jakarta Mail/`jakarta.mail` intentionally;
5. understand Jakarta Activation's role in attachment/data handling;
6. configure SMTP with finite timeout and TLS/auth controls;
7. classify Jakarta Mail and SMTP failures;
8. design outbox-based reliable delivery;
9. avoid duplicate emails under retries;
10. test mail systems with fake SMTP and MIME assertions;
11. design template versioning and rendering architecture;
12. reason about SPF/DKIM/DMARC and deliverability boundaries;
13. process bounce/complaint/webhook feedback safely;
14. protect credentials, PII, logs, and attachments;
15. operate mail systems with metrics, dashboards, alerts, and runbooks;
16. review a mail design for production readiness;
17. migrate from Java 8 `javax.mail` to modern Jakarta Mail safely;
18. defend design decisions in audit/compliance/regulatory discussions.

---

## 32. Final Checklist for Personal Mastery

You are not done when you can send an email.

You are done when you can answer these without handwaving:

```text
1. What happens if SMTP times out after accepting the message?
2. What happens if DB commit fails after email send?
3. What happens if provider accepts email but recipient bounces later?
4. What happens if user clicks resend twice?
5. What happens if template changes after the notification was sent?
6. What happens if attachment is 80 MB?
7. What happens if recipient contains non-ASCII characters?
8. What happens if SMTP credential rotates during deployment?
9. What happens if provider rate limit drops by 90%?
10. What happens if auditor asks what content was sent last year?
11. What happens if support needs to resend without seeing sensitive body?
12. What happens if webhook arrives twice or out of order?
13. What happens if logs are exported to a third-party system?
14. What happens if a tenant tries to send from an unverified domain?
15. What happens if Java 8 legacy and Java 21 services coexist?
```

If your design has coherent answers, you are thinking at the right level.

---

## 33. Closing Note

Mail engineering looks boring until it fails.

When it fails, it fails across:

- business workflow;
- user trust;
- legal evidence;
- security;
- privacy;
- operations;
- deliverability;
- support;
- compliance.

That is why this series treated mail as a serious subsystem.

The goal is not to make every application build a giant mail platform. The goal is to know **how much architecture the problem deserves**, and to avoid simple designs that are only simple because they ignore failure.

---

## 34. Further Reading

Primary/spec references to revisit:

1. Jakarta Mail Specification 2.1
2. Jakarta Mail API documentation
3. Eclipse Angus Mail documentation
4. Jakarta Activation Specification 2.1
5. RFC 5321 — SMTP
6. RFC 5322 — Internet Message Format
7. RFC 2045–2049 — MIME
8. RFC 3463 — Enhanced Mail System Status Codes
9. RFC 3464 — Delivery Status Notifications
10. RFC 6376 — DKIM
11. RFC 7208 — SPF
12. RFC 7489 — DMARC
13. RFC 6531 — SMTPUTF8
14. OWASP Logging Cheat Sheet
15. NIST SP 800-122 — Guide to Protecting PII

---

# Series Completion Status

This is the final part of the series.

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
[x] Part 17 — Jakarta Mail in Jakarta EE Containers
[x] Part 18 — Jakarta Mail in Spring Boot and Modern Java Applications
[x] Part 19 — Testing Mail Systems
[x] Part 20 — Observability: Logs, Metrics, Tracing, Audit
[x] Part 21 — Performance and Resource Management
[x] Part 22 — Provider Integration Patterns: SMTP Relay vs API-Based Email Provider
[x] Part 23 — Bounce, Complaint, Webhook, and Delivery Feedback Loop
[x] Part 24 — Template Architecture and Domain Notification Design
[x] Part 25 — Compliance, Privacy, and Regulatory-Grade Mail Systems
[x] Part 26 — Advanced MIME and Internationalization
[x] Part 27 — Failure Modelling and Production Incident Playbook
[x] Part 28 — End-to-End Reference Implementation
[x] Part 29 — Top 1% Design Review
```

**Series completed.**


<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 28 — End-to-End Reference Implementation: Java 8 Legacy and Java 21/25 Modern](./28-end-to-end-reference-implementation.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-json-xml-soap-connectors-enterprise-integration-part-000](../mapper/learn-java-json-xml-soap-connectors-enterprise-integration-part-000.md)
