# Part 11 — Reliable Email Delivery Architecture: Queue, Outbox, Retry, Idempotency

> Series: `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery`  
> File: `11-reliable-delivery-outbox-retry-idempotency.md`  
> Scope: Java 8–25, JavaMail `javax.mail`, Jakarta Mail `jakarta.mail`, enterprise outbound email reliability architecture

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas:

- SMTP sending configuration,
- MIME message construction,
- multipart email,
- attachment handling,
- HTML email,
- addressing/header semantics,
- exception/failure classification.

Bagian ini naik satu level: **bagaimana membuat email delivery subsystem yang reliable**.

Banyak engineer berhenti di level ini:

```java
Transport.send(message);
```

Tetapi production system tidak bisa berhenti di situ.

Pertanyaan sebenarnya bukan hanya:

> “Bagaimana cara kirim email?”

Melainkan:

> “Bagaimana memastikan intent bisnis untuk mengirim email tidak hilang, tidak terkirim dua kali secara tidak terkendali, bisa di-retry dengan aman, bisa diaudit, bisa dipantau, bisa dipulihkan setelah crash, dan tetap benar walaupun SMTP/provider/database/network gagal di tengah jalan?”

Inilah fokus bagian ini.

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. menjelaskan kenapa mengirim email langsung di dalam request atau transaksi database adalah desain yang rapuh;
2. memahami transactional outbox pattern untuk email;
3. mendesain state machine pengiriman email;
4. membedakan business notification intent, email job, email attempt, dan SMTP outcome;
5. membuat retry policy yang aman;
6. menangani partial success dan duplicate delivery;
7. memahami idempotency secara realistis, bukan secara idealistis;
8. memilih antara DB polling, broker queue, atau hybrid;
9. mendesain worker yang aman terhadap crash, concurrency, dan backlog;
10. membuat email subsystem yang bisa diaudit dan dioperasikan.

---

## 1. Email Sending adalah Distributed Workflow

Secara mental model, email sending bukan satu operasi atomic.

Ia terdiri dari beberapa langkah yang masing-masing bisa gagal:

```text
Business action
  -> persist business state
  -> create notification intent
  -> render template
  -> build MIME message
  -> acquire SMTP/provider connection
  -> authenticate
  -> transmit message
  -> provider accepts/rejects
  -> recipient server accepts/rejects later
  -> possible bounce/complaint later
```

Masalahnya: aplikasi sering memperlakukan seluruh proses ini seperti satu method call.

```java
public void approveApplication(String applicationId) {
    application.approve();
    repository.save(application);

    mailService.sendApprovalEmail(application); // terlihat sederhana, sebenarnya distributed I/O
}
```

Dari sisi code, ini terlihat clean.

Dari sisi reliability, ini berbahaya.

Mengapa?

Karena ada minimal dua resource berbeda:

1. database application state;
2. SMTP/email provider.

Database transaction bisa commit/rollback. SMTP send tidak ikut rollback bersama database.

Tidak ada atomic transaction alami antara:

```text
UPDATE application SET status = 'APPROVED'
```

Dan:

```text
SMTP DATA accepted by relay
```

Inilah akar problem.

---

## 2. Kesalahan Desain: Send Email di Dalam Request Path

Contoh umum:

```java
@PostMapping("/applications/{id}/approve")
public ResponseEntity<?> approve(@PathVariable String id) {
    applicationService.approve(id);
    return ResponseEntity.ok().build();
}
```

```java
@Transactional
public void approve(String id) {
    Application app = repository.findById(id).orElseThrow();
    app.approve();
    repository.save(app);

    emailService.sendApprovalEmail(app); // anti-pattern
}
```

Masalahnya banyak.

### 2.1 User Request Menjadi Tergantung SMTP

Jika SMTP lambat 20 detik, request ikut lambat.

Jika SMTP timeout, user mungkin melihat approval gagal padahal business state sudah berubah atau sebaliknya.

### 2.2 Transaction Menjadi Terlalu Lama

Jika `sendApprovalEmail()` dipanggil sebelum transaction commit, maka transaction database tetap terbuka saat aplikasi melakukan network I/O.

Efeknya:

- lock lebih lama;
- connection pool tertahan;
- throughput turun;
- deadlock risk naik;
- user-facing latency naik.

### 2.3 SMTP Bisa Sukses lalu DB Rollback

Contoh:

```java
@Transactional
public void approve(String id) {
    Application app = repository.findById(id).orElseThrow();
    app.approve();

    emailService.sendApprovalEmail(app); // SMTP accepted

    auditRepository.save(...); // gagal karena constraint
}
```

Hasil:

```text
Email terkirim: "Application approved"
Database rollback: application tetap belum approved
```

Ini adalah inconsistency serius.

### 2.4 DB Commit Bisa Sukses lalu Email Gagal

Contoh:

```java
@Transactional
public void approve(String id) {
    app.approve();
    repository.save(app);
}

// setelah commit, coba email
emailService.sendApprovalEmail(app); // timeout
```

Hasil:

```text
Application approved
Email tidak terkirim
Tidak ada record retry
Tidak ada audit trail jelas
```

### 2.5 Crash Window

Ada window berbahaya:

```text
1. DB commit berhasil
2. JVM crash sebelum email dikirim
```

Jika tidak ada record durable bahwa email perlu dikirim, notification intent hilang.

---

## 3. Prinsip Utama: Pisahkan Business Commit dari Delivery Attempt

Sistem yang reliable membedakan dua hal:

1. **business fact**: sesuatu terjadi;
2. **delivery attempt**: sistem mencoba mengirim email tentang kejadian itu.

Contoh business fact:

```text
Application APP-001 approved at 2026-06-18T10:15:00+07:00 by officer O-123
```

Contoh notification intent:

```text
Send approval notification email to applicant for APP-001 using template APPLICATION_APPROVED:v5
```

Contoh delivery attempt:

```text
Attempt #1 via SMTP relay mail.internal.gov.sg at 2026-06-18T10:16:02+07:00 failed with 421 timeout
```

Contoh final send outcome:

```text
SMTP relay accepted message with provider id xyz at 2026-06-18T10:21:15+07:00
```

Ini bukan detail administratif. Ini adalah desain domain.

Jika kamu tidak memisahkan konsep ini, maka sistemmu akan sulit diaudit, sulit diretry, dan sulit dijelaskan saat incident.

---

## 4. Transactional Outbox Pattern untuk Email

Transactional outbox pattern menyelesaikan masalah klasik:

> Bagaimana melakukan update database dan publish/send side-effect secara reliable tanpa distributed transaction?

Idenya:

1. Saat business transaction commit, simpan juga record outbox di database yang sama.
2. Worker asynchronous membaca outbox.
3. Worker melakukan side-effect, misalnya kirim email.
4. Worker update status outbox.

Secara sederhana:

```text
Business transaction:
  update application
  insert email_outbox row
  commit

Background worker:
  select pending email_outbox
  send email
  update status
```

Dengan ini, business state dan notification intent commit bersama dalam satu database transaction.

Bukan berarti email send menjadi exactly-once. Tetapi intent untuk mengirim tidak hilang.

---

## 5. Core Invariant dalam Reliable Email System

Top 1% engineer biasanya berpikir dalam invariant.

Untuk email subsystem, beberapa invariant penting:

```text
Invariant 1:
Jika business event commit dan membutuhkan email, maka durable email intent harus ikut commit.

Invariant 2:
SMTP delivery attempt tidak boleh dilakukan sebelum business transaction commit.

Invariant 3:
Retry harus bounded, observable, dan classifiable.

Invariant 4:
Failure permanent tidak boleh diretry tanpa batas.

Invariant 5:
Failure transient tidak boleh langsung dianggap final.

Invariant 6:
Setiap email intent harus punya identity/idempotency key.

Invariant 7:
Worker crash tidak boleh menyebabkan job hilang.

Invariant 8:
Duplicate delivery mungkin terjadi; desain harus mengurangi dan mendeteksinya, bukan berpura-pura impossible.

Invariant 9:
Tidak boleh ada PII/secret berlebihan dalam log.

Invariant 10:
Setiap email yang dikirim harus bisa ditelusuri ke business cause, template version, recipient category, dan send attempts.
```

Invariant ini menjadi dasar semua desain berikutnya.

---

## 6. Model Data Minimal

Sebuah outbox email minimal biasanya butuh beberapa konsep:

1. `email_outbox` — notification intent/job;
2. `email_attempt` — setiap percobaan kirim;
3. `email_recipient` — recipient-level status jika perlu;
4. `email_template_version` — metadata template;
5. optional `email_delivery_event` — bounce/webhook/complaint event.

Untuk Part 11, kita fokus outbound outbox dan attempt.

---

## 7. Email Outbox Table

Contoh skema konseptual:

```sql
CREATE TABLE email_outbox (
    id                    VARCHAR(36) PRIMARY KEY,
    idempotency_key       VARCHAR(200) NOT NULL,

    business_type         VARCHAR(100) NOT NULL,
    business_id           VARCHAR(100) NOT NULL,
    business_event_type   VARCHAR(100) NOT NULL,

    template_code         VARCHAR(100) NOT NULL,
    template_version      VARCHAR(50) NOT NULL,
    locale                VARCHAR(20),

    from_address          VARCHAR(320) NOT NULL,
    reply_to_address      VARCHAR(320),

    recipient_to_json     CLOB NOT NULL,
    recipient_cc_json     CLOB,
    recipient_bcc_json    CLOB,

    subject               VARCHAR(998) NOT NULL,
    text_body             CLOB,
    html_body             CLOB,

    attachment_ref_json   CLOB,
    metadata_json         CLOB,

    status                VARCHAR(40) NOT NULL,
    priority              INTEGER DEFAULT 100 NOT NULL,

    attempt_count         INTEGER DEFAULT 0 NOT NULL,
    max_attempts          INTEGER DEFAULT 5 NOT NULL,
    next_attempt_at       TIMESTAMP NOT NULL,

    locked_by             VARCHAR(100),
    locked_at             TIMESTAMP,
    lock_expires_at       TIMESTAMP,

    last_error_code       VARCHAR(100),
    last_error_message    VARCHAR(1000),

    provider_name         VARCHAR(100),
    provider_message_id   VARCHAR(300),
    mail_message_id       VARCHAR(300),

    created_at            TIMESTAMP NOT NULL,
    created_by            VARCHAR(100),
    updated_at            TIMESTAMP NOT NULL,

    UNIQUE (idempotency_key)
);
```

Catatan:

- `idempotency_key` mencegah intent yang sama dibuat berkali-kali.
- `business_type`, `business_id`, `business_event_type` menghubungkan email ke domain.
- `template_code` dan `template_version` penting untuk audit.
- `recipient_*_json` bisa diganti normalized table jika butuh recipient-level tracking.
- `subject`, `text_body`, `html_body` bisa berupa rendered content atau template+variables, tergantung kebutuhan audit.
- `next_attempt_at` membuat retry scheduling explicit.
- `locked_by`, `lock_expires_at` membantu worker concurrency.
- `provider_message_id` tidak selalu tersedia untuk pure SMTP, tetapi tersedia untuk banyak API provider.
- `mail_message_id` adalah header `Message-ID` yang dibuat aplikasi/provider.

---

## 8. Email Attempt Table

Outbox row menyimpan state saat ini. Attempt table menyimpan riwayat percobaan.

```sql
CREATE TABLE email_attempt (
    id                    VARCHAR(36) PRIMARY KEY,
    email_outbox_id       VARCHAR(36) NOT NULL,
    attempt_no            INTEGER NOT NULL,

    provider_name         VARCHAR(100) NOT NULL,
    smtp_host             VARCHAR(300),
    smtp_port             INTEGER,

    started_at            TIMESTAMP NOT NULL,
    finished_at           TIMESTAMP,
    duration_ms           BIGINT,

    outcome               VARCHAR(40) NOT NULL,
    error_category        VARCHAR(100),
    smtp_return_code      INTEGER,
    smtp_command          VARCHAR(50),
    smtp_response         VARCHAR(1000),
    exception_class       VARCHAR(300),
    exception_message     VARCHAR(1000),

    provider_message_id   VARCHAR(300),
    mail_message_id       VARCHAR(300),

    worker_id             VARCHAR(100),
    created_at            TIMESTAMP NOT NULL,

    CONSTRAINT fk_email_attempt_outbox
        FOREIGN KEY (email_outbox_id) REFERENCES email_outbox(id),

    UNIQUE (email_outbox_id, attempt_no)
);
```

Kenapa attempt table penting?

Karena saat incident, pertanyaan yang muncul bukan hanya:

> “Email ini statusnya apa?”

Tetapi:

> “Sudah dicoba berapa kali?”

> “Gagal karena apa?”

> “SMTP return code-nya apa?”

> “Apakah pernah accepted?”

> “Apakah duplicate?”

> “Worker mana yang proses?”

> “Apakah ada retry storm?”

Tanpa attempt history, jawabanmu akan berbasis tebakan.

---

## 9. Status State Machine

Jangan desain status sebagai string acak. Desain sebagai state machine.

Contoh state:

```text
PENDING
PROCESSING
SENT
FAILED_RETRYABLE
FAILED_PERMANENT
DEAD_LETTER
CANCELLED
SUPPRESSED
```

### 9.1 Diagram State Sederhana

```text
                +-------------------+
                |      PENDING      |
                +---------+---------+
                          |
                          | worker claims
                          v
                +-------------------+
                |    PROCESSING     |
                +----+---------+----+
                     |         |
       send success  |         | send failure
                     |         |
                     v         v
              +------+--+   +-------------------+
              |  SENT   |   | FAILED_RETRYABLE  |
              +---------+   +---------+---------+
                                      |
                                      | next_attempt_at reached
                                      v
                                  PENDING

PROCESSING -> FAILED_PERMANENT
PROCESSING -> DEAD_LETTER
PENDING/FAILED_RETRYABLE -> CANCELLED
PENDING -> SUPPRESSED
```

### 9.2 Status Meaning

#### `PENDING`

Email intent exists and is eligible to be processed.

#### `PROCESSING`

A worker has claimed the job.

#### `SENT`

The SMTP relay/provider accepted the message.

Important: `SENT` usually means accepted by outbound provider, not necessarily inbox delivered.

#### `FAILED_RETRYABLE`

Failure looks transient.

Examples:

- network timeout;
- SMTP 421;
- SMTP 450/451/452;
- provider rate limit;
- temporary DNS issue;
- connection refused during maintenance.

#### `FAILED_PERMANENT`

Failure looks final.

Examples:

- invalid recipient syntax;
- SMTP 550 mailbox unavailable;
- authentication configuration invalid if operator confirms non-transient;
- template rendering invalid due to missing required data;
- attachment missing permanently.

#### `DEAD_LETTER`

Retry attempts exhausted or message requires manual inspection.

#### `CANCELLED`

Intent was cancelled before successful sending.

Example:

- business action reversed before email sent;
- user opted out before send;
- duplicate detected.

#### `SUPPRESSED`

Email intentionally not sent due to suppression policy.

Example:

- hard bounced recipient;
- unsubscribed recipient;
- domain suppression;
- compliance rule.

---

## 10. State Transition Rules

State transition harus eksplisit.

Contoh:

```text
PENDING -> PROCESSING
Allowed when:
  now >= next_attempt_at
  status = PENDING or FAILED_RETRYABLE
  not locked or lock expired

PROCESSING -> SENT
Allowed when:
  SMTP/provider accepted message

PROCESSING -> FAILED_RETRYABLE
Allowed when:
  failure classified transient
  attempt_count < max_attempts

PROCESSING -> DEAD_LETTER
Allowed when:
  transient failure but attempt_count >= max_attempts

PROCESSING -> FAILED_PERMANENT
Allowed when:
  failure classified permanent

PENDING -> CANCELLED
Allowed when:
  business cancellation occurs before worker sends

FAILED_RETRYABLE -> CANCELLED
Allowed when:
  business cancellation occurs before retry
```

Jangan biarkan semua state bisa pindah ke semua state.

Jika status transition bebas, kamu kehilangan audit semantics.

---

## 11. Email Intent vs Rendered Message

Ada dua pendekatan menyimpan content:

### 11.1 Store Rendered Content

Saat business transaction terjadi, aplikasi langsung render subject/body dan menyimpannya di outbox.

```text
email_outbox.subject = "Your application is approved"
email_outbox.html_body = "<html>...</html>"
```

Kelebihan:

- audit kuat;
- email yang dikirim nanti sama dengan intent saat itu;
- template berubah tidak memengaruhi pending email lama;
- worker lebih sederhana;
- replay lebih deterministic.

Kekurangan:

- menyimpan HTML/PII lebih banyak;
- jika data berubah sebelum send, email tetap memakai snapshot lama;
- storage lebih besar.

### 11.2 Store Template + Variables

Outbox menyimpan:

```json
{
  "templateCode": "APPLICATION_APPROVED",
  "templateVersion": "v5",
  "variables": {
    "applicantName": "Alice",
    "applicationNo": "APP-001"
  }
}
```

Worker render saat mengirim.

Kelebihan:

- storage lebih kecil;
- bisa apply rendering fix sebelum send;
- content generation terpusat di worker.

Kekurangan:

- hasil bisa berubah jika template mutable;
- audit lebih rumit;
- retry bisa menghasilkan content berbeda jika template/data berubah;
- worker bisa gagal karena rendering issue.

### 11.3 Recommendation

Untuk sistem regulatory, audit-heavy, atau enterprise workflow:

```text
Prefer store rendered content + template metadata + variable snapshot.
```

Artinya simpan:

- template code;
- template version;
- variable snapshot;
- rendered subject;
- rendered text body;
- rendered HTML body;
- attachment references.

Dengan ini kamu dapat audit dan juga debug rendering.

---

## 12. Idempotency Key

Idempotency key adalah identity stabil untuk “email intent yang sama”.

Contoh:

```text
APPLICATION_APPROVED:APP-001:APPLICANT:v5
```

Atau:

```text
businessType=APPLICATION
businessId=APP-001
eventType=APPROVED
recipientRole=APPLICANT
templateCode=APPLICATION_APPROVED
templateVersion=v5
```

Idempotency key mencegah duplicate intent.

```sql
UNIQUE (idempotency_key)
```

Jika operation retry di application layer, insert outbox kedua akan gagal secara controlled.

### 12.1 Idempotency Key yang Buruk

Jangan gunakan timestamp random sebagai idempotency key.

Buruk:

```text
APPLICATION_APPROVED:APP-001:2026-06-18T10:15:00.123
```

Kenapa?

Karena retry akan menghasilkan key berbeda.

### 12.2 Idempotency Key yang Terlalu Luas

Buruk:

```text
APPLICATION:APP-001
```

Kenapa?

Karena satu application bisa butuh banyak email:

- submitted;
- approved;
- rejected;
- renewal reminder;
- document requested.

### 12.3 Idempotency Key yang Terlalu Sempit

Buruk:

```text
APPLICATION_APPROVED:APP-001:ATTEMPT-1
```

Kenapa?

Karena attempt bukan intent. Retry bukan intent baru.

### 12.4 Idempotency Key Harus Berbasis Business Meaning

Baik:

```text
APPLICATION_APPROVED:APP-001:APPLICANT:EMAIL
```

Lebih baik untuk multi-template/version:

```text
APPLICATION_APPROVED:APP-001:APPLICANT:APPLICATION_APPROVED:v5
```

---

## 13. Exactly-Once Delivery adalah Ilusi

Banyak engineer ingin guarantee:

> “Email pasti terkirim exactly once.”

Dalam distributed system, ini hampir tidak bisa dijamin end-to-end.

Kenapa?

Karena ada kondisi seperti ini:

```text
1. Worker kirim email ke SMTP
2. SMTP menerima DATA dan mengirim 250 OK
3. Network putus sebelum aplikasi membaca 250 OK
4. Worker menganggap timeout
5. Worker retry
6. Recipient menerima dua email
```

Dari sisi aplikasi:

```text
Tidak tahu apakah provider sudah menerima atau belum.
```

Dari sisi recipient:

```text
Bisa saja menerima duplicate.
```

Jadi target realistis:

```text
At-least-once intent processing
At-most-once best effort delivery attempt per provider message identity
Duplicate minimized, detectable, explainable
```

Bukan exactly-once global delivery.

---

## 14. Cara Mengurangi Duplicate Email

Walaupun exactly-once tidak realistis, duplicate bisa dikurangi.

### 14.1 Idempotency pada Intent

Pastikan email intent tidak dibuat berkali-kali.

```sql
UNIQUE (idempotency_key)
```

### 14.2 Stable Message-ID

Untuk retry dari intent yang sama, gunakan `Message-ID` stabil jika desainmu mengizinkan.

Contoh:

```text
<notification-APPROVED-APP-001-APPLICANT@example.gov.sg>
```

Namun hati-hati:

- beberapa provider mungkin override `Message-ID`;
- same `Message-ID` tidak menjamin mail client deduplicate;
- jika content berubah, memakai same `Message-ID` bisa membingungkan threading/caching.

### 14.3 Provider Idempotency Key

Jika memakai email provider API, beberapa provider menyediakan idempotency/custom argument/header.

Untuk SMTP murni, capability ini terbatas.

### 14.4 Send One Recipient per Message untuk Critical Email

Jika satu message ke banyak recipient dan terjadi partial failure, retry semantics menjadi sulit.

Untuk critical transactional email, sering lebih aman:

```text
1 outbox row per recipient role / recipient address
```

Daripada:

```text
1 outbox row untuk 200 recipients
```

### 14.5 Detect Duplicate by Business Key

Saat operator melihat duplicate, sistem harus bisa menunjukkan:

```text
Same business event? Same idempotency key? Same Message-ID? Different attempts? Different outbox rows?
```

---

## 15. Retry Policy

Retry tidak boleh asal.

Retry yang buruk bisa membuat incident menjadi lebih parah.

Contoh buruk:

```java
while (true) {
    try {
        send(email);
        break;
    } catch (Exception e) {
        // retry forever
    }
}
```

Masalah:

- retry storm;
- provider rate limit makin parah;
- thread pool habis;
- SMTP account terkunci;
- duplicate risk naik;
- queue baru tidak terproses.

### 15.1 Retry Harus Berdasarkan Failure Classification

Contoh:

```text
Network timeout         -> retryable
SMTP 421               -> retryable
SMTP 450/451/452       -> retryable
SMTP 550 user unknown  -> permanent
Invalid address syntax -> permanent
Authentication failed  -> usually operational/config, often pause/circuit-break
Template invalid       -> permanent until data/template fixed
Attachment missing     -> depends: transient storage issue or permanent reference issue
```

### 15.2 Retry Harus Bounded

Contoh:

```text
max_attempts = 5
```

Setelah itu:

```text
DEAD_LETTER
```

### 15.3 Retry Harus Pakai Backoff

Contoh schedule:

```text
attempt 1: now
attempt 2: +1 minute
attempt 3: +5 minutes
attempt 4: +30 minutes
attempt 5: +2 hours
```

### 15.4 Tambahkan Jitter

Tanpa jitter, ribuan email gagal akan retry bersamaan.

Dengan jitter:

```text
nextAttemptAt = baseDelay + random(0, jitterRange)
```

Contoh:

```java
Duration base = switch (attemptNo) {
    case 1 -> Duration.ofMinutes(1);
    case 2 -> Duration.ofMinutes(5);
    case 3 -> Duration.ofMinutes(30);
    default -> Duration.ofHours(2);
};

Duration jitter = Duration.ofSeconds(ThreadLocalRandom.current().nextInt(0, 60));
return now.plus(base).plus(jitter);
```

Untuk Java 8:

```java
Duration base;
switch (attemptNo) {
    case 1:
        base = Duration.ofMinutes(1);
        break;
    case 2:
        base = Duration.ofMinutes(5);
        break;
    case 3:
        base = Duration.ofMinutes(30);
        break;
    default:
        base = Duration.ofHours(2);
}

Duration jitter = Duration.ofSeconds(ThreadLocalRandom.current().nextInt(0, 60));
return now.plus(base).plus(jitter);
```

---

## 16. Failure Classification Layer

Jangan biarkan business service memahami detail `MessagingException`.

Buat classifier:

```java
public interface MailFailureClassifier {
    MailFailure classify(Throwable error);
}
```

```java
public final class MailFailure {
    private final MailFailureCategory category;
    private final boolean retryable;
    private final Integer smtpReturnCode;
    private final String smtpCommand;
    private final String providerResponse;
    private final String safeMessage;

    // constructor/getters
}
```

```java
public enum MailFailureCategory {
    INVALID_ADDRESS,
    RECIPIENT_REJECTED,
    AUTH_FAILED,
    TLS_FAILED,
    CONNECTION_TIMEOUT,
    READ_TIMEOUT,
    WRITE_TIMEOUT,
    PROVIDER_RATE_LIMIT,
    PROVIDER_TEMPORARY_FAILURE,
    PROVIDER_PERMANENT_FAILURE,
    TEMPLATE_RENDER_FAILED,
    ATTACHMENT_UNAVAILABLE,
    UNKNOWN_TRANSIENT,
    UNKNOWN_PERMANENT
}
```

### 16.1 Jakarta Mail Exception Handling

Jakarta Mail `SendFailedException` dapat memuat:

- invalid addresses;
- valid sent addresses;
- valid unsent addresses.

Ini penting untuk partial success.

Pseudo-code:

```java
public MailFailure classify(Throwable error) {
    Throwable current = error;

    while (current != null) {
        if (current instanceof SendFailedException) {
            return classifySendFailed((SendFailedException) current);
        }

        if (current instanceof SocketTimeoutException) {
            return retryable(MailFailureCategory.READ_TIMEOUT);
        }

        if (current instanceof ConnectException) {
            return retryable(MailFailureCategory.CONNECTION_TIMEOUT);
        }

        current = current.getCause();
    }

    return retryable(MailFailureCategory.UNKNOWN_TRANSIENT);
}
```

Untuk provider-specific SMTP exception, implementasi Jakarta Mail/Angus menyediakan exception yang membawa return code dan response. Jangan hanya menyimpan string exception top-level.

---

## 17. Partial Success

Partial success terjadi saat sebagian recipient accepted, sebagian rejected.

Contoh:

```text
To: alice@example.com, bob@example.com, invalid@example.invalid
```

SMTP server mungkin menerima Alice dan Bob, lalu reject invalid recipient.

Jakarta Mail dapat melaporkan address groups:

```text
validSentAddresses
validUnsentAddresses
invalidAddresses
```

Ini menciptakan pertanyaan desain:

> Jika satu outbox row berisi banyak recipient dan sebagian sudah sent, apa status row?

### 17.1 Pilihan Desain A: Satu Row Banyak Recipient

Kelebihan:

- lebih sedikit row;
- cocok untuk email internal non-critical;
- mudah membuat satu message dengan CC.

Kekurangan:

- partial success sulit;
- retry bisa duplicate ke recipient yang sudah sent;
- audit recipient-level lemah.

### 17.2 Pilihan Desain B: Satu Row per Recipient

Kelebihan:

- retry lebih aman;
- status recipient jelas;
- suppression mudah;
- audit kuat;
- per-recipient personalization mudah.

Kekurangan:

- row lebih banyak;
- throughput perlu dikelola;
- thread email di mailbox bisa berbeda jika tiap recipient dapat message sendiri.

### 17.3 Rekomendasi

Untuk transactional/regulatory email:

```text
Prefer one job per recipient or per recipient role.
```

Untuk email yang memang harus menunjukkan CC/BCC group sebagai satu komunikasi formal:

```text
Use one job with multiple recipients, but implement partial success handling explicitly.
```

---

## 18. Worker Architecture

Worker bertugas mengambil pending job dan memprosesnya.

High-level flow:

```text
loop:
  claim N pending jobs
  for each job:
    create attempt record
    build MIME message
    send via gateway
    update outbox status
    update attempt outcome
```

Ada dua model utama:

1. DB polling worker;
2. broker-based worker;
3. hybrid outbox + broker relay.

---

## 19. DB Polling Worker

DB polling adalah worker yang membaca langsung table outbox.

Contoh:

```text
Every 1 second:
  find pending rows where next_attempt_at <= now
  lock rows
  process rows
```

Kelebihan:

- simple;
- durable;
- tidak butuh broker tambahan;
- audit langsung di DB;
- cocok untuk enterprise system dengan volume moderate.

Kekurangan:

- polling overhead;
- DB menjadi queue;
- butuh indexing dan locking hati-hati;
- high throughput bisa membebani DB.

### 19.1 Index Penting

```sql
CREATE INDEX idx_email_outbox_polling
ON email_outbox (status, next_attempt_at, priority, created_at);
```

Jika pakai lock expiration:

```sql
CREATE INDEX idx_email_outbox_lock_expiry
ON email_outbox (status, lock_expires_at);
```

### 19.2 Claim Pattern dengan SKIP LOCKED

Secara konsep:

```sql
SELECT id
FROM email_outbox
WHERE status IN ('PENDING', 'FAILED_RETRYABLE')
  AND next_attempt_at <= CURRENT_TIMESTAMP
ORDER BY priority ASC, created_at ASC
FETCH FIRST 50 ROWS ONLY
FOR UPDATE SKIP LOCKED;
```

Kemudian update:

```sql
UPDATE email_outbox
SET status = 'PROCESSING',
    locked_by = ?,
    locked_at = CURRENT_TIMESTAMP,
    lock_expires_at = CURRENT_TIMESTAMP + INTERVAL '5' MINUTE,
    updated_at = CURRENT_TIMESTAMP
WHERE id = ?;
```

`SKIP LOCKED` berguna agar beberapa worker tidak saling menunggu row yang sama.

### 19.3 Claim Pattern Tanpa SKIP LOCKED

Jika DB tidak mendukung atau ORM sulit:

```sql
UPDATE email_outbox
SET status = 'PROCESSING',
    locked_by = ?,
    locked_at = ?,
    lock_expires_at = ?,
    updated_at = ?
WHERE id = ?
  AND status IN ('PENDING', 'FAILED_RETRYABLE')
  AND next_attempt_at <= ?
  AND (lock_expires_at IS NULL OR lock_expires_at < ?);
```

Kemudian cek affected rows.

Jika affected rows = 1, worker berhasil claim.

Jika 0, job sudah diambil worker lain.

Ini optimistic claim pattern.

---

## 20. Lock Expiration

Apa yang terjadi jika worker crash saat job `PROCESSING`?

Tanpa lock expiration:

```text
Job stuck forever in PROCESSING
```

Dengan lock expiration:

```text
PROCESSING row with expired lock can be re-claimed
```

Contoh recovery query:

```sql
UPDATE email_outbox
SET status = 'FAILED_RETRYABLE',
    next_attempt_at = CURRENT_TIMESTAMP,
    last_error_code = 'WORKER_LOCK_EXPIRED',
    updated_at = CURRENT_TIMESTAMP
WHERE status = 'PROCESSING'
  AND lock_expires_at < CURRENT_TIMESTAMP;
```

Namun ada risiko:

```text
Worker A lambat tapi masih hidup
Lock expired
Worker B mengambil job yang sama
Duplicate send terjadi
```

Solusi:

- set lock timeout realistis;
- worker heartbeat memperpanjang lock;
- processing time dibatasi;
- send timeout wajib;
- desain idempotency.

---

## 21. Worker Transaction Boundary

Jangan tahan DB transaction saat SMTP send terlalu lama jika tidak perlu.

Ada dua pola.

### 21.1 Single Long Transaction — Tidak Disarankan

```text
begin transaction
select for update outbox
send SMTP while row locked
update status
commit
```

Masalah:

- row lock lama;
- transaction lama;
- DB connection tertahan;
- jika SMTP timeout 60 detik, DB ikut menunggu.

### 21.2 Claim-Then-Send-Then-Update — Lebih Umum

```text
Transaction 1:
  claim row as PROCESSING
  commit

Outside transaction:
  send SMTP

Transaction 2:
  update outcome
  commit
```

Risiko:

- crash setelah send sebelum update => retry bisa duplicate.

Tetapi ini risiko unavoidable dalam distributed systems. Mitigasi dengan:

- stable idempotency key;
- stable Message-ID;
- provider message id jika tersedia;
- conservative retry;
- attempt history;
- manual reconciliation.

### 21.3 Trade-off

```text
Long transaction:
  less duplicate window
  worse DB health and scalability

Claim-send-update:
  better scalability
  duplicate window exists
```

Untuk sebagian besar enterprise email subsystem:

```text
Use claim-send-update.
```

---

## 22. Broker-Based Queue

Alternatif: gunakan broker seperti RabbitMQ, Kafka, SQS, atau JMS.

High-level:

```text
Business service publishes EmailCommand to queue
Worker consumes queue
Worker sends email
```

Masalahnya: jika publish ke broker dilakukan terpisah dari DB commit, muncul problem yang sama.

```text
DB commit succeeds, broker publish fails
```

atau:

```text
Broker publish succeeds, DB rollback
```

Karena itu broker tidak otomatis menggantikan outbox.

### 22.1 Outbox + Broker Relay

Pola robust:

```text
Business transaction:
  update DB
  insert outbox row
  commit

Outbox relay:
  read outbox rows
  publish to broker
  mark published

Worker:
  consume broker message
  send email
  update email status
```

Kelebihan:

- broker handles fan-out/scale;
- DB tetap source of truth untuk intent;
- worker bisa scalable.

Kekurangan:

- arsitektur lebih kompleks;
- perlu idempotent consumer;
- perlu reconcile DB vs broker;
- operational surface bertambah.

### 22.2 Kapan DB Polling Cukup?

DB polling cukup jika:

- volume email tidak ekstrem;
- throughput predictable;
- simplicity lebih penting;
- audit DB-centric;
- team kecil;
- tidak butuh cross-service event fanout besar.

### 22.3 Kapan Broker Layak?

Broker layak jika:

- volume tinggi;
- multiple worker groups;
- backpressure/fanout penting;
- email pipeline terpisah service;
- ada standard message infrastructure;
- notification channel lebih dari email.

---

## 23. Outbox Creation dalam Business Transaction

Contoh service:

```java
@Transactional
public void approveApplication(String applicationId, UserId approverId) {
    Application app = applicationRepository.getForUpdate(applicationId);

    app.approve(approverId);

    applicationRepository.save(app);

    EmailOutbox outbox = EmailOutbox.create(
        EmailIntentId.newId(),
        IdempotencyKey.of(
            "APPLICATION_APPROVED",
            app.getId().value(),
            "APPLICANT",
            "APPLICATION_APPROVED",
            "v5"
        ),
        BusinessRef.of("APPLICATION", app.getId().value(), "APPROVED"),
        Recipient.applicant(app.getApplicantEmail()),
        TemplateRef.of("APPLICATION_APPROVED", "v5"),
        renderSnapshot(app)
    );

    emailOutboxRepository.insert(outbox);
}
```

Jika method ini rollback, baik application state maupun email intent rollback.

Jika commit, keduanya commit.

Inilah value utama transactional outbox.

---

## 24. Insert Idempotent Outbox

Jika business command bisa dipanggil ulang, outbox insert harus idempotent.

### 24.1 Approach: Insert and Ignore Duplicate

Pseudo-code:

```java
try {
    emailOutboxRepository.insert(outbox);
} catch (DuplicateKeyException e) {
    // Same notification intent already exists.
    // Do not create second email.
}
```

Namun hati-hati: duplicate key harus benar-benar untuk idempotency key, bukan constraint lain.

### 24.2 Approach: Find Existing

```java
Optional<EmailOutbox> existing = repository.findByIdempotencyKey(key);
if (existing.isEmpty()) {
    repository.insert(outbox);
}
```

Ini rentan race condition kecuali tetap ada unique constraint.

Rekomendasi:

```text
Application-level check boleh, DB unique constraint wajib.
```

---

## 25. Worker Pseudocode

```java
public final class EmailOutboxWorker implements Runnable {
    private final EmailOutboxRepository outboxRepository;
    private final EmailAttemptRepository attemptRepository;
    private final MailGateway mailGateway;
    private final MailFailureClassifier failureClassifier;
    private final RetryPolicy retryPolicy;
    private final Clock clock;
    private final String workerId;

    @Override
    public void run() {
        List<EmailOutboxJob> jobs = outboxRepository.claimDueJobs(workerId, 50, clock.instant());

        for (EmailOutboxJob job : jobs) {
            processOne(job);
        }
    }

    private void processOne(EmailOutboxJob job) {
        int attemptNo = job.getAttemptCount() + 1;
        Instant startedAt = clock.instant();

        EmailAttempt attempt = EmailAttempt.started(job.getId(), attemptNo, workerId, startedAt);
        attemptRepository.insert(attempt);

        try {
            MailSendResult result = mailGateway.send(job.toMailCommand());

            attemptRepository.markSuccess(
                attempt.getId(),
                result.getProviderMessageId(),
                result.getMailMessageId(),
                clock.instant()
            );

            outboxRepository.markSent(
                job.getId(),
                result.getProviderMessageId(),
                result.getMailMessageId(),
                clock.instant()
            );
        } catch (Throwable error) {
            MailFailure failure = failureClassifier.classify(error);

            attemptRepository.markFailure(attempt.getId(), failure, clock.instant());

            if (!failure.isRetryable()) {
                outboxRepository.markPermanentFailure(job.getId(), failure, clock.instant());
                return;
            }

            if (attemptNo >= job.getMaxAttempts()) {
                outboxRepository.markDeadLetter(job.getId(), failure, clock.instant());
                return;
            }

            Instant nextAttemptAt = retryPolicy.nextAttemptAt(attemptNo, clock.instant(), failure);
            outboxRepository.markRetryableFailure(job.getId(), failure, attemptNo, nextAttemptAt, clock.instant());
        }
    }
}
```

Catatan:

- `Throwable` tidak berarti semua error diretry.
- `OutOfMemoryError` atau fatal JVM error sebaiknya tidak ditelan sembarangan.
- Dalam production, catch boundary harus disesuaikan.
- Attempt insert sebelum send penting agar ada trace walaupun send menggantung/worker crash setelah attempt dibuat.

---

## 26. MailGateway Boundary

Jangan biarkan worker tahu detail Jakarta Mail.

Buat port:

```java
public interface MailGateway {
    MailSendResult send(MailCommand command) throws MailSendException;
}
```

```java
public final class MailCommand {
    private final String from;
    private final List<String> to;
    private final List<String> cc;
    private final List<String> bcc;
    private final String replyTo;
    private final String subject;
    private final String textBody;
    private final String htmlBody;
    private final List<MailAttachment> attachments;
    private final String messageId;
    private final Map<String, String> headers;

    // constructor/getters
}
```

Implementasi:

```java
public final class JakartaMailGateway implements MailGateway {
    private final Session session;
    private final SmtpProperties properties;

    @Override
    public MailSendResult send(MailCommand command) {
        // build MimeMessage
        // send via Transport
        // return result
    }
}
```

Dengan boundary ini, kamu bisa mengganti:

- Jakarta Mail SMTP;
- AWS SES API;
- SendGrid API;
- Mailgun API;
- fake mail gateway untuk test.

---

## 27. Transactional Boundary di Worker Update

Pastikan update attempt dan outbox konsisten.

Contoh success update sebaiknya satu transaction:

```java
@Transactional
public void recordSuccess(JobId jobId, AttemptId attemptId, MailSendResult result) {
    attemptRepository.markSuccess(attemptId, result);
    outboxRepository.markSent(jobId, result);
}
```

Contoh failure update:

```java
@Transactional
public void recordRetryableFailure(
    JobId jobId,
    AttemptId attemptId,
    MailFailure failure,
    Instant nextAttemptAt
) {
    attemptRepository.markFailure(attemptId, failure);
    outboxRepository.markRetryableFailure(jobId, failure, nextAttemptAt);
}
```

Jika attempt update sukses tapi outbox update gagal, status bisa inconsistent.

Gunakan transaction.

---

## 28. Handling Crash Windows

Mari lihat crash windows satu per satu.

### 28.1 Crash Sebelum Claim Commit

```text
Worker select job
JVM crash before status PROCESSING commit
```

Outcome:

```text
Job tetap PENDING
Worker lain bisa ambil
Aman
```

### 28.2 Crash Setelah Claim Commit, Sebelum Send

```text
Job PROCESSING
Worker crash before SMTP send
```

Outcome:

```text
Tidak ada email terkirim
Job stuck until lock expiration
Retry aman
```

### 28.3 Crash Saat Send

```text
Worker mengirim SMTP DATA
Crash/network fail in middle
```

Outcome:

```text
Tidak pasti apakah provider menerima
Retry bisa duplicate
```

Mitigasi:

- timeout;
- stable Message-ID;
- provider idempotency jika ada;
- attempt log;
- bounded retry;
- operator reconciliation.

### 28.4 Crash Setelah Send Sukses, Sebelum Mark Sent

```text
SMTP accepted
Worker crash before DB update SENT
```

Outcome:

```text
Email mungkin sudah terkirim
Job akan retry setelah lock expired
Duplicate risk
```

Ini crash window paling sulit.

Tidak bisa dihilangkan total tanpa dukungan provider idempotency/reconciliation.

Top 1% answer bukan “pakai transaction”. Top 1% answer adalah:

```text
Acknowledge the impossibility of global exactly-once delivery, then design duplicate minimization, detection, and operational reconciliation.
```

---

## 29. Retry Storm dan Circuit Breaker

Jika SMTP credential salah, 10.000 job retry terus, sistem bisa makin rusak.

Gunakan circuit breaker untuk failure kategori tertentu.

Contoh:

```text
If AUTH_FAILED > threshold within 5 minutes:
  pause mail worker for provider X
  alert operator
  do not burn attempts for all jobs
```

Failure yang cocok untuk circuit breaker:

- authentication failed;
- TLS handshake consistently failed;
- provider unavailable;
- DNS resolution failed;
- connection refused;
- rate limit massive.

Failure yang tidak perlu circuit breaker global:

- one invalid recipient;
- one missing attachment;
- one template data error.

### 29.1 Provider Health State

Tambahkan table/config:

```text
mail_provider_health
  provider_name
  status: HEALTHY / DEGRADED / PAUSED
  reason
  paused_until
  updated_at
```

Worker check sebelum send:

```java
if (providerHealth.isPaused(providerName)) {
    outboxRepository.reschedule(jobId, providerHealth.pausedUntil());
    return;
}
```

---

## 30. Priority dan Fairness

Tidak semua email sama.

Contoh:

```text
Priority 10: OTP / login verification
Priority 20: regulatory deadline notice
Priority 50: workflow notification
Priority 100: normal notification
Priority 200: digest/report
```

Namun priority bisa menyebabkan starvation.

Jika high priority terus masuk, low priority tidak pernah terkirim.

Mitigasi:

- priority + aging;
- separate queues;
- quota per category;
- worker pool per class.

Contoh polling:

```sql
ORDER BY priority ASC, created_at ASC
```

Untuk fairness lebih baik:

```text
Reserve worker capacity:
  50% critical
  30% normal
  20% bulk/digest
```

---

## 31. Rate Limit dan Backpressure

Worker harus menghormati provider rate limit.

Contoh:

```text
Provider limit: 300 emails/minute
Application worker: 20 threads
Each thread can send 5/sec
```

Tanpa limiter:

```text
20 * 5/sec = 100/sec = 6000/minute
```

Provider akan reject/rate-limit.

Gunakan rate limiter:

```java
public interface MailRateLimiter {
    boolean tryAcquire(String providerName, int permits);
}
```

Atau token bucket.

Jika rate limit tercapai:

```text
reschedule job slightly later
status remains PENDING or RATE_LIMITED
```

Jangan mark as failed setiap kali internal limiter menolak.

Itu bukan delivery failure; itu scheduling decision.

---

## 32. Attachment dan Outbox Reliability

Attachment sering menjadi sumber failure.

Ada beberapa pendekatan:

### 32.1 Store Attachment Bytes in DB

Kelebihan:

- atomic dengan outbox;
- replay aman;
- tidak tergantung external storage.

Kekurangan:

- DB bengkak;
- LOB maintenance;
- backup besar;
- performance buruk untuk file besar.

### 32.2 Store Attachment Reference

Contoh:

```json
{
  "storage": "S3",
  "bucket": "mail-attachments",
  "key": "applications/APP-001/approval.pdf",
  "sha256": "...",
  "contentType": "application/pdf",
  "filename": "approval.pdf"
}
```

Kelebihan:

- scalable;
- DB ringan;
- file bisa streaming.

Kekurangan:

- reference bisa hilang;
- permission bisa expired;
- object bisa berubah;
- audit perlu hash/version.

### 32.3 Recommendation

Untuk attachment critical:

```text
Store immutable attachment reference + content hash + size + content type + retention policy.
```

Jika attachment generated from business data, pertimbangkan:

```text
generate at intent creation and store immutable artifact
```

bukan generate ulang saat retry, kecuali memang diinginkan.

---

## 33. Cancellation Semantics

Tidak semua pending email harus tetap dikirim.

Contoh:

```text
Case assigned to Officer A
Email pending
Before worker sends, case reassigned to Officer B
```

Apakah email ke Officer A tetap dikirim?

Tergantung business semantics.

Ada dua tipe email:

### 33.1 Historical Notification

Email adalah bukti bahwa event pernah terjadi.

Contoh:

```text
Application submitted
Payment received
Decision issued
```

Biasanya tidak dibatalkan.

### 33.2 Current-State Notification

Email hanya relevan jika state masih berlaku.

Contoh:

```text
Task assigned to you
Approval pending your action
Reminder to review document
```

Jika state berubah sebelum send, email mungkin harus cancelled/suppressed.

### 33.3 Pre-Send Validation Hook

Worker bisa menjalankan validation sebelum send:

```java
public interface PreSendPolicy {
    PreSendDecision evaluate(EmailOutboxJob job);
}
```

Result:

```text
SEND
CANCEL
SUPPRESS
RESCHEDULE
```

Contoh:

```text
If task no longer assigned to recipient -> CANCEL
If recipient unsubscribed -> SUPPRESS
If business entity locked/migrating -> RESCHEDULE
```

---

## 34. Outbox Granularity

Pertanyaan desain:

> Satu business event menghasilkan satu outbox row atau banyak?

Contoh event:

```text
Application approved
```

Recipients:

- applicant;
- officer;
- supervisor;
- audit mailbox.

Pilihan:

### 34.1 One Row for All Recipients

```text
APPLICATION_APPROVED -> one email with To/Cc/Bcc
```

Cocok jika semua recipient memang bagian dari komunikasi yang sama.

### 34.2 One Row per Recipient Role

```text
APPLICATION_APPROVED -> applicant email
APPLICATION_APPROVED -> officer email
APPLICATION_APPROVED -> supervisor email
```

Cocok jika content/semantics berbeda.

### 34.3 One Row per Recipient Address

Cocok untuk:

- personalization;
- suppression;
- tracking;
- retry isolation.

### 34.4 Recommendation

Gunakan rule:

```text
Jika recipient memiliki business meaning/status/retry/audit yang berbeda, pisahkan outbox row.
```

Jangan optimasi row count terlalu dini.

---

## 35. Message Identity

Ada beberapa identity berbeda:

```text
business_event_id
email_outbox_id
idempotency_key
mail_message_id
provider_message_id
attempt_id
```

Jangan campur.

### 35.1 `business_event_id`

Identity event domain.

```text
APPLICATION_APPROVED:APP-001:2026-06-18T10:15
```

### 35.2 `email_outbox_id`

Identity job internal.

```text
UUID
```

### 35.3 `idempotency_key`

Identity logical intent.

```text
APPLICATION_APPROVED:APP-001:APPLICANT:v5
```

### 35.4 `mail_message_id`

Header email.

```text
<application-approved-app-001-applicant@example.gov.sg>
```

### 35.5 `provider_message_id`

Identity dari provider.

```text
SES message id / SendGrid message id / SMTP queue id if available
```

### 35.6 `attempt_id`

Identity attempt.

```text
UUID attempt #3
```

Saat troubleshooting, kamu butuh semuanya.

---

## 36. Repository API Design

Contoh repository boundary:

```java
public interface EmailOutboxRepository {
    void insert(EmailOutbox outbox);

    List<EmailOutboxJob> claimDueJobs(
        String workerId,
        int limit,
        Instant now
    );

    void markSent(
        EmailOutboxId id,
        String providerMessageId,
        String mailMessageId,
        Instant now
    );

    void markRetryableFailure(
        EmailOutboxId id,
        MailFailure failure,
        int attemptNo,
        Instant nextAttemptAt,
        Instant now
    );

    void markPermanentFailure(
        EmailOutboxId id,
        MailFailure failure,
        Instant now
    );

    void markDeadLetter(
        EmailOutboxId id,
        MailFailure failure,
        Instant now
    );

    int recoverExpiredLocks(Instant now);
}
```

Sengaja tidak expose `save(entity)` generic.

Kenapa?

Karena outbox state transition harus dikontrol.

---

## 37. Avoid Generic CRUD for State Machine

Generic CRUD memungkinkan code seperti ini:

```java
outbox.setStatus("SENT");
repository.save(outbox);
```

Masalah:

- siapa pun bisa ubah state sembarangan;
- transition rules tidak enforced;
- audit lemah;
- concurrency bug mudah.

Lebih baik:

```java
outboxRepository.markSent(id, providerMessageId, messageId, now);
```

Atau domain method:

```java
outbox.markSent(result, now);
```

Dengan guard:

```java
if (status != PROCESSING) {
    throw new InvalidStateTransitionException(status, SENT);
}
```

---

## 38. Concurrency Control

Beberapa worker bisa berjalan paralel.

Masalah utama:

```text
Two workers send same email job
```

Mitigasi:

1. claim atomic;
2. status guard;
3. lock owner;
4. lock expiration;
5. unique attempt number;
6. worker id tracking.

### 38.1 Atomic Claim by Update

```sql
UPDATE email_outbox
SET status = 'PROCESSING',
    locked_by = :workerId,
    locked_at = :now,
    lock_expires_at = :lockExpiresAt
WHERE id = :id
  AND status IN ('PENDING', 'FAILED_RETRYABLE')
  AND next_attempt_at <= :now;
```

Affected rows = 1 berarti sukses.

### 38.2 Optimistic Version

Tambahkan:

```sql
version INTEGER NOT NULL
```

Update:

```sql
UPDATE email_outbox
SET status = ?, version = version + 1
WHERE id = ? AND version = ?;
```

Useful jika ORM/JPA digunakan.

---

## 39. Java 8 vs Java 21/25 Considerations

Reliability architecture-nya sama. Perbedaannya ada di implementasi concurrency/runtime.

### 39.1 Java 8

Biasanya:

- fixed thread pool;
- scheduled executor;
- JDBC/JPA blocking I/O;
- JavaMail `javax.mail`;
- manual backpressure.

Contoh:

```java
ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(1);
ExecutorService workers = Executors.newFixedThreadPool(10);

scheduler.scheduleWithFixedDelay(() -> {
    List<EmailOutboxJob> jobs = repository.claimDueJobs(workerId, 50, Instant.now());
    for (EmailOutboxJob job : jobs) {
        workers.submit(() -> processor.process(job));
    }
}, 0, 1, TimeUnit.SECONDS);
```

### 39.2 Java 21/25

Bisa mempertimbangkan virtual threads untuk blocking SMTP calls.

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    for (EmailOutboxJob job : jobs) {
        executor.submit(() -> processor.process(job));
    }
}
```

Namun jangan salah paham:

```text
Virtual threads increase concurrency capacity, not provider capacity.
```

Tetap perlu:

- rate limit;
- connection limit;
- timeout;
- backpressure;
- max in-flight jobs;
- DB connection pool sizing.

Virtual threads tidak menggantikan architecture.

---

## 40. Timeouts Tetap Wajib

Outbox worker tidak boleh menggantung karena SMTP call tanpa timeout.

Minimal:

```properties
mail.smtp.connectiontimeout=10000
mail.smtp.timeout=30000
mail.smtp.writetimeout=30000
```

Nilai tergantung SLA.

Tanpa timeout:

```text
Worker stuck
Job stuck PROCESSING
Queue backlog naik
Lock expiration bisa memicu duplicate worker
```

Timeout adalah reliability feature.

---

## 41. Observability Minimal untuk Part 11

Untuk reliable delivery, minimal metrics:

```text
email_outbox_pending_count
email_outbox_processing_count
email_outbox_sent_count
email_outbox_failed_retryable_count
email_outbox_failed_permanent_count
email_outbox_dead_letter_count
email_outbox_oldest_pending_age_seconds
email_send_attempt_total{outcome, provider, category}
email_send_latency_ms{provider}
email_retry_scheduled_total{category}
email_worker_claimed_total
email_worker_lock_expired_total
```

Minimal log fields:

```text
correlation_id
business_type
business_id
business_event_type
email_outbox_id
idempotency_key
attempt_no
worker_id
provider_name
mail_message_id
provider_message_id
failure_category
smtp_return_code
elapsed_ms
```

Jangan log:

- full recipient list jika sensitif;
- full body;
- full attachment content;
- SMTP password;
- auth token;
- PII berlebihan.

---

## 42. Alerting

Alert yang berguna:

```text
Oldest pending email age > SLA
Dead letter count increases
Auth failure spike
TLS failure spike
Provider timeout spike
Queue size grows continuously
No successful sends in last N minutes
Processing lock expired spike
Retry attempts exhausted spike
```

Alert yang buruk:

```text
Any single email failure
```

Karena satu invalid recipient bisa normal.

Yang penting adalah pattern dan impact.

---

## 43. Dead Letter Handling

Dead letter bukan kuburan tanpa proses.

Dead letter harus punya workflow:

1. inspect;
2. classify;
3. fix data/config/template/provider issue;
4. replay if safe;
5. cancel if obsolete;
6. document decision.

### 43.1 Dead Letter Fields

Tambahkan operational fields:

```sql
review_status       VARCHAR(40), -- NEW, REVIEWED, REPLAYED, CANCELLED
reviewed_by         VARCHAR(100),
reviewed_at         TIMESTAMP,
review_note         VARCHAR(2000),
replay_count        INTEGER DEFAULT 0 NOT NULL
```

### 43.2 Replay Safety

Sebelum replay:

- apakah email mungkin sudah terkirim?
- apakah business state masih relevan?
- apakah recipient masih valid?
- apakah template masih cocok?
- apakah duplicate acceptable?

Replay bukan sekadar ubah status ke `PENDING`.

---

## 44. Example End-to-End Flow

### 44.1 Business Action

```text
Officer approves application APP-001
```

### 44.2 Transaction

```text
BEGIN
  update application status = APPROVED
  insert audit trail
  insert email_outbox:
    idempotency_key = APPLICATION_APPROVED:APP-001:APPLICANT:v5
    status = PENDING
    next_attempt_at = now
COMMIT
```

### 44.3 Worker Claims

```text
Worker W1 claims email_outbox row
status = PROCESSING
lock_expires_at = now + 5 minutes
```

### 44.4 Attempt #1

```text
Insert email_attempt attempt_no=1 outcome=STARTED
Build MimeMessage
Send SMTP
```

### 44.5 SMTP Timeout

```text
mail.smtp.timeout triggered
Classifier: READ_TIMEOUT retryable
Attempt marked FAILED
Outbox marked FAILED_RETRYABLE
next_attempt_at = now + 1 minute + jitter
```

### 44.6 Attempt #2

```text
Worker claims again
SMTP accepted
Attempt marked SUCCESS
Outbox marked SENT
provider_message_id saved if available
mail_message_id saved
```

### 44.7 Later Bounce

Not in Part 11 deep dive, but later Part 23:

```text
Bounce webhook/mailbox updates delivery feedback state
```

---

## 45. Common Anti-Patterns

### 45.1 Send Inside `@Transactional`

```java
@Transactional
public void approve() {
    updateDb();
    mailService.send();
}
```

Problem:

- DB rollback after email sent;
- long transaction;
- request latency;
- no durable retry.

### 45.2 Fire-and-Forget Thread

```java
new Thread(() -> mailService.send(email)).start();
```

Problem:

- lost on JVM crash;
- no backpressure;
- no retry;
- no audit;
- thread explosion.

### 45.3 `@Async` Without Durable Outbox

```java
@Async
public void sendEmail(...) { ... }
```

Better than blocking, but still not durable.

If app crashes after DB commit before async task runs, email intent can disappear.

### 45.4 Retry Forever

Problem:

- poison message;
- provider abuse;
- noise;
- cost;
- backlog.

### 45.5 Treat All Exceptions as Permanent

Problem:

- transient provider issue causes lost email.

### 45.6 Treat All Exceptions as Retryable

Problem:

- invalid address retried forever;
- missing template retried forever;
- auth failure burns attempts.

### 45.7 One Giant Email with Thousands of Recipients

Problem:

- privacy risk;
- partial failure;
- provider limit;
- personalization impossible;
- BCC mistakes catastrophic.

### 45.8 No Timeout

Problem:

- worker hangs;
- backlog;
- lock expiry duplicate;
- thread exhaustion.

### 45.9 No Attempt History

Problem:

- cannot diagnose;
- cannot prove;
- cannot improve retry policy.

---

## 46. Reference Implementation Sketch

### 46.1 Domain Types

```java
public enum EmailStatus {
    PENDING,
    PROCESSING,
    SENT,
    FAILED_RETRYABLE,
    FAILED_PERMANENT,
    DEAD_LETTER,
    CANCELLED,
    SUPPRESSED
}
```

```java
public final class EmailOutbox {
    private final EmailOutboxId id;
    private final IdempotencyKey idempotencyKey;
    private final BusinessRef businessRef;
    private EmailStatus status;
    private int attemptCount;
    private final int maxAttempts;
    private Instant nextAttemptAt;
    private String lockedBy;
    private Instant lockExpiresAt;

    public void markProcessing(String workerId, Instant now, Duration lockTtl) {
        if (!(status == EmailStatus.PENDING || status == EmailStatus.FAILED_RETRYABLE)) {
            throw new IllegalStateException("Cannot process from status " + status);
        }
        if (nextAttemptAt.isAfter(now)) {
            throw new IllegalStateException("Not due yet");
        }
        this.status = EmailStatus.PROCESSING;
        this.lockedBy = workerId;
        this.lockExpiresAt = now.plus(lockTtl);
    }

    public void markSent(Instant now) {
        requireStatus(EmailStatus.PROCESSING);
        this.status = EmailStatus.SENT;
        clearLock();
    }

    public void markRetryableFailure(MailFailure failure, Instant nextAttemptAt) {
        requireStatus(EmailStatus.PROCESSING);
        this.status = EmailStatus.FAILED_RETRYABLE;
        this.nextAttemptAt = nextAttemptAt;
        clearLock();
    }

    public void markPermanentFailure(MailFailure failure) {
        requireStatus(EmailStatus.PROCESSING);
        this.status = EmailStatus.FAILED_PERMANENT;
        clearLock();
    }

    private void requireStatus(EmailStatus expected) {
        if (this.status != expected) {
            throw new IllegalStateException("Expected " + expected + " but was " + status);
        }
    }

    private void clearLock() {
        this.lockedBy = null;
        this.lockExpiresAt = null;
    }
}
```

### 46.2 Retry Policy

```java
public final class ExponentialBackoffRetryPolicy implements RetryPolicy {
    private final Clock clock;

    public ExponentialBackoffRetryPolicy(Clock clock) {
        this.clock = clock;
    }

    @Override
    public Instant nextAttemptAt(int attemptNo, MailFailure failure) {
        Instant now = clock.instant();
        long baseSeconds = baseDelaySeconds(attemptNo, failure);
        long jitterSeconds = ThreadLocalRandom.current().nextLong(0, Math.min(60, baseSeconds + 1));
        return now.plusSeconds(baseSeconds + jitterSeconds);
    }

    private long baseDelaySeconds(int attemptNo, MailFailure failure) {
        if (failure.getCategory() == MailFailureCategory.PROVIDER_RATE_LIMIT) {
            return 300L;
        }

        switch (attemptNo) {
            case 1:
                return 60L;
            case 2:
                return 5 * 60L;
            case 3:
                return 30 * 60L;
            default:
                return 2 * 60 * 60L;
        }
    }
}
```

### 46.3 Worker Loop with Backpressure

```java
public final class ScheduledEmailWorker {
    private final ScheduledExecutorService scheduler;
    private final ExecutorService executor;
    private final EmailOutboxRepository repository;
    private final EmailJobProcessor processor;
    private final Semaphore inFlight;
    private final String workerId;

    public ScheduledEmailWorker(
        EmailOutboxRepository repository,
        EmailJobProcessor processor,
        String workerId,
        int maxConcurrency
    ) {
        this.scheduler = Executors.newSingleThreadScheduledExecutor();
        this.executor = Executors.newFixedThreadPool(maxConcurrency);
        this.repository = repository;
        this.processor = processor;
        this.workerId = workerId;
        this.inFlight = new Semaphore(maxConcurrency);
    }

    public void start() {
        scheduler.scheduleWithFixedDelay(this::poll, 0, 1, TimeUnit.SECONDS);
    }

    private void poll() {
        int available = inFlight.availablePermits();
        if (available <= 0) {
            return;
        }

        List<EmailOutboxJob> jobs = repository.claimDueJobs(workerId, available, Instant.now());

        for (EmailOutboxJob job : jobs) {
            if (!inFlight.tryAcquire()) {
                return;
            }

            executor.submit(() -> {
                try {
                    processor.process(job);
                } finally {
                    inFlight.release();
                }
            });
        }
    }
}
```

---

## 47. Design Decision Matrix

| Decision | Option A | Option B | Recommendation |
|---|---|---|---|
| Send timing | Inside request | Async outbox | Prefer async outbox |
| Transaction | DB + SMTP together | DB stores intent, worker sends | Prefer outbox |
| Queue | DB polling | Broker | DB polling for moderate volume, broker for scale/fanout |
| Content storage | Render on send | Store rendered snapshot | Prefer snapshot for audit-heavy systems |
| Recipient granularity | Multi-recipient row | One row per recipient/role | Prefer per recipient/role for critical mail |
| Retry | Infinite | Bounded backoff+jitter | Bounded backoff+jitter |
| Failure handling | Raw exception | Classified failure model | Classified model |
| Worker locking | None | Atomic claim + lock expiry | Atomic claim + lock expiry |
| Duplicate | Assume impossible | Minimize/detect/explain | Minimize/detect/explain |
| Observability | Log only | Metrics + attempts + audit | Full observability |

---

## 48. Production Checklist

Sebelum menganggap mail subsystem production-ready, jawab ini:

```text
[ ] Apakah email intent disimpan durable dalam transaksi yang sama dengan business state?
[ ] Apakah tidak ada SMTP call di dalam DB transaction panjang?
[ ] Apakah outbox punya idempotency key unique?
[ ] Apakah retry bounded?
[ ] Apakah retry pakai backoff dan jitter?
[ ] Apakah failure diklasifikasikan transient/permanent?
[ ] Apakah invalid address tidak diretry forever?
[ ] Apakah timeout SMTP dikonfigurasi?
[ ] Apakah worker punya atomic claim?
[ ] Apakah worker crash bisa dipulihkan?
[ ] Apakah lock expiration ada?
[ ] Apakah duplicate delivery risk diakui dan dimitigasi?
[ ] Apakah attempt history disimpan?
[ ] Apakah dead letter punya workflow?
[ ] Apakah metrics queue age dan failure rate tersedia?
[ ] Apakah PII tidak bocor di log?
[ ] Apakah template version disimpan?
[ ] Apakah attachment reference immutable dan auditable?
[ ] Apakah cancellation semantics jelas?
[ ] Apakah provider auth failure bisa pause worker/circuit-break?
```

---

## 49. Mental Model Final

Reliable email delivery bukan tentang membuat `Transport.send()` tidak pernah gagal.

Itu mustahil.

Reliable email delivery adalah tentang membuat sistem yang:

```text
1. tidak kehilangan intent;
2. tidak melakukan side-effect sebelum business commit;
3. bisa retry secara aman;
4. bisa membedakan failure sementara dan final;
5. bisa menjelaskan setiap attempt;
6. bisa pulih setelah crash;
7. bisa mengendalikan duplicate risk;
8. bisa dipantau dan diaudit;
9. bisa dioperasikan saat provider bermasalah;
10. tidak memperlakukan SMTP accepted sebagai inbox delivered.
```

Jika kamu memahami bagian ini, kamu sudah melewati level “bisa kirim email dengan Java”.

Kamu mulai masuk ke level engineer yang bisa membangun **mail delivery subsystem**.

---

## 50. Ringkasan

Dalam Part 11 ini kita membahas:

- kenapa send email di request path/transaction adalah anti-pattern;
- transactional outbox pattern;
- email state machine;
- data model outbox dan attempt;
- idempotency key;
- exactly-once delivery myth;
- duplicate minimization;
- retry policy;
- failure classification;
- partial success;
- DB polling worker;
- broker-based design;
- lock expiration;
- crash windows;
- circuit breaker;
- priority/fairness;
- rate limit/backpressure;
- attachment reliability;
- cancellation semantics;
- worker implementation sketch;
- production checklist.

Part berikutnya akan masuk ke:

```text
Part 12 — Bulk, Batch, and Rate-Limited Sending
```

Di sana kita akan membahas desain high-throughput mail sending, per-domain throttling, worker pool sizing, batching, provider quota, warm-up, backpressure, dan pemisahan transactional vs bulk email.

---

## Referensi

- Jakarta Mail `SendFailedException` API documentation — menjelaskan invalid addresses, valid sent addresses, dan valid unsent addresses.
- Microservices.io — Transactional Outbox Pattern.
- Jakarta Mail SMTP provider documentation — SMTP transport properties dan timeout behavior.
- PostgreSQL/Oracle locking semantics — konsep `FOR UPDATE SKIP LOCKED` untuk worker concurrency.
- RFC 5321 — Simple Mail Transfer Protocol.
- RFC 5322 — Internet Message Format.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 10 — Error Model: `MessagingException`, `SendFailedException`, `SMTPAddressFailedException`](./10-error-model-exception-failure-classification.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 12 — Bulk, Batch, and Rate-Limited Sending](./12-bulk-batch-rate-limited-sending.md)
