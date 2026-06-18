# Part 9 — Mail Addressing, Identity, and Header Semantics

> Series: `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery`  
> File: `09-addressing-identity-header-semantics.md`  
> Scope: Java 8–25, JavaMail `javax.mail`, Jakarta Mail `jakarta.mail`, SMTP, MIME, enterprise outbound/inbound mail systems

---

## 0. Why this part matters

Banyak engineer bisa membuat email terkirim dengan kode seperti ini:

```java
message.setFrom(new InternetAddress("noreply@example.com"));
message.setRecipients(Message.RecipientType.TO, "user@example.org");
message.setSubject("Hello");
message.setText("Hello");
Transport.send(message);
```

Tetapi production incident, deliverability issue, audit dispute, privacy breach, dan multi-tenant sender bug sering bukan berasal dari `Transport.send()`-nya. Seringnya berasal dari salah memahami **identity** di email.

Email punya beberapa lapisan identitas:

1. **SMTP envelope identity**: dipakai untuk routing dan bounce.
2. **Message header identity**: dilihat oleh user dan dipakai oleh mail client.
3. **Authentication identity**: dipakai oleh SMTP server untuk mengizinkan pengiriman.
4. **Domain authentication identity**: dipakai oleh SPF, DKIM, DMARC, dan anti-abuse system.
5. **Business identity**: dipakai aplikasi untuk audit, tenant, module, case, notification type, dan evidence.

Kesalahan umum:

- mengira `From:` sama dengan SMTP `MAIL FROM`;
- mengira `To:` menentukan recipient aktual;
- mengira `Bcc:` aman kalau tidak dihapus;
- mengira `Reply-To:` mengubah alamat pengirim;
- mengira `Return-Path:` bisa diset bebas oleh aplikasi;
- mengira `Message-ID` tidak penting;
- mengira satu email multi-recipient selalu lebih efisien dan aman;
- mengira `noreply@...` selalu pilihan terbaik;
- mengira “SMTP accepted” berarti identitas mail sudah valid secara deliverability.

Part ini membangun mental model agar kamu bisa membaca, mendesain, dan mengaudit mail identity seperti engineer senior.

---

## 1. Core mental model: email has two conversations

Email modern minimal punya dua percakapan yang sering tercampur:

```text
Conversation A — SMTP envelope
Application / SMTP client  --->  SMTP relay / MTA

MAIL FROM:<bounce@example.com>
RCPT TO:<alice@example.org>
RCPT TO:<bob@example.org>
DATA
...
.

Conversation B — Internet message headers/body
From: ACEAS Notifications <noreply@example.com>
To: Alice <alice@example.org>
Cc: Bob <bob@example.org>
Subject: Case update
Message-ID: <...>
Date: ...

Body...
```

Percakapan A adalah **transport envelope**. Ia mirip alamat di amplop fisik: dipakai sistem pengiriman.

Percakapan B adalah **isi surat**. Ia mirip letterhead, nama pengirim, daftar penerima yang tertulis di surat, subject, threading, dan body.

Keduanya bisa sama, tetapi tidak harus sama.

### 1.1 Analogi sederhana

Bayangkan surat fisik:

```text
Amplop luar:
  Return address: Bounce Handling Department
  Destination: Alice's address

Isi surat:
  From: Legal Department
  To: Alice
  Cc: Compliance Officer
  Subject: Notice of Decision
```

Postal system melihat amplop. Alice melihat isi surat.

SMTP server melihat envelope. Mail client melihat header.

### 1.2 Kenapa dipisah?

Karena kebutuhan routing dan kebutuhan user-facing berbeda.

Envelope dipakai untuk:

- menentukan recipient aktual;
- menentukan kemana bounce dikirim;
- SMTP transaction;
- SPF alignment context;
- delivery status;
- provider routing;
- recipient rejection.

Header dipakai untuk:

- apa yang tampil di inbox;
- siapa yang terlihat sebagai pengirim;
- reply behavior;
- threading;
- audit visual;
- human-readable context.

Top 1% engineer tidak memperlakukan email address sebagai satu field. Mereka memodelkannya sebagai beberapa identity field dengan fungsi berbeda.

---

## 2. The five identity layers

Untuk enterprise system, gunakan model lima lapis ini.

```text
+---------------------------------------------------------------+
| Business identity                                              |
| tenant, module, case, notification type, template version       |
+---------------------------------------------------------------+
| Header identity                                                |
| From, Sender, Reply-To, To, Cc, Bcc, Subject, Message-ID         |
+---------------------------------------------------------------+
| SMTP envelope identity                                         |
| MAIL FROM, RCPT TO                                             |
+---------------------------------------------------------------+
| Authentication identity                                        |
| SMTP username / OAuth2 client / relay credential                |
+---------------------------------------------------------------+
| Domain authentication identity                                 |
| SPF, DKIM, DMARC alignment, return-path domain, signing domain   |
+---------------------------------------------------------------+
```

Masing-masing menjawab pertanyaan berbeda.

| Layer | Pertanyaan utama |
|---|---|
| Business identity | Email ini berasal dari proses bisnis apa? |
| Header identity | User melihat email ini dari siapa dan untuk siapa? |
| SMTP envelope | Server harus mengirim ke mana, bounce ke mana? |
| Authentication | Aplikasi boleh memakai relay ini atau tidak? |
| Domain authentication | Domain pengirim sah atau terlihat spoofed? |

Jika desain hanya punya satu field `senderEmail`, desainnya belum cukup matang untuk sistem enterprise.

---

## 3. SMTP envelope: `MAIL FROM` and `RCPT TO`

SMTP envelope adalah bagian dari transaksi SMTP.

Contoh simplified transcript:

```text
C: EHLO app.example.com
S: 250-mail.relay.example.net
S: 250-STARTTLS
S: 250 AUTH PLAIN LOGIN

C: MAIL FROM:<bounce+case-123@example.com>
S: 250 2.1.0 Ok

C: RCPT TO:<alice@example.org>
S: 250 2.1.5 Ok

C: RCPT TO:<bob@example.org>
S: 250 2.1.5 Ok

C: DATA
S: 354 End data with <CR><LF>.<CR><LF>
C: From: Case Management <noreply@example.com>
C: To: Alice <alice@example.org>
C: Cc: Bob <bob@example.org>
C: Subject: Case update
C:
C: Body...
C: .
S: 250 2.0.0 Queued
```

### 3.1 `MAIL FROM`

`MAIL FROM` adalah envelope sender.

Ia sering disebut:

- envelope sender;
- bounce address;
- return path address;
- RFC5321.MailFrom;
- sometimes “reverse-path”.

Fungsinya:

- alamat untuk delivery failure/bounce;
- identity yang bisa dipakai SPF;
- address yang sering muncul sebagai `Return-Path` setelah message diterima;
- operational handle untuk bounce correlation.

### 3.2 `RCPT TO`

`RCPT TO` adalah recipient aktual pada SMTP transaction.

Ini yang menentukan kemana mail benar-benar dikirim.

Header `To:` tidak menentukan delivery aktual. Kamu bisa mengirim SMTP ke Alice tetapi header `To:` berisi Bob. Itu mungkin buruk secara etika, audit, dan deliverability, tetapi secara protokol bisa terjadi.

### 3.3 Header `To:` vs envelope `RCPT TO`

```text
Envelope:
  RCPT TO:<alice@example.org>

Header:
  To: Bob <bob@example.org>
```

Mail dikirim ke Alice, tetapi Alice melihat seolah email ditujukan ke Bob.

Kasus legitimate:

- mailing list;
- BCC;
- alias forwarding;
- role mailbox;
- provider rewriting;
- batch notification;
- compliance blind-copy.

Kasus berbahaya:

- privacy breach;
- spoofed communication;
- wrong recipient display;
- audit dispute;
- phishing-like pattern.

### 3.4 Jakarta Mail and envelope sender

Dalam Jakarta Mail/JavaMail, `MimeMessage.setFrom()` mengatur header `From`, bukan selalu SMTP envelope `MAIL FROM`.

Envelope sender biasanya diatur melalui property provider SMTP:

#### Jakarta Mail

```java
Properties props = new Properties();
props.put("mail.smtp.host", "smtp.example.com");
props.put("mail.smtp.port", "587");
props.put("mail.smtp.auth", "true");
props.put("mail.smtp.starttls.enable", "true");

// Envelope MAIL FROM / bounce address
props.put("mail.smtp.from", "bounce+case-123@example.com");

Session session = Session.getInstance(props, authenticator);
```

#### JavaMail legacy

Sama secara property:

```java
props.put("mail.smtp.from", "bounce+case-123@example.com");
```

Prinsip:

```text
message.setFrom(...)        -> Header From
mail.smtp.from              -> SMTP envelope MAIL FROM
message.setRecipients(...)  -> Header recipients + usually used by Transport to select recipients
Transport.send(message, addresses) -> Explicit actual recipients
```

Catatan penting: provider dan mode sending dapat mempengaruhi bagaimana envelope recipient dipilih. Untuk desain enterprise, jangan biarkan ini implicit tanpa dipahami.

---

## 4. Header identity fields

Internet message header adalah bagian dari message content.

Header umum:

```text
From: ACEAS Notifications <noreply@example.com>
Sender: System Mailer <mailer@example.com>
Reply-To: support@example.com
To: Alice <alice@example.org>
Cc: Bob <bob@example.org>
Bcc: Carol <carol@example.org>
Subject: Your application has been updated
Date: Tue, 16 Jun 2026 10:30:00 +0700
Message-ID: <case-123.notification-456@example.com>
In-Reply-To: <original-message@example.org>
References: <root@example.org> <original-message@example.org>
```

Setiap field punya fungsi berbeda.

---

## 5. `From`: visible author identity

`From:` adalah identity yang biasanya paling terlihat oleh recipient.

```text
From: Case Management <noreply@example.com>
```

Dalam Jakarta Mail:

```java
MimeMessage message = new MimeMessage(session);
message.setFrom(new InternetAddress("noreply@example.com", "Case Management", StandardCharsets.UTF_8.name()));
```

### 5.1 Meaning of `From`

`From` menjawab:

> Siapa author/pengirim yang diklaim oleh pesan ini?

Di mail client, ini biasanya yang muncul sebagai sender.

### 5.2 `From` should be stable and intentional

Untuk system-generated mail, `From` harus jelas:

```text
Good:
From: ACEAS Case Management <noreply@notifications.example.gov.sg>
From: CEA Licensing Portal <licensing@example.gov.sg>
From: Compliance Notices <compliance-notices@example.gov.sg>

Weak:
From: System <system@gmail.com>
From: noreply <noreply@vendor-domain.com>
From: Admin <admin@localhost>
```

Masalah `From` buruk:

- recipient tidak percaya;
- support ticket meningkat;
- DMARC alignment bisa gagal;
- sulit audit;
- tenant identity bocor;
- reply masuk ke tempat salah.

### 5.3 Display name matters

Email address saja sering tidak cukup.

```java
message.setFrom(new InternetAddress(
    "noreply@example.com",
    "ACEAS Notifications",
    StandardCharsets.UTF_8.name()
));
```

Jangan concatenate raw string:

```java
// Bad
message.setHeader("From", displayName + " <" + email + ">");
```

Gunakan `InternetAddress` agar encoding dan validasi lebih aman.

### 5.4 Multiple `From` addresses

RFC-style message format memungkinkan kondisi tertentu dengan multiple authors, tetapi untuk enterprise transactional email, hindari multiple `From` kecuali benar-benar paham implikasinya.

Untuk system notification, gunakan satu `From`.

---

## 6. `Sender`: actual sending agent when different from author

`Sender:` dipakai ketika actor yang mengirim berbeda dari author yang diklaim.

Contoh:

```text
From: Compliance Officer <officer@example.gov.sg>
Sender: ACEAS System <mailer@example.gov.sg>
```

Makna:

- `From`: author atau pihak atas nama siapa pesan dikirim;
- `Sender`: agent yang secara aktual mengirim.

### 6.1 Kapan `Sender` berguna?

1. Delegated sending.
2. System sends on behalf of human officer.
3. Workflow approval sends notice using officer identity.
4. Multi-tenant platform sends using tenant-visible identity, tetapi platform mailer melakukan send.

### 6.2 Kapan jangan pakai `Sender`?

Jangan pakai `Sender` untuk menyamarkan identity.

Jika aplikasi tidak benar-benar punya authority untuk mengirim atas nama user/domain tertentu, jangan set `From` ke user dan `Sender` ke system. Itu dapat terlihat seperti spoofing.

### 6.3 Jakarta Mail handling

Tidak semua high-level helper punya method khusus untuk `Sender`. Bisa pakai header:

```java
message.setHeader("Sender", new InternetAddress(
    "mailer@example.com",
    "ACEAS System Mailer",
    StandardCharsets.UTF_8.name()
).toUnicodeString());
```

Tetapi validasi sendiri tetap penting. Jangan masukkan user input mentah ke `setHeader`.

---

## 7. `Reply-To`: where human replies should go

`Reply-To:` menentukan alamat default saat recipient klik reply.

```text
From: ACEAS Notifications <noreply@example.gov.sg>
Reply-To: ACEAS Support <support@example.gov.sg>
```

Dalam Jakarta Mail:

```java
message.setReplyTo(new Address[] {
    new InternetAddress("support@example.gov.sg", "ACEAS Support", StandardCharsets.UTF_8.name())
});
```

### 7.1 `Reply-To` is not sender

`Reply-To` tidak mengubah:

- envelope sender;
- visible `From`;
- DKIM domain;
- SMTP auth identity;
- return path.

Ia hanya memberi instruksi ke mail client untuk reply behavior.

### 7.2 Good use cases

```text
From: No Reply <noreply@example.gov.sg>
Reply-To: Helpdesk <helpdesk@example.gov.sg>
```

```text
From: Licensing Portal <licensing@example.gov.sg>
Reply-To: Assigned Officer <officer@example.gov.sg>
```

```text
From: Case Management <case-notices@example.gov.sg>
Reply-To: Case Inbox <case-123@example.gov.sg>
```

### 7.3 Bad use cases

```text
From: Trusted Agency <noreply@agency.gov.sg>
Reply-To: random-user@gmail.com
```

Ini terlihat seperti phishing.

### 7.4 Reply handling design

Pertanyaan desain:

1. Apakah user boleh reply?
2. Kalau reply, masuk ke mailbox siapa?
3. Apakah reply harus masuk ke case management system?
4. Apakah reply perlu correlation ID?
5. Apakah auto-reply harus diproses?
6. Apakah PII bisa masuk mailbox support?

Untuk regulatory system, `Reply-To` bukan detail kecil. Ia menentukan jalur komunikasi dan evidence.

---

## 8. `Return-Path`: bounce path, not normal reply path

`Return-Path:` adalah header yang biasanya ditambahkan oleh receiving mail server berdasarkan SMTP envelope sender.

Contoh:

```text
Return-Path: <bounce+notification-456@example.gov.sg>
```

### 8.1 Jangan anggap bisa set manual

Aplikasi sebaiknya tidak mengandalkan:

```java
message.setHeader("Return-Path", "<bounce@example.com>");
```

Banyak server akan mengabaikan, mengganti, atau menambahkan `Return-Path` sendiri saat final delivery.

Untuk mengontrol bounce path, gunakan envelope sender, misalnya:

```java
props.put("mail.smtp.from", "bounce+notification-456@example.gov.sg");
```

### 8.2 Return-Path vs Reply-To

| Field | Fungsi |
|---|---|
| `Return-Path` | Kemana delivery failure/bounce dikirim |
| `Reply-To` | Kemana human reply diarahkan |
| `From` | Siapa yang terlihat sebagai sender |
| `MAIL FROM` | Envelope bounce sender dalam SMTP transaction |

Jangan kirim human reply ke bounce mailbox. Jangan kirim bounce ke support inbox biasa.

### 8.3 Bounce correlation

Untuk enterprise notification, bounce address bisa memakai token:

```text
bounce+notification-456@example.gov.sg
bounce+tenantA.case-123.notification-456@example.gov.sg
```

Tapi hati-hati:

- jangan taruh PII di local-part;
- jangan taruh full case number sensitif jika email header dapat diekspos;
- gunakan opaque ID atau signed token;
- pastikan mailbox/provider mendukung plus addressing atau custom return-path.

Contoh lebih aman:

```text
bounce+n_7f3a9c2d@example.gov.sg
```

Mapping disimpan di database:

```text
n_7f3a9c2d -> notification_id=456, tenant=CEA, case_id=internal UUID
```

---

## 9. `To`, `Cc`, and `Bcc`: visible and hidden recipients

### 9.1 `To`

`To:` adalah recipient utama yang terlihat.

```java
message.setRecipients(
    Message.RecipientType.TO,
    InternetAddress.parse("alice@example.org", true)
);
```

### 9.2 `Cc`

`Cc:` adalah visible secondary recipient.

```java
message.setRecipients(
    Message.RecipientType.CC,
    InternetAddress.parse("bob@example.org", true)
);
```

### 9.3 `Bcc`

`Bcc:` adalah blind recipient.

```java
message.setRecipients(
    Message.RecipientType.BCC,
    InternetAddress.parse("audit@example.org", true)
);
```

Tetapi pahami detailnya.

`Bcc` secara konseptual berarti recipient menerima email, tetapi tidak muncul sebagai visible recipient untuk recipient lain.

### 9.4 BCC privacy invariant

Invariant:

```text
No recipient should be able to infer the BCC recipient list from delivered message headers.
```

Dalam banyak sending flow, Jakarta Mail/SMTP provider akan menggunakan BCC untuk recipient envelope tetapi tidak menyertakan header `Bcc` dalam message yang dikirim. Namun sebagai engineer enterprise, jangan hanya percaya asumsi; test raw message di fake SMTP dan provider staging.

### 9.5 BCC audit problem

BCC berguna untuk blind copy, tapi untuk audit bisa membingungkan.

Jika system mengirim BCC ke audit mailbox:

- user tidak melihat audit recipient;
- audit mailbox punya salinan;
- tapi visible header tidak menunjukkan audit copy;
- dispute bisa muncul: “apakah audit mailbox memang recipient resmi atau technical copy?”

Lebih baik modelkan explicit:

```text
Recipient role:
- PRIMARY_VISIBLE
- CC_VISIBLE
- AUDIT_COPY_HIDDEN
- INTERNAL_MONITORING_COPY
```

Daripada hanya enum `TO/CC/BCC`.

### 9.6 One message many recipients vs one message per recipient

Satu message banyak recipient:

```text
To: alice@example.org, bob@example.org, carol@example.org
```

Kelebihan:

- fewer SMTP transactions;
- same content;
- natural for group announcement.

Risiko:

- privacy leak;
- personalization sulit;
- per-recipient delivery status sulit;
- one invalid recipient can complicate partial failure;
- unsubscribe/preference per recipient sulit;
- reply-all chaos;
- legal/audit ambiguity.

One message per recipient:

```text
Email 1: To: Alice
Email 2: To: Bob
Email 3: To: Carol
```

Kelebihan:

- privacy safer;
- personalized;
- per-recipient status;
- better bounce correlation;
- easier retry;
- better suppression handling.

Trade-off:

- more sends;
- rate limit impact;
- more storage;
- more queue processing.

Enterprise transactional notification biasanya lebih aman memakai one message per recipient, kecuali ada business reason bahwa recipients memang harus melihat satu sama lain.

---

## 10. `Message-ID`: identity of the message instance

`Message-ID:` adalah unique identifier untuk message.

Contoh:

```text
Message-ID: <notification-456.20260616T103000.7f3a9c2d@example.gov.sg>
```

### 10.1 What it is for

`Message-ID` dipakai oleh:

- mail client threading;
- duplicate detection heuristics;
- replies;
- references;
- diagnostics;
- audit correlation;
- provider logs.

### 10.2 Jakarta Mail default generation

`MimeMessage.saveChanges()` dapat mengisi beberapa header seperti `Date` dan `Message-ID` jika belum ada. `Transport.send()` biasanya memanggil `saveChanges()`.

Tetapi untuk enterprise system, pertimbangkan generate `Message-ID` sendiri agar bisa dikorelasikan.

```java
String msgId = "<notification-" + notificationId + "." + randomSuffix + "@mail.example.gov.sg>";
message.setHeader("Message-ID", msgId);
```

### 10.3 Message-ID must be globally unique

Jangan pakai:

```text
<123@example.com>
<case-123@example.com>
<test@example.com>
```

Jika email dikirim ulang dengan content berbeda tetapi `Message-ID` sama, mail client bisa melakukan threading/dedup aneh.

### 10.4 Retry and Message-ID

Ini subtle.

Pertanyaan:

> Kalau send attempt pertama timeout setelah SMTP DATA, lalu aplikasi retry, apakah `Message-ID` harus sama atau berbeda?

Jawabannya tergantung model.

Jika retry adalah attempt untuk **message logical yang sama**, mempertahankan `Message-ID` bisa membantu dedup/threading. Tetapi provider/client behavior bervariasi. Jika retry menghasilkan email duplicate, same `Message-ID` mungkin membantu sebagian client mengenali duplicate, tetapi tidak boleh dianggap reliable duplicate prevention.

Desain lebih baik:

- gunakan `notification_id` sebagai idempotency business identity;
- gunakan `message_id` sebagai transport message identity;
- simpan `attempt_id` untuk setiap attempt;
- jangan bergantung pada `Message-ID` saja untuk idempotency.

Model:

```text
notification_id = N-456
  attempt_id = A-1, message_id = <N-456.A-1.x@example.gov.sg>
  attempt_id = A-2, message_id = <N-456.A-2.y@example.gov.sg>
```

Atau:

```text
notification_id = N-456
  all retry attempts use message_id = <N-456.x@example.gov.sg>
```

Pilih secara sadar dan dokumentasikan.

### 10.5 Recommendation

Untuk transactional enterprise:

- generate `Message-ID` deterministically enough for correlation, but with uniqueness;
- store it;
- log it;
- include it in provider metadata if using API provider;
- never expose internal sequential IDs if sensitive;
- use opaque/random suffix.

---

## 11. `In-Reply-To` and `References`: threading identity

Header ini dipakai untuk reply/threading.

```text
Message-ID: <reply-789@example.gov.sg>
In-Reply-To: <original-123@example.org>
References: <root-001@example.org> <original-123@example.org>
```

### 11.1 Meaning

`In-Reply-To` mengarah ke message yang dibalas.

`References` membawa chain message ID untuk conversation thread.

### 11.2 Use cases

1. System replies to inbound email.
2. Case management sends follow-up in same thread.
3. Ticketing system preserves email conversation.
4. Approval workflow replies to prior notification.

### 11.3 Jakarta Mail implementation

```java
message.setHeader("In-Reply-To", originalMessageId);
message.setHeader("References", existingReferences + " " + originalMessageId);
```

Validasi format penting. Message-ID harus berbentuk angle-bracketed id:

```text
<unique@domain>
```

Jangan asal memasukkan subject atau case ID.

### 11.4 Threading is client-specific

Mail clients menggunakan kombinasi:

- `Message-ID`;
- `In-Reply-To`;
- `References`;
- normalized subject;
- participants;
- date proximity;
- proprietary heuristics.

Jadi jangan janjikan threading 100% sama di Gmail, Outlook, Apple Mail, dan mobile client.

### 11.5 Failure mode: accidental thread hijacking

Jika kamu reuse `Message-ID`, `In-Reply-To`, atau `References` yang salah, email bisa masuk ke thread yang salah.

Dampak:

- privacy leak;
- user confusion;
- wrong case context;
- legal/audit issue;
- support escalation.

Invariant:

```text
A message must only reference another message if it belongs to the same authorized conversation context.
```

Dalam regulatory/case system, validasi:

```text
current.case_id == referenced_message.case_id
current.tenant_id == referenced_message.tenant_id
recipient is authorized for that case/thread
```

---

## 12. Subject identity and anti-patterns

Subject bukan identity teknis yang reliable, tetapi punya efek besar ke user.

```text
Subject: [ACEAS] Case EA-2026-00123 has been updated
```

### 12.1 Subject is not a stable identifier

Jangan gunakan subject untuk:

- deduplication;
- threading critical logic;
- parsing notification type;
- case mapping;
- security decision.

Subject bisa berubah karena:

- localization;
- user reply prefixes;
- mail client rewrite;
- ticketing system prefix;
- user edit;
- encoding;
- truncation.

### 12.2 But subject is part of user experience

Subject harus:

- jelas;
- tidak membocorkan sensitive data berlebihan;
- tidak terlalu panjang;
- konsisten;
- memudahkan search;
- membedakan action required vs FYI.

Contoh:

```text
Good:
Action required: Submit missing documents for your application
Your licence renewal application has been received
Case update: Additional information requested

Risky:
URGENT!!!! CLICK NOW
Case rejected for John Tan NRIC S1234567A
System Notification
```

### 12.3 Regulatory subject policy

Untuk sistem regulasi, tetapkan policy:

| Data type | Allowed in subject? |
|---|---|
| Generic case reference | Sometimes |
| Full legal name | Avoid unless required |
| National ID | No |
| Health/financial/legal sensitive facts | No |
| Enforcement outcome | Usually avoid in subject |
| Action required phrase | Yes |

---

## 13. Custom headers: power and danger

Custom headers bisa dipakai untuk correlation.

```text
X-App-Notification-ID: n_7f3a9c2d
X-App-Tenant: cea
X-App-Template-Version: licence-renewal-v4
```

### 13.1 Use cases

- internal debugging;
- bounce matching;
- provider webhook correlation;
- mail archive processing;
- inbound reply routing;
- support investigation.

### 13.2 Danger

Email headers bisa dilihat oleh recipient, forwarded ke pihak lain, disimpan oleh mail providers, dan masuk ke archives.

Jangan masukkan:

- raw database IDs yang sensitif;
- NRIC/passport/national ID;
- private internal hostname;
- secret token;
- authorization data;
- stack trace;
- environment secret;
- confidential workflow state.

### 13.3 Better custom header design

Gunakan opaque identifiers:

```text
X-Notification-Ref: nref_6W7F9KQ2
X-Correlation-ID: corr_8f3c1a9d
```

Mapping detail disimpan internal.

### 13.4 Header injection risk

Jangan pernah:

```java
message.setHeader("X-User-Name", userInput);
```

Tanpa validasi, user input yang mengandung CR/LF bisa mencoba menambah header baru.

Validasi minimal:

```java
static String safeHeaderValue(String value) {
    if (value == null) return null;
    if (value.contains("\r") || value.contains("\n")) {
        throw new IllegalArgumentException("Header value must not contain CR/LF");
    }
    return value;
}
```

Lebih baik: batasi custom header hanya dari server-side generated values.

---

## 14. InternetAddress: syntax, display names, validation

`InternetAddress` merepresentasikan alamat email internet.

### 14.1 Basic usage

```java
InternetAddress address = new InternetAddress(
    "noreply@example.gov.sg",
    "ACEAS Notifications",
    StandardCharsets.UTF_8.name()
);

message.setFrom(address);
```

### 14.2 Parsing strict

```java
InternetAddress[] recipients = InternetAddress.parse("alice@example.org", true);
message.setRecipients(Message.RecipientType.TO, recipients);
```

Parameter `true` meminta strict parsing.

### 14.3 Address validation is not deliverability validation

`InternetAddress` bisa membantu validasi syntax, tetapi tidak menjamin:

- domain exists;
- mailbox exists;
- recipient accepts mail;
- address belongs to intended person;
- address is not disposable;
- address is authorized for case.

Jadi validasi email address punya beberapa level:

| Level | Contoh |
|---|---|
| Syntax | `InternetAddress.parse(..., true)` |
| Domain plausibility | DNS/MX check |
| Ownership | verification link/OTP |
| Business authorization | recipient allowed for case |
| Delivery confirmation | provider event/bounce absence |

### 14.4 Display name encoding

Display name non-ASCII harus diencode sebagai MIME header.

```java
new InternetAddress(
    "notifikasi@example.gov.sg",
    "Pemberitahuan Perizinan",
    StandardCharsets.UTF_8.name()
);
```

Jangan build manual:

```java
// Bad
"Pemberitahuan Perizinan <notifikasi@example.gov.sg>"
```

Manual string bisa gagal jika display name mengandung koma, quote, unicode, atau karakter khusus.

### 14.5 Personal name from user input

Jika display name berasal dari user input:

- validasi CR/LF;
- pertimbangkan length limit;
- normalize whitespace;
- hindari memasukkan sensitive name jika email bisa forwarded;
- gunakan constructor `InternetAddress(address, personal, charset)`.

---

## 15. Multi-tenant sender identity

Dalam platform multi-tenant, identity menjadi lebih sulit.

Contoh aplikasi mengirim email untuk beberapa agency/tenant:

```text
Tenant A: Licensing Agency
From: Licensing Portal <notifications@licensing.gov.sg>

Tenant B: Compliance Agency
From: Compliance Portal <notifications@compliance.gov.sg>
```

### 15.1 Design options

#### Option A — Shared sender domain

```text
From: Tenant Name <notifications@platform.gov.sg>
```

Kelebihan:

- simpler DNS/auth;
- simpler relay;
- easier operational control.

Kekurangan:

- tenant identity less strong;
- replies centralized;
- branding limitation.

#### Option B — Tenant-owned sender domain

```text
From: Tenant Name <notifications@tenant.gov.sg>
```

Kelebihan:

- stronger trust;
- better alignment with agency identity;
- clearer to citizen/user.

Kekurangan:

- SPF/DKIM/DMARC setup per tenant;
- more onboarding complexity;
- risk of misconfigured tenant domain;
- harder failover.

#### Option C — Subdomain per tenant under platform domain

```text
From: Tenant Name <notifications@tenant-a.platform.gov.sg>
```

Kelebihan:

- platform controls DNS;
- tenant separation;
- routing easier.

Kekurangan:

- domain may look unfamiliar;
- requires communication/trust design.

### 15.2 Identity configuration model

Jangan hardcode sender.

Modelkan:

```java
public final class SenderIdentity {
    private final String tenantId;
    private final String senderEmail;
    private final String displayName;
    private final String replyToEmail;
    private final String replyToDisplayName;
    private final String bounceDomain;
    private final String dkimSigningDomain;
    private final boolean active;
    private final Instant validFrom;
    private final Instant validUntil;
}
```

### 15.3 Validation rules

Sebelum send:

```text
sender identity must be active
sender domain must be verified
template must be allowed for tenant
reply-to must be approved
bounce domain must be configured
recipient must belong to allowed context
```

### 15.4 Tenant spoofing invariant

```text
A tenant must never be able to send email using another tenant's visible From domain or display identity.
```

This is an authorization problem, not just mail configuration.

---

## 16. Authentication identity: SMTP account is not necessarily From

SMTP credential bisa berbeda dari `From`.

```text
SMTP auth username: smtp-service-account@example.net
Header From: Licensing Portal <notifications@licensing.gov.sg>
Envelope From: bounce@bounces.licensing.gov.sg
```

Ini normal jika relay/provider mengizinkan sending domain tersebut.

### 16.1 Dangerous assumption

Asumsi salah:

```text
SMTP username == From address
```

Kadang benar untuk simple mailbox SMTP, tetapi tidak general.

Enterprise relay biasanya memisahkan:

- credential identity;
- allowed sender domains;
- bounce domain;
- DKIM signing domain;
- return-path domain.

### 16.2 Authorization check

Mail subsystem harus punya rule:

```text
authenticated relay credential may send only for approved sender identities
```

Jangan biarkan request API internal menentukan `From` bebas.

Bad API:

```json
{
  "from": "ceo@example.gov.sg",
  "to": "user@example.org",
  "subject": "..."
}
```

Better API:

```json
{
  "senderIdentityKey": "ACEAS_CASE_NOTIFICATION",
  "recipientRef": "party:123",
  "templateKey": "CASE_STATUS_UPDATED",
  "templateData": { }
}
```

Business service memilih identity yang sudah pre-approved, bukan menerima raw `From` dari caller.

---

## 17. Header and envelope in Jakarta Mail: practical recipes

### 17.1 Simple safe transactional email

```java
Properties props = new Properties();
props.put("mail.smtp.host", "smtp.example.gov.sg");
props.put("mail.smtp.port", "587");
props.put("mail.smtp.auth", "true");
props.put("mail.smtp.starttls.enable", "true");
props.put("mail.smtp.starttls.required", "true");
props.put("mail.smtp.connectiontimeout", "10000");
props.put("mail.smtp.timeout", "30000");
props.put("mail.smtp.writetimeout", "30000");

// Envelope sender for bounce handling
props.put("mail.smtp.from", "bounce+nref_6W7F9KQ2@bounces.example.gov.sg");

Session session = Session.getInstance(props, authenticator);

MimeMessage message = new MimeMessage(session);
message.setFrom(new InternetAddress(
    "notifications@example.gov.sg",
    "ACEAS Notifications",
    StandardCharsets.UTF_8.name()
));
message.setReplyTo(new Address[] {
    new InternetAddress("support@example.gov.sg", "ACEAS Support", StandardCharsets.UTF_8.name())
});
message.setRecipients(
    Message.RecipientType.TO,
    new Address[] { new InternetAddress("alice@example.org", "Alice", StandardCharsets.UTF_8.name()) }
);
message.setSubject("Your application has been updated", StandardCharsets.UTF_8.name());
message.setText("Your application has been updated.", StandardCharsets.UTF_8.name());
message.setHeader("X-Notification-Ref", "nref_6W7F9KQ2");
message.setHeader("Message-ID", "<nref_6W7F9KQ2." + UUID.randomUUID() + "@mail.example.gov.sg>");
message.setSentDate(new Date());

Transport.send(message);
```

### 17.2 Explicit envelope recipients

Kadang kamu ingin header recipients dan actual SMTP recipients dikontrol eksplisit.

```java
Address[] envelopeRecipients = InternetAddress.parse("alice@example.org", true);

try (Transport transport = session.getTransport("smtp")) {
    transport.connect();
    transport.sendMessage(message, envelopeRecipients);
}
```

Ini penting untuk:

- BCC handling custom;
- one-message-per-recipient personalization;
- test harness;
- advanced routing;
- partial recipient handling.

### 17.3 Do not trust raw header strings

Bad:

```java
message.setHeader("Reply-To", userProvidedReplyTo);
```

Better:

```java
InternetAddress replyTo = new InternetAddress(replyToEmail, replyToName, StandardCharsets.UTF_8.name());
replyTo.validate();
message.setReplyTo(new Address[] { replyTo });
```

---

## 18. Privacy and recipient modelling

### 18.1 Recipient is not just an email address

Enterprise recipient model:

```java
public final class MailRecipient {
    private final String recipientId;
    private final String email;
    private final String displayName;
    private final RecipientVisibility visibility;
    private final RecipientRole role;
    private final String partyId;
    private final boolean verified;
    private final boolean allowedForCase;
}

enum RecipientVisibility {
    VISIBLE_TO,
    VISIBLE_CC,
    HIDDEN_BCC,
    ENVELOPE_ONLY
}

enum RecipientRole {
    PRIMARY_PARTY,
    REPRESENTATIVE,
    INTERNAL_OFFICER,
    AUDIT_COPY,
    SYSTEM_ARCHIVE,
    SUPPORT_CONTACT
}
```

### 18.2 Why role matters

Two recipients may both be `TO`, but business meaning differs:

```text
TO: applicant
TO: representative
TO: licensee
TO: enforcement officer
```

For audit, “who received it?” is not enough. Need:

```text
why this recipient received it
under what authority
visible or hidden
which business role
which address source
whether address was verified
```

### 18.3 Recipient expansion risk

Suppose notification is sent to a company.

Business data:

```text
case_id = C123
company_id = CO9
representatives = [A, B, C]
```

If recipient expansion runs dynamically at send time, team membership may change between event creation and send.

Questions:

- Should recipients be captured at event time or send time?
- If representative removed before send, should they still receive?
- If new representative added after event, should they receive?
- How is this audited?

Top-grade design stores:

```text
notification created at T1
recipient resolution policy = SNAPSHOT_AT_CREATION or LIVE_AT_SEND
resolved recipients = immutable list with source metadata
```

### 18.4 Privacy invariant

```text
Visible recipient list must not disclose other parties unless the business process explicitly allows mutual visibility.
```

If unsure, prefer one email per recipient.

---

## 19. No-reply address: useful but often abused

`noreply@...` is common.

### 19.1 Benefits

- discourages unmonitored replies;
- prevents support chaos;
- clear system-generated signal;
- simple routing.

### 19.2 Problems

- user cannot ask follow-up naturally;
- replies may bounce and frustrate user;
- important evidence may be lost;
- accessibility/user trust issue;
- looks impersonal;
- may hurt deliverability/user engagement.

### 19.3 Better patterns

#### Pattern A — No-reply with explicit support link

```text
From: ACEAS Notifications <noreply@example.gov.sg>
Reply-To: Do Not Reply <noreply@example.gov.sg>
Body: For enquiries, contact support at ...
```

Works for purely informational notification.

#### Pattern B — System From with support Reply-To

```text
From: ACEAS Notifications <notifications@example.gov.sg>
Reply-To: ACEAS Support <support@example.gov.sg>
```

Works when replies should go to support.

#### Pattern C — Case-specific reply address

```text
From: Case Management <case-notices@example.gov.sg>
Reply-To: Case C123 <case+C123@example.gov.sg>
```

Works when inbound email ingestion exists.

#### Pattern D — Secure portal link instead of email reply

```text
From: Licensing Portal <notifications@example.gov.sg>
Body: Please respond through the secure portal.
```

Works when email should not carry sensitive discussion.

### 19.4 Recommendation

For regulatory systems, avoid blind `noreply` default. Decide per notification type:

| Notification type | Reply behavior |
|---|---|
| OTP/security code | No reply |
| Case information request | Secure portal or case inbox |
| Payment receipt | Support reply allowed |
| Enforcement notice | Usually secure portal/contact channel |
| System maintenance | Support/helpdesk |

---

## 20. Mailing lists, aliases, and group addresses

Recipient may not be a person.

Examples:

```text
licensing-team@example.gov.sg
case-officers@example.gov.sg
vendor-support@example.com
```

### 20.1 Risks

- group membership unknown to application;
- sensitive data distributed too widely;
- replies go to group;
- audit cannot prove individual receipt;
- external forwarding possible;
- mailbox permissions change over time.

### 20.2 Policy

For sensitive/regulatory notification:

- prefer individual verified recipient;
- use group address only if business-approved;
- record that recipient is group mailbox;
- avoid high-sensitive content to group;
- use portal link for details.

### 20.3 Role mailbox legitimate use

Role mailbox is useful for:

- support queues;
- operations;
- internal monitoring;
- low-risk notices;
- official agency inbox.

But model it differently from individual user.

---

## 21. Inbound replies and identity continuity

If your system receives replies, identity mapping becomes bidirectional.

Outbound:

```text
Message-ID: <nref_123@mail.example.gov.sg>
Reply-To: case+nref_123@example.gov.sg
```

Inbound reply:

```text
From: Alice <alice@example.org>
To: case+nref_123@example.gov.sg
In-Reply-To: <nref_123@mail.example.gov.sg>
References: <nref_123@mail.example.gov.sg>
Subject: Re: Your application has been updated
```

### 21.1 Routing signals

Inbound processor can use:

- recipient address token;
- `In-Reply-To`;
- `References`;
- subject token;
- custom headers if preserved;
- provider webhook metadata;
- mailbox folder;
- sender address.

### 21.2 Do not rely on one signal

Signals can be missing or modified.

| Signal | Risk |
|---|---|
| Reply-To token | User changes recipient |
| In-Reply-To | Some clients omit/break |
| References | Can be long/truncated |
| Subject token | User edits subject |
| Custom headers | Not always preserved in replies |
| From address | Forwarded/delegated reply |

Robust inbound routing uses layered matching and confidence scoring.

### 21.3 Authorization check

Even if inbound reply matches case token, verify sender is allowed.

```text
matched case = C123
sender = alice@example.org
is sender verified party/representative/officer for C123?
```

If not, route to manual review.

---

## 22. Message identity and audit evidence

For regulatory-grade system, email audit should not only store “sent true”.

Store identity fields:

```text
notification_id
attempt_id
message_id_header
envelope_from
envelope_recipients
header_from
header_sender
header_reply_to
header_to
header_cc
header_bcc_policy
subject_hash_or_subject_redacted
template_key
template_version
recipient_resolution_policy
smtp_provider
smtp_response_code
smtp_queue_id_if_available
created_at
sent_at
```

### 22.1 Store raw MIME?

Trade-off.

Storing raw MIME gives strong evidence:

- exact headers;
- exact body;
- exact attachments metadata;
- exact rendered content.

But risk:

- PII retention;
- storage size;
- encryption requirement;
- legal discovery;
- access control;
- attachment sensitivity.

Alternative:

- store template key/version + data snapshot;
- store rendered hash;
- store redacted preview;
- store attachment references/hashes;
- store identity headers.

For defensibility, often best:

```text
store rendered content hash + template version + immutable data snapshot + redacted preview + metadata
```

For high-stakes notice, maybe also store encrypted raw MIME under strict access.

### 22.2 Audit invariant

```text
For every outbound email, system must be able to reconstruct who it claimed to be from, who it attempted to send to, which identity was used for bounce/reply, and which business event authorized it.
```

---

## 23. Failure modes caused by wrong identity/header semantics

### 23.1 Bounce goes to unmonitored mailbox

Symptom:

```text
Application logs SENT, user never receives, no bounce visible.
```

Cause:

```text
MAIL FROM defaults to SMTP username or From, bounce mailbox not monitored.
```

Fix:

- configure envelope sender;
- monitor bounce mailbox/webhook;
- correlate bounce to notification.

### 23.2 Replies go to noreply blackhole

Symptom:

```text
User replies with requested documents, agency never sees them.
```

Cause:

```text
Reply-To absent, From is noreply, mailbox discards replies.
```

Fix:

- set Reply-To per notification type;
- body tells user correct channel;
- inbound ingestion or support mailbox.

### 23.3 BCC leaked

Symptom:

```text
Recipient sees hidden audit or internal recipient.
```

Cause:

```text
Manual header construction included Bcc, or raw MIME archived/forwarded incorrectly.
```

Fix:

- never manually build Bcc header;
- test raw SMTP output;
- one-message-per-recipient for sensitive mail.

### 23.4 DMARC fail due to From mismatch

Symptom:

```text
Provider accepts email, recipient domain rejects/quarantines.
```

Cause:

```text
From domain not aligned with authenticated/signed domain.
```

Fix:

- verify sender domain;
- align DKIM/SPF/DMARC;
- use approved sender identity.

### 23.5 Wrong thread association

Symptom:

```text
Email appears under unrelated previous conversation.
```

Cause:

```text
Reused Message-ID or wrong References/In-Reply-To.
```

Fix:

- unique Message-ID;
- validate thread/case context;
- test replies.

### 23.6 Multi-recipient privacy incident

Symptom:

```text
External parties see each other's email addresses.
```

Cause:

```text
Batch sent with all recipients in To/Cc.
```

Fix:

- one email per recipient;
- BCC only when business-approved;
- recipient visibility policy.

---

## 24. Designing a production-grade MailIdentity model

A robust model separates identity concerns.

```java
public final class MailIdentity {
    private final HeaderIdentity header;
    private final EnvelopeIdentity envelope;
    private final AuthIdentity auth;
    private final BusinessIdentity business;
}

public final class HeaderIdentity {
    private final MailboxAddress from;
    private final Optional<MailboxAddress> sender;
    private final List<MailboxAddress> replyTo;
    private final Optional<String> messageId;
    private final Optional<String> inReplyTo;
    private final List<String> references;
}

public final class EnvelopeIdentity {
    private final String mailFrom;
    private final List<String> rcptTo;
}

public final class AuthIdentity {
    private final String smtpProfileKey;
    private final String allowedSenderDomain;
}

public final class BusinessIdentity {
    private final String tenantId;
    private final String module;
    private final String notificationId;
    private final String templateKey;
    private final String templateVersion;
}
```

### 24.1 MailboxAddress value object

```java
public final class MailboxAddress {
    private final String email;
    private final String displayName;

    public InternetAddress toInternetAddress() throws UnsupportedEncodingException, AddressException {
        validateNoHeaderInjection(email);
        validateNoHeaderInjection(displayName);

        InternetAddress address = new InternetAddress(
            email,
            displayName,
            StandardCharsets.UTF_8.name()
        );
        address.validate();
        return address;
    }

    private static void validateNoHeaderInjection(String value) {
        if (value == null) return;
        if (value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0) {
            throw new IllegalArgumentException("CR/LF not allowed in mail address fields");
        }
    }
}
```

### 24.2 Sender identity registry

```java
public interface SenderIdentityRegistry {
    SenderIdentity resolve(String tenantId, String senderIdentityKey);
    void assertAllowed(String tenantId, String senderIdentityKey, String templateKey);
}
```

### 24.3 Do not let business caller pass arbitrary From

Bad:

```java
sendEmail(String from, String to, String subject, String body)
```

Better:

```java
sendNotification(SendNotificationCommand command)
```

Where:

```java
public final class SendNotificationCommand {
    private final String tenantId;
    private final String senderIdentityKey;
    private final String templateKey;
    private final List<RecipientRef> recipients;
    private final Map<String, Object> templateData;
    private final String businessCorrelationId;
}
```

Sender identity is resolved server-side.

---

## 25. Practical builder with identity separation

```java
public final class MimeMessageFactory {

    public MimeMessage create(
            Session session,
            ResolvedMailCommand command
    ) throws MessagingException, UnsupportedEncodingException {

        MimeMessage message = new MimeMessage(session);

        HeaderIdentity header = command.headerIdentity();

        message.setFrom(header.from().toInternetAddress());

        if (header.sender().isPresent()) {
            message.setHeader("Sender", header.sender().get().toInternetAddress().toUnicodeString());
        }

        if (!header.replyTo().isEmpty()) {
            Address[] replyTo = toAddresses(header.replyTo());
            message.setReplyTo(replyTo);
        }

        message.setRecipients(Message.RecipientType.TO, toAddresses(command.visibleTo()));
        message.setRecipients(Message.RecipientType.CC, toAddresses(command.visibleCc()));
        message.setRecipients(Message.RecipientType.BCC, toAddresses(command.hiddenBcc()));

        message.setSubject(command.subject(), StandardCharsets.UTF_8.name());
        message.setSentDate(Date.from(command.createdAt()));

        String messageId = command.messageId();
        validateMessageId(messageId);
        message.setHeader("Message-ID", messageId);

        command.inReplyTo().ifPresent(value -> {
            try {
                validateMessageId(value);
                message.setHeader("In-Reply-To", value);
            } catch (MessagingException e) {
                throw new IllegalStateException(e);
            }
        });

        if (!command.references().isEmpty()) {
            String references = String.join(" ", command.references());
            validateNoHeaderInjection(references);
            message.setHeader("References", references);
        }

        message.setHeader("X-Notification-Ref", command.notificationRef());
        message.setContent(command.content());

        return message;
    }

    private Address[] toAddresses(List<MailboxAddress> addresses)
            throws UnsupportedEncodingException, AddressException {
        Address[] result = new Address[addresses.size()];
        for (int i = 0; i < addresses.size(); i++) {
            result[i] = addresses.get(i).toInternetAddress();
        }
        return result;
    }

    private void validateMessageId(String value) {
        validateNoHeaderInjection(value);
        if (!value.startsWith("<") || !value.endsWith(">") || !value.contains("@")) {
            throw new IllegalArgumentException("Invalid Message-ID format");
        }
    }

    private static void validateNoHeaderInjection(String value) {
        if (value == null) return;
        if (value.contains("\r") || value.contains("\n")) {
            throw new IllegalArgumentException("CR/LF not allowed");
        }
    }
}
```

Catatan:

- Ini illustrative skeleton, bukan final library.
- Untuk checked exception di lambda, production code sebaiknya lebih rapi.
- Validasi `Message-ID` di atas minimal; parser RFC penuh lebih kompleks.
- `message.setContent(command.content())` bergantung pada content abstraction yang sudah dibahas di part MIME/multipart.

---

## 26. Sending with explicit envelope sender and recipients

Karena `mail.smtp.from` berada di `Session` properties, jika envelope sender berbeda per message, ada beberapa opsi.

### 26.1 Option A — Session per sender identity

```java
Properties props = baseProps();
props.put("mail.smtp.from", command.envelope().mailFrom());
Session session = Session.getInstance(props, authenticator);
```

Kelebihan:

- simple;
- explicit.

Kekurangan:

- session creation per mail;
- config management;
- less ideal jika banyak identity.

### 26.2 Option B — SMTPMessage extension

JavaMail/Jakarta Mail provider historically has provider-specific classes such as SMTPMessage in SMTP package, allowing SMTP-specific options. Ini lebih provider-specific, jadi gunakan hanya jika kamu menerima coupling ke implementation.

Conceptual:

```java
// provider-specific style, not pure jakarta.mail abstraction
SMTPMessage smtpMessage = new SMTPMessage(session);
smtpMessage.setEnvelopeFrom(command.envelope().mailFrom());
```

Trade-off:

- lebih precise per-message envelope;
- less portable;
- depends on SMTP provider package.

### 26.3 Option C — Provider/API abstraction

Jika memakai SES/SendGrid/Mailgun API, envelope/return-path sering dikonfigurasi via API field/provider setting.

Desain `MailGateway` harus mengekspresikan semantic, bukan property Jakarta Mail:

```java
public interface MailGateway {
    SendResult send(MailEnvelope envelope, RenderedMailMessage message);
}
```

Implementasi SMTP menerjemahkan ke `mail.smtp.from`; implementasi API menerjemahkan ke provider field.

---

## 27. Top 1% checklist: identity/header review

Gunakan checklist ini saat design review.

### 27.1 Header identity

- [ ] `From` berasal dari approved sender identity, bukan raw request.
- [ ] Display name jelas dan tidak misleading.
- [ ] `Reply-To` ditentukan per notification type.
- [ ] `Sender` digunakan hanya jika delegated sending benar-benar diperlukan.
- [ ] `Message-ID` unik, tersimpan, dan bisa dikorelasikan.
- [ ] `In-Reply-To`/`References` hanya dipakai untuk thread yang sama dan authorized.
- [ ] Subject tidak membocorkan sensitive data.

### 27.2 Envelope identity

- [ ] Envelope `MAIL FROM` eksplisit untuk bounce handling.
- [ ] Bounce address tidak mengandung PII.
- [ ] Envelope recipients sesuai recipient policy.
- [ ] Actual recipients tidak hanya diasumsikan dari visible headers.

### 27.3 Recipient privacy

- [ ] One-message-per-recipient dipakai untuk sensitive/personal notification.
- [ ] Multi-recipient visible list hanya dipakai jika mutual visibility allowed.
- [ ] BCC tidak dipakai sebagai shortcut tanpa audit policy.
- [ ] Group mailbox diberi classification khusus.

### 27.4 Security

- [ ] Tidak ada CR/LF injection di header values.
- [ ] User input tidak langsung masuk header.
- [ ] Custom headers tidak mengandung secret/PII.
- [ ] Sender domain authorization dicek.
- [ ] Tenant tidak bisa spoof tenant lain.

### 27.5 Audit

- [ ] Header and envelope identity disimpan.
- [ ] Recipient role dan source disimpan.
- [ ] Template version disimpan.
- [ ] Message-ID dan provider response disimpan.
- [ ] Replay/retry memiliki attempt model.

---

## 28. Common anti-patterns

### Anti-pattern 1 — Generic utility method

```java
sendMail(String from, String to, String subject, String body)
```

Masalah:

- no sender authorization;
- no reply policy;
- no bounce handling;
- no audit metadata;
- no recipient role;
- no template version;
- no retry identity.

### Anti-pattern 2 — Treating `From` as SMTP account

```text
SMTP username = noreply@vendor.com
From = user-selected arbitrary email
```

Masalah:

- spoofing;
- DMARC fail;
- provider rejection;
- trust issue.

### Anti-pattern 3 — All recipients in To

```text
To: applicant1@example.org, applicant2@example.org, applicant3@example.org
```

Masalah:

- privacy leak;
- reply-all risk;
- per-recipient status impossible.

### Anti-pattern 4 — Case ID in bounce address with PII

```text
bounce+JohnTan-NRIC-S1234567A-case-123@example.gov.sg
```

Masalah:

- PII in headers/logs;
- forwarded exposure;
- provider retention.

### Anti-pattern 5 — Manually constructing headers

```java
message.setHeader("From", name + " <" + email + ">");
```

Masalah:

- encoding bug;
- injection risk;
- invalid syntax;
- display name edge cases.

### Anti-pattern 6 — Reusing Message-ID

```text
Message-ID: <case-123@example.gov.sg>
```

For every notification in same case.

Masalah:

- client dedup/threading chaos;
- audit ambiguity;
- reply mismatch.

---

## 29. Example: regulatory case notification identity design

Scenario:

```text
System: Case management platform
Tenant: CEA
Module: Application Management
Event: Additional document requested
Recipient: applicant representative
Reply channel: secure portal preferred, support fallback
Bounce handling: notification-specific opaque bounce token
```

### 29.1 Header design

```text
From: CEA Application Management <notifications@aceas.example.gov.sg>
Reply-To: CEA Support <support@aceas.example.gov.sg>
To: Representative Name <rep@example.org>
Subject: Action required: Submit additional documents for your application
Message-ID: <nref_8K2P9Q.20260618.4f7a@mail.aceas.example.gov.sg>
X-Notification-Ref: nref_8K2P9Q
```

### 29.2 Envelope design

```text
MAIL FROM:<bounce+nref_8K2P9Q@bounces.aceas.example.gov.sg>
RCPT TO:<rep@example.org>
```

### 29.3 Business audit

```text
notification_id: 456
business_event_id: application-doc-requested-789
tenant: CEA
module: Application Management
template: ADDITIONAL_DOCUMENT_REQUESTED:v3
recipient_role: REPRESENTATIVE
recipient_source: case_party_snapshot
sender_identity: CEA_APPLICATION_MANAGEMENT
message_id: <nref_8K2P9Q.20260618.4f7a@mail.aceas.example.gov.sg>
envelope_from: bounce+nref_8K2P9Q@bounces.aceas.example.gov.sg
envelope_to: rep@example.org
header_from: notifications@aceas.example.gov.sg
header_reply_to: support@aceas.example.gov.sg
```

### 29.4 Why this is strong

- visible sender matches business context;
- reply goes to monitored channel;
- bounce is machine-correlatable;
- no PII in bounce/custom header;
- one recipient avoids privacy leak;
- message ID is unique and traceable;
- audit can reconstruct identity.

---

## 30. Java 8–25 notes

### 30.1 Java 8 legacy

Likely stack:

```xml
<dependency>
  <groupId>com.sun.mail</groupId>
  <artifactId>javax.mail</artifactId>
  <version>1.6.2</version>
</dependency>
```

Package:

```java
import javax.mail.*;
import javax.mail.internet.*;
```

### 30.2 Java 11+

Do not assume Java SE includes JavaMail/Activation.

Add dependencies explicitly.

### 30.3 Jakarta modern

Package:

```java
import jakarta.mail.*;
import jakarta.mail.internet.*;
```

Activation:

```java
import jakarta.activation.*;
```

### 30.4 Avoid mixed namespace

Do not mix:

```java
javax.mail.Message
jakarta.mail.internet.MimeMessage
```

or:

```java
javax.activation.DataSource
jakarta.mail.internet.MimeBodyPart
```

Namespace consistency matters.

### 30.5 Identity semantics do not change

The namespace changes from `javax` to `jakarta`, but the conceptual distinction remains:

```text
From header != SMTP MAIL FROM
To/Cc/Bcc headers != necessarily all actual envelope recipients
Reply-To != Return-Path
Message-ID != notification_id
SMTP auth user != visible sender
```

---

## 31. Minimal tests for identity correctness

### 31.1 Test From and Reply-To

```java
@Test
void shouldSetApprovedFromAndReplyTo() throws Exception {
    MimeMessage message = factory.create(session, command);

    assertThat(message.getFrom()[0].toString()).contains("ACEAS Notifications");
    assertThat(message.getReplyTo()[0].toString()).contains("support@example.gov.sg");
}
```

### 31.2 Test Message-ID exists

```java
@Test
void shouldSetMessageId() throws Exception {
    MimeMessage message = factory.create(session, command);

    String[] ids = message.getHeader("Message-ID");
    assertThat(ids).hasSize(1);
    assertThat(ids[0]).startsWith("<nref_").endsWith("@mail.example.gov.sg>");
}
```

### 31.3 Test no PII in custom headers

```java
@Test
void customHeadersShouldNotContainPii() throws Exception {
    MimeMessage message = factory.create(session, command);

    Enumeration<?> headers = message.getAllHeaders();
    while (headers.hasMoreElements()) {
        Header header = (Header) headers.nextElement();
        assertThat(header.getValue()).doesNotContain("S1234567A");
    }
}
```

### 31.4 Test BCC not visible in raw output

Use fake SMTP or write message to output stream:

```java
ByteArrayOutputStream out = new ByteArrayOutputStream();
message.writeTo(out);
String raw = out.toString(StandardCharsets.UTF_8);

assertThat(raw).doesNotContain("Bcc:");
```

Catatan: behavior dapat berbeda tergantung kapan/how message ditulis. Test end-to-end dengan SMTP test server tetap penting.

### 31.5 Test header injection rejection

```java
@Test
void shouldRejectHeaderInjectionInDisplayName() {
    MailboxAddress address = new MailboxAddress(
        "safe@example.org",
        "Alice\r\nBcc: attacker@example.org"
    );

    assertThrows(IllegalArgumentException.class, address::toInternetAddress);
}
```

---

## 32. Summary mental model

Jika hanya membawa satu mental model dari part ini, bawa ini:

```text
Email identity is multi-layered.
Visible sender, reply destination, bounce destination, actual recipient, SMTP account, domain authentication, and business authorization are different concepts.
```

Mapping penting:

| Concept | Field/protocol | Controlled by |
|---|---|---|
| Visible sender | `From:` | Message header |
| Delegated sender | `Sender:` | Message header |
| Human reply target | `Reply-To:` | Message header |
| Visible recipient | `To:` / `Cc:` | Message header |
| Hidden recipient | `Bcc:` + envelope | Message/header sending behavior |
| Actual SMTP recipient | `RCPT TO` | SMTP envelope |
| Bounce target | `MAIL FROM` / `Return-Path` | SMTP envelope / receiver-added header |
| Thread identity | `Message-ID`, `In-Reply-To`, `References` | Message header |
| SMTP login | username/OAuth2 | SMTP authentication |
| Domain legitimacy | SPF/DKIM/DMARC | DNS/provider/signing |
| Business authorization | tenant/module/case/template policy | application domain |

Top-grade engineering is not memorizing headers. It is designing invariants:

```text
- sender identity must be approved
- reply route must be intentional
- bounce route must be monitored
- recipient visibility must match privacy policy
- message identity must be traceable
- headers must not leak sensitive data
- business event must authorize the send
```

---

## 33. What comes next

Part berikutnya:

```text
Part 10 — Error Model: MessagingException, SendFailedException, SMTPAddressFailedException
```

Kita akan masuk ke failure taxonomy Jakarta Mail/SMTP:

- `MessagingException`;
- nested exception;
- recipient rejected;
- partial success;
- transient vs permanent failure;
- SMTP code mapping;
- retry classification;
- domain-level error model.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 8 — HTML Email Engineering: Templates, CSS, Images, and Client Compatibility](./08-html-email-template-client-compatibility.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 10 — Error Model: `MessagingException`, `SendFailedException`, `SMTPAddressFailedException`](./10-error-model-exception-failure-classification.md)
