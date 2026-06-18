# Part 27 — Failure Modelling and Production Incident Playbook

> Series: `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery`  
> File: `27-production-incident-playbook.md`  
> Scope: Java 8–25, JavaMail (`javax.mail`), Jakarta Mail (`jakarta.mail`), Eclipse Angus Mail, SMTP relay/provider/API integration, inbound/outbound production operations.

---

## 1. Tujuan Part Ini

Part sebelumnya sudah membahas:

- protokol SMTP/MIME/IMAP/POP3;
- Jakarta Mail API;
- sending, receiving, multipart, attachment, template;
- security, deliverability, observability, performance;
- queue, retry, outbox, bounce, complaint, compliance.

Part ini menyatukan semuanya ke dalam satu kemampuan yang membedakan engineer biasa dan engineer senior/top-tier: **mampu memodelkan failure sebelum terjadi, mendeteksi failure saat terjadi, mengisolasi blast radius, memperbaiki sistem tanpa merusak evidence, lalu memperkuat desain setelah incident.**

Email system sering terlihat sederhana karena API-nya sederhana:

```java
Transport.send(message);
```

Tetapi production reality-nya jauh lebih kompleks:

```text
business event
  -> notification intent
  -> template rendering
  -> MIME composition
  -> outbox persistence
  -> worker claim
  -> SMTP/API provider
  -> relay acceptance
  -> downstream MTA
  -> recipient provider
  -> spam filter
  -> mailbox
  -> bounce/complaint/delivery webhook
  -> business state update
```

Setiap panah bisa gagal. Setiap failure bisa:

- transient;
- permanent;
- partial;
- duplicated;
- delayed;
- silent;
- provider-specific;
- user-visible;
- compliance-sensitive.

Tujuan part ini adalah membangun **failure model dan incident playbook** yang cukup matang untuk production-grade mail subsystem.

---

## 2. Mental Model: Email Failure Bukan Satu Jenis

Kesalahan umum: bertanya “kenapa email gagal terkirim?” seolah-olah hanya ada satu failure point.

Pertanyaan yang lebih benar:

1. Apakah notification intent berhasil dibuat?
2. Apakah outbox row berhasil commit?
3. Apakah worker mengambil row?
4. Apakah template berhasil dirender?
5. Apakah MIME valid?
6. Apakah SMTP connect berhasil?
7. Apakah TLS/auth berhasil?
8. Apakah sender diterima?
9. Apakah recipient diterima?
10. Apakah DATA diterima?
11. Apakah provider menerima message?
12. Apakah downstream recipient server menerima message?
13. Apakah message masuk inbox/spam/quarantine?
14. Apakah bounce/complaint terjadi belakangan?
15. Apakah business state sudah sinkron dengan feedback?

Satu incident “email tidak diterima” bisa berasal dari:

- DB transaction rollback;
- worker mati;
- queue stuck;
- SMTP timeout;
- invalid recipient;
- provider quota;
- SPF/DKIM/DMARC alignment issue;
- content rejected;
- attachment blocked;
- bounce delayed;
- recipient mailbox full;
- email masuk spam;
- user salah alamat;
- duplicate suppression;
- template conditional mengosongkan recipient;
- environment menggunakan SMTP sandbox;
- feature flag disable sending.

Top-tier engineer tidak langsung menebak. Ia **memecah jalur email menjadi stage dan mencari stage terakhir yang punya evidence sukses.**

---

## 3. Stage-Based Failure Model

Gunakan stage model berikut sebagai kerangka utama troubleshooting.

```text
[0] Business Trigger
    |
[1] Notification Intent Created
    |
[2] Outbox Persisted
    |
[3] Worker Claimed Job
    |
[4] Template Rendered
    |
[5] MIME Composed
    |
[6] Provider Request Started
    |
[7] SMTP/API Accepted
    |
[8] Delivery Feedback Received
    |
[9] Business Delivery State Updated
```

Setiap stage harus punya:

- correlation id;
- timestamp;
- status;
- error classification;
- retry metadata;
- evidence yang aman untuk audit;
- redaction policy.

### 3.1 Stage 0 — Business Trigger

Contoh:

- application submitted;
- case assigned;
- appeal approved;
- password reset requested;
- payment receipt generated;
- batch reminder executed.

Possible failure:

- event tidak dipublish;
- rule notification tidak match;
- user preference menolak channel email;
- business transaction rollback;
- duplicate event suppressed secara salah.

Evidence:

- domain event id;
- aggregate id;
- event timestamp;
- notification rule id;
- decision reason.

### 3.2 Stage 1 — Notification Intent Created

Notification intent adalah keputusan bahwa email harus dikirim, belum tentu sudah terkirim.

Possible failure:

- recipient kosong;
- template id invalid;
- required variable missing;
- channel disabled;
- tenant sender belum dikonfigurasi.

Evidence:

- notification id;
- template id/version;
- recipient count;
- channel;
- idempotency key.

### 3.3 Stage 2 — Outbox Persisted

Outbox adalah boundary penting antara domain transaction dan side effect.

Possible failure:

- row tidak commit;
- unique constraint idempotency conflict;
- payload terlalu besar;
- attachment reference invalid;
- DB unavailable.

Evidence:

- outbox id;
- status `PENDING`;
- next attempt timestamp;
- attempt count;
- payload hash, bukan raw payload sensitif.

### 3.4 Stage 3 — Worker Claimed Job

Possible failure:

- worker down;
- scheduler disabled;
- lease lock stuck;
- clock skew;
- `next_attempt_at` salah;
- DB polling query lambat;
- queue partition backlog.

Evidence:

- worker id;
- claim timestamp;
- lease expiry;
- processing duration;
- heartbeat.

### 3.5 Stage 4 — Template Rendered

Possible failure:

- template missing;
- variable missing;
- template syntax error;
- unsafe user content tidak di-escape;
- localization missing;
- HTML terlalu besar;
- broken link;
- external asset unavailable.

Evidence:

- template version;
- rendering duration;
- rendered body hash;
- variable schema version;
- validation result.

### 3.6 Stage 5 — MIME Composed

Possible failure:

- invalid address;
- header injection attempt;
- non-ASCII filename broken;
- attachment missing;
- attachment too large;
- wrong multipart nesting;
- unsupported charset;
- malformed Content-ID.

Evidence:

- message-id;
- recipient categories;
- MIME structure summary;
- attachment count/size/hash;
- validation errors.

### 3.7 Stage 6 — Provider Request Started

Possible failure:

- DNS failure;
- TCP connection timeout;
- TLS handshake failure;
- auth failure;
- write timeout;
- provider rate limit;
- provider unavailable.

Evidence:

- provider name;
- endpoint/relay id;
- connection attempt timestamp;
- timeout config;
- SMTP command response if available;
- exception class.

### 3.8 Stage 7 — SMTP/API Accepted

Important: accepted means **accepted by provider/relay**, not necessarily delivered to inbox.

Possible failure:

- `MAIL FROM` rejected;
- `RCPT TO` rejected;
- DATA rejected;
- partial recipient success;
- provider accepts but later bounces;
- provider accepts but suppresses due to internal policy.

Evidence:

- provider message id;
- SMTP response code;
- valid sent/unsent/invalid addresses;
- provider accepted timestamp.

### 3.9 Stage 8 — Delivery Feedback Received

Possible failure:

- webhook not configured;
- webhook signature invalid;
- duplicate webhook;
- delayed bounce;
- unknown provider message id;
- out-of-order events;
- feedback mailbox parser fails.

Evidence:

- feedback event id;
- provider message id;
- event type;
- event timestamp;
- received timestamp;
- signature verification result.

### 3.10 Stage 9 — Business Delivery State Updated

Possible failure:

- bounce received but business state not updated;
- complaint not suppressing future mail;
- permanent failure retried endlessly;
- user-facing state says sent while provider says bounced;
- audit status ambiguous.

Evidence:

- state transition;
- previous state;
- new state;
- transition reason;
- actor/system;
- timestamp.

---

## 4. Failure Taxonomy

A strong incident response begins with a taxonomy. Without taxonomy, all errors become “failed”.

Recommended top-level categories:

```text
CONFIGURATION
NETWORK
DNS
TLS
AUTHENTICATION
AUTHORIZATION
PROVIDER_QUOTA
PROVIDER_AVAILABILITY
RATE_LIMIT
CONTENT_REJECTED
RECIPIENT_REJECTED
SENDER_REJECTED
MIME_INVALID
TEMPLATE_INVALID
ATTACHMENT_INVALID
QUEUE_BACKLOG
LOCKING_OR_LEASE
RETRY_EXHAUSTED
BOUNCE
COMPLAINT
SUPPRESSION
OBSERVABILITY_GAP
UNKNOWN
```

### 4.1 Configuration Failure

Examples:

- wrong SMTP host;
- wrong port;
- missing STARTTLS;
- using dev credentials in prod;
- missing provider API key;
- feature flag disables sending;
- tenant sender domain not verified.

Symptoms:

- all messages fail immediately;
- failure started after deployment/config change;
- same exception repeated;
- no recipient-specific variation.

Mitigation:

- rollback config;
- validate config at startup;
- provide config health check;
- separate readiness from full send test.

### 4.2 Network Failure

Examples:

- TCP connect timeout;
- read timeout;
- write timeout;
- firewall/security group issue;
- proxy/NAT issue;
- provider endpoint unreachable.

Symptoms:

- timeout spike;
- no SMTP response code;
- intermittent failures;
- environment-specific failure.

Mitigation:

- check egress rules;
- verify DNS resolution;
- test TCP connectivity from pod/node;
- ensure sane timeout;
- circuit breaker if provider unavailable.

### 4.3 DNS Failure

Examples:

- SMTP hostname cannot resolve;
- provider DNS outage;
- stale DNS cache;
- wrong split-horizon DNS;
- MX lookup issue for direct-to-MX sending.

Symptoms:

- `UnknownHostException`;
- environment-specific;
- restart temporarily fixes due to DNS cache.

Mitigation:

- avoid direct-to-MX unless required;
- use provider relay;
- inspect JVM DNS cache TTL;
- inspect CoreDNS/VPC resolver behavior;
- do not hardcode transient IPs.

### 4.4 TLS Failure

Examples:

- STARTTLS required but server does not support;
- certificate expired;
- certificate chain not trusted;
- hostname mismatch;
- TLS protocol/cipher mismatch;
- corporate proxy intercepting TLS.

Symptoms:

- `SSLHandshakeException`;
- failure after EHLO/STARTTLS;
- works with insecure setting but fails securely.

Mitigation:

- fix truststore;
- validate certificate chain;
- enable TLS required mode only with compatible server;
- never permanently disable certificate validation.

### 4.5 Authentication Failure

Examples:

- wrong username/password;
- expired app password;
- OAuth2 token expired;
- wrong auth mechanism;
- account locked;
- provider disables basic auth.

Symptoms:

- SMTP 535/534-style auth errors;
- all messages fail;
- failure starts after credential rotation.

Mitigation:

- rotate credentials;
- validate secret loading;
- ensure token refresh;
- separate secret version metadata;
- monitor auth failure as high-severity.

### 4.6 Authorization Failure

Examples:

- authenticated account cannot send as header `From`;
- tenant sender not allowed;
- domain not verified;
- sandbox mode only allows verified recipients.

Symptoms:

- sender rejected;
- provider-specific “not authorized to send from domain”;
- staging works, production tenant fails.

Mitigation:

- verify sender identity/domain;
- enforce sender allowlist in application;
- validate tenant configuration before activation.

### 4.7 Provider Quota / Rate Limit

Examples:

- daily quota exceeded;
- per-second send rate exceeded;
- sandbox limit;
- tenant quota exhausted;
- provider throttles a recipient domain.

Symptoms:

- 4xx throttling;
- HTTP 429 for API provider;
- queue backlog grows;
- retry amplifies failure.

Mitigation:

- global and per-provider rate limiter;
- exponential backoff with jitter;
- quota dashboard;
- pause non-critical batch;
- prioritize transactional email.

### 4.8 Content Rejected

Examples:

- message flagged as spam/phishing;
- suspicious links;
- blocked attachment type;
- malformed HTML;
- too many recipients;
- message too large.

Symptoms:

- DATA command rejection;
- provider accepts some templates but rejects one;
- attachment/template-specific failures.

Mitigation:

- inspect template version;
- validate attachment policy;
- reduce link/HTML risk;
- use provider content diagnostics;
- rollback template.

### 4.9 Recipient Rejected

Examples:

- invalid address;
- mailbox disabled;
- domain does not exist;
- recipient server rejects sender;
- recipient suppressed.

Symptoms:

- RCPT TO rejection;
- partial success;
- specific recipient/domain failure.

Mitigation:

- mark recipient invalid if permanent;
- do not retry permanent recipient failures;
- suppress hard bounces;
- expose business-friendly error.

### 4.10 Queue Backlog

Examples:

- worker unavailable;
- slow provider;
- too few workers;
- large batch starves transactional email;
- poison message blocks partition;
- retry storm.

Symptoms:

- pending count grows;
- queue age increases;
- latency SLO breached;
- CPU/DB pressure increases.

Mitigation:

- pause batch;
- scale workers carefully;
- isolate priority queues;
- dead-letter poison messages;
- cap retry rate.

---

## 5. SMTP Reply Code Interpretation

SMTP has a structured reply model:

```text
2xx = positive completion
3xx = positive intermediate
4xx = transient negative completion
5xx = permanent negative completion
```

Operationally:

- `2xx`: provider/relay accepted the command;
- `4xx`: usually retryable, but retry must be controlled;
- `5xx`: usually permanent for the same request, do not blindly retry.

But do not classify only from the first digit. Real systems need context:

```text
421 service not available        -> retryable provider/server issue
450 mailbox unavailable          -> often retryable
451 local error                  -> retryable
452 insufficient storage         -> retryable-ish, with backoff
535 authentication failed        -> not retryable until credential/config changes
550 mailbox unavailable          -> usually permanent recipient failure
552 message size exceeded        -> permanent for same content
554 transaction failed           -> depends on response text/provider
```

Enhanced status codes such as `5.1.1` or `4.7.0` add more diagnostic detail. Example:

```text
550 5.1.1 User unknown
421 4.7.0 Temporary rate limit
554 5.7.1 Message rejected due to policy
```

Design implication:

```text
raw SMTP code + enhanced code + command + response text
  -> normalized technical failure
  -> retry decision
  -> business-facing status
  -> operator diagnostic
```

Never let business code directly parse provider-specific strings everywhere. Centralize classification.

---

## 6. Jakarta Mail Exception Chain Playbook

Jakarta Mail failures are often nested.

Important exception concepts:

- `MessagingException` can chain nested exceptions.
- `SendFailedException` can contain:
  - invalid addresses;
  - valid sent addresses;
  - valid unsent addresses.
- SMTP provider exceptions can include command, return code, and server response.
- Recipient-level failures can appear as chained exceptions per address.

Pseudo extraction pattern:

```java
public final class MailFailureAnalyzer {

    public MailFailureReport analyze(Exception e) {
        MailFailureReport report = new MailFailureReport();
        Throwable current = e;

        while (current != null) {
            report.addException(current.getClass().getName(), current.getMessage());

            if (current instanceof jakarta.mail.SendFailedException sfe) {
                report.addInvalidAddresses(sfe.getInvalidAddresses());
                report.addValidSentAddresses(sfe.getValidSentAddresses());
                report.addValidUnsentAddresses(sfe.getValidUnsentAddresses());
            }

            if (current instanceof org.eclipse.angus.mail.smtp.SMTPAddressFailedException afe) {
                report.addSmtpAddressFailure(
                    afe.getAddress(),
                    afe.getCommand(),
                    afe.getReturnCode(),
                    afe.getMessage()
                );
            }

            if (current instanceof org.eclipse.angus.mail.smtp.SMTPSendFailedException sfe2) {
                report.addSmtpCommandFailure(
                    sfe2.getCommand(),
                    sfe2.getReturnCode(),
                    sfe2.getMessage()
                );
            }

            if (current instanceof jakarta.mail.MessagingException me) {
                Exception next = me.getNextException();
                if (next != null && next != current) {
                    current = next;
                    continue;
                }
            }

            current = current.getCause();
        }

        return report;
    }
}
```

For Java 8 / `javax.mail`, the same idea applies with package names changed.

Do not just log:

```text
Failed to send email: MessagingException
```

Log structured fields:

```json
{
  "event": "mail_send_failed",
  "notificationId": "notif_123",
  "provider": "smtp-primary",
  "failureCategory": "RECIPIENT_REJECTED",
  "smtpCommand": "RCPT TO",
  "smtpReturnCode": 550,
  "enhancedStatusCode": "5.1.1",
  "retryable": false,
  "attempt": 1,
  "recipientHash": "...",
  "messageId": "..."
}
```

---

## 7. Symptom-Based Incident Diagnosis

### 7.1 Symptom: “No Emails Are Being Sent”

Likely causes:

- global SMTP config broken;
- provider outage;
- credential expired;
- worker down;
- outbox polling stopped;
- queue lock stuck;
- feature flag disabled;
- deployment regression.

Diagnostic path:

```text
1. Check outbox pending count.
2. Check outbox oldest pending age.
3. Check worker heartbeat.
4. Check recent send attempt count.
5. Check failure category distribution.
6. Check provider auth/connectivity errors.
7. Check recent deployment/config changes.
8. Check provider status/quota dashboard.
9. Send controlled test through same path, not ad-hoc code.
```

Do not start by sending from your laptop. That bypasses the real runtime, network, secret, DNS, and config path.

### 7.2 Symptom: “Some Recipients Receive, Some Do Not”

Likely causes:

- recipient-specific invalid address;
- domain-specific blocking;
- partial success not handled;
- BCC/CC misunderstanding;
- provider suppression list;
- recipient spam/quarantine;
- DMARC alignment affects certain recipient providers.

Diagnostic path:

```text
1. Identify affected recipient domains.
2. Compare accepted/sent/unsent/invalid recipient arrays.
3. Check SMTP response per recipient.
4. Check bounce/complaint events.
5. Check provider suppression list.
6. Check if same template/message to another domain works.
7. Check recipient mailbox/spam/quarantine evidence.
```

### 7.3 Symptom: “Email Sent But User Says Not Received”

Likely causes:

- SMTP accepted but downstream delayed;
- message in spam/quarantine;
- bounce arrived later;
- wrong recipient;
- user checking different mailbox;
- display name confusion;
- recipient mail rule moved message;
- message suppressed by provider after acceptance.

Diagnostic path:

```text
1. Verify notification id and intended recipient.
2. Verify SMTP/API accepted timestamp.
3. Verify provider message id.
4. Check bounce/complaint/delivery event.
5. Check Message-ID if available.
6. Ask recipient admin to search by Message-ID/provider timestamp.
7. Do not claim delivered unless delivery feedback exists.
```

Correct language:

```text
The system generated the notification and the provider accepted it at 10:42. We do not yet have final mailbox delivery evidence. We are checking provider feedback and recipient-side filtering.
```

Wrong language:

```text
The email was delivered successfully.
```

Unless you actually have delivery evidence.

### 7.4 Symptom: “Duplicate Emails Were Sent”

Likely causes:

- retry after ambiguous timeout;
- missing idempotency key;
- worker lease expired while send still in progress;
- multiple workers claimed same row;
- event replay without dedup;
- user double-click created duplicate intent;
- outbox status update failed after provider accepted.

Diagnostic path:

```text
1. Compare notification id, outbox id, provider message id.
2. Check if duplicates share idempotency key.
3. Check worker lease duration vs send duration.
4. Check timeout and retry timing.
5. Check DB locking query.
6. Check status transition audit.
7. Check whether provider accepted multiple distinct sends.
```

Mitigation:

- idempotency key at notification intent;
- database unique constraint;
- worker lease heartbeat;
- post-send status update resilience;
- provider idempotency if API supports it;
- duplicate detection dashboard.

### 7.5 Symptom: “Queue Is Growing”

Likely causes:

- provider slow;
- rate limiter too strict;
- retry storm;
- workers underprovisioned;
- DB query slow;
- large attachments;
- batch job flooding queue;
- poison messages repeatedly retried.

Diagnostic path:

```text
1. Measure queue depth by priority/status.
2. Measure oldest pending age.
3. Measure processing latency by stage.
4. Compare enqueue rate vs send completion rate.
5. Check failure/retry rate.
6. Check worker concurrency and DB CPU.
7. Check provider throttling/quota.
8. Identify top templates/tenants causing volume.
```

Immediate controls:

- pause non-critical batch;
- reduce retry aggressiveness;
- prioritize transactional queue;
- apply circuit breaker to failing provider;
- move poison messages to dead-letter;
- scale workers only if downstream and DB can handle it.

### 7.6 Symptom: “Auth Suddenly Fails”

Likely causes:

- credential rotation failed;
- secret not mounted;
- provider disabled basic auth;
- account locked;
- OAuth token refresh broken;
- wrong environment secret;
- SMTP username differs from sender.

Diagnostic path:

```text
1. Check first failure timestamp.
2. Compare with secret rotation/deployment timeline.
3. Verify application loaded expected secret version.
4. Check provider account status.
5. Test controlled authentication from runtime environment.
6. Inspect whether all tenants fail or one tenant fails.
```

Mitigation:

- rollback secret;
- force refresh token;
- enable alternate provider route if approved;
- alert security/ops because credential issues may indicate compromise or policy change.

### 7.7 Symptom: “Attachment Is Missing or Corrupt”

Likely causes:

- wrong MIME part disposition;
- filename encoding issue;
- stream consumed twice;
- temporary file deleted before send;
- wrong content type;
- base64 encoding issue;
- attachment blocked by provider/client;
- size limit exceeded.

Diagnostic path:

```text
1. Check MIME structure summary.
2. Check attachment count/size/hash at composition time.
3. Check raw MIME in test environment.
4. Compare expected content hash and sent part hash.
5. Check provider/client attachment policy.
6. Check filename encoding for non-ASCII names.
7. Check temp file lifecycle.
```

### 7.8 Symptom: “HTML Looks Broken”

Likely causes:

- unsupported CSS;
- dark mode transformation;
- missing inline CSS;
- image blocked;
- CID mismatch;
- remote image blocked;
- malformed HTML;
- client-specific rendering.

Diagnostic path:

```text
1. Identify affected client: Outlook desktop, Gmail web, iOS Mail, etc.
2. Reproduce using captured MIME.
3. Inspect HTML after template rendering.
4. Inspect multipart related structure.
5. Verify Content-ID and cid: references.
6. Test dark mode.
7. Rollback template version if broad impact.
```

---

## 8. Diagnostic Flow: From Alert to Root Cause

When an alert fires, avoid chaotic investigation. Use this flow.

```text
A. Scope
   - one user, one tenant, one template, one provider, or global?

B. Time
   - when did it start?
   - correlate with deployment/config/secret/template changes.

C. Stage
   - last successful stage with evidence?

D. Category
   - config, network, auth, quota, recipient, content, queue, feedback?

E. Blast Radius
   - customer-facing?
   - regulatory deadline?
   - transactional vs marketing/batch?

F. Immediate Control
   - pause, rollback, failover, throttle, kill switch.

G. Recovery
   - replay pending?
   - resend failed?
   - suppress duplicates?
   - notify stakeholders?

H. Hardening
   - add metric, test, validation, alert, runbook, guardrail.
```

---

## 9. SMTP Transcript Reading

A simplified successful SMTP submission:

```text
S: 220 smtp.example.com ESMTP
C: EHLO app.example.com
S: 250-smtp.example.com
S: 250-STARTTLS
S: 250-AUTH PLAIN LOGIN XOAUTH2
S: 250 SIZE 52428800
C: STARTTLS
S: 220 Ready to start TLS
... TLS handshake ...
C: EHLO app.example.com
S: 250-smtp.example.com
S: 250-AUTH PLAIN LOGIN XOAUTH2
C: AUTH PLAIN ********
S: 235 Authentication successful
C: MAIL FROM:<bounce@example.com>
S: 250 OK
C: RCPT TO:<user@example.net>
S: 250 Accepted
C: DATA
S: 354 End data with <CR><LF>.<CR><LF>
C: From: Service <no-reply@example.com>
C: To: user@example.net
C: Subject: Your receipt
C: Message-ID: <...>
C:
C: ... MIME content ...
C: .
S: 250 Queued as abc123
C: QUIT
S: 221 Bye
```

Where failures happen:

```text
EHLO          -> connectivity/protocol/server issue
STARTTLS      -> TLS support/cert/trust issue
AUTH          -> credential/auth mechanism issue
MAIL FROM     -> sender/envelope authorization issue
RCPT TO       -> recipient-specific issue
DATA          -> content/size/policy issue
end of DATA   -> final acceptance/rejection of message content
```

Important nuance:

- `RCPT TO` failure can be per recipient.
- `DATA` failure usually affects message content as a whole.
- `250 Queued` means accepted by relay, not necessarily inbox-delivered.

---

## 10. Safe Debugging

Jakarta Mail `Session` supports debug output. This is useful, but dangerous.

Never enable full SMTP debug permanently in production without controls because it may expose:

- email addresses;
- headers;
- subject;
- server responses;
- auth flow details;
- possibly sensitive body/attachment metadata.

Safer approach:

1. Enable debug only for a short window.
2. Redirect to controlled sink.
3. Redact credentials and tokens.
4. Scope to specific notification/provider/tenant if possible.
5. Use lower environment reproduction when possible.
6. Store transcript with restricted access.
7. Expire/delete diagnostic artifacts.

Example diagnostic toggle design:

```java
public final class MailDebugPolicy {
    private final boolean enabled;
    private final Set<String> allowedNotificationIds;
    private final Instant expiresAt;

    public boolean shouldDebug(String notificationId, Instant now) {
        return enabled
            && now.isBefore(expiresAt)
            && allowedNotificationIds.contains(notificationId);
    }
}
```

Avoid this:

```java
props.put("mail.debug", "true"); // globally, forever, in production
```

Prefer a controlled diagnostic channel.

---

## 11. Incident Controls

### 11.1 Kill Switch

A kill switch stops sending without undeploying the app.

Types:

```text
GLOBAL_SEND_DISABLED
TENANT_SEND_DISABLED
TEMPLATE_SEND_DISABLED
PROVIDER_DISABLED
BATCH_SEND_DISABLED
ATTACHMENT_SEND_DISABLED
```

A good kill switch:

- is fast to activate;
- is audited;
- is visible in dashboard;
- has scope;
- does not delete pending notifications;
- records suppression reason;
- is safe to deactivate.

Bad kill switch:

- only exists as code change;
- silently drops messages;
- cannot distinguish batch vs transactional;
- lacks audit evidence.

### 11.2 Circuit Breaker

Use circuit breaker when provider is unhealthy.

States:

```text
CLOSED      -> send normally
OPEN        -> stop sending to provider temporarily
HALF_OPEN   -> allow limited probes
```

Trigger examples:

- auth failure spike;
- connection timeout rate > threshold;
- 4xx provider throttle spike;
- provider API 5xx spike.

Be careful: not every 5xx should open global circuit if the failure is template-specific or recipient-specific.

### 11.3 Rate Limiter

Rate limiter protects provider and your system.

Recommended dimensions:

- global;
- provider;
- tenant;
- template/category;
- recipient domain;
- priority lane.

### 11.4 Priority Lane

Transactional email should not be starved by batch email.

Example priority:

```text
P0: security/password reset/MFA
P1: regulatory deadline/official notice
P2: case/application transactional update
P3: reminder
P4: bulk announcement
```

Design implication:

- separate queues or priority column;
- worker allocation by priority;
- batch pausable independently.

---

## 12. Retry Storm Model

A retry storm happens when failure causes retries, retries create more load, more load creates more failure.

Example:

```text
provider starts returning 421 throttling
  -> app retries immediately
  -> queue workers increase attempts
  -> provider throttles harder
  -> DB writes spike
  -> queue age grows
  -> operators scale workers
  -> provider receives even more requests
```

Prevention:

1. Exponential backoff.
2. Jitter.
3. Max attempts.
4. Provider-level circuit breaker.
5. Retry budget.
6. Separate transient provider failures from recipient failures.
7. Do not retry 5xx permanent failures blindly.
8. Respect provider rate-limit headers/messages where available.
9. Pause bulk when transactional queue is at risk.

Retry decision table:

| Failure | Retry? | Notes |
|---|---:|---|
| TCP connect timeout | Yes | Backoff, circuit breaker if spike |
| SMTP 421 | Yes | Provider/server temporary issue |
| SMTP 450/451 | Yes | Usually transient recipient/server issue |
| SMTP 535 auth failed | No automatic retry loop | Config/secret intervention needed |
| SMTP 550 user unknown | No | Mark permanent recipient failure |
| Message too large | No | Same content will fail again |
| Template rendering error | No until template/data fixed | Move to dead-letter/manual correction |
| Provider 429 | Yes | Respect rate limit, backoff |
| Unknown ambiguous timeout after DATA | Cautious | Possible provider accepted message; duplicate risk |

---

## 13. Ambiguous Outcome Handling

One of the hardest mail failures is this:

```text
Application sends DATA.
Provider accepts message but connection drops before client receives 250.
```

From application perspective:

- send failed due to timeout/connection reset.

From provider perspective:

- message may have been queued.

If application retries, duplicate email may be sent.

How to handle:

1. Treat post-DATA timeout as `UNKNOWN_OUTCOME`, not simple retryable failure.
2. Use provider message id if available.
3. Use idempotency key if provider API supports it.
4. Use deterministic `Message-ID` per notification attempt only if appropriate.
5. Apply delayed cautious retry for critical emails.
6. Prefer manual review for high-impact regulatory notices.
7. Record ambiguity in audit.

State model:

```text
PENDING
PROCESSING
ACCEPTED
FAILED_RETRYABLE
FAILED_PERMANENT
UNKNOWN_OUTCOME
DEAD_LETTER
CANCELLED
```

`UNKNOWN_OUTCOME` is not overengineering. It is honest modelling.

---

## 14. Drain and Replay Strategy

When incident is fixed, you often need to drain pending messages or replay failed ones.

### 14.1 Drain Pending

Use when:

- messages were queued but not attempted;
- provider/config fixed;
- pending messages are still valid.

Controls:

- limit rate;
- preserve priority;
- monitor failure spike;
- do not flood provider immediately after outage.

### 14.2 Replay Failed Retryable

Use when:

- transient provider/network issue resolved;
- failures are safe to retry;
- no evidence provider accepted the message.

Controls:

- replay by time window;
- replay by failure category;
- replay by template/tenant;
- cap attempts;
- produce replay audit.

### 14.3 Replay Permanent Failure

Usually do not replay automatically.

Only after correcting root cause:

- template fixed;
- attachment fixed;
- recipient corrected;
- sender authorization fixed;
- domain verification fixed.

### 14.4 Duplicate-Sensitive Replay

For legal/regulatory notices, payment receipts, security tokens:

- do not blindly replay;
- use business idempotency;
- maybe send correction notice instead;
- involve business owner for user-visible duplicate risk.

Replay command should be explicit:

```text
replay failed notifications
where failure_category = PROVIDER_AVAILABILITY
and created_at between T1 and T2
and template_id in (...)
and current_status = FAILED_RETRYABLE
limit N per minute
```

Not:

```text
UPDATE outbox SET status = 'PENDING' WHERE status = 'FAILED';
```

That is how systems create secondary incidents.

---

## 15. Dead-Letter Queue Playbook

Dead-letter is not a trash can. It is a controlled state for items that need inspection or correction.

Dead-letter reasons:

```text
MAX_RETRY_EXCEEDED
TEMPLATE_RENDERING_FAILED
INVALID_RECIPIENT
ATTACHMENT_NOT_FOUND
MESSAGE_TOO_LARGE
PROVIDER_PERMANENT_REJECTION
UNKNOWN_OUTCOME_REQUIRES_REVIEW
SECURITY_POLICY_BLOCKED
```

Dead-letter record should include:

- notification id;
- failure category;
- last exception summary;
- attempt count;
- first failure time;
- last failure time;
- template id/version;
- tenant;
- recipient hash/category;
- remediation owner;
- manual action log.

Dead-letter actions:

```text
IGNORE_WITH_REASON
CORRECT_AND_REPLAY
CANCEL
ESCALATE
SUPPRESS_RECIPIENT
CHANGE_TEMPLATE_AND_REPLAY
```

Every manual action must be auditable.

---

## 16. Common Production Incidents and Playbooks

### 16.1 Expired SMTP Credential

Symptoms:

- all sends fail;
- SMTP auth error;
- starts at rotation time;
- queue grows.

Immediate actions:

1. Activate provider circuit breaker or global pause if failure volume high.
2. Verify secret version in runtime.
3. Rotate/fix credential.
4. Run controlled test through app path.
5. Resume slowly.
6. Replay retryable failures.

Hardening:

- secret expiry alert;
- credential canary;
- startup config validation;
- runbook for rotation;
- dual-secret rollout if supported.

### 16.2 Provider Rate Limit Exceeded

Symptoms:

- 4xx throttling/429;
- queue backlog;
- batch running;
- transactional latency affected.

Immediate actions:

1. Pause batch.
2. Reduce global send rate.
3. Prioritize P0/P1 transactional.
4. Increase backoff.
5. Check provider quota.
6. Drain gradually.

Hardening:

- quota-aware scheduler;
- per-priority queue;
- per-domain throttling;
- pre-batch capacity check;
- alert on quota utilization.

### 16.3 Wrong Template Sent

Symptoms:

- users receive incorrect content;
- template version recently changed;
- outbound sending itself succeeds.

Immediate actions:

1. Disable affected template.
2. Identify affected notification ids.
3. Stop further sends.
4. Determine if correction email is needed.
5. Preserve evidence of rendered content/version.
6. Notify stakeholders/compliance if sensitive.

Hardening:

- template approval workflow;
- preview/signoff;
- snapshot tests;
- staged rollout;
- canary recipients;
- template version audit.

### 16.4 Duplicate Regulatory Notice

Symptoms:

- user receives same official notice multiple times;
- retries or replay happened;
- potentially legal/confusing impact.

Immediate actions:

1. Stop replay/send for affected template.
2. Identify duplicate source: same notification or multiple notification intents.
3. Preserve evidence.
4. Coordinate business/legal response.
5. Decide whether correction notice is needed.
6. Prevent further duplicates with temporary constraint/filter.

Hardening:

- stronger idempotency key;
- unique business notification constraint;
- unknown outcome state;
- replay approval for high-impact templates;
- duplicate detection metric.

### 16.5 Attachment PII Leak

Symptoms:

- wrong attachment sent;
- wrong recipient;
- attachment reference mismatch;
- severe compliance risk.

Immediate actions:

1. Kill switch affected template/channel.
2. Identify all affected recipients and attachments.
3. Preserve audit trail with restricted access.
4. Notify security/privacy/compliance team.
5. Disable download links if link-based.
6. Rotate access tokens if needed.
7. Prepare user/regulator notification if required by policy/law.

Hardening:

- attachment ownership validation;
- recipient-to-document authorization check;
- secure link over attachment;
- short-lived token;
- pre-send policy engine;
- test cases for cross-entity access.

### 16.6 DNS/Network Outage

Symptoms:

- connect/resolve timeout;
- no SMTP response code;
- environment-specific;
- unrelated templates fail.

Immediate actions:

1. Verify from runtime environment.
2. Check DNS resolver/CoreDNS/VPC resolver.
3. Check egress/firewall.
4. Switch provider route if approved.
5. Keep queue pending; avoid aggressive retry.
6. Drain gradually after fix.

Hardening:

- connectivity canary;
- DNS cache TTL awareness;
- egress monitoring;
- provider failover plan;
- network dependency dashboard.

---

## 17. Forensic Evidence Model

During incidents, logs are not enough. You need evidence that is:

- accurate;
- time-ordered;
- redacted;
- immutable enough;
- explainable to non-engineers.

Recommended evidence fields:

```text
notification_id
business_event_id
business_entity_type
business_entity_id
template_id
template_version
recipient_hash
recipient_type
channel
provider
provider_message_id
smtp_return_code
smtp_enhanced_status_code
message_id_header
status
attempt_count
first_attempt_at
last_attempt_at
accepted_at
bounced_at
complained_at
last_failure_category
last_failure_summary
operator_action
operator_action_reason
```

Avoid storing raw body/attachment unless there is a strong policy reason. If stored, protect it heavily and define retention.

---

## 18. Status Page and Stakeholder Communication

Technical truth must be translated carefully.

### 18.1 For Internal Ops

Useful:

```text
From 09:12 to 09:46, SMTP provider authentication failed due to expired credential version smtp-prod-v42. 1,842 notifications entered FAILED_RETRYABLE. No provider acceptance occurred for those attempts. Credential was rotated at 09:51, controlled test passed at 09:54, replay began at 10:00 at 120/min. No duplicate risk identified for failed attempts before AUTH.
```

### 18.2 For Business Stakeholder

Useful:

```text
Some outbound emails were delayed because the application could not authenticate to the mail provider. The affected emails were not accepted by the provider during the failed window, so we are replaying them after fixing the credential. We will provide the final affected count and completion time after replay finishes.
```

### 18.3 Avoid Overclaiming

Do not say:

```text
All emails were delivered.
```

Unless you have actual delivery evidence.

Say:

```text
All affected notifications were accepted by the mail provider for delivery.
```

Or:

```text
All affected notifications were generated and handed off to the provider; delivery feedback is still being monitored.
```

---

## 19. Runbook Template

Use this as a standard incident runbook skeleton.

```markdown
# Mail Incident Runbook

## 1. Incident Summary
- Incident ID:
- Start time:
- Detected by:
- Current status:
- Severity:
- Affected environment:

## 2. Scope
- Global / tenant-specific / template-specific / recipient-domain-specific:
- Affected templates:
- Affected tenants:
- Affected count:
- Criticality:

## 3. Symptoms
- Queue backlog:
- Failure rate:
- Failure category:
- Provider status:
- User reports:

## 4. Last Known Good Stage
- Business trigger:
- Outbox persisted:
- Worker claimed:
- Template rendered:
- MIME composed:
- Provider accepted:
- Delivery feedback:

## 5. Immediate Controls
- Kill switch:
- Circuit breaker:
- Batch paused:
- Rate limit changed:
- Provider failover:

## 6. Root Cause Investigation
- Recent deployments:
- Recent config changes:
- Recent template changes:
- Secret rotation:
- Provider quota/status:
- Network/DNS/TLS/auth checks:

## 7. Recovery Plan
- Drain pending:
- Replay failed:
- Cancel invalid:
- Manual review required:
- Duplicate risk:

## 8. Evidence
- Query links:
- Dashboard links:
- Provider evidence:
- Audit records:

## 9. Communication
- Internal update:
- Business update:
- Customer/regulatory update if needed:

## 10. Post-Incident Actions
- Code fix:
- Config guardrail:
- Test coverage:
- Alerting:
- Runbook update:
- Owner:
- Due date:
```

---

## 20. SQL Diagnostics Example

Assume an outbox table:

```sql
CREATE TABLE notification_outbox (
    id                  VARCHAR2(64) PRIMARY KEY,
    idempotency_key     VARCHAR2(200) NOT NULL,
    tenant_id           VARCHAR2(64) NOT NULL,
    template_id         VARCHAR2(100) NOT NULL,
    template_version    VARCHAR2(50),
    channel             VARCHAR2(30) NOT NULL,
    priority            NUMBER(3) NOT NULL,
    status              VARCHAR2(50) NOT NULL,
    failure_category    VARCHAR2(80),
    attempt_count       NUMBER(10) DEFAULT 0 NOT NULL,
    next_attempt_at     TIMESTAMP,
    created_at          TIMESTAMP NOT NULL,
    updated_at          TIMESTAMP NOT NULL,
    accepted_at         TIMESTAMP,
    provider            VARCHAR2(100),
    provider_message_id VARCHAR2(200),
    last_error_summary  VARCHAR2(1000)
);
```

### 20.1 Queue Depth by Status

```sql
SELECT status, COUNT(*) AS cnt
FROM notification_outbox
GROUP BY status
ORDER BY cnt DESC;
```

### 20.2 Oldest Pending Age

```sql
SELECT MIN(created_at) AS oldest_pending
FROM notification_outbox
WHERE status IN ('PENDING', 'FAILED_RETRYABLE');
```

### 20.3 Failure Category Distribution

```sql
SELECT failure_category, COUNT(*) AS cnt
FROM notification_outbox
WHERE status IN ('FAILED_RETRYABLE', 'FAILED_PERMANENT', 'DEAD_LETTER')
GROUP BY failure_category
ORDER BY cnt DESC;
```

### 20.4 Identify Retry Storm

```sql
SELECT
    TRUNC(updated_at, 'MI') AS minute_bucket,
    failure_category,
    COUNT(*) AS failures
FROM notification_outbox
WHERE updated_at >= SYSTIMESTAMP - INTERVAL '1' HOUR
  AND status IN ('FAILED_RETRYABLE', 'FAILED_PERMANENT')
GROUP BY TRUNC(updated_at, 'MI'), failure_category
ORDER BY minute_bucket DESC, failures DESC;
```

### 20.5 High Attempt Count

```sql
SELECT id, tenant_id, template_id, status, failure_category, attempt_count, last_error_summary
FROM notification_outbox
WHERE attempt_count >= 5
ORDER BY attempt_count DESC, updated_at DESC;
```

### 20.6 Duplicate Intent Detection

```sql
SELECT idempotency_key, COUNT(*) AS cnt
FROM notification_outbox
GROUP BY idempotency_key
HAVING COUNT(*) > 1
ORDER BY cnt DESC;
```

---

## 21. Application-Level Diagnostic Endpoint

A safe diagnostic endpoint can help operators inspect one notification without raw PII.

Example response:

```json
{
  "notificationId": "notif_123",
  "tenantId": "tenant_a",
  "template": {
    "id": "case-approved",
    "version": "2026.06.01"
  },
  "channel": "EMAIL",
  "priority": 1,
  "status": "FAILED_RETRYABLE",
  "attempts": 3,
  "lastStage": "PROVIDER_REQUEST_STARTED",
  "failure": {
    "category": "PROVIDER_RATE_LIMIT",
    "retryable": true,
    "smtpReturnCode": 421,
    "enhancedStatusCode": "4.7.0"
  },
  "recipientSummary": {
    "toCount": 1,
    "ccCount": 0,
    "bccCount": 0,
    "recipientHash": "sha256:..."
  },
  "provider": {
    "name": "smtp-primary",
    "messageId": null
  },
  "timestamps": {
    "createdAt": "2026-06-18T10:00:00Z",
    "lastAttemptAt": "2026-06-18T10:05:00Z",
    "nextAttemptAt": "2026-06-18T10:20:00Z"
  }
}
```

Rules:

- do not expose raw recipient by default;
- do not expose body;
- do not expose credential/config secret;
- require authorization;
- audit access to diagnostics.

---

## 22. Health Checks and Canaries

### 22.1 Liveness

Should only answer: “is process alive?”

Do not make liveness depend on SMTP provider. Otherwise provider outage can restart healthy application endlessly.

### 22.2 Readiness

Can include:

- DB reachable;
- outbox table reachable;
- config loaded;
- worker dependencies ready.

Be careful making readiness depend on external SMTP provider. It may remove all pods during provider outage.

### 22.3 Mail Canary

A canary is a controlled test send path.

Types:

```text
CONFIG_CANARY       -> verify config/secret syntax, no send
SMTP_CONNECT_CANARY -> connect/EHLO/STARTTLS/auth/quit, no DATA
FULL_SEND_CANARY    -> send to controlled mailbox
FEEDBACK_CANARY     -> verify delivery/bounce webhook loop
```

Full send canary should:

- use controlled recipient;
- be rate-limited;
- be excluded from business metrics or labeled separately;
- verify provider acceptance;
- optionally verify mailbox receipt.

---

## 23. Production Guardrails Checklist

Before a mail system is considered production-ready, it should have these guardrails.

### 23.1 Send Path

- [ ] Timeouts configured.
- [ ] TLS mode explicit.
- [ ] Auth failure classified.
- [ ] Sender allowlist enforced.
- [ ] Header injection blocked.
- [ ] Attachment size limit enforced.
- [ ] MIME validation exists.
- [ ] Provider response captured.

### 23.2 Reliability

- [ ] Outbox pattern or equivalent durable queue.
- [ ] Idempotency key.
- [ ] Retry policy with backoff and jitter.
- [ ] Max attempts.
- [ ] Dead-letter handling.
- [ ] Unknown outcome state or policy.
- [ ] Duplicate detection.
- [ ] Replay tooling.

### 23.3 Observability

- [ ] Queue depth metric.
- [ ] Queue age metric.
- [ ] Send success/failure metric.
- [ ] Failure category metric.
- [ ] Provider latency metric.
- [ ] Bounce/complaint metric.
- [ ] Correlation id.
- [ ] Audit trail.
- [ ] Redaction policy.

### 23.4 Operations

- [ ] Kill switch.
- [ ] Circuit breaker.
- [ ] Rate limiter.
- [ ] Priority queue/lane.
- [ ] Runbook.
- [ ] Canary.
- [ ] Secret rotation procedure.
- [ ] Provider quota dashboard.

### 23.5 Compliance

- [ ] PII minimization.
- [ ] Secure attachment/link policy.
- [ ] Retention policy.
- [ ] Access-controlled diagnostics.
- [ ] Business evidence model.
- [ ] Manual operator action audit.

---

## 24. Anti-Patterns

### 24.1 “Send Email Inside Request Transaction”

Bad:

```text
DB transaction begins
  -> update case
  -> send email via SMTP
  -> commit DB
```

If SMTP is slow, user request is slow. If SMTP succeeds but DB commit fails, email lies. If SMTP times out after provider accepted, retry may duplicate.

Better:

```text
DB transaction begins
  -> update case
  -> insert notification outbox row
  -> commit DB
worker sends email asynchronously
```

### 24.2 “Retry Everything”

Bad:

```text
catch Exception -> retry 10 times immediately
```

This causes duplicate risk, provider throttling, and waste.

Better:

```text
classify -> retry only if retryable -> backoff -> jitter -> max attempts -> dead-letter
```

### 24.3 “Sent Means Delivered”

Bad:

```text
status = DELIVERED after Transport.send()
```

Better:

```text
Transport/provider accepted -> ACCEPTED
Delivery feedback -> DELIVERED / BOUNCED / COMPLAINED
No feedback -> ACCEPTED_WITHOUT_FINAL_DELIVERY_EVIDENCE
```

### 24.4 “Raw SMTP Debug in Production Logs”

Bad:

```text
mail.debug=true globally
```

Better:

- scoped debug;
- redaction;
- short duration;
- restricted access;
- audit.

### 24.5 “One Queue for Everything”

Bad:

```text
password reset + regulatory notice + marketing announcement in same FIFO queue
```

Better:

- priority lane;
- separate batch queue;
- rate limit per category;
- pause low priority during incident.

---

## 25. Advanced Failure Modelling: Invariants

Define invariants that must always hold.

Recommended invariants:

1. A business event must not produce more than one notification intent per idempotency key.
2. A notification must not be sent if recipient authorization fails.
3. A permanent recipient rejection must not be retried indefinitely.
4. A provider auth failure must not generate retry storm.
5. A template rendering failure must not be marked as sent.
6. A provider-accepted message must retain provider evidence.
7. A bounce must not be ignored for future suppression policy.
8. A complaint must suppress or escalate according to policy.
9. A manual replay must be audited.
10. A diagnostic view must not expose raw PII unless explicitly authorized.
11. A global provider outage must not starve unrelated application functionality.
12. A low-priority batch must not block high-priority transactional email.
13. A kill switch must stop new sends without deleting evidence.
14. A retry after ambiguous post-DATA timeout must consider duplicate risk.
15. A compliance-sensitive notification must have stronger replay controls.

Invariants are more powerful than scattered checks because they create architectural clarity.

---

## 26. End-to-End Incident Example

### Incident

Users report that official approval emails are delayed.

### Initial Metrics

```text
mail_outbox_pending = 12,430
oldest_pending_age = 48 minutes
mail_send_failure_rate = 78%
failure_category_top = PROVIDER_RATE_LIMIT
provider = smtp-primary
priority P1 affected = yes
batch campaign running = yes
```

### Diagnosis

Stage analysis:

```text
Business Trigger       OK
Notification Intent    OK
Outbox Persisted       OK
Worker Claimed         OK
Template Rendered      OK
MIME Composed          OK
Provider Request       FAILING
SMTP/API Accepted      PARTIAL
Feedback               not relevant yet
```

Root cause hypothesis:

```text
Batch campaign consumed provider quota and caused throttling, affecting P1 transactional approval notices.
```

### Immediate Controls

```text
1. Pause P4 batch campaign.
2. Reduce global provider send rate.
3. Reserve worker capacity for P0/P1.
4. Increase retry backoff for throttled items.
5. Monitor queue age and accepted rate.
```

### Recovery

```text
1. Drain P1 first at safe rate.
2. Continue P4 only after P1 queue age normalizes.
3. Replay throttled messages with jitter.
4. Confirm provider quota stable.
```

### Post-Incident Actions

```text
1. Add priority-based rate limiter.
2. Add alert: P1 queue age > 5 minutes.
3. Add pre-batch quota estimation.
4. Add batch kill switch in admin UI.
5. Update runbook.
```

---

## 27. How This Looks in a Java Architecture

Recommended component layout:

```text
business-service
  -> NotificationRequestService
     -> NotificationPolicy
     -> TemplateVariableAssembler
     -> OutboxRepository

mail-worker
  -> OutboxPoller
  -> LeaseManager
  -> TemplateRenderer
  -> MimeComposer
  -> MailGateway
      -> JakartaSmtpMailGateway
      -> ApiProviderMailGateway
  -> FailureClassifier
  -> RetryScheduler
  -> MetricsPublisher
  -> AuditWriter

feedback-service
  -> WebhookVerifier
  -> BounceParser
  -> ComplaintHandler
  -> SuppressionService
  -> DeliveryStateUpdater
```

Key boundary:

```text
Business layer says: "a notification should exist"
Infrastructure layer says: "this notification was attempted/accepted/rejected"
Feedback layer says: "what happened after provider acceptance"
```

Do not mix all three meanings into one boolean `sent`.

---

## 28. Checklist Saat Incident Sedang Terjadi

Use this short operational checklist:

```text
[ ] Define blast radius.
[ ] Identify last successful stage.
[ ] Classify dominant failure category.
[ ] Check recent deployment/config/template/secret changes.
[ ] Check provider status/quota.
[ ] Prevent retry storm.
[ ] Pause low-priority batch if needed.
[ ] Activate kill switch/circuit breaker if needed.
[ ] Preserve evidence.
[ ] Decide replay/drain/cancel strategy.
[ ] Communicate without overclaiming delivery.
[ ] Add post-incident guardrail.
```

---

## 29. Key Takeaways

1. Email failure must be modelled as a multi-stage distributed workflow, not a single `send()` result.
2. SMTP accepted does not mean delivered.
3. Retry is dangerous without classification, backoff, jitter, max attempts, and duplicate awareness.
4. Partial success is real: some recipients can be accepted while others fail.
5. Unknown outcome is real, especially after DATA/write/read timeout.
6. Queue backlog is a symptom, not a root cause.
7. Kill switch, circuit breaker, priority lanes, and rate limiters are production necessities.
8. Diagnostic evidence must be useful, redacted, and auditable.
9. Replay is a controlled operation, not a bulk status update.
10. A top-tier engineer designs mail systems so incidents are diagnosable before they happen.

---

## 30. Practical Exercise

Design an incident response for this scenario:

```text
At 09:00, a batch process enqueues 100,000 reminder emails.
At 09:10, password reset emails start taking 20 minutes to arrive.
At 09:15, SMTP provider starts returning 421 and 451 errors.
At 09:20, support reports duplicate reminder emails for some users.
```

Answer these:

1. What is the likely failure model?
2. Which metrics prove it?
3. Which kill switch or rate limiter should be activated?
4. How do you protect password reset emails?
5. How do you distinguish accepted vs unknown outcome duplicates?
6. Which items are safe to replay?
7. What should be added after the incident?

A good answer will mention:

- priority isolation;
- provider quota;
- retry storm;
- ambiguous post-DATA timeout;
- idempotency;
- batch pause;
- queue drain by priority;
- replay audit.

---

## 31. References

- Jakarta Mail API — `SendFailedException`, recipient success/failure classification.
- Jakarta Mail / JavaMail SMTP provider documentation — SMTP properties, timeouts, provider exceptions.
- Eclipse Angus Mail documentation — modern Jakarta Mail implementation and SMTP transport classes.
- RFC 5321 — Simple Mail Transfer Protocol and reply code classes.
- RFC 3463 — Enhanced Mail System Status Codes.
- RFC 3464 — Delivery Status Notifications.
- RFC 5965 — Abuse Reporting Format.

---

## 32. What Comes Next

Next part:

```text
Part 28 — End-to-End Reference Implementation: Java 8 Legacy and Java 21/25 Modern
```

Part berikutnya akan menyatukan seluruh seri menjadi implementation blueprint:

- common domain model;
- Java 8 `javax.mail` implementation;
- Java 21/25 `jakarta.mail` implementation;
- MIME composer;
- outbox worker;
- retry classifier;
- metrics;
- tests;
- migration notes;
- production hardening checklist.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 26 — Advanced MIME and Internationalization](./26-advanced-mime-internationalization.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 28 — End-to-End Reference Implementation: Java 8 Legacy and Java 21/25 Modern](./28-end-to-end-reference-implementation.md)
