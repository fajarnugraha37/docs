# Strict Coding Standards — Go SMTP and Email Delivery

Status: Mandatory for all Go email, SMTP, notification, and outbound message implementation.
Audience: LLM coding agents, reviewers, maintainers, and security owners.
Scope: SMTP clients, email construction, MIME, attachments, templates, queueing, retries, bounce handling, authentication, logging, and audit events.

This standard is a merge gate. Email code is security-sensitive and compliance-sensitive. LLM-generated email code must be treated as high-risk by default.

---

## 1. Source authority

Use these sources as the primary authority when resolving ambiguity:

- Go `net/smtp` package documentation.
- Go `net/mail`, `mime`, `mime/multipart`, `text/template`, and `html/template` documentation.
- RFC 5321 SMTP, RFC 5322 Internet Message Format, MIME-related RFCs, and provider-specific SMTP/API docs.
- OWASP guidance on SMTP/IMAP injection, header injection, input validation, output encoding, and sensitive-data handling.
- Project notification, audit, data protection, retry, and incident-response policies.

Important: Go's standard `net/smtp` package is frozen and not accepting new features. It may be acceptable for simple SMTP delivery, but advanced use cases such as attachments, modern auth flows, provider APIs, robust MIME composition, pooling, DKIM signing, and delivery analytics may require a reviewed third-party package or provider SDK.

---

## 2. Non-negotiable email principles

LLM-generated Go email code MUST obey these principles:

1. Email construction must be structured, not string-concatenated from raw user input.
2. Headers must reject CR/LF injection.
3. Recipients, sender, reply-to, subject, and custom headers are untrusted unless system-generated.
4. Templates must use context-appropriate escaping.
5. SMTP credentials and API keys must never be logged, embedded, or hardcoded.
6. Sending email must be asynchronous or bounded; request handlers must not block indefinitely on SMTP delivery.
7. Email delivery must be idempotent where retries are possible.
8. Attachments must be size-limited, type-validated, and scanned/quarantined when required.
9. Logs and audit events must capture safe metadata, not full message bodies by default.
10. Bounce, failure, and retry behavior must be explicit.

---

## 3. Package and provider selection

### 3.1 `net/smtp` use

Use `net/smtp` only when all are true:

- requirements are simple;
- message construction is handled safely;
- STARTTLS/TLS and authentication are configured correctly;
- no unsupported provider-specific behavior is required;
- no attachments or complex MIME are required unless implemented through reviewed MIME builder code;
- no connection pooling/advanced retry semantics are needed.

Do not assume `net/smtp` is sufficient for production marketing, transactional, compliance, or bulk delivery systems.

### 3.2 Third-party package rule

A third-party mail package MAY be used only when reviewed for:

- active maintenance;
- TLS/auth support;
- MIME correctness;
- attachment handling;
- context/deadline support;
- dependency vulnerability posture;
- license acceptability;
- testability;
- ability to prevent header injection.

---

## 4. Email architecture

### 4.1 Separate concerns

Email code MUST separate:

- notification command/request;
- policy decision: may send or not;
- recipient resolution;
- template rendering;
- message construction;
- delivery transport;
- retry scheduling;
- audit/event logging;
- bounce/failure processing.

Forbidden:

```go
// Forbidden: handler directly composes and sends email.
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
    smtp.SendMail(...)
}
```

Preferred:

```go
type NotificationService interface {
    SendCaseAssigned(ctx context.Context, cmd SendCaseAssignedCommand) error
}
```

### 4.2 Transport interface

Define a narrow transport interface owned by the consumer.

```go
type MailSender interface {
    Send(ctx context.Context, msg Message) error
}
```

The interface must not expose provider-specific details to domain/application layers.

---

## 5. Message model

### 5.1 Use typed message structures

Email messages MUST use typed structures.

```go
type Message struct {
    EnvelopeFrom Mailbox
    From         Mailbox
    ReplyTo      *Mailbox
    To           []Mailbox
    CC           []Mailbox
    BCC          []Mailbox
    Subject      string
    TextBody     string
    HTMLBody     string
    Headers      map[string]string
    Attachments  []Attachment
    Metadata     MessageMetadata
}
```

Rules:

- `EnvelopeFrom` and visible `From` must be deliberate and may differ.
- `BCC` must never be added to message headers visible to recipients.
- `Subject` must be sanitized against header injection.
- Custom headers must be allowlisted.

### 5.2 Address parsing and validation

Email addresses MUST be parsed and validated before use.

Rules:

- Use `net/mail` parsing where appropriate.
- Normalize display names carefully.
- Do not accept newline characters in address or display-name fields.
- Do not treat regex-only validation as authoritative.
- Domain allowlist/blocklist may be required for regulated or internal mail.

Forbidden:

```go
msg := "To: " + userInputEmail + "\r\n" + body
```

---

## 6. Header injection prevention

Any value written into an email header MUST reject CR and LF.

Applies to:

- `From`;
- `To`;
- `CC`;
- `BCC`;
- `Reply-To`;
- `Subject`;
- `Message-ID`;
- `References`;
- `In-Reply-To`;
- custom headers;
- attachment filenames when represented in MIME headers.

Required guard:

```go
func rejectHeaderInjection(name, value string) error {
    if strings.ContainsAny(value, "\r\n") {
        return fmt.Errorf("%s contains newline", name)
    }
    return nil
}
```

Do not attempt to "sanitize" injected headers by removing characters unless policy explicitly permits canonicalization. Prefer rejection.

---

## 7. MIME construction

### 7.1 Structured MIME builder

MIME messages MUST be generated using a structured MIME writer or a reviewed library.

Rules:

- Use correct `Content-Type`.
- Use correct transfer encoding.
- Use multipart boundaries generated safely.
- Preserve text and HTML alternatives correctly.
- Validate attachment filename metadata.
- Do not hand-build multipart boundaries with string concatenation.

### 7.2 Plain text and HTML

Transactional emails SHOULD include both plain text and HTML alternatives when user-facing.

Rules:

- HTML body must be generated using `html/template` or equivalent context-aware escaping.
- Plain text body must not include untrusted control characters where downstream systems may interpret them.
- Do not mark user-supplied HTML as trusted without sanitization and policy approval.

---

## 8. Templates

### 8.1 Template ownership

Templates MUST be versioned and reviewed.

Rules:

- Keep templates outside business logic.
- Use typed template data.
- Missing template fields should fail tests.
- Localize only through approved i18n mechanism.
- Do not allow arbitrary users to author executable templates.

### 8.2 Escaping

Use:

- `html/template` for HTML email;
- `text/template` only for plain text or already-safe non-HTML output;
- explicit URL generation and validation for links.

Forbidden:

```go
html := "<a href=\"" + rawURL + "\">Click</a>"
```

Preferred:

```go
tmpl := template.Must(template.New("email.html").Parse(emailTemplate))
```

---

## 9. SMTP connection and TLS

### 9.1 TLS rules

SMTP delivery MUST use TLS according to provider requirements.

Rules:

- Prefer implicit TLS on provider-supported ports or STARTTLS with verification.
- Do not set `InsecureSkipVerify: true` in production.
- Verify server name.
- Configure minimum TLS version according to project security baseline.
- Do not silently continue after STARTTLS failure when TLS is required.

### 9.2 Authentication

SMTP authentication MUST:

- use secret manager/config injection;
- avoid hardcoded credentials;
- avoid logging username/password/token;
- support rotation;
- fail closed on missing credentials;
- use provider-approved auth mechanisms.

---

## 10. Context, timeout, and cancellation

Email sending MUST be bounded by context and timeouts.

Rules:

- Public methods accept `context.Context`.
- Request handlers must not use unbounded SMTP calls.
- Background queue workers must have lifecycle context.
- SMTP dial, TLS handshake, write, and read operations must be bounded by deadline when using low-level connections.
- Provider API clients must use configured HTTP timeouts.

If a selected SMTP library does not support context, wrap calls in a worker with strict lifecycle control or select another library.

---

## 11. Idempotency and retries

Email retries MUST be designed to avoid duplicate harmful sends.

Rules:

- Persist a notification intent before delivery when delivery is business-critical.
- Use idempotency keys based on business event ID and recipient.
- Store provider message ID when available.
- Retry transient failures only.
- Do not retry permanent failures such as invalid recipient.
- Use capped exponential backoff with jitter.
- Maintain max attempt count.
- Preserve audit trail for each attempt.

### 11.1 Failure taxonomy

Classify delivery failures as:

- validation failure;
- template failure;
- policy denial;
- transient SMTP/provider failure;
- permanent recipient failure;
- authentication/config failure;
- rate limit;
- unknown internal failure.

---

## 12. Queueing and outbox

For production-critical notifications, email MUST be delivered through an outbox or queue.

Rules:

- Business transaction records notification intent atomically when required.
- Worker sends asynchronously.
- Worker is idempotent.
- Worker updates status with optimistic concurrency or exactly-once effect pattern.
- Dead-letter or manual review path exists.
- Poison messages cannot block the entire queue.

HTTP request/response should normally return after intent creation, not after SMTP success, unless synchronous delivery is a documented requirement.

---

## 13. Attachments

Attachment handling MUST be secure and bounded.

Rules:

- Enforce max total email size.
- Enforce max attachment count.
- Enforce per-attachment size.
- Validate media type and extension by business policy.
- Treat filenames as display metadata only.
- Reject CR/LF and path separators in attachment filenames.
- Scan/quarantine where required.
- Do not load large attachments fully into memory unless bounded and justified.
- Do not attach sensitive documents without authorization and audit.

---

## 14. Links and URLs

Email links MUST be generated from trusted configuration and signed when sensitive.

Rules:

- Do not derive base URL from request `Host` without allowlist.
- Prefer configured public base URL.
- Use HTTPS.
- Sign action links with expiry and purpose.
- Avoid long-lived one-click privileged action links.
- Do not put secrets or raw tokens in query strings unless explicitly approved and short-lived.

---

## 15. Privacy and audit

Email systems MUST minimize sensitive data.

Rules:

- Avoid including secrets, credentials, internal notes, full case data, or unnecessary PII in emails.
- Use links to authenticated portals instead of attaching sensitive data when possible.
- Audit notification intent, recipient, template, event ID, and delivery status.
- Do not log full body by default.
- Redact recipient address in lower environments if policy requires.
- Ensure test/staging cannot send to real users unless allowlisted.

---

## 16. Deliverability and domain controls

Production email systems SHOULD support:

- SPF alignment awareness;
- DKIM signing via provider or approved library;
- DMARC policy alignment;
- bounce processing;
- suppression lists;
- unsubscribe handling where legally required;
- rate limiting;
- provider feedback loop handling.

Do not implement custom DKIM/DMARC logic unless approved and tested against provider requirements.

---

## 17. Testing gate

Email code MUST include tests for:

- valid message construction;
- CR/LF injection rejection in all header fields;
- address parsing edge cases;
- template escaping;
- missing template data;
- text and HTML output;
- attachment size/count/filename validation;
- retry classification;
- idempotency/deduplication;
- context cancellation/timeout;
- provider error mapping;
- no secret leakage in logs;
- staging recipient allowlist behavior;
- queue worker poison message behavior.

Recommended test tools:

- fake `MailSender` interface;
- in-memory SMTP test server where necessary;
- golden tests for MIME output;
- fuzz tests for address/header/template input;
- integration tests against provider sandbox only.

---

## 18. Anti-patterns

Reject code that:

- constructs email headers through string concatenation with user input;
- allows newline characters in header values;
- hardcodes SMTP credentials;
- uses plaintext SMTP in production;
- sets `InsecureSkipVerify: true`;
- sends emails synchronously from request handlers without timeout;
- retries indefinitely;
- logs full email bodies or secrets;
- trusts client-provided recipient lists for privileged notifications;
- stores provider API keys in code;
- attaches files using raw user filename paths;
- sends from test/staging to arbitrary real recipients;
- treats email sent as proof of user receipt.

---

## 19. Merge checklist

Before merging Go SMTP/email code, verify:

- [ ] Header injection is rejected for every header value.
- [ ] Message construction is structured and tested.
- [ ] Templates use proper escaping.
- [ ] SMTP/API credentials are externalized and redacted.
- [ ] TLS is verified.
- [ ] Delivery is bounded by timeout/context.
- [ ] Retries are idempotent and capped.
- [ ] Attachments are bounded and validated.
- [ ] Logs and audit events are privacy-safe.
- [ ] Staging/test delivery is restricted.
- [ ] Failure taxonomy and dead-letter behavior are defined.
