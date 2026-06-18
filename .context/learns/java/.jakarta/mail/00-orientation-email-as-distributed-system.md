# Part 0 — Orientation: Email as a Distributed System

> Series: `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery`  
> File: `00-orientation-email-as-distributed-system.md`  
> Scope: Java 8 sampai Java 25, JavaMail/`javax.mail`, Jakarta Mail/`jakarta.mail`, SMTP, MIME, Jakarta Activation, dan enterprise-grade email delivery architecture.

---

## 0.1. Kenapa Part 0 Ini Penting?

Banyak developer belajar email dari contoh seperti ini:

```java
Transport.send(message);
```

Lalu mereka merasa sudah memahami email di Java. Padahal, dalam production system, baris itu hanya ujung paling kecil dari sistem yang jauh lebih besar.

Email bukan sekadar “mengirim teks ke alamat penerima”. Email adalah **distributed system** dengan banyak aktor, banyak boundary, banyak format, banyak policy, banyak failure mode, dan banyak asumsi yang sering salah.

Dalam aplikasi enterprise, terutama aplikasi case management, regulatory system, notification system, workflow engine, payment, compliance, atau citizen-facing service, email sering menjadi bagian dari proses bisnis yang penting:

- mengirim acknowledgement;
- mengirim reminder;
- mengirim approval/rejection notice;
- mengirim attachment resmi;
- mengirim OTP atau magic link;
- mengirim invoice;
- mengirim regulatory notice;
- mengirim internal escalation;
- mengirim evidence bahwa suatu pihak sudah dinotifikasi.

Masalahnya: **SMTP accepted tidak sama dengan user menerima email.**

Kalau application log menulis `email sent successfully`, itu biasanya hanya berarti:

> aplikasi berhasil menyerahkan message ke SMTP server/relay.

Bukan berarti:

- email sudah masuk inbox;
- email sudah dibaca;
- email tidak masuk spam;
- attachment tidak diblokir;
- alamat recipient valid;
- recipient server menerima final delivery;
- user melihat email;
- email bisa dijadikan bukti mutlak bahwa penerima sudah aware.

Mental model inilah yang membedakan developer biasa dengan engineer yang mampu mendesain email subsystem yang reliable, secure, observable, dan defensible.

---

## 0.2. Tujuan Part 0

Part ini tidak dimulai dari API. Part ini membangun peta besar terlebih dahulu.

Setelah menyelesaikan bagian ini, kamu harus bisa menjelaskan:

1. apa sebenarnya yang terjadi saat aplikasi Java “mengirim email”;
2. siapa saja aktor dalam perjalanan email;
3. apa bedanya message, envelope, transport, mailbox, dan delivery;
4. kenapa email harus diperlakukan sebagai asynchronous distributed workflow;
5. apa peran JavaMail/Jakarta Mail;
6. apa peran Jakarta Activation;
7. apa yang tidak bisa dijamin oleh Jakarta Mail;
8. bagaimana posisi SMTP dibanding provider API seperti SES/SendGrid/Mailgun/Postmark;
9. kenapa outbox, retry, idempotency, audit, dan observability adalah bagian inti dari sistem email;
10. bagaimana arah belajar di part berikutnya.

---

## 0.3. Baseline Fakta Teknologi

Sebelum masuk konsep, kita tetapkan baseline versi dan istilah.

### 0.3.1. JavaMail dan Jakarta Mail

JavaMail lama menggunakan namespace:

```java
javax.mail.*
javax.mail.internet.*
```

Jakarta Mail modern menggunakan namespace:

```java
jakarta.mail.*
jakarta.mail.internet.*
```

Secara konsep, keduanya melayani domain yang sama: API untuk membangun aplikasi mail dan messaging yang protocol-independent dan platform-independent. Oracle mendeskripsikan JavaMail sebagai framework platform-independent dan protocol-independent untuk membangun aplikasi mail dan messaging. Jakarta Mail juga mendefinisikan framework platform-independent dan protocol-independent untuk membangun mail and messaging applications.

Rujukan resmi:

- Oracle JavaMail overview: https://www.oracle.com/java/technologies/javamail.html
- Jakarta Mail specification page: https://jakarta.ee/specifications/mail/
- Jakarta Mail 2.1: https://jakarta.ee/specifications/mail/2.1/
- Jakarta Mail API documentation: https://jakartaee.github.io/mail-api/

Catatan versi penting:

- `javax.mail` relevan untuk Java EE / Jakarta EE 8 era dan aplikasi Java 8 legacy.
- `jakarta.mail` relevan untuk Jakarta EE 9+ namespace modern.
- Jakarta Mail 2.1 adalah release untuk Jakarta EE 10 dan mensyaratkan minimum Java SE 11 menurut halaman spesifikasinya.
- Jakarta EE 11 sudah tersedia, sementara Jakarta EE 12 masih under development pada saat materi ini ditulis.
- Untuk implementasi modern, Eclipse Angus Mail adalah compatible implementation untuk Jakarta Mail Specification 2.1+.

### 0.3.2. Jakarta Activation

Jakarta Activation adalah pasangan penting untuk mail, terutama ketika berurusan dengan MIME type, attachment, data source, dan data handler.

Jakarta Activation mendefinisikan layanan standar untuk:

- menentukan MIME type dari data;
- mengenkapsulasi akses ke data;
- menemukan operation yang tersedia terhadap data tersebut;
- menginstansiasi bean yang sesuai untuk operation tersebut.

Rujukan resmi:

- Jakarta Activation specification page: https://jakarta.ee/specifications/activation/
- Jakarta Activation 2.1: https://jakarta.ee/specifications/activation/2.1/
- Jakarta Activation API page: https://jakartaee.github.io/jaf-api/

### 0.3.3. Eclipse Angus

Eclipse Angus Mail adalah implementasi modern untuk Jakarta Mail. Dokumentasinya menyebut Angus Mail sebagai compatible implementation dari Jakarta Mail Specification 2.1+ dan dapat digunakan di Java SE maupun Jakarta EE.

Rujukan:

- Angus Mail: https://eclipse-ee4j.github.io/angus-mail/
- Angus Mail API docs: https://eclipse-ee4j.github.io/angus-mail/docs/api/jakarta.mail/module-summary.html

---

## 0.4. Mental Model Besar: Email Itu Bukan Function Call

Bayangkan sistem Java memiliki method seperti ini:

```java
mailService.sendApprovalNotice(caseId, recipientEmail);
```

Secara surface-level, ini terlihat seperti function call biasa.

Namun secara realita, call tersebut melewati beberapa dunia:

```text
Business Event
   ↓
Notification Decision
   ↓
Template Rendering
   ↓
MIME Message Construction
   ↓
SMTP Client
   ↓
SMTP Relay / Email Provider
   ↓
Recipient Mail Infrastructure
   ↓
Mailbox / Spam Folder / Rejection / Bounce
   ↓
Optional Feedback Loop
```

Setiap panah memiliki kemungkinan gagal.

Contoh:

| Layer | Contoh Failure |
|---|---|
| Business event | event duplicate, wrong recipient, stale case state |
| Notification decision | template salah, channel disabled, recipient preference ignored |
| Template rendering | missing variable, HTML broken, unsafe escaping |
| MIME construction | invalid charset, broken attachment, malformed multipart |
| SMTP client | timeout, auth failed, TLS failed |
| SMTP relay | rate limit, content rejected, quota exceeded |
| Recipient infra | mailbox full, domain not found, spam rejection |
| Feedback loop | bounce webhook duplicate, delayed, or lost |

Jadi pertanyaan engineering-nya bukan hanya:

> Bagaimana kirim email dengan Java?

Pertanyaan yang lebih matang adalah:

> Bagaimana mendesain subsystem yang bisa mengambil keputusan notification, membangun message yang benar, mengirim melalui transport yang aman, menangani failure secara eksplisit, mencegah duplikasi, menyediakan audit trail, dan memberi observability yang cukup untuk operasi production?

---

## 0.5. Actor dalam Sistem Email

Mari pecah aktor-aktornya.

### 0.5.1. Business Application

Ini aplikasi utama: misalnya regulatory case management system, payment system, workflow system, atau citizen portal.

Tugas business application seharusnya bukan “mengerti semua detail SMTP”, tetapi:

- menentukan bahwa notification perlu dikirim;
- menentukan recipient;
- menentukan template;
- menentukan data yang boleh masuk email;
- mencatat keputusan bisnis;
- tidak mengirim email secara sembrono di tengah transaksi kritikal.

Contoh business event:

```text
CaseSubmitted
AppealRejected
InspectionScheduled
PaymentReminderDue
OfficerAssigned
RegulatoryNoticeIssued
```

### 0.5.2. Notification Service / Mail Module

Ini boundary internal yang menerjemahkan domain event menjadi email request.

Tanggung jawabnya:

- validasi recipient;
- pemilihan template;
- rendering;
- MIME composition;
- deduplication;
- outbox persistence;
- dispatch scheduling;
- retry;
- status tracking;
- audit metadata.

Dalam sistem kecil, ini bisa berupa class/module dalam aplikasi yang sama. Dalam sistem besar, ini bisa menjadi service terpisah.

### 0.5.3. JavaMail / Jakarta Mail Client

Ini library/API yang digunakan aplikasi Java untuk:

- membuat message;
- membuat MIME structure;
- mengatur header;
- menambahkan attachment;
- mengirim melalui SMTP;
- membaca mailbox melalui IMAP/POP3 jika diperlukan.

JavaMail/Jakarta Mail bukan email provider. Ia adalah **client-side API**.

### 0.5.4. SMTP Relay / SMTP Server / Email Provider

Aplikasi biasanya tidak mengirim langsung ke recipient mailbox. Aplikasi menyerahkan email ke SMTP relay atau email provider.

Contoh bentuk relay/provider:

- corporate SMTP relay;
- cloud provider SMTP endpoint;
- Amazon SES SMTP interface;
- SendGrid SMTP relay;
- Mailgun SMTP relay;
- Postmark SMTP relay;
- internal MTA seperti Postfix/Exchange relay.

SMTP relay bertugas menerima message dari aplikasi dan meneruskan ke infrastruktur email berikutnya.

### 0.5.5. MTA — Mail Transfer Agent

MTA adalah komponen yang memindahkan email antar server.

Contoh MTA:

- Postfix;
- Exim;
- Microsoft Exchange transport;
- provider-operated MTA.

Aplikasi Java biasanya tidak berinteraksi langsung dengan semua MTA. Tetapi failure dari MTA bisa muncul sebagai SMTP code, bounce, atau delayed delivery.

### 0.5.6. Recipient Mail Server

Ini server milik domain penerima.

Contoh:

- Gmail receiving infrastructure;
- Microsoft 365/Exchange Online;
- corporate mail server;
- government mail gateway;
- university mail server.

Recipient server bisa:

- accept email;
- reject email;
- greylist email;
- quarantine email;
- mark as spam;
- silently drop dalam skenario tertentu;
- accept lalu bounce belakangan.

### 0.5.7. Mailbox Provider / User Agent

Mailbox provider menyimpan email untuk user. User agent adalah aplikasi pembaca email:

- Gmail web/mobile;
- Outlook;
- Apple Mail;
- Thunderbird;
- mobile mail app.

Client rendering berbeda-beda. HTML email yang terlihat bagus di browser bisa rusak di Outlook.

### 0.5.8. Spam Filter / Security Gateway

Email melewati policy engine:

- spam scoring;
- antivirus scanning;
- attachment blocking;
- link rewriting;
- phishing detection;
- DKIM/SPF/DMARC alignment;
- corporate DLP;
- sandboxing attachment;
- quarantine workflow.

Ini sebabnya email yang “berhasil dikirim” belum tentu sampai ke inbox.

### 0.5.9. Bounce Processor / Feedback Loop

Untuk sistem matang, kamu perlu tahu ketika email gagal setelah diterima relay.

Feedback bisa datang melalui:

- bounce mailbox;
- provider webhook;
- complaint feedback loop;
- delivery event API;
- suppression list.

Tanpa feedback loop, sistem hanya tahu “sudah dicoba kirim”, bukan outcome final.

---

## 0.6. Peta Perjalanan Email

Berikut peta sederhana outbound email:

```text
[Java Application]
      |
      | 1. Build MimeMessage
      v
[Jakarta Mail SMTP Client]
      |
      | 2. SMTP handshake/auth/TLS
      v
[SMTP Relay / Provider]
      |
      | 3. Queue, scan, route
      v
[Recipient MX / Mail Gateway]
      |
      | 4. Accept/reject/filter
      v
[Mailbox / Spam / Quarantine]
      |
      | 5. User may or may not see it
      v
[Optional Bounce/Webhook/Complaint]
```

Yang perlu diperhatikan:

1. Step 1 dan 2 berada dekat dengan aplikasi.
2. Step 3 ke bawah sebagian besar berada di luar kendali aplikasi.
3. Jakarta Mail terutama membantu step 1 dan 2.
4. Deliverability dan final mailbox placement tidak dijamin oleh Jakarta Mail.
5. Production design harus menyimpan state dan evidence yang realistis.

---

## 0.7. Email sebagai Distributed System

Sistem email memiliki ciri-ciri distributed system:

### 0.7.1. Network Boundary

SMTP call melewati network. Network bisa:

- lambat;
- timeout;
- reset;
- DNS gagal;
- TLS handshake gagal;
- firewall block;
- proxy interfere;
- NAT exhausted;
- ephemeral port exhausted.

Karena itu, SMTP send tidak boleh dianggap local operation.

### 0.7.2. Partial Failure

Satu message bisa punya beberapa recipient.

Contoh:

```text
To: valid1@example.com
To: invalid@example.com
To: valid2@example.com
```

SMTP server bisa menerima dua recipient dan menolak satu recipient. Ini disebut partial failure.

Jika kode hanya menangkap `Exception` lalu mark seluruh message sebagai failed, kamu bisa salah. Jika kode mark seluruh message sebagai sent, kamu juga bisa salah.

### 0.7.3. Asynchronous Outcome

SMTP relay bisa accept message sekarang, tetapi recipient server bisa bounce beberapa menit atau jam kemudian.

Jadi state machine email tidak cukup hanya:

```text
PENDING → SENT
```

Lebih realistis:

```text
PENDING
  → DISPATCHING
  → ACCEPTED_BY_RELAY
  → DELIVERED?             optional if provider gives event
  → BOUNCED_SOFT?           optional
  → BOUNCED_HARD?           optional
  → COMPLAINED?             optional
  → SUPPRESSED?             optional
```

Untuk banyak enterprise app, minimal state yang realistis:

```text
PENDING
PROCESSING
SENT_TO_RELAY
FAILED_RETRYABLE
FAILED_PERMANENT
DEAD_LETTER
```

### 0.7.4. No Exactly Once Delivery

Email tidak punya exactly-once guarantee dari perspektif aplikasi.

Kamu bisa mengalami:

- aplikasi timeout setelah relay menerima email;
- aplikasi retry karena mengira gagal;
- recipient menerima dua email;
- webhook bounce datang dua kali;
- worker crash setelah send berhasil tetapi sebelum update DB;
- DB update berhasil tetapi send gagal;
- message dikirim ulang setelah recovery.

Karena itu desain yang benar menggunakan:

- idempotency key;
- outbox;
- send attempt record;
- deduplication;
- retry policy;
- business-level duplicate guard;
- observability.

### 0.7.5. Independent Policy Domains

Aplikasi, relay, recipient MX, spam filter, dan mailbox provider memiliki policy sendiri.

Contoh:

- aplikasi mengizinkan attachment `.zip`;
- SMTP relay mengizinkan;
- recipient gateway memblokir;
- user tidak pernah melihat email;
- bounce mungkin tidak dikirim karena policy security.

Jadi desain harus mengakui bahwa email melewati banyak policy domain.

---

## 0.8. Message vs Envelope: Konsep yang Sering Salah

Salah satu kesalahan fundamental adalah mencampuradukkan **SMTP envelope** dan **message header**.

### 0.8.1. Message Header

Ini bagian yang terlihat dalam email.

Contoh:

```text
From: Case Management System <no-reply@example.gov>
To: Alice <alice@example.com>
Subject: Your application has been approved
Reply-To: support@example.gov
```

Header ini menjadi bagian dari message content.

### 0.8.2. SMTP Envelope

SMTP envelope digunakan selama transport.

Contoh command SMTP:

```text
MAIL FROM:<bounce@example.gov>
RCPT TO:<alice@example.com>
DATA
...
```

Envelope sender sering menjadi alamat bounce/return-path. Header `From` adalah identitas yang user lihat.

### 0.8.3. Kenapa Ini Penting?

Karena beberapa hal bergantung pada envelope, bukan header:

- bounce routing;
- SPF check;
- return path;
- provider feedback;
- recipient validation;
- suppression logic.

Sedangkan beberapa hal bergantung pada header:

- user trust;
- reply behavior;
- display identity;
- threading;
- DKIM signing scope;
- DMARC alignment.

### 0.8.4. Kesalahan Umum

Kesalahan umum:

```text
From: no-reply@app.local
SMTP username: smtp-vendor-user
Envelope sender: default provider address
```

Lalu tim heran kenapa email masuk spam atau gagal DMARC alignment.

Top 1% engineer tidak hanya bertanya “SMTP host apa?”, tetapi juga:

- domain apa yang menjadi Header From?
- domain apa yang menjadi envelope sender?
- apakah SPF align?
- apakah DKIM sign domain align?
- apakah DMARC policy domain penerima akan menerima?
- bounce akan masuk ke mana?
- apakah tenant boleh memakai domain sendiri?

---

## 0.9. SMTP Accepted Tidak Sama dengan Delivered

Mari detailkan state outcome.

### 0.9.1. Constructed

Aplikasi berhasil membuat `MimeMessage`.

Ini belum berarti email dikirim.

### 0.9.2. Submitted to SMTP Client

Kode mulai membuka koneksi SMTP.

Possible failure:

- DNS gagal;
- connection refused;
- TLS failure;
- auth failure;
- timeout.

### 0.9.3. Accepted by Relay

SMTP relay mengembalikan success code.

Ini biasanya dianggap “sent” oleh banyak aplikasi.

Namun secara presisi, lebih tepat disebut:

```text
ACCEPTED_BY_RELAY
```

atau:

```text
SUBMITTED_TO_PROVIDER
```

### 0.9.4. Delivered to Recipient Mailbox

Ini hanya bisa diketahui kalau provider memberi delivery event atau kamu punya integrasi feedback.

Tidak semua SMTP relay memberi event ini.

### 0.9.5. Opened / Read

Read receipt dan open tracking tidak reliable untuk bukti kuat.

Alasannya:

- image blocking;
- privacy proxy;
- corporate gateway prefetch;
- user agent behavior;
- read receipt bisa ditolak user.

Untuk regulatory-grade system, “opened” bukan evidence yang sama kuatnya dengan “notice generated” atau “submitted to approved channel”.

---

## 0.10. Apa yang Jakarta Mail Bisa dan Tidak Bisa Lakukan

### 0.10.1. Yang Bisa Dilakukan

Jakarta Mail dapat membantu:

1. membuat email message;
2. mengatur header;
3. mengatur recipient;
4. membuat MIME multipart;
5. menambahkan attachment;
6. mengirim lewat SMTP;
7. membaca mailbox lewat IMAP/POP3;
8. parsing message;
9. mengelola folder/mailbox;
10. menangani exception dari protocol interaction.

### 0.10.2. Yang Tidak Bisa Dijamin

Jakarta Mail tidak bisa menjamin:

1. email masuk inbox;
2. email tidak masuk spam;
3. recipient membuka email;
4. DKIM/SPF/DMARC benar;
5. IP/domain reputation bagus;
6. bounce diproses;
7. template sesuai brand;
8. attachment tidak diblokir security gateway;
9. email tidak duplicate;
10. retry policy benar;
11. audit trail cukup untuk compliance;
12. credential rotation aman;
13. PII tidak bocor di logs;
14. user preference dipatuhi;
15. unsubscribe/compliance terpenuhi.

Ini bukan kekurangan Jakarta Mail. Ini memang bukan layer tanggung jawabnya.

---

## 0.11. Posisi JavaMail/Jakarta Mail dalam Arsitektur

### 0.11.1. Layer yang Ideal

Dalam sistem yang bersih, Jakarta Mail sebaiknya berada di infrastructure adapter.

```text
Domain Layer
  - CaseSubmitted
  - PaymentReminderDue
  - NoticeIssued

Application Layer
  - Decide notification
  - Create MailRequest
  - Persist outbox

Infrastructure Layer
  - Render template
  - Compose MIME
  - Send via Jakarta Mail SMTP
  - Map provider failure
```

Jangan biarkan domain logic langsung bergantung pada `MimeMessage`.

Buruk:

```java
public class CaseService {
    public void approveCase(CaseId id) {
        // update case
        MimeMessage message = new MimeMessage(session);
        message.setSubject("Approved");
        Transport.send(message);
    }
}
```

Lebih baik:

```java
public class CaseService {
    public void approveCase(CaseId id) {
        // update case
        domainEvents.publish(new CaseApproved(id));
    }
}
```

Lalu notification handler:

```java
public class CaseNotificationHandler {
    public void on(CaseApproved event) {
        mailOutbox.enqueue(MailRequest.caseApproved(event.caseId()));
    }
}
```

Lalu worker:

```java
public class MailDispatchWorker {
    public void dispatchPending() {
        MailOutboxItem item = repository.lockNextPending();
        MailSendResult result = mailGateway.send(item.toMailRequest());
        repository.recordResult(item.id(), result);
    }
}
```

Dengan begini, SMTP failure tidak merusak transaksi bisnis utama secara langsung.

---

## 0.12. Email Bukan Hanya Channel, Tetapi Workflow

Dalam production system, email punya lifecycle.

Contoh lifecycle sederhana:

```text
CREATED
  ↓
READY_TO_RENDER
  ↓
RENDERED
  ↓
QUEUED
  ↓
DISPATCHING
  ↓
SUBMITTED_TO_RELAY
  ↓
FINALIZED
```

Untuk sistem lebih matang:

```text
CREATED
  ↓
VALIDATED
  ↓
RENDERED
  ↓
QUEUED
  ↓
PROCESSING
  ├── SENT_TO_RELAY
  │     ├── DELIVERED               optional provider event
  │     ├── BOUNCED_SOFT            optional
  │     ├── BOUNCED_HARD            optional
  │     └── COMPLAINED              optional
  ├── FAILED_RETRYABLE
  │     └── QUEUED_FOR_RETRY
  ├── FAILED_PERMANENT
  └── DEAD_LETTER
```

State machine seperti ini penting karena email adalah **side effect external**.

Side effect external harus diperlakukan hati-hati:

- tidak bisa rollback seperti DB transaction;
- tidak bisa dijamin exactly-once;
- bisa berhasil walaupun aplikasi mengira gagal;
- bisa gagal belakangan;
- bisa punya dampak hukum/operasional.

---

## 0.13. Core Domain Vocabulary

Sebelum masuk API, kuasai vocabulary berikut.

### 0.13.1. Mail Request

Representasi niat aplikasi untuk mengirim email.

Contoh field:

```text
id
idempotencyKey
notificationType
tenantId
recipient
cc
bcc
templateId
templateVersion
templateData
attachmentRefs
priority
createdBy
createdAt
correlationId
```

Mail request bukan `MimeMessage`. Ia masih domain/application-level.

### 0.13.2. Rendered Mail

Hasil rendering template.

Contoh:

```text
subject
plainTextBody
htmlBody
resolvedRecipients
resolvedAttachments
renderedAt
templateVersion
```

### 0.13.3. MIME Message

Representasi technical email sesuai format MIME.

Di Java/Jakarta Mail biasanya berupa:

```java
MimeMessage
MimeBodyPart
MimeMultipart
```

### 0.13.4. Send Attempt

Satu percobaan pengiriman.

Satu mail request bisa punya banyak attempt.

Contoh:

```text
attemptNo
startedAt
endedAt
smtpHost
smtpResponseCode
exceptionClass
failureCategory
latencyMs
```

### 0.13.5. Delivery Event

Event setelah send attempt.

Contoh:

```text
providerAccepted
delivered
bounced
complained
suppressed
opened
clicked
```

Tidak semua sistem membutuhkan semua event ini.

---

## 0.14. Minimal Architecture yang Masuk Akal

Untuk aplikasi enterprise, minimal desain yang sehat:

```text
[Business Transaction]
      |
      | write domain data
      | write mail_outbox row
      v
[Database Commit]
      |
      v
[Mail Worker]
      |
      | lock pending row
      | render template
      | compose MIME
      | send SMTP
      | record attempt
      v
[SMTP Relay]
```

Kenapa outbox penting?

Karena kalau kamu mengirim email di tengah transaksi:

```text
BEGIN TRANSACTION
  update case status
  send email
  insert audit
COMMIT
```

maka banyak failure aneh muncul:

1. Email terkirim, lalu DB rollback.
2. DB commit, tetapi email gagal.
3. Email timeout, tetapi sebenarnya relay menerima.
4. User menerima email untuk state yang tidak pernah committed.
5. Request latency membengkak karena SMTP lambat.

Dengan outbox:

```text
BEGIN TRANSACTION
  update case status
  insert mail_outbox
  insert audit
COMMIT

Async worker sends email after commit.
```

Ini lebih defensible karena notification adalah konsekuensi dari committed state.

---

## 0.15. Apa Itu “Top 1%” dalam Konteks Email Engineering?

Dalam konteks ini, “top 1%” bukan berarti hafal semua property Jakarta Mail. Itu hanya sebagian kecil.

Yang lebih penting adalah bisa melihat sistem email dari beberapa perspektif sekaligus.

### 0.15.1. Protocol Perspective

Kamu paham:

- SMTP handshake;
- STARTTLS;
- SMTP response code;
- envelope vs header;
- MIME structure;
- IMAP/POP3 retrieval.

### 0.15.2. API Perspective

Kamu paham:

- `Session`;
- `Transport`;
- `Store`;
- `Folder`;
- `MimeMessage`;
- `MimeMultipart`;
- `MimeBodyPart`;
- `DataSource`;
- `DataHandler`.

### 0.15.3. Reliability Perspective

Kamu paham:

- outbox;
- retry;
- idempotency;
- backoff;
- dead-letter;
- partial failure;
- duplicate prevention;
- crash recovery.

### 0.15.4. Security Perspective

Kamu paham:

- SMTP credential;
- TLS;
- certificate validation;
- secret rotation;
- header injection;
- attachment scanning;
- PII redaction;
- phishing-like template risk.

### 0.15.5. Deliverability Perspective

Kamu paham:

- SPF;
- DKIM;
- DMARC;
- domain alignment;
- bounce;
- complaint;
- suppression;
- reputation;
- difference between accepted and delivered.

### 0.15.6. Architecture Perspective

Kamu paham:

- domain event to notification mapping;
- template versioning;
- audit trail;
- observability;
- provider abstraction;
- compliance;
- tenant routing;
- failure isolation.

### 0.15.7. Operational Perspective

Kamu paham:

- queue depth;
- send latency;
- provider outage;
- retry storm;
- kill switch;
- replay;
- incident diagnosis;
- dashboard;
- alerting.

---

## 0.16. Common Wrong Mental Models

### 0.16.1. “Email Sent Berarti Email Diterima”

Salah.

Lebih benar:

```text
Email sent by app = submitted to configured transport successfully.
```

Kalau butuh evidence lebih kuat, sistem perlu delivery event, bounce processing, atau provider telemetry.

### 0.16.2. “SMTP Itu Simple”

SMTP command-nya memang sederhana. Production behavior-nya tidak sederhana.

Kompleksitas muncul dari:

- network;
- TLS;
- auth;
- spam filtering;
- DNS;
- rate limit;
- partial recipient failure;
- provider policy;
- delayed bounce;
- encoding;
- attachment;
- mailbox behavior.

### 0.16.3. “Retry Selalu Aman”

Tidak selalu.

Retry bisa menyebabkan duplicate email.

Contoh:

```text
App sends email.
SMTP relay accepts.
Network drops before client receives final response.
App sees timeout.
App retries.
Recipient receives two emails.
```

Retry harus dirancang dengan idempotency dan attempt tracking.

### 0.16.4. “Satu Email Banyak Recipient Lebih Efisien”

Tidak selalu.

Untuk transactional email, sering lebih baik satu recipient per message karena:

- personalization;
- privacy;
- per-recipient status;
- bounce mapping;
- unsubscribe/preference;
- audit clarity;
- partial failure isolation.

### 0.16.5. “Attachment Tinggal Attach File”

Tidak sesederhana itu.

Pertanyaan yang harus dijawab:

- ukuran maksimum?
- apakah file dibaca penuh ke memory?
- MIME type benar?
- filename aman?
- extension cocok dengan content?
- malware scanned?
- encrypted?
- boleh dikirim via email menurut policy?
- apakah lebih aman pakai secure download link?

### 0.16.6. “HTML Email Sama dengan Web HTML”

Salah.

HTML email dibaca oleh client dengan support CSS berbeda-beda. Outlook, Gmail, Apple Mail, dan mobile client punya behavior berbeda. Banyak CSS modern tidak portable.

### 0.16.7. “Mail Log Boleh Simpan Semua untuk Debug”

Berbahaya.

Email bisa mengandung:

- PII;
- token;
- link reset password;
- document resmi;
- attachment sensitif;
- case detail;
- regulatory decision.

Logging raw email body bisa menjadi data leak.

---

## 0.17. Java 8 sampai Java 25: Cara Berpikir Versi

Karena seri ini membahas Java 8–25, kita perlu membagi landscape.

### 0.17.1. Java 8 Legacy

Karakter umum:

- banyak aplikasi memakai `javax.mail`;
- dependency sering berupa JavaMail 1.6.x;
- Activation bisa berasal dari JDK lama atau dependency eksternal;
- aplikasi Java EE lama mungkin memakai container-provided mail session;
- namespace `javax` masih umum.

Risiko:

- dependency usang;
- TLS/cipher issue;
- provider auth modern seperti OAuth2 sulit;
- classpath conflict;
- migrasi ke Jakarta namespace tidak trivial jika framework masih `javax`.

### 0.17.2. Java 11+

Java 11 mengubah banyak asumsi lama karena modul Java EE tidak lagi tersedia di JDK seperti era sebelumnya. Aplikasi perlu explicit dependency untuk mail/activation.

Untuk mail modern, kamu biasanya memilih dependency API dan implementation secara eksplisit.

### 0.17.3. Java 17/21 LTS

Ini baseline modern enterprise yang umum.

Untuk Spring Boot 3/Jakarta EE modern:

- gunakan `jakarta.mail`;
- gunakan `jakarta.activation`;
- hindari campuran `javax` dan `jakarta`;
- pastikan library template/security/framework sejalan.

### 0.17.4. Java 25

Java 25 perlu diperlakukan sebagai platform modern dengan expectation:

- dependency explicit;
- TLS modern;
- observability matang;
- virtual threads bisa dipertimbangkan untuk blocking I/O, tetapi bukan pengganti backpressure;
- module/classpath hygiene semakin penting;
- framework compatibility harus dicek.

### 0.17.5. Prinsip Compatibility

Jangan campur sembarangan:

```text
javax.mail.MimeMessage
jakarta.mail.Transport
```

Itu tipe berbeda.

Migration harus direncanakan di boundary module, bukan sekadar search-replace package.

---

## 0.18. Dependency Mental Model

Ada tiga konsep yang sering tercampur:

### 0.18.1. Specification/API

Ini interface dan class standar.

Contoh:

```text
jakarta.mail-api
jakarta.activation-api
```

### 0.18.2. Implementation/Provider

Ini implementasi nyata.

Contoh:

```text
org.eclipse.angus:jakarta.mail
org.eclipse.angus:angus-activation
```

### 0.18.3. Container-Provided Runtime

Dalam Jakarta EE server, mail/activation bisa disediakan oleh application server.

Contoh:

- Payara/GlassFish;
- WildFly;
- Open Liberty;
- TomEE;
- vendor runtime lain.

Kesalahan umum:

- include implementation di WAR padahal container sudah menyediakan versi lain;
- hanya include API tanpa implementation di Java SE app;
- include `javax.mail` dan `jakarta.mail` sekaligus;
- dependency transitive membawa versi tidak cocok.

---

## 0.19. SMTP vs Provider API

Salah satu keputusan arsitektur penting: kirim email lewat SMTP atau HTTP API provider?

### 0.19.1. SMTP Relay

Kelebihan:

- standard;
- didukung Jakarta Mail;
- portable;
- mudah diganti host;
- cocok dengan corporate relay;
- tidak perlu vendor SDK.

Kekurangan:

- telemetry terbatas;
- bounce/delivery event tidak otomatis;
- response kurang structured;
- rate limit kadang tidak eksplisit;
- auth modern bisa lebih rumit;
- provider feature sulit diakses.

### 0.19.2. Provider HTTP API

Kelebihan:

- structured response;
- event webhook;
- template management;
- analytics;
- suppression list;
- bounce/complaint integration;
- better provider-specific features.

Kekurangan:

- vendor lock-in;
- SDK/API berubah;
- portability rendah;
- data residency concern;
- regulatory/security review lebih berat;
- abstraction butuh desain matang.

### 0.19.3. Rule of Thumb

Gunakan SMTP/Jakarta Mail jika:

- kebutuhan sederhana sampai menengah;
- corporate relay sudah tersedia;
- portability penting;
- tidak butuh advanced delivery analytics;
- aplikasi perlu standard mail protocol.

Gunakan provider API jika:

- butuh bounce/complaint/delivery event kuat;
- volume besar;
- butuh suppression list;
- butuh template/campaign analytics;
- provider-specific deliverability tooling penting.

Untuk top-level architecture, buat interface seperti:

```java
public interface MailGateway {
    MailSendResult send(MailEnvelope envelope);
}
```

Lalu implementasi bisa:

```text
JakartaMailSmtpGateway
SesApiMailGateway
SendGridApiMailGateway
MockMailGateway
```

---

## 0.20. Email Sending di Request Thread: Kenapa Berbahaya?

Banyak aplikasi melakukan ini:

```text
User clicks Submit
  ↓
Controller receives request
  ↓
Service updates DB
  ↓
Service sends email synchronously
  ↓
Response returned to user
```

Masalah:

1. User request latency tergantung SMTP.
2. SMTP outage bisa membuat fitur bisnis gagal.
3. Timeout bisa membuat user retry dan menghasilkan duplicate action.
4. Transaction boundary menjadi kabur.
5. Retry sulit dilakukan dengan benar.
6. Observability email bercampur dengan request processing.
7. Scaling web thread dan mail throughput jadi coupled.

Lebih sehat:

```text
User clicks Submit
  ↓
Controller receives request
  ↓
Service updates DB + writes outbox
  ↓
Response returned
  ↓
Worker asynchronously sends email
```

Ini memisahkan:

- business transaction;
- side effect dispatch;
- failure handling;
- retry;
- audit.

---

## 0.21. Email sebagai Audit Artifact

Dalam enterprise/regulatory system, email sering dianggap evidence.

Namun evidence harus jelas levelnya.

### 0.21.1. Evidence Level

| Evidence | Arti | Kekuatan |
|---|---|---|
| Notification requested | sistem memutuskan email perlu dikirim | rendah-menengah |
| Message rendered | content sudah dibuat | menengah |
| SMTP accepted | relay menerima message | menengah-kuat |
| Provider delivered event | provider menyatakan delivered | kuat, jika tersedia |
| Read/open event | user/client membuka atau memuat pixel | lemah-menengah |
| User action after email | user klik link/login/respond | kuat untuk awareness/action |

### 0.21.2. Audit Metadata Minimum

Untuk email penting, simpan:

```text
notification_id
business_reference_id
notification_type
template_id
template_version
recipient_normalized_or_hashed
recipient_role/category
sender_identity
created_at
queued_at
sent_attempts
final_send_status
smtp/provider response summary
correlation_id
triggered_by
```

Jangan sembarang simpan full body jika berisi PII. Jika perlu evidence content, pertimbangkan:

- encrypted storage;
- retention policy;
- access control;
- hashing rendered content;
- storing template version + immutable data snapshot;
- legal/compliance review.

---

## 0.22. Security Threat Model Awal

Email subsystem punya attack surface yang cukup besar.

### 0.22.1. Header Injection

Jika user input masuk header tanpa sanitasi:

```text
Subject: Hello
Bcc: attacker@example.com
```

Maka attacker bisa menyisipkan header baru.

Mitigasi:

- validate header fields;
- reject CR/LF dalam header input;
- gunakan high-level Jakarta Mail methods;
- jangan `setHeader` dengan raw user input tanpa validasi.

### 0.22.2. Template Injection

Jika template engine tidak dikontrol, attacker bisa menyisipkan HTML/script-like content, link phishing, atau layout manipulation.

Email client biasanya membatasi JavaScript, tetapi risk tetap ada:

- malicious link;
- spoofed content;
- hidden text;
- social engineering;
- brand abuse.

### 0.22.3. Attachment Risk

Attachment bisa:

- mengandung malware;
- terlalu besar;
- mismatch extension/MIME;
- mengandung PII;
- bocor ke recipient salah;
- diblokir gateway;
- menyebabkan memory pressure saat dibaca.

### 0.22.4. Credential Leakage

SMTP credential sering bocor dari:

- application logs;
- debug properties;
- stack trace;
- config file;
- CI/CD variable dump;
- misconfigured secret management.

### 0.22.5. PII Leakage

Email body, subject, recipient, attachment, dan logs bisa mengandung sensitive data.

Subject sering terlihat di lock screen/mobile notification. Jangan taruh data sensitif di subject.

---

## 0.23. Deliverability Mental Model

Deliverability adalah probabilitas email benar-benar masuk inbox dan dipercaya recipient infrastructure.

Faktor utama:

1. domain identity;
2. SPF;
3. DKIM;
4. DMARC;
5. IP/domain reputation;
6. bounce rate;
7. complaint rate;
8. content quality;
9. attachment/link risk;
10. sending pattern;
11. recipient engagement;
12. provider policy.

Jakarta Mail tidak mengatur DNS SPF/DKIM/DMARC. DKIM signing bisa dilakukan oleh relay/provider atau library tambahan, tetapi ini bukan automatic guarantee dari basic Jakarta Mail send.

Important distinction:

```text
Transport.send success != inbox placement success
```

---

## 0.24. Observability Sejak Hari Pertama

Tanpa observability, mail incident sulit didiagnosis.

### 0.24.1. Log yang Berguna

Log minimal:

```text
notificationId
correlationId
mailRequestId
attemptNo
recipientHash or masked recipient
templateId
templateVersion
smtpHost/provider
resultCategory
latencyMs
exceptionCategory
smtpCode if available
```

### 0.24.2. Log yang Berbahaya

Hindari log:

```text
SMTP password
OAuth token
full email body
raw attachment
reset password link
OTP
full recipient list jika sensitif
PII dalam subject/body
```

### 0.24.3. Metrics Minimum

Metric dasar:

```text
mail_outbox_pending_count
mail_send_attempt_total
mail_send_success_total
mail_send_failure_total
mail_send_retryable_failure_total
mail_send_permanent_failure_total
mail_send_latency_ms
mail_queue_age_seconds
mail_dead_letter_count
```

### 0.24.4. Alert Minimum

Alert saat:

- pending queue naik terus;
- auth failure spike;
- timeout spike;
- permanent failure spike;
- dead-letter bertambah;
- provider latency tinggi;
- no email sent dalam window padahal ada traffic.

---

## 0.25. Failure Model Awal

Email failure harus diklasifikasikan. Jangan hanya `catch Exception`.

### 0.25.1. Configuration Failure

Contoh:

- host salah;
- port salah;
- TLS mode salah;
- credential salah;
- missing dependency;
- mixed `javax`/`jakarta`.

Biasanya non-retryable sampai config diperbaiki.

### 0.25.2. Network Failure

Contoh:

- timeout;
- connection reset;
- DNS temporary failure;
- route/firewall issue.

Biasanya retryable dengan backoff.

### 0.25.3. Authentication Failure

Contoh:

- SMTP 535 auth failed;
- credential expired;
- account locked;
- OAuth token invalid.

Biasanya bukan retry agresif. Perlu alert.

### 0.25.4. Recipient Failure

Contoh:

- invalid address;
- mailbox not found;
- domain not found;
- recipient rejected.

Sering permanent untuk recipient tertentu.

### 0.25.5. Content Failure

Contoh:

- attachment blocked;
- message too large;
- spam-like content rejected;
- invalid MIME.

Biasanya perlu perbaikan content/template.

### 0.25.6. Provider Rate Limit

Contoh:

- too many messages;
- quota exceeded;
- throttling;
- per-domain limit.

Retryable, tetapi harus dengan backoff dan throughput control.

### 0.25.7. Unknown Outcome

Ini paling tricky.

Contoh:

- timeout setelah DATA dikirim;
- connection drop setelah relay mungkin menerima;
- worker crash setelah send sebelum update DB.

Unknown outcome harus diperlakukan dengan hati-hati karena retry bisa duplicate.

---

## 0.26. Design Invariants untuk Mail Subsystem

Invariants adalah aturan yang harus tetap benar dalam semua kondisi.

Untuk mail subsystem matang, beberapa invariant penting:

1. **Tidak mengirim email sebelum business state committed.**
2. **Tidak ada retry tanpa batas.**
3. **Setiap send attempt tercatat.**
4. **Setiap email punya correlation ID.**
5. **PII tidak muncul di log teknis secara raw.**
6. **SMTP credential tidak pernah muncul di log.**
7. **Timeout selalu dikonfigurasi.**
8. **Failure diklasifikasikan.**
9. **Duplicate email dipertimbangkan di desain.**
10. **Attachment size dibatasi.**
11. **Template version bisa diaudit.**
12. **Operational kill switch tersedia untuk mass failure.**
13. **Queue backlog bisa dimonitor.**
14. **Email accepted tidak diklaim sebagai delivered kecuali ada evidence.**
15. **Domain logic tidak tergantung langsung pada Jakarta Mail classes.**

---

## 0.27. Reference Boundary Model

Salah satu desain yang baik adalah memisahkan objek berdasarkan layer.

### 0.27.1. Domain/Application Object

```java
public record NotificationCommand(
    String businessRef,
    String notificationType,
    String recipientRole,
    Map<String, Object> data
) {}
```

### 0.27.2. Mail Request Object

```java
public record MailRequest(
    String idempotencyKey,
    MailAddress from,
    List<MailAddress> to,
    List<MailAddress> cc,
    List<MailAddress> bcc,
    String templateId,
    String templateVersion,
    Map<String, Object> templateData,
    List<AttachmentRef> attachments,
    String correlationId
) {}
```

### 0.27.3. Rendered Mail Object

```java
public record RenderedMail(
    String subject,
    String plainText,
    String html,
    List<ResolvedAttachment> attachments
) {}
```

### 0.27.4. Infrastructure MIME Object

```java
MimeMessage message = new MimeMessage(session);
```

### 0.27.5. Send Result Object

```java
public sealed interface MailSendResult permits MailSendSuccess, MailSendFailure {}
```

Dengan separation ini, migration dari JavaMail ke Jakarta Mail tidak menyebar ke seluruh aplikasi.

---

## 0.28. Sample High-Level Flow

Berikut flow yang lebih matang.

```text
1. Business event occurs
   Example: CaseApproved

2. Application writes business state and outbox row in same DB transaction
   case.status = APPROVED
   mail_outbox.status = PENDING

3. Worker picks pending outbox row
   SELECT ... FOR UPDATE SKIP LOCKED

4. Worker renders template
   templateId = case-approved-v3
   locale = en-SG

5. Worker composes MIME
   subject
   plain text
   HTML
   attachments
   headers

6. Worker sends through MailGateway
   implementation = JakartaMailSmtpGateway

7. Gateway returns normalized result
   SUCCESS_ACCEPTED_BY_RELAY
   FAILURE_RETRYABLE_TIMEOUT
   FAILURE_PERMANENT_INVALID_RECIPIENT
   FAILURE_AUTH

8. Worker records attempt and updates state

9. Optional: bounce/webhook updates final delivery state later
```

---

## 0.29. Minimal Tables untuk Outbox-Oriented Design

Contoh konseptual, bukan final schema.

### 0.29.1. `mail_outbox`

```sql
CREATE TABLE mail_outbox (
    id                  VARCHAR2(36) PRIMARY KEY,
    idempotency_key     VARCHAR2(200) NOT NULL,
    business_ref_type   VARCHAR2(100) NOT NULL,
    business_ref_id     VARCHAR2(100) NOT NULL,
    notification_type   VARCHAR2(100) NOT NULL,
    template_id         VARCHAR2(100) NOT NULL,
    template_version    VARCHAR2(50) NOT NULL,
    recipient_hash      VARCHAR2(128) NOT NULL,
    recipient_masked    VARCHAR2(320),
    status              VARCHAR2(50) NOT NULL,
    attempt_count       NUMBER DEFAULT 0 NOT NULL,
    next_attempt_at     TIMESTAMP,
    correlation_id      VARCHAR2(100),
    created_at          TIMESTAMP NOT NULL,
    updated_at          TIMESTAMP NOT NULL,
    last_error_category VARCHAR2(100),
    last_error_message  VARCHAR2(1000)
);
```

### 0.29.2. `mail_send_attempt`

```sql
CREATE TABLE mail_send_attempt (
    id                  VARCHAR2(36) PRIMARY KEY,
    mail_outbox_id      VARCHAR2(36) NOT NULL,
    attempt_no          NUMBER NOT NULL,
    started_at          TIMESTAMP NOT NULL,
    ended_at            TIMESTAMP,
    status              VARCHAR2(50) NOT NULL,
    smtp_host           VARCHAR2(255),
    smtp_code           VARCHAR2(20),
    provider_message_id VARCHAR2(255),
    failure_category    VARCHAR2(100),
    failure_detail      VARCHAR2(1000),
    latency_ms          NUMBER,
    CONSTRAINT fk_mail_attempt_outbox
        FOREIGN KEY (mail_outbox_id) REFERENCES mail_outbox(id)
);
```

### 0.29.3. Why Attempt Table Matters

Tanpa attempt table, kamu kehilangan histori:

- berapa kali dicoba;
- kapan gagal;
- error berubah atau sama;
- apakah provider outage atau recipient issue;
- apakah retry storm terjadi;
- apakah SLA notification terpenuhi.

---

## 0.30. Minimal Java API Shape untuk Seri Ini

Kita akan sering kembali ke boundary ini.

```java
public interface MailGateway {
    MailSendResult send(MailEnvelope envelope);
}
```

```java
public record MailEnvelope(
    MailAddress from,
    List<MailAddress> to,
    List<MailAddress> cc,
    List<MailAddress> bcc,
    String subject,
    String plainTextBody,
    String htmlBody,
    List<MailAttachment> attachments,
    Map<String, String> headers,
    String correlationId
) {}
```

```java
public record MailAddress(
    String email,
    String displayName
) {}
```

```java
public record MailAttachment(
    String filename,
    String contentType,
    AttachmentContent content,
    boolean inline,
    String contentId
) {}
```

```java
public sealed interface MailSendResult permits MailSendResult.Success, MailSendResult.Failure {

    record Success(
        String providerMessageId,
        String acceptedBy,
        long latencyMillis
    ) implements MailSendResult {}

    record Failure(
        MailFailureCategory category,
        boolean retryable,
        String diagnosticCode,
        String message,
        Throwable cause
    ) implements MailSendResult {}
}
```

```java
public enum MailFailureCategory {
    CONFIGURATION,
    AUTHENTICATION,
    NETWORK,
    TLS,
    TIMEOUT,
    RATE_LIMIT,
    INVALID_RECIPIENT,
    MESSAGE_REJECTED,
    MESSAGE_TOO_LARGE,
    PARTIAL_FAILURE,
    UNKNOWN_OUTCOME,
    INTERNAL_ERROR
}
```

Ini belum implementasi final. Ini shape awal agar domain tidak bocor ke library-specific object.

---

## 0.31. Jakarta Mail Bukan Satu-satunya Komponen

Dalam sistem production, mail module biasanya terdiri dari beberapa komponen:

```text
MailRequestFactory
MailPreferenceResolver
RecipientResolver
TemplateRenderer
MailComposer
AttachmentResolver
MailGateway
MailOutboxRepository
MailDispatchWorker
MailRetryPolicy
MailFailureClassifier
MailAuditWriter
MailMetricsPublisher
BounceProcessor
```

### 0.31.1. MailRequestFactory

Membuat request dari event bisnis.

### 0.31.2. MailPreferenceResolver

Memeriksa apakah user boleh/dapat menerima email tertentu.

### 0.31.3. RecipientResolver

Mengubah role/domain object menjadi alamat email aktual.

Contoh:

```text
case applicant → applicant email
assigned officer → officer email
agency admin group → configured distribution list
```

### 0.31.4. TemplateRenderer

Render subject/plain/html berdasarkan template dan data.

### 0.31.5. MailComposer

Mengubah rendered content menjadi MIME message.

### 0.31.6. AttachmentResolver

Mengambil attachment dari file store/document service/report generator.

### 0.31.7. MailGateway

Mengirim message melalui SMTP/provider API.

### 0.31.8. MailFailureClassifier

Mengubah exception/protocol response menjadi kategori domain.

### 0.31.9. BounceProcessor

Mengolah feedback setelah send.

---

## 0.32. Anti-Pattern yang Akan Kita Hindari

### 0.32.1. Send Langsung dari Controller

Buruk:

```java
@PostMapping("/submit")
public ResponseEntity<?> submit(@RequestBody Form form) {
    service.submit(form);
    mailService.sendConfirmation(form.email());
    return ok().build();
}
```

Masalah:

- SMTP latency masuk user latency;
- failure email bisa membuat submit terlihat gagal;
- duplicate risk saat user retry;
- sulit audit.

### 0.32.2. Static Global Session yang Mutable

Buruk:

```java
public static Session session;
```

Masalah:

- config sulit di-test;
- multi-tenant sulit;
- credential rotation sulit;
- thread behavior tidak jelas;
- global state menyebar.

### 0.32.3. Catch Exception dan Ignore

Buruk:

```java
try {
    Transport.send(message);
} catch (Exception e) {
    log.warn("failed");
}
```

Masalah:

- tidak ada retry;
- tidak ada kategori;
- tidak ada alert;
- tidak ada business state;
- tidak ada audit.

### 0.32.4. Infinite Retry

Buruk:

```text
while true retry every 1 second
```

Masalah:

- provider makin menolak;
- queue storm;
- duplicate risk;
- biaya naik;
- incident membesar.

### 0.32.5. Raw Body Logging

Buruk:

```java
log.info("Sending email: {}", renderedHtml);
```

Masalah:

- PII leak;
- secret link leak;
- compliance issue;
- log retention tidak sesuai.

---

## 0.33. Cara Membaca Hasil `Transport.send`

Dalam banyak kode, `Transport.send(message)` dianggap final.

Secara mental model, hasilnya kira-kira:

```text
The local Jakarta Mail client completed SMTP interaction with the configured transport endpoint without throwing an exception.
```

Itu bukan kalimat yang sama dengan:

```text
The recipient has received and read the email.
```

Jika kamu ingin state lebih jujur, gunakan nama status yang jujur:

```text
SENT_TO_RELAY
SUBMITTED_TO_PROVIDER
SMTP_ACCEPTED
```

Hindari istilah terlalu kuat seperti:

```text
DELIVERED
RECEIVED
READ
```

kecuali memang punya evidence dari provider atau user action.

---

## 0.34. Apa yang Akan Dipelajari di Part Berikutnya?

Part berikutnya adalah:

```text
01-email-protocol-stack-smtp-mime-pop3-imap.md
```

Kita akan masuk ke protocol stack:

- SMTP;
- MIME;
- POP3;
- IMAP;
- SMTP envelope;
- message header;
- response code;
- TLS/STARTTLS;
- authentication;
- why direct-to-MX is usually bad for enterprise app;
- bagaimana JavaMail/Jakarta Mail memetakan protocol tersebut ke object model.

Part 0 ini sengaja belum fokus ke syntax API, karena tanpa protocol mental model, API mudah dipakai secara salah.

---

## 0.35. Checklist Pemahaman Part 0

Gunakan checklist ini untuk menguji apakah konsepnya sudah masuk.

Kamu seharusnya bisa menjawab:

1. Kenapa email harus diperlakukan sebagai distributed system?
2. Apa bedanya SMTP accepted dengan delivered?
3. Apa perbedaan envelope sender dan header From?
4. Apa peran Jakarta Mail?
5. Apa peran Jakarta Activation?
6. Apa yang tidak bisa dijamin oleh Jakarta Mail?
7. Kenapa send email di request thread berbahaya?
8. Kenapa outbox pattern penting?
9. Kenapa retry bisa menyebabkan duplicate email?
10. Failure category apa saja yang perlu dibedakan?
11. Metadata apa yang perlu disimpan untuk audit?
12. Apa risiko logging raw email body?
13. Kapan SMTP lebih cocok daripada provider API?
14. Kapan provider API lebih cocok daripada SMTP?
15. Kenapa domain layer sebaiknya tidak bergantung langsung pada `MimeMessage`?

---

## 0.36. Key Takeaways

1. Email bukan function call; email adalah distributed asynchronous workflow.
2. Jakarta Mail membantu membuat, mengirim, membaca, dan parsing mail message, tetapi tidak menjamin inbox delivery.
3. Jakarta Activation penting untuk MIME type, attachment, `DataSource`, dan `DataHandler`.
4. `SMTP accepted` harus dibedakan dari `delivered` dan `read`.
5. Envelope dan header adalah dua konsep berbeda.
6. Production mail subsystem harus punya outbox, retry, idempotency, failure classification, audit, dan observability.
7. Retry tanpa desain bisa menyebabkan duplicate email.
8. Email body, subject, recipient, dan attachment bisa mengandung data sensitif.
9. Deliverability dipengaruhi SPF/DKIM/DMARC/reputation, bukan sekadar kode Java.
10. Top-level design harus memisahkan domain notification dari infrastructure mail gateway.

---

## 0.37. Latihan Desain

Coba desain secara kasar untuk skenario berikut.

### Skenario

Aplikasi regulatory case management harus mengirim email ketika case disubmit.

Email berisi:

- subject acknowledgement;
- plain text body;
- HTML body;
- PDF acknowledgement attachment;
- recipient applicant;
- CC officer internal jika configured;
- audit trail harus menyimpan bahwa email sudah dicoba dikirim;
- retry maksimal 5 kali;
- tidak boleh duplicate jika user menekan submit dua kali;
- tidak boleh log full email body;
- SMTP relay kadang timeout.

### Pertanyaan

1. Apa idempotency key-nya?
2. Apa status outbox yang kamu butuhkan?
3. Apa failure category yang mungkin muncul?
4. Kapan attachment PDF dibuat?
5. Apakah PDF disimpan atau generated on dispatch?
6. Bagaimana jika SMTP timeout setelah message dikirim?
7. Apa yang kamu tampilkan ke user setelah submit?
8. Apa yang kamu log?
9. Apa yang tidak boleh kamu log?
10. Apa alert production yang perlu dibuat?

Jawaban detail akan dibahas bertahap dalam part-part berikutnya.

---

## 0.38. Seri Status

Seri `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery` **belum selesai**.

Progress saat ini:

```text
[x] Part 0 — Orientation: Email as a Distributed System
[ ] Part 1 — Email Protocol Stack: SMTP, MIME, POP3, IMAP
[ ] Part 2 — JavaMail to Jakarta Mail: History, Namespace, Compatibility, Migration
[ ] Part 3 — Core API: Session, Store, Folder, Transport, Message
[ ] Part 4 — SMTP Sending Deep Dive
[ ] Part 5 — MIME Message Construction
[ ] Part 6 — Multipart Email
[ ] Part 7 — Attachment Handling and Jakarta Activation
[ ] Part 8 — HTML Email Engineering
[ ] Part 9 — Mail Addressing, Identity, and Header Semantics
[ ] Part 10 — Error Model
[ ] Part 11 — Reliable Email Delivery Architecture
[ ] Part 12 — Bulk, Batch, and Rate-Limited Sending
[ ] Part 13 — Security Deep Dive
[ ] Part 14 — Deliverability Fundamentals
[ ] Part 15 — Inbound Mail
[ ] Part 16 — MIME Parsing
[ ] Part 17 — Jakarta Mail in Jakarta EE Containers
[ ] Part 18 — Jakarta Mail in Spring Boot and Modern Java Applications
[ ] Part 19 — Testing Mail Systems
[ ] Part 20 — Observability
[ ] Part 21 — Performance and Resource Management
[ ] Part 22 — Provider Integration Patterns
[ ] Part 23 — Bounce, Complaint, Webhook, and Delivery Feedback Loop
[ ] Part 24 — Template Architecture and Domain Notification Design
[ ] Part 25 — Compliance, Privacy, and Regulatory-Grade Mail Systems
[ ] Part 26 — Advanced MIME and Internationalization
[ ] Part 27 — Failure Modelling and Production Incident Playbook
[ ] Part 28 — End-to-End Reference Implementation
[ ] Part 29 — Top 1% Design Review
```

---

## References

1. Oracle JavaMail API overview — https://www.oracle.com/java/technologies/javamail.html
2. Java EE `javax.mail` package summary — https://docs.oracle.com/javaee/7/api/javax/mail/package-summary.html
3. Jakarta Mail specification — https://jakarta.ee/specifications/mail/
4. Jakarta Mail 2.1 specification page — https://jakarta.ee/specifications/mail/2.1/
5. Jakarta Mail API documentation — https://jakartaee.github.io/mail-api/
6. Eclipse Angus Mail — https://eclipse-ee4j.github.io/angus-mail/
7. Angus Mail API documentation — https://eclipse-ee4j.github.io/angus-mail/docs/api/jakarta.mail/module-summary.html
8. Jakarta Activation specification — https://jakarta.ee/specifications/activation/
9. Jakarta Activation 2.1 — https://jakarta.ee/specifications/activation/2.1/
10. Jakarta Activation API documentation — https://jakartaee.github.io/jaf-api/
