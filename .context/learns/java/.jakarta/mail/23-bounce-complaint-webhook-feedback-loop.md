# Part 23 — Bounce, Complaint, Webhook, and Delivery Feedback Loop

> Seri: `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery`  
> Target: Java 8 sampai Java 25, JavaMail `javax.mail`, Jakarta Mail `jakarta.mail`, Jakarta Activation, SMTP, MIME, dan enterprise email delivery architecture.

---

## 1. Tujuan Part Ini

Di part sebelumnya kita sudah membahas:

- SMTP sending,
- error model saat pengiriman,
- outbox/retry/idempotency,
- batch/rate limit,
- security,
- deliverability,
- inbound mail,
- MIME parsing,
- testing,
- observability,
- performance,
- provider integration.

Part ini fokus pada satu hal yang sering menjadi pembeda antara engineer biasa dan engineer yang matang secara production:

> Email subsystem tidak selesai ketika SMTP/API provider menjawab sukses.

Sukses kirim hanya berarti aplikasi berhasil menyerahkan pesan ke satu boundary tertentu. Setelah itu, masih ada kemungkinan:

- mailbox provider menolak email belakangan,
- recipient tidak ada,
- domain tujuan bermasalah,
- email masuk spam,
- user menandai sebagai spam,
- provider men-drop email karena suppression list,
- provider mengirim webhook delayed,
- bounce email masuk ke mailbox khusus,
- webhook dikirim lebih dari sekali,
- webhook dikirim out-of-order,
- webhook datang untuk email yang sudah dianggap `SENT`,
- business module salah menganggap email sudah pasti diterima user.

Tujuan part ini adalah membangun mental model lengkap tentang **delivery feedback loop**.

Setelah part ini, kita ingin bisa menjawab:

1. Apa perbedaan `sent`, `accepted`, `delivered`, `bounced`, `complained`, dan `dropped`?
2. Mengapa SMTP success bukan bukti penerimaan akhir?
3. Bagaimana bounce terjadi dan bagaimana cara memprosesnya?
4. Bagaimana complaint/spam report diproses?
5. Bagaimana webhook provider harus dimodelkan secara idempotent?
6. Bagaimana state machine email notification seharusnya dirancang?
7. Bagaimana Java/Jakarta Mail tetap relevan dalam feedback processing?
8. Bagaimana menghindari duplicate handling, race condition, dan audit ambiguity?

---

## 2. Mental Model Besar: Sending Is a Request, Feedback Is a Stream

Banyak aplikasi memperlakukan email seperti ini:

```text
application -> SMTP/API -> success -> done
```

Model itu terlalu sederhana.

Model yang lebih benar:

```text
Application
  |
  | creates notification intent
  v
Outbox / Mail Queue
  |
  | sends to SMTP relay / email provider
  v
Provider Accepted
  |
  | provider attempts final delivery
  v
Recipient Mail Infrastructure
  |
  | may accept, reject, defer, classify, spam-folder, bounce, complain
  v
Feedback Events
  |
  | webhook / SNS / bounce mailbox / feedback loop / provider API
  v
Application Delivery State
```

Jadi, email delivery adalah dua proses:

1. **Forward path**: aplikasi mengirim pesan keluar.
2. **Feedback path**: sistem menerima informasi balik tentang nasib pesan tersebut.

Forward path biasanya synchronous atau semi-synchronous:

```text
send request -> provider response
```

Feedback path biasanya asynchronous:

```text
bounce/complaint/delivery event -> webhook/inbound mailbox -> application state update
```

Implikasinya:

- Tidak semua failure muncul saat `Transport.send()`.
- Tidak semua provider response berarti final delivery.
- Tidak semua feedback datang cepat.
- Tidak semua feedback datang sekali.
- Tidak semua feedback datang berurutan.
- Tidak semua provider memakai vocabulary yang sama.

Top 1% engineer tidak hanya menyimpan status `SENT`; mereka memodelkan lifecycle pengiriman sebagai state machine yang bisa menerima event pasca-kirim.

---

## 3. Vocabulary yang Harus Dibedakan

### 3.1 Generated

Email sudah dibangun oleh aplikasi:

- template dirender,
- recipient diketahui,
- subject/body/attachment siap,
- mail request masuk outbox.

Belum tentu dikirim.

```text
GENERATED != SENT
```

### 3.2 Queued

Email sudah masuk queue/outbox dan menunggu worker.

```text
QUEUED != PROVIDER_ACCEPTED
```

### 3.3 Attempted

Worker sudah mencoba mengirim ke provider/SMTP relay.

Bisa berhasil, timeout, auth failed, network failed, atau partial recipient failure.

### 3.4 Accepted

Provider atau SMTP relay menerima pesan.

Dalam SMTP, ini biasanya terjadi setelah server menerima message data dan memberi response 2xx. Dalam provider API, ini berarti API menerima request dan memberi response sukses.

Namun:

```text
ACCEPTED != DELIVERED_TO_INBOX
```

Accepted hanya berarti pesan sudah masuk tanggung jawab next hop.

### 3.5 Delivered

Provider mengatakan pesan berhasil dikirim ke server tujuan atau mailbox provider.

Tapi ini juga perlu hati-hati:

```text
DELIVERED != READ
DELIVERED != INBOX
DELIVERED != SEEN_BY_USER
```

Delivered biasanya berarti accepted by receiving mail server, bukan user membaca email.

### 3.6 Deferred

Pengiriman sementara tertunda.

Contoh:

- target server greylisting,
- temporary DNS issue,
- mailbox temporarily unavailable,
- provider throttling,
- network timeout.

Biasanya retriable.

### 3.7 Bounced

Email gagal dikirim dan sistem menerima failure feedback.

Bisa:

- hard bounce,
- soft bounce,
- delayed bounce,
- provider-generated bounce,
- recipient-MTA-generated DSN.

### 3.8 Dropped

Provider tidak mencoba mengirim email karena alasan internal/policy.

Contoh:

- recipient ada di suppression list,
- address pernah hard bounce,
- user pernah complaint,
- content dianggap spam,
- invalid request,
- unsubscribe.

Dropped sering terjadi pada API provider modern. Dari sisi aplikasi, dropped harus diperlakukan sebagai final non-delivery event walaupun SMTP/API call awal bisa saja sukses untuk request batch tertentu.

### 3.9 Complained / Spam Report

Recipient menandai email sebagai spam atau mailbox provider mengirim abuse feedback.

Ini serius karena berdampak pada reputation.

### 3.10 Opened / Clicked

Event engagement.

Ini bukan bukti legal yang kuat karena:

- image loading bisa diblokir,
- security proxy bisa membuka image/link,
- Apple Mail Privacy Protection dan proxy sejenis dapat mengubah makna open,
- link scanner bisa trigger click palsu.

Untuk regulatory-grade notification, open/click harus dianggap telemetry lemah, bukan bukti final.

---

## 4. Mengapa Feedback Loop Penting

Tanpa feedback loop, aplikasi hanya tahu:

```text
Saya sudah mencoba mengirim.
```

Dengan feedback loop, aplikasi bisa tahu:

```text
Email ini diterima provider.
Email ini gagal permanen.
Email ini gagal sementara.
Recipient ini harus disuppress.
Recipient ini menandai spam.
Template/domain/provider tertentu bermasalah.
```

Manfaatnya:

1. **Reliability**  
   Sistem bisa retry atau berhenti retry berdasarkan informasi nyata.

2. **Deliverability**  
   Hard bounce dan complaint bisa mengurangi reputation jika diabaikan.

3. **Compliance**  
   Untuk email resmi, perlu audit trail yang membedakan `generated`, `sent`, `accepted`, `bounced`, dan `complained`.

4. **User experience**  
   Aplikasi bisa meminta user memperbarui email jika address bounce.

5. **Operational visibility**  
   Spike bounce/complaint bisa menunjukkan incident.

6. **Cost control**  
   Jangan terus mengirim ke alamat yang sudah diketahui invalid.

---

## 5. Feedback Channel: Bagaimana Informasi Balik Datang

Ada beberapa channel umum.

### 5.1 SMTP Synchronous Failure

Failure muncul saat aplikasi mengirim.

Contoh:

```text
550 5.1.1 User unknown
421 4.7.0 Try again later
535 5.7.8 Authentication credentials invalid
```

Dalam Jakarta Mail, ini bisa muncul sebagai:

- `SendFailedException`,
- `SMTPAddressFailedException`,
- `SMTPSendFailedException`,
- nested `MessagingException`.

Ini sudah dibahas di Part 10.

### 5.2 Delayed DSN / Bounce Email

Server tujuan atau relay mengirim email balik ke envelope sender atau return path.

Format standar Delivery Status Notification dimodelkan oleh RFC 3464 sebagai extensible message format untuk DSN. DSN biasanya memakai MIME `multipart/report` dan bagian machine-readable `message/delivery-status`.

Contoh konseptual:

```text
From: MAILER-DAEMON@example.net
To: bounce+abc123@sender.example.com
Subject: Undelivered Mail Returned to Sender
Content-Type: multipart/report; report-type=delivery-status

--boundary
Content-Type: text/plain

Delivery failed.

--boundary
Content-Type: message/delivery-status

Final-Recipient: rfc822; user@example.net
Action: failed
Status: 5.1.1
Diagnostic-Code: smtp; 550 5.1.1 User unknown

--boundary
Content-Type: message/rfc822

<original message or headers>
```

### 5.3 Provider Webhook

Provider mengirim HTTP callback ke aplikasi.

Contoh event:

```json
{
  "event": "bounce",
  "message_id": "provider-message-id",
  "recipient": "user@example.com",
  "reason": "550 5.1.1 User unknown",
  "timestamp": "2026-06-18T10:15:00Z"
}
```

Provider berbeda punya schema berbeda.

### 5.4 Provider Event Stream / Queue

Beberapa provider mengirim ke queue/topic, misalnya:

```text
SES -> SNS/SQS/Lambda/webhook consumer
```

Amazon SES dapat mengirim bounce/complaint/delivery notification melalui notification email, SNS topic, atau sending events. Dokumentasi SES juga menyebut setiap notification membawa `mail` object dengan informasi original email termasuk timestamp dan SES message ID.

### 5.5 Feedback Loop / ARF Complaint

Mailbox provider dapat mengirim complaint dalam format abuse report.

RFC 5965 mendefinisikan format extensible untuk email feedback reports, terutama Abuse Reporting Format, sebagai format machine-readable untuk laporan abuse.

Complaint feedback loop biasanya dikirim ke sender/provider, tidak selalu langsung ke aplikasi kecuali provider meneruskan sebagai webhook/event.

### 5.6 Provider API Polling

Jika webhook tidak tersedia atau tidak reliable, aplikasi bisa polling API provider.

Namun polling biasanya:

- lebih lambat,
- lebih mahal,
- lebih kompleks untuk reconciliation,
- bergantung pada retention window provider.

---

## 6. Bounce: Hard, Soft, Transient, Permanent

### 6.1 Hard Bounce

Hard bounce adalah failure permanen.

Contoh:

- mailbox does not exist,
- domain does not exist,
- address invalid,
- recipient permanently rejected.

Typical action:

```text
mark recipient as invalid/suppressed
stop retrying for that recipient
surface issue to user/admin if needed
```

### 6.2 Soft Bounce

Soft bounce adalah failure sementara.

Contoh:

- mailbox full,
- temporary server issue,
- greylisting,
- connection timeout,
- temporary DNS failure,
- rate limited.

Typical action:

```text
retry with backoff
limit maximum retry window
escalate if repeated
```

### 6.3 Transient vs Permanent Berdasarkan SMTP Code

Secara umum:

```text
4xx = transient / temporary
5xx = permanent
```

Tapi provider dan real-world mail server tidak selalu rapi. Ada server yang mengembalikan text ambigu, enhanced status code berbeda, atau provider mengklasifikasikan ulang.

Contoh:

```text
421 4.7.0 Temporary rate limit
450 4.2.0 Mailbox unavailable
550 5.1.1 User unknown
552 5.2.2 Mailbox full
554 5.7.1 Message rejected as spam
```

Perhatikan `552 mailbox full` secara kode 5xx terlihat permanent, tapi secara operasional bisa saja diperlakukan sebagai soft-ish failure tergantung provider dan policy. Karena itu, sistem besar biasanya punya classification layer, bukan hanya `if statusCode startsWith 4`.

### 6.4 Bounce Bisa Datang Terlambat

Skenario:

```text
T0   app sends email
T1   provider accepts email
T2   app marks PROVIDER_ACCEPTED
T3   provider attempts delivery
T4   receiving server rejects
T5   provider sends bounce webhook
T6   app marks BOUNCED
```

Jadi state bisa berubah dari accepted/sent menjadi bounced.

Ini bukan inkonsistensi. Ini realitas asynchronous delivery.

---

## 7. Complaint: Lebih Serius daripada Bounce

Complaint terjadi ketika recipient atau mailbox provider menganggap email sebagai spam/abuse.

Dampaknya:

- sender reputation turun,
- domain/IP reputation terganggu,
- provider bisa membatasi akun,
- email legitimate berikutnya bisa masuk spam,
- compliance risk jika user sudah unsubscribe tapi masih dikirimi email.

### 7.1 Complaint Event Harus Final untuk Recipient

Untuk kebanyakan sistem:

```text
complaint => suppress recipient for marketing/bulk email
```

Untuk transactional email, treatment bisa lebih nuanced.

Contoh:

- password reset tetap perlu dikirim jika user meminta secara eksplisit,
- regulatory notice mungkin wajib dikirim,
- marketing/newsletter harus berhenti.

Maka suppression sebaiknya punya dimensi:

```text
recipient
channel
message_category
tenant
reason
scope
```

Bukan hanya boolean global:

```text
email_suppressed = true
```

### 7.2 Complaint Feedback Tidak Selalu Memberi Semua Data

Karena privacy, complaint event kadang tidak memberikan full recipient atau original content. Provider mungkin menyertakan provider message ID, campaign ID, atau custom metadata.

Karena itu, saat sending, aplikasi perlu menanam correlation metadata.

Contoh header:

```text
X-App-Notification-Id: notif_123
X-App-Tenant-Id: tenant_a
X-App-Template-Key: password-reset-v3
```

Namun hati-hati:

- jangan masukkan PII sensitif,
- header bisa terlihat oleh penerima/server,
- provider bisa menghapus/menormalisasi header tertentu,
- metadata API provider sering lebih aman daripada custom header.

---

## 8. Dropped, Suppressed, Blocked: Failure Sebelum Delivery Attempt

Provider modern sering punya event `dropped` atau `suppressed`.

Artinya provider menolak mengirim sebelum attempt ke recipient server.

Penyebab:

- recipient sudah hard bounce sebelumnya,
- recipient pernah complaint,
- unsubscribe,
- invalid address,
- content filtered,
- template rejected,
- quota exceeded,
- account restricted,
- policy violation.

Contoh state:

```text
PROVIDER_ACCEPTED -> DROPPED
```

Atau:

```text
SEND_ATTEMPTED -> PROVIDER_REJECTED
```

Tergantung kapan provider memberi tahu.

Yang penting: dropped bukan sukses. Dropped adalah final non-delivery outcome.

---

## 9. State Machine Feedback Loop

Minimal state machine untuk enterprise email:

```text
REQUESTED
  -> QUEUED
  -> PROCESSING
  -> PROVIDER_ACCEPTED
  -> DELIVERED
  -> OPENED
  -> CLICKED

PROCESSING
  -> SEND_FAILED_RETRYABLE
  -> SEND_FAILED_PERMANENT

PROVIDER_ACCEPTED
  -> DEFERRED
  -> BOUNCED_SOFT
  -> BOUNCED_HARD
  -> DROPPED
  -> COMPLAINED

DELIVERED
  -> COMPLAINED
  -> BOUNCED_DELAYED?  (rare but possible depending provider semantics)
```

Untuk sistem yang lebih defensible:

```text
CREATED
VALIDATED
QUEUED
CLAIMED_BY_WORKER
RENDERED
SEND_ATTEMPTED
PROVIDER_ACCEPTED
PROVIDER_REJECTED
DELIVERY_CONFIRMED
DELIVERY_DEFERRED
BOUNCED_SOFT
BOUNCED_HARD
COMPLAINT_RECEIVED
SUPPRESSED
DEAD_LETTERED
CANCELLED
```

### 9.1 State vs Event

Jangan campur state dan event.

Event:

```text
EmailSendAttempted
ProviderAccepted
DeliverySucceeded
BounceReceived
ComplaintReceived
WebhookDuplicateIgnored
```

State:

```text
PROVIDER_ACCEPTED
DELIVERED
BOUNCED_HARD
COMPLAINED
```

Event adalah fakta historis. State adalah ringkasan terkini.

Untuk audit-grade system, simpan keduanya:

```text
email_notification.current_state
email_delivery_event.append_only_log
```

### 9.2 State Tidak Selalu Monotonic Sederhana

Contoh:

```text
PROVIDER_ACCEPTED -> DELIVERED -> COMPLAINED
```

Complaint bukan “mundur”. Itu outcome baru.

Contoh lain:

```text
PROVIDER_ACCEPTED -> BOUNCED_HARD
```

Ini normal untuk delayed bounce.

Maka state machine harus menerima asynchronous event setelah accepted.

### 9.3 Terminal State Harus Jelas

Terminal delivery states:

```text
DELIVERED
BOUNCED_HARD
DROPPED
COMPLAINED
CANCELLED
EXPIRED
```

Namun `COMPLAINED` bisa datang setelah `DELIVERED`.

Maka ada dua pendekatan:

#### Approach A — Single current state

```text
DELIVERED -> COMPLAINED
```

Sederhana, tapi kehilangan nuance bahwa pernah delivered.

#### Approach B — Current delivery state + flags

```text
current_delivery_state = DELIVERED
complaint_received = true
complaint_at = ...
```

Lebih cocok untuk analytics.

#### Approach C — Event-sourced delivery lifecycle

```text
events:
- ProviderAccepted
- Delivered
- ComplaintReceived

projection:
- latest_delivery_state = DELIVERED
- reputation_state = COMPLAINED
```

Paling kuat, tapi lebih kompleks.

---

## 10. Database Model

### 10.1 Core Notification Table

```sql
CREATE TABLE email_notification (
    id                    VARCHAR(64) PRIMARY KEY,
    tenant_id              VARCHAR(64) NOT NULL,
    message_category       VARCHAR(64) NOT NULL,
    template_key           VARCHAR(128) NOT NULL,
    template_version       VARCHAR(32),

    recipient_email_hash   VARCHAR(128) NOT NULL,
    recipient_email_masked VARCHAR(320) NOT NULL,

    provider_name          VARCHAR(64),
    provider_message_id    VARCHAR(256),
    smtp_message_id        VARCHAR(256),

    current_state          VARCHAR(64) NOT NULL,
    current_reason_code    VARCHAR(128),
    current_reason_text    VARCHAR(1024),

    attempt_count          INTEGER NOT NULL DEFAULT 0,
    next_attempt_at        TIMESTAMP NULL,

    created_at             TIMESTAMP NOT NULL,
    updated_at             TIMESTAMP NOT NULL,
    sent_at                TIMESTAMP NULL,
    accepted_at            TIMESTAMP NULL,
    delivered_at           TIMESTAMP NULL,
    bounced_at             TIMESTAMP NULL,
    complained_at          TIMESTAMP NULL,

    idempotency_key        VARCHAR(256) NOT NULL,
    UNIQUE (tenant_id, idempotency_key)
);
```

Catatan:

- Simpan masked recipient untuk operasional.
- Simpan hash untuk lookup tanpa membuka PII penuh.
- Provider message ID penting untuk webhook correlation.
- SMTP Message-ID penting untuk DSN/inbound correlation.
- `idempotency_key` mencegah duplicate notification intent.

### 10.2 Event Table

```sql
CREATE TABLE email_delivery_event (
    id                    VARCHAR(64) PRIMARY KEY,
    notification_id        VARCHAR(64) NOT NULL,
    event_type             VARCHAR(64) NOT NULL,
    event_source           VARCHAR(64) NOT NULL,

    provider_name          VARCHAR(64),
    provider_event_id      VARCHAR(256),
    provider_message_id    VARCHAR(256),

    event_time             TIMESTAMP NOT NULL,
    received_at            TIMESTAMP NOT NULL,

    recipient_email_hash   VARCHAR(128),
    smtp_status_code       VARCHAR(32),
    enhanced_status_code   VARCHAR(32),
    reason_code            VARCHAR(128),
    reason_text            VARCHAR(2048),

    raw_payload_ref        VARCHAR(512),
    payload_hash           VARCHAR(128) NOT NULL,

    UNIQUE (event_source, provider_name, provider_event_id)
);
```

Jika provider tidak memberi event ID, idempotency bisa memakai hash gabungan:

```text
provider + event_type + provider_message_id + recipient + timestamp + payload_hash
```

Namun hati-hati: timestamp kadang berbeda antar retry webhook. Lebih aman simpan payload hash dan fallback dedup window.

### 10.3 Suppression Table

```sql
CREATE TABLE email_suppression (
    id                   VARCHAR(64) PRIMARY KEY,
    tenant_id             VARCHAR(64) NOT NULL,
    recipient_email_hash  VARCHAR(128) NOT NULL,
    recipient_email_masked VARCHAR(320) NOT NULL,

    scope                 VARCHAR(64) NOT NULL,
    message_category      VARCHAR(64),
    reason                VARCHAR(64) NOT NULL,
    source                VARCHAR(64) NOT NULL,

    active                BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMP NOT NULL,
    updated_at            TIMESTAMP NOT NULL,
    expires_at            TIMESTAMP NULL,

    UNIQUE (tenant_id, recipient_email_hash, scope, COALESCE(message_category, '*'))
);
```

Possible `scope`:

```text
GLOBAL
TENANT
CATEGORY
MARKETING_ONLY
TRANSACTIONAL_EXCLUDED
```

Possible `reason`:

```text
HARD_BOUNCE
COMPLAINT
UNSUBSCRIBE
MANUAL_ADMIN
PROVIDER_SUPPRESSION
INVALID_ADDRESS
```

---

## 11. Correlation: Bagaimana Feedback Diikat ke Notification

Feedback event harus bisa dipetakan ke email yang dikirim.

Correlation options:

### 11.1 Provider Message ID

Saat provider menerima send request, ia mengembalikan message ID.

```text
notification.provider_message_id = response.messageId
```

Webhook kemudian membawa `messageId` yang sama.

Ini paling reliable untuk provider API.

### 11.2 SMTP Message-ID Header

Aplikasi bisa set `Message-ID` sendiri atau membiarkan Jakarta Mail membuatnya.

Untuk audit/correlation, aplikasi sering lebih baik membuat deterministic-but-unique message ID.

Contoh:

```text
<notif-01JABCDEF123@mailer.example.com>
```

Namun harus global unique dan domain valid.

### 11.3 VERP / Bounce Address Token

VERP = Variable Envelope Return Path.

Ide:

```text
bounce+notif_123+recipient_hash@example.com
```

Jika bounce masuk ke mailbox, token di alamat penerima bounce membantu correlation.

Contoh:

```text
MAIL FROM:<bounce+N12345.R67890@bounce.example.com>
```

Header From bisa tetap:

```text
From: no-reply@example.com
```

Envelope sender berbeda dari header From.

### 11.4 Custom Headers

Contoh:

```text
X-Notification-Id: notif_123
X-Correlation-Id: corr_abc
X-Template-Key: password-reset
```

Kelebihan:

- mudah debug,
- bisa muncul di returned original headers.

Kekurangan:

- bisa terlihat oleh penerima,
- bisa hilang,
- jangan isi PII.

### 11.5 Provider Metadata / Custom Args

Provider API biasanya mendukung metadata.

Contoh konseptual:

```json
{
  "to": "user@example.com",
  "template": "password-reset",
  "metadata": {
    "notification_id": "notif_123",
    "tenant_id": "tenant_a"
  }
}
```

Ini sering lebih baik daripada custom header karena provider akan mengembalikan metadata dalam webhook.

---

## 12. Webhook Consumer Architecture

Webhook endpoint tidak boleh langsung melakukan semua logic berat.

Pola yang lebih robust:

```text
Provider Webhook
  -> verify signature/authenticity
  -> normalize payload
  -> store raw event / event inbox
  -> ack quickly
  -> async processor updates notification state
```

### 12.1 Kenapa Jangan Proses Berat di HTTP Handler?

Karena webhook provider biasanya punya timeout dan retry policy.

Jika handler lambat:

- provider retry,
- duplicate event meningkat,
- system overload,
- retry storm.

Handler sebaiknya:

1. validasi minimal,
2. persist event,
3. return 2xx.

### 12.2 Inbound Event Inbox Pattern

Mirip outbox, tapi untuk incoming event.

```sql
CREATE TABLE inbound_provider_event (
    id                   VARCHAR(64) PRIMARY KEY,
    provider_name         VARCHAR(64) NOT NULL,
    provider_event_id     VARCHAR(256),
    event_type            VARCHAR(64),
    payload_hash          VARCHAR(128) NOT NULL,
    raw_payload           CLOB NOT NULL,
    received_at           TIMESTAMP NOT NULL,
    processed_at          TIMESTAMP NULL,
    processing_state      VARCHAR(64) NOT NULL,
    error_message         VARCHAR(2048),
    UNIQUE (provider_name, provider_event_id)
);
```

Jika tidak ada provider event ID:

```sql
UNIQUE (provider_name, payload_hash)
```

Tapi payload hash bisa gagal dedup jika provider menambahkan timestamp retry baru.

### 12.3 Normalized Event

Jangan biarkan seluruh aplikasi bergantung pada schema provider.

Buat normalized model:

```java
public final class NormalizedMailEvent {
    public enum Type {
        ACCEPTED,
        DELIVERED,
        DEFERRED,
        BOUNCED_SOFT,
        BOUNCED_HARD,
        DROPPED,
        COMPLAINED,
        OPENED,
        CLICKED,
        UNSUBSCRIBED,
        UNKNOWN
    }

    private final String provider;
    private final String providerEventId;
    private final String providerMessageId;
    private final String smtpMessageId;
    private final String notificationId;
    private final String recipientHash;
    private final Type type;
    private final String reasonCode;
    private final String reasonText;
    private final String smtpStatusCode;
    private final String enhancedStatusCode;
    private final Instant eventTime;
    private final Instant receivedAt;
}
```

Provider adapter bertugas mapping:

```text
SES Bounce     -> BOUNCED_HARD / BOUNCED_SOFT
SendGrid bounce -> BOUNCED_HARD
SendGrid dropped -> DROPPED
Mailgun failed permanent -> BOUNCED_HARD
Mailgun failed temporary -> BOUNCED_SOFT
ARF report -> COMPLAINED
```

---

## 13. Idempotency: Webhook Akan Duplicate

Webhook harus diasumsikan **at-least-once delivery**.

Artinya:

```text
satu event bisa diterima lebih dari sekali
```

Alasan:

- provider tidak menerima 2xx,
- network timeout,
- handler lambat,
- provider retry policy,
- manual replay,
- event stream redelivery.

### 13.1 Prinsip Idempotent Handler

Handler harus aman jika event sama diproses berulang.

Pseudo-flow:

```java
@Transactional
public void receiveWebhook(RawWebhook raw) {
    VerifiedWebhook verified = verifier.verify(raw);
    String eventKey = dedupKey(verified);

    if (inboundEventRepository.exists(eventKey)) {
        return; // duplicate ignored
    }

    inboundEventRepository.insert(verified.toInboundEvent(eventKey));
}
```

Processor:

```java
@Transactional
public void processInboundEvent(String inboundEventId) {
    InboundEvent event = inboundEventRepository.lock(inboundEventId);

    if (event.isProcessed()) {
        return;
    }

    NormalizedMailEvent normalized = normalizer.normalize(event);
    deliveryEventRepository.insertIfAbsent(normalized);
    notificationStateMachine.apply(normalized);

    inboundEventRepository.markProcessed(inboundEventId);
}
```

### 13.2 Duplicate Event Tidak Sama dengan Duplicate Outcome

Jika event duplicate `BOUNCED_HARD`, jangan:

- membuat suppression duplicate,
- mengirim alert duplicate,
- menambah counter bisnis berkali-kali,
- mengubah `bounced_at` berkali-kali secara misleading.

Gunakan uniqueness constraint.

```sql
UNIQUE(notification_id, event_type, provider_event_id)
```

Atau:

```sql
UNIQUE(notification_id, event_type, recipient_email_hash, event_time)
```

### 13.3 Event Out-of-Order

Event bisa datang seperti ini:

```text
T1 delivered generated by provider
T2 bounce generated by provider

arrival order:
T2 bounce arrives first
T1 delivered arrives later
```

State machine tidak boleh naif.

Bad logic:

```java
notification.setState(event.type().toState());
```

Better:

```java
stateMachine.apply(currentState, eventType, eventTime, precedenceRules);
```

---

## 14. Event Precedence Rules

Kita perlu aturan ketika event bertabrakan.

Contoh precedence:

```text
COMPLAINED        highest reputation impact
BOUNCED_HARD      final non-delivery
DROPPED           final non-delivery before attempt
DELIVERED         successful delivery
BOUNCED_SOFT      temporary failure
DEFERRED          temporary delay
ACCEPTED          provider accepted
OPENED/CLICKED    engagement side-channel, not delivery state
```

Namun precedence tidak selalu satu dimensi.

Lebih aman pisahkan projection:

```text
delivery_state:
  ACCEPTED / DEFERRED / DELIVERED / BOUNCED_SOFT / BOUNCED_HARD / DROPPED

reputation_state:
  NONE / COMPLAINED

engagement_state:
  NONE / OPENED / CLICKED
```

Dengan begitu:

```text
DELIVERED + COMPLAINED
```

bisa direpresentasikan tanpa kehilangan fakta delivered.

### 14.1 Example State Application

```java
public void apply(NormalizedMailEvent event, EmailNotification n) {
    switch (event.type()) {
        case DELIVERED -> {
            if (!n.isFinalNonDelivery()) {
                n.markDelivered(event.eventTime());
            }
        }
        case BOUNCED_HARD -> {
            n.markHardBounced(event.eventTime(), event.reasonCode(), event.reasonText());
            suppressionService.suppressHardBounce(n);
        }
        case BOUNCED_SOFT -> {
            if (!n.isFinalNonDelivery()) {
                n.markSoftBounced(event.eventTime(), event.reasonCode(), event.reasonText());
            }
        }
        case DROPPED -> {
            n.markDropped(event.eventTime(), event.reasonCode(), event.reasonText());
        }
        case COMPLAINED -> {
            n.markComplaint(event.eventTime(), event.reasonCode(), event.reasonText());
            suppressionService.suppressComplaint(n);
        }
        case OPENED -> n.markOpenedIfFirst(event.eventTime());
        case CLICKED -> n.markClickedIfFirst(event.eventTime());
        default -> n.recordUnknownEvent(event);
    }
}
```

---

## 15. Bounce Mailbox Processing with Jakarta Mail

Jika provider tidak memberi webhook, atau jika kita menggunakan SMTP relay biasa, kita bisa membaca bounce mailbox.

Architecture:

```text
SMTP Send
  MAIL FROM:<bounce+token@bounce.example.com>
      |
      v
Recipient server generates DSN
      |
      v
bounce mailbox
      |
      v
Java IMAP poller using Jakarta Mail
      |
      v
DSN parser
      |
      v
NormalizedMailEvent
```

### 15.1 Bounce Mailbox Poller

Pseudo-code:

```java
public final class BounceMailboxPoller {
    private final Session session;
    private final BounceMessageParser parser;
    private final InboundFeedbackService feedbackService;

    public void poll() throws MessagingException {
        Store store = session.getStore("imaps");
        store.connect();

        Folder inbox = store.getFolder("INBOX");
        inbox.open(Folder.READ_WRITE);

        Message[] messages = inbox.getMessages();
        for (Message message : messages) {
            try {
                Optional<NormalizedMailEvent> event = parser.parse(message);
                event.ifPresent(feedbackService::receive);
                message.setFlag(Flags.Flag.SEEN, true);
                // optionally move to processed folder
            } catch (Exception ex) {
                // move to error folder or mark with user flag if supported
            }
        }

        inbox.close(false);
        store.close();
    }
}
```

Production version harus punya:

- checkpoint,
- duplicate detection,
- folder move strategy,
- size limit,
- safe MIME parsing,
- poison message handling,
- connection timeout,
- metrics.

### 15.2 DSN Detection

DSN biasanya:

```text
Content-Type: multipart/report; report-type=delivery-status
```

Cari part:

```text
message/delivery-status
```

Pseudo-code:

```java
public Optional<DsnReport> parseDsn(Part part) throws Exception {
    if (part.isMimeType("multipart/report")) {
        Multipart mp = (Multipart) part.getContent();
        for (int i = 0; i < mp.getCount(); i++) {
            BodyPart bp = mp.getBodyPart(i);
            if (bp.isMimeType("message/delivery-status")) {
                return Optional.of(parseDeliveryStatus(bp));
            }
        }
    }
    return Optional.empty();
}
```

Masalah praktis:

- tidak semua bounce compliant,
- banyak bounce berupa free-form text,
- DSN bisa menyertakan original headers saja,
- recipient bisa dimasking,
- encoding bisa aneh,
- server lama bisa membuat format non-standard.

### 15.3 Token-Based Correlation Lebih Reliable daripada Parsing Text

Daripada regex dari body bounce:

```text
550 User unknown: john@example.com
```

lebih baik pakai VERP token:

```text
bounce+notif_123@example.com
```

Atau original header:

```text
X-Notification-Id: notif_123
```

Bounce parser mencari token tersebut.

---

## 16. Provider Webhook Security

Webhook endpoint adalah public attack surface.

Threats:

- fake bounce event,
- fake complaint event,
- replay attack,
- payload tampering,
- flooding,
- PII leakage,
- endpoint enumeration,
- malicious oversized payload,
- JSON parser abuse.

### 16.1 Verification

Provider biasanya menyediakan salah satu:

- HMAC signature,
- public key signature,
- basic auth,
- mTLS,
- signed timestamp,
- IP allowlist.

Minimal:

```text
verify signature
verify timestamp freshness
reject oversized payload
rate limit endpoint
log without PII
```

### 16.2 Replay Protection

Jika webhook menyertakan timestamp dan signature:

```text
reject if timestamp older than allowed window
dedup by event id
```

Contoh:

```java
if (Duration.between(event.timestamp(), now).abs().compareTo(MAX_SKEW) > 0) {
    throw new InvalidWebhookException("stale webhook");
}
```

### 16.3 Raw Payload Preservation

Untuk signature verification, sering harus memakai raw request body, bukan parsed JSON yang sudah dinormalisasi.

Bad:

```java
Map<String,Object> parsed = objectMapper.readValue(body);
String canonical = objectMapper.writeValueAsString(parsed);
verify(canonical);
```

Good:

```java
byte[] rawBody = request.getInputStream().readAllBytes();
verify(rawBody, headers);
```

### 16.4 Fail Closed vs Fail Open

Untuk security verification:

```text
verification failed => reject
```

Jangan simpan sebagai valid event.

Namun untuk schema parsing setelah verification:

```text
unknown field => tolerate
unknown event type => store as UNKNOWN for later analysis
```

---

## 17. Java Design: Provider Adapter Layer

Jangan expose provider payload ke domain service.

Design:

```text
WebhookController
  -> ProviderWebhookVerifier
  -> ProviderEventNormalizer
  -> InboundEventInbox
  -> MailDeliveryEventProcessor
  -> NotificationStateMachine
  -> SuppressionService
```

### 17.1 Interfaces

```java
public interface MailProviderWebhookVerifier {
    VerifiedWebhook verify(RawWebhookRequest request);
}
```

```java
public interface MailProviderEventNormalizer {
    List<NormalizedMailEvent> normalize(VerifiedWebhook webhook);
}
```

Satu webhook payload bisa berisi banyak event.

```java
public interface MailDeliveryStateMachine {
    void apply(NormalizedMailEvent event);
}
```

### 17.2 Controller Example

```java
@RestController
@RequestMapping("/webhooks/mail/{provider}")
public class MailWebhookController {
    private final MailWebhookRegistry registry;
    private final InboundMailEventInbox inbox;

    @PostMapping
    public ResponseEntity<Void> receive(
            @PathVariable String provider,
            HttpServletRequest request
    ) throws IOException {
        byte[] rawBody = request.getInputStream().readAllBytes();
        Map<String, List<String>> headers = extractHeaders(request);

        RawWebhookRequest raw = new RawWebhookRequest(provider, headers, rawBody, Instant.now());

        MailProviderWebhookVerifier verifier = registry.verifierFor(provider);
        VerifiedWebhook verified = verifier.verify(raw);

        inbox.storeIfAbsent(verified);

        return ResponseEntity.accepted().build();
    }
}
```

### 17.3 Async Processor

```java
public class InboundMailEventProcessor {
    private final InboundMailEventRepository inboundRepo;
    private final MailWebhookRegistry registry;
    private final DeliveryEventRepository deliveryEventRepo;
    private final MailDeliveryStateMachine stateMachine;

    @Transactional
    public void processNext() {
        InboundProviderEvent inbound = inboundRepo.claimNext();
        if (inbound == null) {
            return;
        }

        try {
            MailProviderEventNormalizer normalizer = registry.normalizerFor(inbound.provider());
            List<NormalizedMailEvent> events = normalizer.normalize(inbound.toVerifiedWebhook());

            for (NormalizedMailEvent event : events) {
                boolean inserted = deliveryEventRepo.insertIfAbsent(event);
                if (inserted) {
                    stateMachine.apply(event);
                }
            }

            inboundRepo.markProcessed(inbound.id());
        } catch (Exception ex) {
            inboundRepo.markFailed(inbound.id(), ex.getMessage());
            throw ex;
        }
    }
}
```

---

## 18. Handling Multi-Recipient Messages

SMTP dan email provider bisa mengirim satu message ke banyak recipients.

Masalah:

```text
one provider_message_id
multiple recipients
recipient-level outcome differs
```

Contoh:

```text
alice@example.com delivered
bob@example.com hard bounce
carol@example.com complained
```

Jika sistem menyimpan satu notification untuk semua recipients, state jadi ambigu.

Untuk enterprise system, lebih baik:

```text
one logical notification batch
  -> one recipient notification per recipient
```

Model:

```text
email_batch(id, template, business_context)
email_notification(id, batch_id, recipient, state)
```

Jadi feedback recipient-level bisa diterapkan akurat.

### 18.1 Jangan Pakai To Banyak untuk Personalized Email

Bad:

```text
To: alice@example.com, bob@example.com, carol@example.com
```

Masalah:

- privacy leak,
- personalization tidak mungkin,
- bounce correlation susah,
- per-recipient state ambigu.

Better:

```text
send one message per recipient
```

Untuk announcement internal kecil, multi-recipient bisa acceptable. Untuk enterprise notification, per-recipient lebih aman.

---

## 19. Race Conditions yang Sering Terjadi

### 19.1 Bounce Datang Sebelum Provider Accepted Disimpan

Skenario:

```text
T0 worker sends to provider
T1 provider returns accepted
T2 webhook bounce arrives very fast
T3 transaction worker belum commit provider_message_id
```

Jika webhook mencari notification by provider_message_id, lookup bisa gagal.

Solusi:

1. Simpan provider response dalam transaction cepat.
2. Webhook unknown masuk pending reconciliation.
3. Gunakan application-generated notification ID di metadata/header.
4. Processor retry lookup.

### 19.2 Duplicate Send dan Single Feedback

Jika send retry terjadi setelah timeout:

```text
T0 app sends
T1 provider accepts but response timeout
T2 app retries
T3 provider sends duplicate email
```

Feedback bisa datang untuk dua provider message ID.

Solusi:

- idempotency key provider jika tersedia,
- application outbox lock,
- detect timeout uncertainty,
- avoid blind retry for ambiguous accepted boundary,
- store send attempts separately.

### 19.3 Delivered Lalu Bounce

Mungkin karena provider semantics, forwarding, delayed DSN, atau event ordering.

Jangan langsung anggap data corrupt. Simpan event log, terapkan precedence/projection.

### 19.4 Complaint Setelah Unsubscribe

Jika user unsubscribe lalu masih complaint untuk email lama, event tetap valid.

Action:

- record complaint,
- ensure suppression active,
- do not reopen subscription.

### 19.5 Webhook Retry Setelah Sudah Processed

Normal. Must be idempotent.

---

## 20. Suppression Strategy

Suppression adalah keputusan untuk tidak mengirim email tertentu ke recipient tertentu.

### 20.1 Suppression Sources

```text
HARD_BOUNCE
COMPLAINT
UNSUBSCRIBE
MANUAL_ADMIN
PROVIDER_SUPPRESSION
INVALID_ADDRESS
LEGAL_REQUEST
```

### 20.2 Suppression Scope

```text
GLOBAL_EMAIL_CHANNEL
TENANT_LEVEL
CATEGORY_LEVEL
MARKETING_ONLY
TEMPLATE_LEVEL
TEMPORARY
```

### 20.3 Transactional vs Marketing

Tidak semua suppression berlaku sama.

Contoh:

| Event | Marketing | Transactional | Regulatory notice |
|---|---|---|---|
| Unsubscribe | stop | usually still allowed if service-related | depends on policy/law |
| Complaint | stop | maybe suppress unless user explicitly triggers | legal review needed |
| Hard bounce | stop | stop until address updated | alternative channel needed |
| Soft bounce | retry later | retry later | retry/escalate |

### 20.4 Suppression Check Before Send

Sebelum worker mengirim:

```java
SuppressionDecision decision = suppressionService.evaluate(
    tenantId,
    recipient,
    messageCategory,
    templateKey
);

if (decision.isSuppressed()) {
    notification.markSuppressed(decision.reason());
    return;
}
```

Jangan hanya mengandalkan provider suppression, karena aplikasi tetap perlu state/audit.

---

## 21. Bounce Classification Layer

Provider raw reason tidak boleh langsung dipakai oleh business logic.

Buat classifier:

```java
public enum DeliveryFailureClass {
    INVALID_RECIPIENT,
    MAILBOX_FULL,
    DOMAIN_NOT_FOUND,
    POLICY_REJECTION,
    SPAM_REJECTION,
    RATE_LIMITED,
    TEMPORARY_NETWORK,
    PROVIDER_SUPPRESSED,
    COMPLAINT,
    UNSUBSCRIBED,
    UNKNOWN_PERMANENT,
    UNKNOWN_TEMPORARY
}
```

Input classifier:

- provider event type,
- SMTP status code,
- enhanced status code,
- diagnostic text,
- provider reason code,
- previous history,
- message category.

Output:

```java
public final class DeliveryClassification {
    private final DeliveryFailureClass failureClass;
    private final boolean retryable;
    private final boolean suppressRecipient;
    private final boolean alertOps;
    private final Duration retryAfter;
}
```

### 21.1 Example Rules

```text
5.1.1 user unknown -> INVALID_RECIPIENT, permanent, suppress
5.2.2 mailbox full -> MAILBOX_FULL, retryable limited, no permanent suppress initially
4.7.0 rate limited -> RATE_LIMITED, retryable with backoff
spam complaint -> COMPLAINT, permanent, suppress marketing
provider dropped unsubscribed -> UNSUBSCRIBED, permanent for marketing
```

### 21.2 Classification Harus Bisa Diubah

Jangan hardcode semua rule di service business.

Gunakan:

- config table,
- enum + rule registry,
- provider adapter,
- feature flag,
- versioned classifier.

Karena real-world provider behavior berubah.

---

## 22. Operational Metrics

Feedback loop harus punya metrics sendiri.

### 22.1 Webhook Metrics

```text
mail_webhook_received_total{provider,event_type}
mail_webhook_verified_total{provider}
mail_webhook_rejected_total{provider,reason}
mail_webhook_duplicate_total{provider,event_type}
mail_webhook_processing_failed_total{provider,event_type}
mail_webhook_processing_latency_seconds{provider}
```

### 22.2 Delivery Outcome Metrics

```text
mail_delivery_delivered_total{provider,tenant,category}
mail_delivery_bounced_total{provider,tenant,category,bounce_type}
mail_delivery_complained_total{provider,tenant,category}
mail_delivery_dropped_total{provider,tenant,category,reason}
mail_delivery_deferred_total{provider,tenant,category}
```

### 22.3 Rate Metrics

```text
hard_bounce_rate = hard_bounce / sent_or_accepted
complaint_rate = complaint / delivered_or_sent
delivery_rate = delivered / accepted
unknown_feedback_rate = unknown_events / total_events
```

### 22.4 Alerting Examples

Alert jika:

- hard bounce rate naik tajam,
- complaint rate melewati threshold,
- webhook verification failure spike,
- event processing backlog tinggi,
- provider event schema unknown spike,
- delivered event drop tiba-tiba,
- dropped due to suppression naik tajam,
- bounce mailbox poller gagal lama,
- DSN parser error tinggi.

---

## 23. Audit Model

Untuk sistem enterprise/regulatory, audit harus membedakan fakta.

Bad audit:

```text
Email sent successfully.
```

Better audit:

```text
Notification generated at 2026-06-18T10:00:00Z.
Send attempt started at 2026-06-18T10:00:03Z.
Provider accepted message at 2026-06-18T10:00:04Z.
Provider message id: abc-123.
Delivery event received at 2026-06-18T10:00:10Z.
Recipient server accepted delivery.
```

Jika bounce:

```text
Provider accepted message at 10:00:04Z.
Hard bounce received at 10:00:32Z.
Reason: 5.1.1 user unknown.
Recipient suppressed for future marketing email.
```

### 23.1 Evidence Levels

| Evidence | Meaning | Strength |
|---|---|---|
| Generated | app created message | weak for delivery |
| Queued | app intended send | weak for delivery |
| SMTP/API accepted | provider/relay accepted | medium |
| Delivered event | provider says delivered | stronger, still not read proof |
| Bounce | non-delivery evidence | strong for failure |
| Complaint | user/provider abuse feedback | strong reputation event |
| Open | tracking image loaded | weak/ambiguous |
| Click | link hit | medium, but scanners exist |
| Read receipt | user/client dependent | weak/optional |

### 23.2 Raw Payload Retention

Simpan raw webhook/bounce?

Trade-off:

- pro: forensic/debug/audit,
- con: PII/security/retention burden.

Praktik lebih aman:

- simpan raw payload terenkripsi atau object storage protected,
- simpan reference di DB,
- redacted normalized fields di DB,
- retention policy jelas,
- access audited.

---

## 24. Interaction with Jakarta Mail

Jakarta Mail berperan dalam feedback loop pada beberapa area:

1. **Outbound Message-ID/Header**  
   Membuat `MimeMessage`, custom headers, envelope sender config.

2. **Bounce Mailbox Reader**  
   Menggunakan IMAP/POP3 `Store`, `Folder`, `Message`.

3. **MIME/DSN Parser**  
   Membaca `multipart/report`, `message/delivery-status`, original message headers.

4. **Fallback Provider**  
   Jika provider API tidak dipakai, SMTP relay masih bisa dipakai via Jakarta Mail.

5. **Testing**  
   Membuat raw MIME, fake SMTP, inbound mailbox simulation.

Namun Jakarta Mail tidak menyelesaikan:

- provider webhook verification,
- suppression policy,
- bounce classification,
- DMARC aggregate reporting,
- provider reputation analytics,
- delivery dashboard,
- provider-specific event API.

Top-level architecture harus menggabungkan Jakarta Mail dengan domain service dan provider integration layer.

---

## 25. Example End-to-End Flow

### 25.1 Sending

```text
1. Business module creates NotificationRequested.
2. Notification service validates recipient.
3. Suppression service checks whether recipient/category is allowed.
4. Template renderer creates body.
5. MIME composer builds message.
6. Outbox row inserted.
7. Worker claims row.
8. Provider adapter sends email.
9. Provider returns message id.
10. Notification state becomes PROVIDER_ACCEPTED.
```

### 25.2 Delivery Event

```text
1. Provider sends webhook: delivered.
2. Webhook controller verifies signature.
3. Raw event stored in inbound event inbox.
4. Processor normalizes event.
5. Event inserted into delivery event log.
6. State machine marks notification DELIVERED.
7. Metrics updated.
```

### 25.3 Hard Bounce

```text
1. Provider sends webhook: bounce, reason 5.1.1.
2. Webhook verified and stored.
3. Normalizer maps to BOUNCED_HARD.
4. Classifier maps to INVALID_RECIPIENT.
5. State machine marks notification BOUNCED_HARD.
6. Suppression record created.
7. User profile may be flagged email_invalid.
8. Audit event appended.
```

### 25.4 Complaint

```text
1. Provider sends complaint event.
2. App verifies event.
3. Event normalized to COMPLAINED.
4. Suppression created for marketing/category.
5. Complaint metrics incremented.
6. Alert may trigger if complaint rate threshold breached.
```

---

## 26. Common Anti-Patterns

### 26.1 `SENT` as Final State

Bad:

```text
Transport.send success => SENT forever
```

Better:

```text
Transport/API success => PROVIDER_ACCEPTED
Feedback can update final state later
```

### 26.2 No Provider Message ID Storage

Without provider message ID, webhook correlation becomes fragile.

### 26.3 No Idempotency

Webhook duplicate creates duplicate suppression, duplicate audit, duplicate alerts.

### 26.4 Treating Complaint as Just Another Bounce

Complaint affects reputation and user preference. It needs separate handling.

### 26.5 Global Suppression Too Aggressive

Suppressing all transactional email after marketing unsubscribe can break user flows.

### 26.6 No Raw Event Preservation

When incident happens, no one can reconstruct provider payload.

### 26.7 Parsing Bounce Body with Fragile Regex Only

Free-form bounce text varies wildly. Prefer DSN structured fields, provider webhook, VERP token, and original headers.

### 26.8 Ignoring Unknown Events

Unknown event types should be stored and monitored. Provider schema changes happen.

### 26.9 Logging Full Recipient and Payload Everywhere

Feedback events may contain PII. Redact logs.

### 26.10 Synchronous Heavy Webhook Processing

Webhook endpoint should be fast and idempotent.

---

## 27. Production Checklist

### 27.1 Sending Metadata

- [ ] Store notification ID.
- [ ] Store provider message ID.
- [ ] Store SMTP Message-ID.
- [ ] Use custom metadata/header safely.
- [ ] Use VERP/bounce token if processing bounce mailbox.
- [ ] Store masked/hash recipient.

### 27.2 Webhook

- [ ] Verify signature.
- [ ] Verify timestamp if available.
- [ ] Enforce payload size limit.
- [ ] Store raw event or safe reference.
- [ ] Deduplicate.
- [ ] Return 2xx quickly after persistence.
- [ ] Process async.
- [ ] Monitor duplicate/rejected/unknown event.

### 27.3 State Machine

- [ ] Separate event log and current state.
- [ ] Support delayed bounce.
- [ ] Support complaint after delivered.
- [ ] Support out-of-order events.
- [ ] Do not overwrite important terminal state naively.
- [ ] Keep event timestamps and received timestamps.

### 27.4 Bounce/Complaint

- [ ] Classify hard vs soft.
- [ ] Create suppression for hard bounce.
- [ ] Create suppression for complaint.
- [ ] Scope suppression correctly.
- [ ] Distinguish marketing vs transactional.
- [ ] Alert on high bounce/complaint rate.

### 27.5 Bounce Mailbox

- [ ] Use IMAPS.
- [ ] Use checkpoint/folder move.
- [ ] Parse DSN if available.
- [ ] Use VERP token.
- [ ] Handle malformed MIME.
- [ ] Avoid reprocessing.
- [ ] Protect against oversized messages.

### 27.6 Audit/Compliance

- [ ] Do not say delivered unless evidence supports it.
- [ ] Record provider accepted separately from delivery confirmation.
- [ ] Retain event evidence according to policy.
- [ ] Redact PII in logs.
- [ ] Restrict raw payload access.

---

## 28. A More Mature Status Vocabulary

For user-facing UI, avoid exposing too many technical states.

Internal states:

```text
REQUESTED
QUEUED
PROCESSING
PROVIDER_ACCEPTED
DELIVERED
DEFERRED
BOUNCED_SOFT
BOUNCED_HARD
DROPPED
COMPLAINED
SUPPRESSED
FAILED
```

User/admin-facing simplified states:

```text
Pending
Sent to provider
Delivered
Temporarily delayed
Failed
Suppressed
Complaint received
```

Regulatory/audit view should show more detail.

Customer/user view should be simpler.

---

## 29. Key Takeaways

1. Email sending is not complete at SMTP/API success.
2. `SENT` should often mean `PROVIDER_ACCEPTED`, not delivered to inbox.
3. Bounce and complaint are asynchronous feedback events.
4. Feedback can arrive late, duplicate, or out-of-order.
5. Webhook handlers must be verified, idempotent, fast, and async.
6. Store raw/normalized event separately from current notification state.
7. Use provider message ID, SMTP Message-ID, metadata, custom header, or VERP token for correlation.
8. Hard bounce and complaint should feed suppression logic.
9. Suppression must be scoped by tenant/category/use case.
10. Complaint is reputation-sensitive and should not be treated as ordinary failure.
11. Jakarta Mail is useful for MIME, Message-ID/header, SMTP, and bounce mailbox parsing, but not enough for provider feedback architecture.
12. A top-tier mail subsystem models delivery as lifecycle + event stream, not a boolean.

---

## 30. References

- RFC 3464 — An Extensible Message Format for Delivery Status Notifications.
- RFC 3461 — SMTP Service Extension for Delivery Status Notifications.
- RFC 5965 — An Extensible Format for Email Feedback Reports.
- RFC 6449 — Complaint Feedback Loop Operational Recommendations.
- RFC 5321 — Simple Mail Transfer Protocol.
- Jakarta Mail API documentation.
- Eclipse Angus Mail documentation.
- Amazon SES notification documentation.
- Twilio SendGrid Event Webhook documentation.

---

## 31. What Comes Next

Part berikutnya:

```text
Part 24 — Template Architecture and Domain Notification Design
```

Kita akan naik satu level dari delivery feedback ke domain design:

- notification domain model,
- template identity,
- template versioning,
- variable schema,
- localization,
- preview rendering,
- approval workflow,
- storing rendered content vs template+data,
- channel abstraction,
- audit defensibility.

