# Part 20 — Observability: Logs, Metrics, Tracing, Audit

> Series: `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery`  
> File: `20-observability-logs-metrics-tracing-audit.md`  
> Scope: Java 8–25, JavaMail `javax.mail`, Jakarta Mail `jakarta.mail`, Eclipse Angus Mail, Spring Boot, Jakarta EE, enterprise notification system

---

## 1. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas:

- SMTP sending;
- MIME construction;
- multipart;
- attachment;
- security;
- deliverability;
- inbound mail;
- testing.

Sekarang kita masuk ke area yang sering membedakan engineer biasa dengan engineer yang mampu mengoperasikan sistem di production: **observability**.

Di mail subsystem, masalah paling sering bukan hanya “email gagal dikirim”, tetapi:

- user bilang email tidak diterima;
- aplikasi mencatat `SENT`, tetapi mailbox kosong;
- SMTP provider menerima message, tetapi message masuk spam;
- retry mengirim duplicate email;
- attachment corrupt tetapi SMTP success;
- queue backlog tetapi tidak ada alert;
- SMTP auth expired tetapi worker terus retry;
- bounce datang 2 jam setelah send success;
- ada audit/compliance question: “siapa mengirim apa ke siapa, kapan, dan atas dasar event apa?”;
- debug SMTP dibuka saat incident lalu credential atau PII masuk log.

Observability bukan hanya logging. Observability adalah kemampuan menjawab pertanyaan operasional dari luar sistem tanpa harus menebak isi runtime.

Pertanyaan inti part ini:

> Ketika mail subsystem berjalan di production, informasi apa yang harus kita kumpulkan agar sistem bisa di-debug, diaudit, diukur, dan dipercaya?

---

## 2. Mental Model: Mail Observability Bukan “Log Exception”

Email adalah side effect asynchronous yang melewati banyak boundary:

```text
Business Action
   ↓
Notification Intent
   ↓
Template Rendering
   ↓
MIME Composition
   ↓
Outbox / Queue
   ↓
Worker
   ↓
Jakarta Mail / SMTP Client
   ↓
SMTP Relay / Provider
   ↓
Recipient MX / Mailbox Provider
   ↓
Inbox / Spam / Bounce / Complaint
```

Log exception hanya menangkap sebagian kecil dari chain tersebut.

Observability harus mencakup minimal empat lapisan:

| Lapisan | Pertanyaan yang harus bisa dijawab |
|---|---|
| Business | Email ini dipicu oleh proses bisnis apa? |
| Application | Request notification mana yang diproses? Template apa? Recipient siapa? |
| Infrastructure | Worker mana? SMTP host mana? Timeout/auth/response apa? |
| Delivery feedback | Accepted, bounced, complained, suppressed, delayed? |

Kalau hanya punya log seperti ini:

```text
Failed to send email: jakarta.mail.MessagingException: Could not connect to SMTP host
```

maka sistem masih miskin observability.

Engineer harus bisa menjawab:

- notification ID berapa?
- triggered by user/action/event apa?
- template version mana?
- attempt ke berapa?
- provider mana?
- SMTP host/port apa?
- timeout berapa?
- failure transient atau permanent?
- recipient mana yang gagal?
- apakah ada partial success?
- apakah akan retry?
- retry berikutnya kapan?
- apakah message sudah pernah accepted sebelumnya?
- apakah bounce sudah diterima?

---

## 3. Observability Vocabulary

Sebelum desain, kita samakan vocabulary.

### 3.1 Logging

Logging adalah event record berbentuk text/structured data.

Contoh:

```json
{
  "event": "mail_send_failed",
  "notification_id": "notif_20260618_000001",
  "attempt": 3,
  "provider": "smtp-relay-primary",
  "smtp_status": "451",
  "failure_class": "TRANSIENT_PROVIDER_FAILURE",
  "next_retry_at": "2026-06-18T12:15:00+07:00"
}
```

Logging berguna untuk menjelaskan **apa yang terjadi**.

### 3.2 Metrics

Metrics adalah angka/time series.

Contoh:

```text
mail_send_attempt_total{provider="primary", result="success"} 10293
mail_send_latency_seconds_bucket{provider="primary", le="0.5"} 9210
mail_outbox_queue_depth{status="PENDING"} 435
mail_oldest_pending_age_seconds 840
```

Metrics berguna untuk menjawab **berapa banyak, seberapa cepat, dan apakah memburuk**.

### 3.3 Tracing

Tracing menghubungkan operasi lintas service/thread/boundary.

Contoh span:

```text
HTTP POST /case/submit
  └── CaseService.submit
      └── NotificationService.enqueueEmail
          └── DB INSERT mail_outbox

MailWorker.poll
  └── MailComposer.renderTemplate
  └── SMTPTransport.sendMessage
```

Tracing berguna untuk menjawab **alur request/event sampai menjadi mail side effect**.

### 3.4 Audit

Audit adalah evidence record yang disimpan untuk menjawab pertanyaan governance/compliance.

Contoh:

```text
Notification notif_123 was generated from CASE_SUBMITTED event case_987,
rendered using template CASE_SUBMISSION_ACK v12,
addressed to recipient category APPLICANT,
submitted to SMTP provider PRIMARY at 2026-06-18T12:00:12+07:00,
and accepted with provider response 250 2.0.0 OK.
```

Audit bukan sekadar log. Audit harus:

- tahan lama;
- queryable;
- punya lifecycle retention;
- redacted sesuai policy;
- immutable atau append-only sejauh mungkin;
- bisa dipakai untuk rekonstruksi kronologi.

---

## 4. Mail Observability Has Two Timelines

Mail subsystem memiliki minimal dua timeline.

### 4.1 Application Timeline

Ini timeline saat aplikasi memutuskan mengirim email.

```text
T0 business event happens
T1 notification request created
T2 template rendered
T3 MIME composed
T4 mail queued
T5 worker picks job
T6 SMTP send attempted
T7 SMTP accepted/rejected
```

### 4.2 Delivery Feedback Timeline

Ini timeline setelah SMTP provider menerima message.

```text
T8 provider tries delivery
T9 recipient server accepts/rejects/defer
T10 message lands inbox/spam/quarantine
T11 bounce/complaint/webhook may arrive
T12 suppression list may be updated
```

Kekeliruan besar:

> Menganggap T7 `SMTP accepted` sama dengan T10 `delivered to inbox`.

Dari sisi Jakarta Mail, successful `Transport.send()` biasanya berarti message berhasil diserahkan ke SMTP server/relay. Itu bukan bukti final bahwa email sudah masuk inbox penerima.

---

## 5. Core Identifiers: Tanpa ID, Observability Hancur

Mail subsystem harus punya ID yang jelas.

### 5.1 Business Entity ID

Contoh:

- `case_id`
- `application_id`
- `appeal_id`
- `invoice_id`
- `user_id`
- `tenant_id`

Ini menjawab: email ini terkait proses bisnis apa?

### 5.2 Notification ID

ID internal untuk notification request.

Contoh:

```text
notification_id = notif_01JY4R8P9PQGMZK5F0F4QG8T6B
```

Ini harus stabil dari awal intent dibuat sampai selesai.

### 5.3 Outbox ID

ID row outbox/queue.

Biasanya sama dengan notification ID atau child dari notification ID.

```text
outbox_id = mail_outbox_01JY4R8XB5M6Y99KHQE1W8BZW5
```

### 5.4 Attempt ID

Setiap retry harus punya attempt ID.

```text
attempt_id = mail_attempt_01JY4R91CQV8WHR3JG6B4RJQW9
attempt_no = 3
```

Ini penting untuk membedakan:

- notification yang sama;
- attempt berbeda;
- failure berbeda;
- worker berbeda.

### 5.5 SMTP Message-ID

Header `Message-ID` pada email.

Contoh:

```text
Message-ID: <notif_01JY4R8P9PQGMZK5F0F4QG8T6B@app.example.com>
```

`Message-ID` berguna untuk tracing di mail provider, mailbox header, dan support investigation.

Namun jangan menjadikan `Message-ID` sebagai satu-satunya identity internal karena:

- bisa digenerate oleh library/provider;
- bisa berubah bila message dibuat ulang;
- tidak selalu mudah ditemukan dari business system;
- tidak selalu sama dengan provider message ID.

### 5.6 Provider Message ID

Beberapa provider mengembalikan ID internal.

Contoh:

```text
provider_message_id = 0100018f0a123abc-12345678-90ab-cdef-1234-567890abcdef-000000
```

Untuk SMTP murni, ID semacam ini belum tentu tersedia secara structured. Kadang hanya ada dalam response text atau provider dashboard.

### 5.7 Correlation ID / Trace ID

Correlation ID menghubungkan HTTP request, async job, log, metric exemplar, dan trace.

Contoh:

```text
trace_id = 6f4d0d2e9e7a4e709c1bb6e2cf38b1e8
correlation_id = req_20260618_abc123
```

Dalam async pipeline, correlation ID harus dipersist di outbox agar worker bisa melanjutkan trace/log context.

---

## 6. Logging Design

### 6.1 Prinsip Structured Logging

Jangan log seperti ini:

```text
Sending email to john@example.com
```

Lebih baik:

```json
{
  "event": "mail_send_started",
  "notification_id": "notif_01JY4R8P9P",
  "attempt_id": "mail_attempt_01JY4R91C",
  "attempt_no": 1,
  "template_code": "CASE_SUBMISSION_ACK",
  "template_version": 12,
  "recipient_count": 1,
  "recipient_domain": "example.com",
  "provider": "primary-smtp",
  "smtp_host": "smtp-relay.internal",
  "smtp_port": 587,
  "tls_mode": "STARTTLS_REQUIRED"
}
```

Structured logging membuat query lebih kuat:

```text
event = mail_send_failed AND failure_class = SMTP_AUTH_FAILED
```

atau:

```text
notification_id = notif_01JY4R8P9P
```

### 6.2 Log Event yang Wajib Ada

Minimal event:

| Event | Kapan |
|---|---|
| `mail_intent_created` | Saat business layer membuat notification intent |
| `mail_outbox_inserted` | Saat request masuk outbox |
| `mail_job_claimed` | Worker mengambil job |
| `mail_render_started` | Template rendering dimulai |
| `mail_render_failed` | Template gagal render |
| `mail_mime_composed` | MIME berhasil dibuat |
| `mail_send_started` | SMTP send dimulai |
| `mail_send_accepted` | SMTP relay menerima message |
| `mail_send_failed` | SMTP/client failure |
| `mail_retry_scheduled` | Retry dijadwalkan |
| `mail_dead_lettered` | Dimasukkan dead letter |
| `mail_bounce_received` | Bounce/webhook diterima |
| `mail_complaint_received` | Complaint diterima |
| `mail_suppressed` | Recipient/domain disuppress |

### 6.3 Field Standar untuk Semua Log Mail

Gunakan field konsisten:

```text
service
environment
trace_id
correlation_id
notification_id
outbox_id
attempt_id
attempt_no
tenant_id
business_event_type
business_entity_type
business_entity_id
template_code
template_version
provider
provider_account
smtp_host
smtp_port
recipient_count
recipient_domain_hash_or_label
result
failure_class
failure_code
latency_ms
queue_age_ms
worker_id
```

Tidak semua event punya semua field, tetapi nama field harus konsisten.

### 6.4 Jangan Log Ini Secara Plaintext

Jangan log:

- full recipient email address tanpa policy;
- subject yang mengandung PII;
- body email;
- attachment content;
- SMTP password;
- OAuth2 access token;
- authorization header;
- full SMTP transcript saat production tanpa redaction;
- template variables mentah;
- national ID/passport/phone/address;
- reset password link;
- magic login link;
- signed document URL.

Untuk debugging, gunakan controlled redaction:

```json
{
  "recipient_sha256": "7f83b1657ff1fc53...",
  "recipient_domain": "example.com",
  "recipient_local_part_redacted": "j***"
}
```

### 6.5 Recipient Logging Strategy

Ada beberapa level:

| Level | Isi | Cocok untuk |
|---|---|---|
| None | Tidak log recipient | Highly sensitive systems |
| Domain only | `example.com` | Deliverability/domain issue |
| Hash only | SHA-256 canonical email | Correlation tanpa reveal PII |
| Masked | `j***@example.com` | Support dengan policy jelas |
| Full | `john@example.com` | Hanya audit store terbatas/terenkripsi |

Top 1% approach: bedakan **operational log** dan **audit store**.

Operational log:

```text
recipient_domain=example.com
recipient_hash=...
```

Audit store:

```text
recipient_encrypted=...
access_control=restricted
retention_policy=defined
```

---

## 7. Jakarta Mail Debug Output: Berguna tapi Berbahaya

Jakarta Mail `Session` memiliki debug setting melalui `setDebug(boolean)` dan debug output stream melalui `setDebugOut(PrintStream)`. Dokumentasi `Session` menjelaskan bahwa `Session` menyimpan properties/defaults untuk Mail API dan menyediakan debug setting.

Contoh:

```java
Properties props = new Properties();
props.put("mail.smtp.host", "smtp.example.com");
props.put("mail.smtp.port", "587");
props.put("mail.smtp.auth", "true");
props.put("mail.smtp.starttls.enable", "true");

Session session = Session.getInstance(props, authenticator);
session.setDebug(true);
```

Masalahnya: debug output bisa berisi detail SMTP conversation.

Contoh transcript konseptual:

```text
DEBUG SMTP: trying to connect to host "smtp.example.com", port 587
220 smtp.example.com ESMTP
EHLO app-host
250-smtp.example.com
250-STARTTLS
STARTTLS
220 Ready to start TLS
AUTH LOGIN
...
MAIL FROM:<no-reply@example.com>
RCPT TO:<user@example.net>
DATA
Subject: Account reset
...
```

Debug ini membantu saat incident, tetapi berisiko membocorkan:

- host internal;
- alamat email;
- subject;
- auth flow;
- header;
- body fragment;
- provider response;
- token/credential jika tidak hati-hati.

### 7.1 Production Rule

Default:

```text
mail debug OFF in production
```

Debug boleh diaktifkan hanya bila:

- scoped ke environment tertentu;
- durasi terbatas;
- output disanitasi;
- akses log terbatas;
- ada incident ticket;
- ada approval bila data sensitif;
- dimatikan setelah investigasi.

### 7.2 Safer Debug Wrapper

Untuk sistem serius, jangan arahkan debug output langsung ke stdout. Gunakan `setDebugOut` ke stream yang melakukan redaction.

Konsep:

```java
public final class RedactingPrintStream extends PrintStream {
    public RedactingPrintStream(OutputStream out) {
        super(out, true, StandardCharsets.UTF_8);
    }

    @Override
    public void println(String x) {
        super.println(redact(x));
    }

    private String redact(String line) {
        if (line == null) return null;
        return line
            .replaceAll("(?i)(AUTH\\s+LOGIN).*", "$1 <redacted>")
            .replaceAll("(?i)(AUTH\\s+XOAUTH2).*", "$1 <redacted>")
            .replaceAll("(?i)(Authorization:).*", "$1 <redacted>")
            .replaceAll("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}", "<email-redacted>");
    }
}
```

Lalu:

```java
Session session = Session.getInstance(props, authenticator);

if (mailDebugEnabled) {
    session.setDebug(true);
    session.setDebugOut(new RedactingPrintStream(System.out));
}
```

Catatan: regex redaction tidak pernah sempurna. Jangan jadikan ini satu-satunya kontrol.

---

## 8. Metrics Design

Metrics menjawab pertanyaan seperti:

- berapa banyak email dikirim per menit?
- berapa banyak gagal?
- failure class apa yang meningkat?
- queue backlog berapa?
- email tertua di queue sudah menunggu berapa lama?
- latency SMTP naik?
- retry storm terjadi?
- provider primary down?
- bounce rate meningkat?

### 8.1 Counter

Counter untuk event yang hanya naik.

Contoh:

```text
mail_intent_created_total
mail_send_attempt_total
mail_send_success_total
mail_send_failure_total
mail_retry_scheduled_total
mail_dead_letter_total
mail_bounce_received_total
mail_complaint_received_total
```

Micrometer mendefinisikan `Counter` sebagai metric yang melaporkan satu count dan increment harus bernilai positif.

### 8.2 Timer

Timer untuk latency dan count event berdurasi.

Contoh:

```text
mail_smtp_send_duration_seconds
mail_template_render_duration_seconds
mail_mime_compose_duration_seconds
mail_worker_job_duration_seconds
```

Micrometer `Timer` memang ditujukan untuk mengukur short-duration latency dan frequency event, serta minimal melaporkan total time dan count.

### 8.3 Gauge

Gauge untuk nilai naik-turun.

Contoh:

```text
mail_outbox_pending_count
mail_outbox_processing_count
mail_outbox_dead_letter_count
mail_oldest_pending_age_seconds
mail_worker_active_count
mail_worker_queue_capacity_remaining
```

### 8.4 Distribution Summary

Untuk ukuran payload:

```text
mail_message_size_bytes
mail_attachment_count
mail_attachment_total_size_bytes
mail_recipient_count
```

### 8.5 Metric Tags

Tags membuat metric queryable, tetapi jangan overdo.

Tag yang berguna:

```text
environment
provider
channel=email
template_code
failure_class
status
smtp_status_class
recipient_domain_group
```

Tag yang berbahaya:

```text
recipient_email
notification_id
message_id
subject
business_entity_id
```

Kenapa? Karena high-cardinality tags bisa menghancurkan metrics backend.

### 8.6 Cardinality Rule

Prinsip:

```text
Use logs for high-cardinality identity.
Use metrics for low-cardinality aggregation.
Use traces for request/operation linkage.
Use audit for durable evidence.
```

Jangan tag metric dengan `notification_id`.

Buruk:

```text
mail_send_success_total{notification_id="notif_123"} 1
```

Baik:

```text
mail_send_success_total{provider="primary", template_code="CASE_ACK"} 1
```

### 8.7 Example Micrometer Instrumentation

```java
public final class MailMetrics {
    private final MeterRegistry registry;

    public MailMetrics(MeterRegistry registry) {
        this.registry = registry;
    }

    public Timer.Sample startTimer() {
        return Timer.start(registry);
    }

    public void recordSendSuccess(
            Timer.Sample sample,
            String provider,
            String templateCode,
            int smtpStatusCode
    ) {
        sample.stop(Timer.builder("mail.smtp.send.duration")
                .tag("provider", provider)
                .tag("template", templateCode)
                .tag("result", "success")
                .tag("smtp_status_class", statusClass(smtpStatusCode))
                .register(registry));

        Counter.builder("mail.send.attempt")
                .tag("provider", provider)
                .tag("template", templateCode)
                .tag("result", "success")
                .register(registry)
                .increment();
    }

    public void recordSendFailure(
            Timer.Sample sample,
            String provider,
            String templateCode,
            MailFailureClass failureClass,
            Integer smtpStatusCode
    ) {
        sample.stop(Timer.builder("mail.smtp.send.duration")
                .tag("provider", provider)
                .tag("template", templateCode)
                .tag("result", "failure")
                .tag("failure_class", failureClass.name())
                .tag("smtp_status_class", smtpStatusCode == null ? "none" : statusClass(smtpStatusCode))
                .register(registry));

        Counter.builder("mail.send.attempt")
                .tag("provider", provider)
                .tag("template", templateCode)
                .tag("result", "failure")
                .tag("failure_class", failureClass.name())
                .register(registry)
                .increment();
    }

    private String statusClass(int statusCode) {
        if (statusCode >= 200 && statusCode < 300) return "2xx";
        if (statusCode >= 400 && statusCode < 500) return "4xx";
        if (statusCode >= 500 && statusCode < 600) return "5xx";
        return "other";
    }
}
```

### 8.8 Queue Metrics

Untuk outbox/queue, metrics paling penting:

```text
mail_outbox_pending_count
mail_outbox_processing_count
mail_outbox_retryable_failed_count
mail_outbox_dead_letter_count
mail_outbox_oldest_pending_age_seconds
mail_outbox_claim_rate_per_minute
mail_outbox_send_success_rate_per_minute
mail_outbox_retry_rate_per_minute
```

Jika hanya boleh punya satu alert queue, pilih:

```text
oldest pending age
```

Kenapa?

Queue depth 10.000 bisa normal saat batch. Tetapi jika oldest pending age sudah 2 jam untuk transactional email, itu buruk.

### 8.9 SMTP Metrics

```text
mail_smtp_connect_duration_seconds
mail_smtp_tls_handshake_failure_total
mail_smtp_auth_failure_total
mail_smtp_send_duration_seconds
mail_smtp_timeout_total
mail_smtp_response_total{code="421"}
mail_smtp_partial_failure_total
```

### 8.10 Deliverability Metrics

```text
mail_bounce_total{type="hard"}
mail_bounce_total{type="soft"}
mail_complaint_total
mail_suppression_total
mail_delivery_feedback_delay_seconds
mail_provider_webhook_failure_total
```

Bounce/complaint metrics biasanya berasal dari webhook/provider event, bukan dari Jakarta Mail langsung.

---

## 9. Tracing Design

### 9.1 Kenapa Tracing Mail Sulit?

Mail sending sering asynchronous.

HTTP request selesai di T1, email dikirim worker di T2.

Kalau trace context tidak dipersist, chain terputus:

```text
HTTP request trace A
  └── insert outbox

Mail worker trace B
  └── send email
```

Keduanya tidak terlihat terhubung.

### 9.2 Persist Trace Context

Saat insert outbox, simpan:

```text
traceparent
tracestate
correlation_id
causation_id
```

Contoh kolom:

```sql
ALTER TABLE mail_outbox ADD (
    trace_id VARCHAR2(64),
    span_id VARCHAR2(32),
    traceparent VARCHAR2(256),
    correlation_id VARCHAR2(128),
    causation_id VARCHAR2(128)
);
```

Saat worker memproses outbox, restore context dan buat child/linked span.

### 9.3 Span yang Disarankan

```text
NotificationService.enqueueEmail
MailOutboxRepository.insert
MailWorker.claimJob
MailTemplateRenderer.render
MailMimeComposer.compose
MailGateway.send
SMTPTransport.connect
SMTPTransport.sendMessage
MailOutboxRepository.markSent
```

Tidak semua harus manual span. Pilih operation penting.

### 9.4 Span Attributes

Gunakan low-cardinality attributes untuk span:

```text
mail.provider = primary
mail.template_code = CASE_ACK
mail.attempt_no = 2
mail.recipient_count = 1
mail.smtp.host = smtp-relay.internal
mail.smtp.port = 587
mail.result = success
mail.failure_class = TRANSIENT_PROVIDER_FAILURE
```

High-cardinality seperti `notification_id` boleh di span attribute dalam beberapa tracing backend, tetapi harus hati-hati. Alternatifnya taruh sebagai event/log linked to trace.

### 9.5 Messaging Semantics

Jika mail outbox diproses via queue/broker, gunakan semantic conventions messaging untuk producer/consumer span. OpenTelemetry semantic conventions mendefinisikan conventions untuk messaging spans, metrics, dan logs.

Untuk SMTP sendiri, tidak selalu ada semantic convention khusus yang universal. Jadi gunakan span custom dengan nama jelas:

```text
SMTP SEND
```

atau:

```text
MailGateway.send smtp
```

### 9.6 Trace Event untuk SMTP Response

Tambahkan event:

```java
span.addEvent("smtp.accepted", Attributes.of(
    stringKey("smtp.response.code"), "250",
    stringKey("smtp.response.class"), "2xx"
));
```

Untuk failure:

```java
span.recordException(exception);
span.setStatus(StatusCode.ERROR);
span.setAttribute("mail.failure_class", failureClass.name());
span.setAttribute("mail.retryable", failureClass.isRetryable());
```

---

## 10. Audit Design

### 10.1 Audit Bukan Log

Log biasanya untuk operasi/debug.

Audit untuk evidence.

Bedanya:

| Aspek | Log | Audit |
|---|---|---|
| Tujuan | Debug/operation | Evidence/governance |
| Retention | Lebih pendek | Lebih panjang |
| Format | Banyak event teknis | Event domain penting |
| Mutability | Bisa rotate/drop | Append-only/semi-immutable |
| Access | Engineer/SRE | Restricted + auditable |
| PII | Sebisa mungkin redacted | Bisa encrypted dengan policy |

### 10.2 Audit Event Mail Minimal

```text
MAIL_INTENT_CREATED
MAIL_RENDERED
MAIL_SEND_ATTEMPTED
MAIL_ACCEPTED_BY_PROVIDER
MAIL_REJECTED_BY_PROVIDER
MAIL_RETRY_SCHEDULED
MAIL_DEAD_LETTERED
MAIL_BOUNCED
MAIL_COMPLAINT_RECEIVED
MAIL_SUPPRESSED
MAIL_CANCELLED
```

### 10.3 Audit Record Schema

Contoh:

```sql
CREATE TABLE mail_audit_event (
    id                 VARCHAR2(64) PRIMARY KEY,
    notification_id    VARCHAR2(64) NOT NULL,
    event_type         VARCHAR2(64) NOT NULL,
    event_time         TIMESTAMP WITH TIME ZONE NOT NULL,

    tenant_id          VARCHAR2(64),
    business_type      VARCHAR2(64),
    business_id        VARCHAR2(128),
    actor_type         VARCHAR2(32),
    actor_id           VARCHAR2(128),

    template_code      VARCHAR2(128),
    template_version   NUMBER,
    recipient_category VARCHAR2(64),
    recipient_hash     VARCHAR2(128),
    recipient_domain   VARCHAR2(255),

    provider           VARCHAR2(128),
    provider_message_id VARCHAR2(255),
    smtp_status_code   NUMBER,
    failure_class      VARCHAR2(128),

    metadata_json      CLOB,
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT SYSTIMESTAMP NOT NULL
);
```

### 10.4 Apa yang Sebaiknya Diaudit?

Audit should capture intent and outcome, not raw email content by default.

Recommended:

```text
notification_id
template_code
template_version
recipient category
recipient hash/domain
business entity id
actor/system trigger
send state
provider
SMTP status class/code
failure class
attempt no
timestamp
```

Careful with:

```text
subject
rendered body
full recipient
attachments
```

Untuk regulatory systems, mungkin perlu menyimpan rendered email atau attachment snapshot. Jika iya:

- encrypt at rest;
- separate table/storage;
- access control ketat;
- retention jelas;
- redaction strategy;
- immutable checksum;
- legal basis jelas.

### 10.5 Template Versioning dan Audit

Jika audit hanya menyimpan `template_code`, itu tidak cukup.

Kenapa?

Template berubah dari waktu ke waktu.

Pada 2026, template `CASE_ACK` v15 bisa berbeda dari v7 yang dikirim pada 2025.

Audit harus menyimpan:

```text
template_code
template_version
template_hash
rendered_subject_hash
rendered_body_hash
```

Opsional:

```text
rendered_subject_encrypted
rendered_body_encrypted
```

### 10.6 Evidence Level

Buat level evidence:

| Level | Evidence | Arti |
|---|---|---|
| L0 | Intent created | Sistem berniat mengirim |
| L1 | Queued | Intent tersimpan durable |
| L2 | SMTP attempt | Sistem mencoba mengirim |
| L3 | SMTP accepted | Relay/provider menerima |
| L4 | Provider delivered | Provider melaporkan delivered |
| L5 | User opened/clicked | Tracking event; tidak selalu reliable |
| L6 | User acknowledged | Explicit user action |

Untuk compliance, jangan klaim L5/L6 jika hanya punya L3.

---

## 11. Mail State Machine for Observability

State machine membantu logs, metrics, audit, dan UI konsisten.

```text
DRAFTED / REQUESTED
    ↓
QUEUED
    ↓
PROCESSING
    ↓
SMTP_ACCEPTED ───────┐
    ↓                 │
DELIVERY_PENDING      │
    ↓                 │
DELIVERED             │
                      │
PROCESSING            │
    ↓                 │
FAILED_RETRYABLE ─────┘
    ↓
QUEUED

PROCESSING
    ↓
FAILED_PERMANENT
    ↓
DEAD_LETTER

SMTP_ACCEPTED
    ↓
BOUNCED

SMTP_ACCEPTED
    ↓
COMPLAINED

QUEUED
    ↓
CANCELLED
```

Jangan hanya punya boolean `sent`.

Boolean `sent=true` tidak bisa membedakan:

- accepted by SMTP;
- delivered to inbox;
- bounced after accepted;
- partially delivered;
- suppressed;
- duplicate send.

### 11.1 State Transition Log

Setiap transisi penting harus terekam:

```json
{
  "event": "mail_state_changed",
  "notification_id": "notif_123",
  "from_state": "PROCESSING",
  "to_state": "SMTP_ACCEPTED",
  "attempt_no": 1,
  "reason": "smtp_250",
  "provider": "primary"
}
```

### 11.2 Invalid Transition Detection

Observability juga mencakup deteksi anomali.

Contoh invalid:

```text
DEAD_LETTER -> SMTP_ACCEPTED
DELIVERED -> QUEUED
CANCELLED -> PROCESSING
```

Metric:

```text
mail_invalid_state_transition_total
```

---

## 12. Failure Classification for Observability

Jangan jadikan exception class sebagai dashboard utama.

Buruk:

```text
jakarta.mail.MessagingException = 123
java.net.SocketTimeoutException = 45
org.eclipse.angus.mail.smtp.SMTPAddressFailedException = 12
```

Lebih baik:

```text
SMTP_CONNECT_TIMEOUT = 45
SMTP_AUTH_FAILED = 20
SMTP_RECIPIENT_REJECTED = 12
SMTP_PROVIDER_RATE_LIMIT = 30
SMTP_CONTENT_REJECTED = 8
TEMPLATE_RENDER_FAILED = 4
ATTACHMENT_LOAD_FAILED = 2
```

### 12.1 Failure Class Standard

```java
public enum MailFailureClass {
    TEMPLATE_RENDER_FAILED,
    MIME_COMPOSITION_FAILED,
    ATTACHMENT_LOAD_FAILED,

    SMTP_CONNECT_FAILED,
    SMTP_CONNECT_TIMEOUT,
    SMTP_WRITE_TIMEOUT,
    SMTP_READ_TIMEOUT,
    SMTP_TLS_FAILED,
    SMTP_AUTH_FAILED,

    SMTP_RECIPIENT_REJECTED,
    SMTP_SENDER_REJECTED,
    SMTP_CONTENT_REJECTED,
    SMTP_PROVIDER_RATE_LIMIT,
    SMTP_PROVIDER_TEMPORARY_FAILURE,
    SMTP_PROVIDER_PERMANENT_FAILURE,
    SMTP_PARTIAL_FAILURE,

    PROVIDER_API_FAILED,
    PROVIDER_WEBHOOK_INVALID,

    UNKNOWN_RETRYABLE,
    UNKNOWN_PERMANENT
}
```

### 12.2 Observability Field

Log/metric/audit harus memakai failure class ini.

```json
{
  "event": "mail_send_failed",
  "failure_class": "SMTP_PROVIDER_RATE_LIMIT",
  "smtp_status_code": 451,
  "retryable": true,
  "next_retry_at": "2026-06-18T12:30:00+07:00"
}
```

---

## 13. Alerting Strategy

Alert harus actionable.

Buruk:

```text
mail_send_failure_total > 0
```

Kenapa buruk? Email bisa gagal karena invalid recipient, dan itu normal.

Lebih baik:

```text
SMTP_AUTH_FAILED > 0 for 5 minutes
```

Karena auth failure biasanya global dan butuh tindakan cepat.

### 13.1 Alert Kritis

| Alert | Kenapa penting |
|---|---|
| SMTP auth failure spike | Credential expired/rotated salah |
| Queue oldest pending age too high | Transactional email terlambat |
| Dead letter spike | Banyak message tidak bisa diproses |
| Provider timeout/error spike | Provider/network issue |
| Retry rate abnormal | Retry storm |
| Bounce hard rate abnormal | Deliverability/list quality issue |
| Complaint rate abnormal | Reputation/compliance risk |
| Webhook processing failure | Feedback loop rusak |
| Invalid state transition | Bug state machine/concurrency |

### 13.2 Alert Threshold Example

Transactional email:

```text
mail_outbox_oldest_pending_age_seconds > 300 for 10 minutes
```

Critical system email:

```text
mail_outbox_oldest_pending_age_seconds > 60 for 5 minutes
template_code in [OTP, PASSWORD_RESET, CASE_SUBMISSION_ACK]
```

Auth failure:

```text
rate(mail_send_attempt_total{failure_class="SMTP_AUTH_FAILED"}[5m]) > 0
```

Timeout spike:

```text
rate(mail_send_attempt_total{failure_class=~"SMTP_.*TIMEOUT"}[10m])
/
rate(mail_send_attempt_total[10m]) > 0.10
```

Dead letter:

```text
increase(mail_dead_letter_total[15m]) > 10
```

### 13.3 Alert Severity

| Severity | Example |
|---|---|
| P1 | All transactional emails failing globally |
| P2 | Queue delay > SLA for critical templates |
| P3 | Bounce rate elevated for one domain |
| P4 | Non-critical template render failure for small subset |

---

## 14. Dashboard Design

### 14.1 Executive/Operational Dashboard

Panel:

```text
Email send success rate
Email send failure rate by class
Queue depth by status
Oldest pending age
Dead letter count
SMTP latency p50/p95/p99
Bounce rate
Complaint rate
Top failing templates
Top failing providers
```

### 14.2 Engineering Debug Dashboard

Panel:

```text
Send attempt by worker
Failure class by provider
SMTP response codes
Timeout distribution
Template render latency
MIME compose latency
Attachment size distribution
Retry attempts histogram
Invalid state transitions
Webhook processing failures
```

### 14.3 Deliverability Dashboard

Panel:

```text
Hard bounce rate by domain/provider
Soft bounce rate by domain/provider
Complaint rate
Suppression list growth
Delivery feedback delay
Provider accepted vs delivered vs bounced
Domain-level failure anomaly
```

### 14.4 Audit/Support Search Dashboard

Search by:

```text
notification_id
business_entity_id
recipient hash/full recipient depending permission
template_code
provider_message_id
Message-ID
trace_id
```

Show timeline:

```text
12:00:01 intent created
12:00:02 queued
12:00:05 worker claimed
12:00:05 rendered template CASE_ACK v12
12:00:06 SMTP send attempt #1
12:00:07 SMTP accepted 250 OK
12:04:22 provider webhook delivered
```

---

## 15. Support Investigation Playbook

User says:

> “Saya tidak menerima email.”

Jangan langsung resend. Ikuti flow.

### 15.1 Step 1 — Find Notification

Search by:

```text
business entity ID
user ID
recipient hash/email
template code
time range
```

### 15.2 Step 2 — Check Application State

Pertanyaan:

- Apakah intent dibuat?
- Apakah queued?
- Apakah worker memproses?
- Apakah SMTP accepted?
- Apakah failure?
- Apakah retry pending?
- Apakah dead letter?

### 15.3 Step 3 — Check Provider State

Pertanyaan:

- Provider message ID ada?
- Status delivered/bounced/deferred?
- Masuk suppression list?
- Ada complaint?
- Ada policy rejection?

### 15.4 Step 4 — Check Recipient Context

Pertanyaan:

- Recipient address benar?
- Domain punya issue?
- Email masuk spam/quarantine?
- Mailbox full?
- Rule/filter user memindahkan email?

### 15.5 Step 5 — Decide Action

Action:

| Kondisi | Action |
|---|---|
| Intent tidak dibuat | Investigasi business trigger |
| Queued tapi stuck | Investigasi worker/queue |
| Retry pending | Tunggu atau manual retry sesuai SOP |
| Permanent failure | Fix data/recipient/provider issue |
| SMTP accepted tapi no delivery feedback | Check provider dashboard/log |
| Bounced hard | Jangan resend sampai address diperbaiki |
| Suppressed | Review suppression reason |
| Delivered but user tidak lihat | Minta check spam/quarantine/rules |

---

## 16. Observability in Code: Reference Design

### 16.1 Domain Event

```java
public final class MailNotification {
    private final String notificationId;
    private final String businessType;
    private final String businessId;
    private final String templateCode;
    private final int templateVersion;
    private final List<MailRecipient> recipients;
    private final String correlationId;
    private final String traceparent;

    // constructor/getters omitted
}
```

### 16.2 Logging Context

```java
public final class MailLogContext {
    private final String notificationId;
    private final String attemptId;
    private final int attemptNo;
    private final String templateCode;
    private final int templateVersion;
    private final String provider;
    private final String correlationId;

    public Map<String, Object> asFields() {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("notification_id", notificationId);
        fields.put("attempt_id", attemptId);
        fields.put("attempt_no", attemptNo);
        fields.put("template_code", templateCode);
        fields.put("template_version", templateVersion);
        fields.put("provider", provider);
        fields.put("correlation_id", correlationId);
        return fields;
    }
}
```

### 16.3 Send Flow with Metrics and Audit

```java
public final class ObservableMailSender {
    private final MailGateway gateway;
    private final MailMetrics metrics;
    private final MailAuditService audit;
    private final MailFailureClassifier classifier;
    private final Logger log = LoggerFactory.getLogger(getClass());

    public SendOutcome send(MailOutboxJob job) {
        Timer.Sample sample = metrics.startTimer();
        MailLogContext ctx = MailLogContext.from(job);

        log.info("mail_send_started {}", ctx.asFields());
        audit.recordSendAttempted(job);

        try {
            SendOutcome outcome = gateway.send(job.toMailRequest());

            metrics.recordSendSuccess(
                    sample,
                    job.provider(),
                    job.templateCode(),
                    outcome.smtpStatusCodeOrDefault(250)
            );

            log.info("mail_send_accepted notification_id={} attempt_id={} smtp_status_code={} provider_message_id={}",
                    job.notificationId(),
                    job.attemptId(),
                    outcome.smtpStatusCodeOrDefault(250),
                    outcome.providerMessageIdOrNull());

            audit.recordAccepted(job, outcome);
            return outcome;
        } catch (Exception ex) {
            ClassifiedMailFailure failure = classifier.classify(ex);

            metrics.recordSendFailure(
                    sample,
                    job.provider(),
                    job.templateCode(),
                    failure.failureClass(),
                    failure.smtpStatusCodeOrNull()
            );

            log.warn("mail_send_failed notification_id={} attempt_id={} failure_class={} retryable={} smtp_status_code={} message={}",
                    job.notificationId(),
                    job.attemptId(),
                    failure.failureClass(),
                    failure.retryable(),
                    failure.smtpStatusCodeOrNull(),
                    safeMessage(ex));

            audit.recordFailed(job, failure);
            throw failure.toException();
        }
    }

    private String safeMessage(Exception ex) {
        String message = ex.getMessage();
        if (message == null) return "";
        return message.replaceAll("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}", "<email-redacted>");
    }
}
```

### 16.4 Better Logging with Key-Value API

Jika logging framework mendukung structured logging/key-value:

```java
log.atInfo()
   .addKeyValue("event", "mail_send_started")
   .addKeyValue("notification_id", job.notificationId())
   .addKeyValue("attempt_id", job.attemptId())
   .addKeyValue("template_code", job.templateCode())
   .addKeyValue("provider", job.provider())
   .log("Mail send started");
```

Ini lebih bersih daripada string concatenation.

---

## 17. Observability for Partial Success

SMTP bisa mengalami partial success:

- recipient A accepted;
- recipient B rejected;
- recipient C not attempted.

`SendFailedException` dapat membawa invalid, valid sent, dan valid unsent addresses.

Observability harus menangkap ini.

### 17.1 Log Partial Failure

```json
{
  "event": "mail_send_partial_failure",
  "notification_id": "notif_123",
  "attempt_id": "attempt_456",
  "valid_sent_count": 1,
  "valid_unsent_count": 1,
  "invalid_count": 1,
  "failure_class": "SMTP_PARTIAL_FAILURE"
}
```

### 17.2 Metrics

```text
mail_smtp_partial_failure_total{provider="primary"}
mail_recipient_rejected_total{provider="primary", smtp_status_class="5xx"}
```

### 17.3 Audit

Audit harus menyimpan recipient-level outcome bila email multi-recipient.

Lebih baik untuk transactional email:

```text
one notification recipient = one message
```

Ini membuat observability jauh lebih bersih.

---

## 18. Observability for Attachments

Attachment sering menyebabkan masalah:

- file tidak ditemukan;
- permission denied;
- file terlalu besar;
- MIME type salah;
- filename rusak;
- memory tinggi;
- antivirus quarantine;
- provider reject karena size limit.

### 18.1 Log Metadata, Bukan Content

```json
{
  "event": "mail_attachment_added",
  "notification_id": "notif_123",
  "attachment_count": 2,
  "attachment_total_size_bytes": 845912,
  "attachment_types": ["application/pdf", "image/png"]
}
```

Jangan log:

```text
file content
full path sensitif
signed URL
raw document id kalau sensitif
```

### 18.2 Metrics

```text
mail_attachment_total_size_bytes
mail_attachment_count
mail_attachment_load_failure_total
mail_message_size_bytes
```

### 18.3 Audit

Untuk audit:

```text
attachment logical type
attachment document id/hash
attachment checksum
attachment size
attachment policy decision
```

Contoh:

```json
{
  "attachment_ref": "document_789",
  "attachment_sha256": "...",
  "mime_type": "application/pdf",
  "size_bytes": 392102,
  "included_in_email": true
}
```

---

## 19. Observability for Template Rendering

Template failure sering muncul sebagai email send failure, padahal SMTP belum disentuh.

### 19.1 Template Metrics

```text
mail_template_render_total{template="CASE_ACK", result="success"}
mail_template_render_total{template="CASE_ACK", result="failure"}
mail_template_render_duration_seconds{template="CASE_ACK"}
```

### 19.2 Template Logs

```json
{
  "event": "mail_template_render_failed",
  "notification_id": "notif_123",
  "template_code": "CASE_ACK",
  "template_version": 12,
  "missing_variables": ["applicantName", "caseNumber"],
  "failure_class": "TEMPLATE_RENDER_FAILED"
}
```

Jangan log full `templateData` karena bisa berisi PII.

### 19.3 Template Audit

Audit:

```text
template_code
template_version
template_hash
variable_schema_version
render_result
```

---

## 20. Observability for Inbound Mail

Inbound pipeline juga butuh observability.

Metrics:

```text
mail_inbound_poll_total
mail_inbound_messages_seen_total
mail_inbound_messages_processed_total
mail_inbound_messages_failed_total
mail_inbound_duplicate_detected_total
mail_inbound_attachment_quarantined_total
mail_inbound_oldest_unprocessed_age_seconds
```

Logs:

```json
{
  "event": "inbound_mail_processed",
  "mailbox": "appeals-inbox",
  "folder": "INBOX",
  "message_uid": "123456",
  "message_id_hash": "...",
  "attachment_count": 3,
  "processing_result": "accepted"
}
```

Audit:

```text
mailbox
message received time
message id hash
sender hash/domain
business case matched
attachments accepted/rejected
processing decision
```

Security: external inbound email is untrusted input.

---

## 21. Redaction and Data Classification

### 21.1 Data Classes

Klasifikasikan field:

| Class | Example | Log Policy |
|---|---|---|
| Public | template code | OK |
| Internal | provider name, worker id | OK restricted |
| Confidential | recipient email, subject | Mask/hash |
| Restricted | body, attachment, token | Do not log |
| Secret | SMTP password, OAuth token | Never log |

### 21.2 Redaction Utility

```java
public final class MailRedactor {
    private static final Pattern EMAIL = Pattern.compile(
            "[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}"
    );

    private MailRedactor() {}

    public static String redact(String value) {
        if (value == null) return null;
        return EMAIL.matcher(value).replaceAll("<email-redacted>");
    }

    public static String emailHash(String email, byte[] salt) {
        String canonical = canonicalizeEmail(email);
        return sha256Hex(salt, canonical);
    }

    private static String canonicalizeEmail(String email) {
        return email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
    }

    private static String sha256Hex(byte[] salt, String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update(salt);
            byte[] hash = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(hash.length * 2);
            for (byte b : hash) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
```

Salt penting agar hash tidak mudah dicocokkan via dictionary.

---

## 22. Event Schema: Satu Bahasa untuk Semua Layer

Buat event schema standar.

### 22.1 Mail Operational Event

```json
{
  "event_type": "mail_send_failed",
  "event_time": "2026-06-18T12:00:00+07:00",
  "environment": "prod",
  "service": "notification-service",
  "trace_id": "...",
  "correlation_id": "...",

  "notification_id": "notif_123",
  "outbox_id": "outbox_123",
  "attempt_id": "attempt_123",
  "attempt_no": 2,

  "business_type": "CASE",
  "business_id": "case_789",
  "template_code": "CASE_ACK",
  "template_version": 12,

  "provider": "primary-smtp",
  "smtp_host": "smtp-relay.internal",
  "smtp_port": 587,
  "smtp_status_code": 451,
  "smtp_status_class": "4xx",

  "recipient_count": 1,
  "recipient_domain": "example.com",
  "recipient_hash": "...",

  "result": "failure",
  "failure_class": "SMTP_PROVIDER_TEMPORARY_FAILURE",
  "retryable": true,
  "next_retry_at": "2026-06-18T12:05:00+07:00",
  "latency_ms": 823
}
```

### 22.2 Naming Rule

Gunakan snake_case untuk field log/event.

Gunakan enum stabil untuk:

```text
event_type
failure_class
result
state
provider
template_code
```

---

## 23. Retention Strategy

Tidak semua telemetry disimpan selamanya.

| Data | Retention contoh |
|---|---|
| Debug SMTP transcript | Jam/hari, incident-only |
| Operational logs | 14–90 hari |
| Metrics | 30–395 hari tergantung resolusi |
| Traces | 7–30 hari |
| Audit events | Sesuai compliance, bisa tahun |
| Rendered email body | Hindari; jika perlu, retention ketat |
| Attachment snapshot | Hindari; jika perlu, storage policy ketat |

High-risk anti-pattern:

```text
Keep full email body and attachments forever in logs.
```

---

## 24. Sampling Strategy

Trace sampling bisa menyebabkan trace email hilang.

Untuk mail subsystem, gunakan rules:

- always sample failures;
- always sample dead letter;
- sample slow sends;
- sample critical templates;
- lower sample normal high-volume bulk.

Contoh policy:

```text
sample 100% if result=failure
sample 100% if template in [OTP, PASSWORD_RESET]
sample 100% if duration > 5s
sample 10% otherwise
```

Logs untuk audit event jangan disampling jika menjadi evidence. Lebih baik audit disimpan di DB/event store.

---

## 25. Multi-Tenant Observability

Jika sistem multi-tenant:

- tenant A tidak boleh melihat telemetry tenant B;
- provider account bisa berbeda per tenant;
- sender domain berbeda;
- quota/rate limit berbeda;
- failure impact harus bisa di-slice per tenant.

Metrics tag `tenant_id` bisa high-cardinality jika tenant banyak. Gunakan:

```text
tenant_tier
tenant_region
provider_account
```

Untuk tenant-specific debugging, gunakan log/audit search, bukan metrics tag global.

---

## 26. Common Anti-Patterns

### 26.1 Boolean `sent`

```sql
sent NUMBER(1)
```

Tidak cukup.

Ganti dengan:

```text
state
attempt_count
last_failure_class
last_smtp_status_code
provider_message_id
next_retry_at
accepted_at
bounced_at
complained_at
```

### 26.2 Logging Full Email Body

Berbahaya untuk PII, secrets, legal exposure.

### 26.3 No Attempt ID

Tanpa attempt ID, retry tidak bisa dianalisis.

### 26.4 Metrics with Recipient Email Tag

High-cardinality + PII leak.

### 26.5 Debug SMTP Always On

Membocorkan data dan memperbesar log volume.

### 26.6 Treating SMTP Accepted as Delivered

Menyebabkan support/compliance statement salah.

### 26.7 No Queue Age Alert

Queue bisa stuck diam-diam.

### 26.8 No Bounce Feedback

Alamat invalid terus dikirimi email, reputation turun.

### 26.9 No Template Version in Audit

Tidak bisa membuktikan isi email historis.

### 26.10 No Provider Dimension

Saat failover/multi-provider, tidak tahu provider mana bermasalah.

---

## 27. Production Checklist

### 27.1 Logging Checklist

- [ ] Semua mail event punya `notification_id`.
- [ ] Semua attempt punya `attempt_id`.
- [ ] Semua log punya `correlation_id` atau `trace_id` bila tersedia.
- [ ] Recipient tidak dilog plaintext di operational log.
- [ ] SMTP debug default off.
- [ ] Debug output bisa diredact.
- [ ] Failure class dinormalisasi.
- [ ] Partial success dilog explicit.
- [ ] State transition dilog.

### 27.2 Metrics Checklist

- [ ] Send attempt counter.
- [ ] Send success/failure counter.
- [ ] Failure by class.
- [ ] SMTP latency timer.
- [ ] Template render latency.
- [ ] Queue depth.
- [ ] Oldest pending age.
- [ ] Retry count/rate.
- [ ] Dead letter count.
- [ ] Bounce/complaint metrics.
- [ ] Webhook processing failure metrics.
- [ ] No high-cardinality tags.

### 27.3 Tracing Checklist

- [ ] Trace context persisted in outbox.
- [ ] Worker restores/links trace context.
- [ ] Spans for render/compose/send.
- [ ] Exception recorded to span.
- [ ] Failure class as span attribute.
- [ ] Sampling keeps failures.

### 27.4 Audit Checklist

- [ ] Intent creation audited.
- [ ] Send attempt audited.
- [ ] SMTP accepted/rejected audited.
- [ ] Bounce/complaint audited.
- [ ] Template version/hash stored.
- [ ] Recipient stored as hash/encrypted according to policy.
- [ ] Audit access restricted.
- [ ] Retention policy defined.
- [ ] Audit schema can reconstruct timeline.

### 27.5 Alert Checklist

- [ ] Auth failure alert.
- [ ] Queue age alert.
- [ ] Dead letter spike alert.
- [ ] Timeout/error spike alert.
- [ ] Retry storm alert.
- [ ] Bounce/complaint anomaly alert.
- [ ] Webhook failure alert.
- [ ] Invalid state transition alert.

---

## 28. End-to-End Example Timeline

Business event:

```text
Case submitted: CASE-2026-000123
```

Mail audit timeline:

```text
12:00:01 MAIL_INTENT_CREATED
         notification_id=notif_123
         business_type=CASE
         business_id=CASE-2026-000123
         template=CASE_SUBMISSION_ACK v12

12:00:01 MAIL_QUEUED
         outbox_id=outbox_123
         state=QUEUED

12:00:05 MAIL_SEND_ATTEMPTED
         attempt_id=attempt_1
         provider=primary-smtp

12:00:06 MAIL_ACCEPTED_BY_PROVIDER
         smtp_status_code=250
         provider_message_id=provider_abc
         state=SMTP_ACCEPTED

12:02:40 MAIL_DELIVERED
         provider_event_id=webhook_999
         state=DELIVERED
```

If failure:

```text
12:00:05 MAIL_SEND_ATTEMPTED
12:00:20 MAIL_SEND_FAILED
         failure_class=SMTP_CONNECT_TIMEOUT
         retryable=true

12:00:20 MAIL_RETRY_SCHEDULED
         next_retry_at=12:05:20

12:05:20 MAIL_SEND_ATTEMPTED
12:05:21 MAIL_ACCEPTED_BY_PROVIDER
```

This is the kind of timeline support, engineer, and auditor can understand.

---

## 29. Java 8–25 Notes

### 29.1 Java 8

Common stack:

```text
javax.mail
javax.activation
legacy app server or standalone app
logback/log4j/slf4j
```

Concerns:

- Java EE modules might exist depending runtime/distribution;
- older dependency naming;
- less built-in modern observability;
- no virtual threads;
- use executor carefully.

### 29.2 Java 11–17

Common stack:

```text
jakarta.mail or javax.mail depending app generation
explicit activation dependency
Spring Boot 2/3 differences
Micrometer common in Spring ecosystem
OpenTelemetry agent/manual instrumentation
```

Concerns:

- Java EE APIs removed from JDK after Java 8 era;
- dependencies must be explicit;
- avoid mixing `javax` and `jakarta`.

### 29.3 Java 21–25

Common stack:

```text
jakarta.mail
Eclipse Angus Mail
Micrometer/OpenTelemetry
virtual threads possible for blocking SMTP workers
structured concurrency possible in app-level designs
```

Virtual threads can help with blocking SMTP operations, but they do not remove the need for:

- timeout;
- rate limit;
- backpressure;
- retry control;
- metrics;
- queue age alert;
- provider quota.

---

## 30. Top 1% Mental Model

A strong engineer does not say:

> “We sent the email because `Transport.send()` returned success.”

A strong engineer says:

> “The application created notification intent `notif_123`, rendered `CASE_ACK` template version 12, submitted SMTP attempt 1 to provider primary, received SMTP 250 accepted at 12:00:06, then provider webhook reported delivered at 12:02:40. Recipient is tracked by hash in operational logs and encrypted in audit storage. No bounce or complaint has been received.”

That difference is the difference between coding and operating a production-grade system.

Observability turns mail from a black-box side effect into a traceable, measurable, auditable subsystem.

---

## 31. Summary

Pada part ini kita mempelajari:

1. Mail observability bukan hanya logging exception.
2. Email memiliki dua timeline: application timeline dan delivery feedback timeline.
3. ID penting: notification ID, outbox ID, attempt ID, Message-ID, provider message ID, correlation ID.
4. Logs harus structured, consistent, dan redacted.
5. Jakarta Mail debug output berguna tetapi berisiko.
6. Metrics harus mencakup send attempt, failure class, latency, queue depth, queue age, retry, dead letter, bounce, complaint.
7. Tracing harus mempertahankan trace context melewati async boundary.
8. Audit harus durable, queryable, dan tidak disamakan dengan log.
9. State machine lebih kuat daripada boolean `sent`.
10. Alert harus actionable dan berbasis symptom penting.
11. Dashboard harus dipisah antara operational, engineering, deliverability, dan support/audit.
12. PII/secrets harus dikontrol melalui redaction dan data classification.
13. Java 8–25 berbeda dependency/runtime, tetapi prinsip observability tetap sama.

---

## 32. What’s Next

Part berikutnya:

```text
Part 21 — Performance and Resource Management
```

Kita akan membahas:

- blocking nature of SMTP;
- worker pool sizing;
- virtual threads Java 21+;
- connection reuse;
- attachment memory pressure;
- message size;
- GC impact;
- backpressure;
- capacity planning;
- benchmark realistis mail pipeline.



<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 19 — Testing Mail Systems](./19-testing-mail-systems.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 21 — Performance and Resource Management](./21-performance-resource-management.md)
