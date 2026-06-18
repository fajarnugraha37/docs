# Part 5 — MIME Message Construction: Text, HTML, Charset, Headers

> Series: `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery`  
> File: `05-mime-message-text-html-headers-charset.md`  
> Scope: Java 8 sampai Java 25, JavaMail `javax.mail`, Jakarta Mail `jakarta.mail`, Eclipse Angus Mail, MIME message construction, text/HTML body, charset, header semantics, safe builders.

---

## 1. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah melihat bahwa email bukan sekadar `Transport.send(message)`. Sekarang kita masuk ke satu hal yang sering terlihat sederhana tetapi sangat menentukan kualitas sistem email: **membangun message yang valid**.

Bagian ini menjawab pertanyaan:

1. Apa sebenarnya isi `MimeMessage`?
2. Apa bedanya body, header, envelope, dan MIME part?
3. Kapan memakai `setText`, `setContent`, `setHeader`, `addHeader`, `setRecipients`, `setSubject`?
4. Bagaimana mengirim plain text dan HTML dengan charset yang benar?
5. Bagaimana mencegah header injection?
6. Bagaimana mendesain builder yang aman, eksplisit, dan tidak rapuh?
7. Apa mental model yang harus dimiliki engineer senior ketika melihat email message?

Target akhir bagian ini: kamu tidak hanya bisa membuat email terkirim, tetapi mampu menjawab:

> “Apakah message ini valid, aman, dapat dirender lintas client, dapat di-debug, dan tidak mencampur tanggung jawab envelope, header, dan content?”

---

## 2. Mental Model Utama: Email Message Adalah Dokumen Terstruktur

Banyak developer memperlakukan email seperti ini:

```java
message.setSubject("Hello");
message.setText("Body");
Transport.send(message);
```

Kode itu valid untuk kasus sangat sederhana. Tetapi secara konseptual, email adalah dokumen internet dengan struktur seperti ini:

```text
SMTP ENVELOPE
  MAIL FROM:<bounce@example.com>
  RCPT TO:<user@example.net>

MESSAGE DATA
  From: Example App <noreply@example.com>
  To: User <user@example.net>
  Subject: Welcome
  Date: Tue, 18 Jun 2026 10:00:00 +0700
  Message-ID: <abc123@example.com>
  MIME-Version: 1.0
  Content-Type: text/plain; charset=UTF-8
  Content-Transfer-Encoding: quoted-printable

  Hello User,
  Welcome to the system.
```

Ada dua area besar:

1. **SMTP envelope**
   - digunakan oleh SMTP server untuk routing dan delivery;
   - tidak selalu sama dengan header `From`/`To`;
   - berhubungan dengan bounce, return path, dan deliverability.

2. **Message content**
   - header message;
   - body;
   - MIME structure;
   - attachment;
   - metadata yang dibaca mail client.

`MimeMessage` merepresentasikan **message content**, bukan seluruh kehidupan email. SMTP envelope dikendalikan oleh transport/protocol layer dan properti tertentu, bukan selalu oleh header yang terlihat user.

---

## 3. Apa Itu `MimeMessage`?

Di Jakarta Mail, `MimeMessage` adalah concrete implementation untuk pesan email bergaya MIME. Secara konseptual, ia adalah:

```text
MimeMessage
  ├── headers
  │   ├── From
  │   ├── To
  │   ├── Cc
  │   ├── Subject
  │   ├── Date
  │   ├── Message-ID
  │   ├── MIME-Version
  │   └── Content-Type
  └── content
      ├── simple text
      ├── HTML
      ├── Multipart
      └── nested MIME parts
```

`MimeMessage` mengimplementasikan beberapa konsep:

1. **Message**
   - abstraction umum untuk pesan;
   - memiliki sender, recipient, subject, sent date, flags, dan content.

2. **MimePart**
   - bagian dari MIME message;
   - memiliki header dan body;
   - bisa punya `Content-Type`, `Content-Disposition`, `Content-Transfer-Encoding`.

3. **Part**
   - common abstraction untuk message dan body part;
   - message itu sendiri bisa dianggap sebagai satu MIME part utama.

Mental model penting:

> `MimeMessage` adalah root MIME part sekaligus message envelope di level header. Kalau email punya attachment, HTML, plain alternative, atau inline image, root content biasanya bukan string biasa, tetapi `Multipart`.

---

## 4. JavaMail vs Jakarta Mail Namespace

Untuk Java 8 legacy:

```java
import javax.mail.Message;
import javax.mail.Session;
import javax.mail.internet.MimeMessage;
import javax.mail.internet.InternetAddress;
```

Untuk Jakarta modern:

```java
import jakarta.mail.Message;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.internet.InternetAddress;
```

Secara mental model, contoh di bagian ini sama. Perbedaan utama adalah namespace dan dependency.

Untuk menghindari duplikasi, contoh utama akan memakai `jakarta.mail`. Jika kamu berada di Java 8 legacy, ubah `jakarta.mail.*` menjadi `javax.mail.*` dan gunakan dependency JavaMail/Angus versi legacy yang sesuai.

---

## 5. Message Construction Lifecycle

Lifecycle normal pembuatan email:

```text
1. Siapkan Session
2. Buat MimeMessage
3. Set identity headers
4. Set recipients
5. Set subject
6. Set body/content
7. Tambahkan optional headers aman
8. saveChanges jika perlu
9. Send via Transport
```

Contoh minimal:

```java
Properties props = new Properties();
props.put("mail.smtp.host", "smtp.example.com");
props.put("mail.smtp.port", "587");
props.put("mail.smtp.auth", "true");
props.put("mail.smtp.starttls.enable", "true");
props.put("mail.smtp.connectiontimeout", "5000");
props.put("mail.smtp.timeout", "10000");
props.put("mail.smtp.writetimeout", "10000");

Session session = Session.getInstance(props);

MimeMessage message = new MimeMessage(session);
message.setFrom(new InternetAddress("noreply@example.com", "Example App", StandardCharsets.UTF_8.name()));
message.setRecipient(Message.RecipientType.TO, new InternetAddress("user@example.net", "User", StandardCharsets.UTF_8.name()));
message.setSubject("Welcome", StandardCharsets.UTF_8.name());
message.setText("Hello User,\nWelcome to the system.", StandardCharsets.UTF_8.name());

message.saveChanges();
```

Hal penting:

1. `MimeMessage` tidak otomatis terkirim.
2. `Session` tidak berarti koneksi SMTP sudah terbuka.
3. `setText` membuat body text/plain.
4. `setSubject(subject, charset)` membantu encoding subject non-ASCII.
5. `saveChanges()` dapat menambahkan/memperbarui beberapa header seperti `Date`, `Message-ID`, dan MIME headers sebelum dikirim.

---

## 6. Header vs Body vs Content

Email message terdiri dari header dan body, dipisahkan oleh blank line.

```text
From: Example App <noreply@example.com>
To: user@example.net
Subject: Hello
Content-Type: text/plain; charset=UTF-8

This is the body.
```

Semua sebelum baris kosong adalah header. Semua setelahnya adalah body.

### 6.1 Header

Header adalah metadata. Contoh:

```text
From: Example App <noreply@example.com>
To: User <user@example.net>
Subject: Account created
Date: Tue, 18 Jun 2026 10:00:00 +0700
Message-ID: <abc123@example.com>
Content-Type: text/plain; charset=UTF-8
```

Header harus mengikuti aturan internet message. Banyak header historis dibatasi ASCII dan perlu MIME encoded-word untuk karakter non-ASCII.

### 6.2 Body

Body adalah payload yang dibaca penerima.

```text
Hello User,
Your account has been created.
```

Body bisa berupa:

1. plain text;
2. HTML;
3. multipart;
4. nested multipart;
5. attachment-bearing structure.

### 6.3 Content

Di Jakarta Mail, `content` adalah isi dari message atau body part.

Content bisa:

```java
String plainText
String html
Multipart multipart
InputStream-backed content
DataHandler-backed content
```

Jadi, `message.setContent(...)` berarti mengganti content utama message.

---

## 7. `setText` vs `setContent`

Ini salah satu titik kebingungan paling umum.

### 7.1 `setText(String text)`

```java
message.setText("Hello");
```

Biasanya menghasilkan:

```text
Content-Type: text/plain; charset=us-ascii
```

atau default charset tertentu tergantung content dan konfigurasi.

Masalah: jika body mengandung Unicode, emoji, nama Indonesia, Jepang, Arab, dan sebagainya, default bisa tidak sesuai.

Lebih aman:

```java
message.setText("Halo Fajar, selamat datang.", StandardCharsets.UTF_8.name());
```

### 7.2 `setText(String text, String charset)`

```java
message.setText("Halo dunia", "UTF-8");
```

Menghasilkan body `text/plain` dengan charset UTF-8.

Gunakan ini untuk plain text email.

### 7.3 `setText(String text, String charset, String subtype)`

Untuk HTML:

```java
message.setText("<h1>Hello</h1>", StandardCharsets.UTF_8.name(), "html");
```

Ini menghasilkan content type seperti:

```text
Content-Type: text/html; charset=UTF-8
```

### 7.4 `setContent(Object content, String type)`

```java
message.setContent(html, "text/html; charset=UTF-8");
```

Ini eksplisit dan sering dipakai untuk HTML sederhana.

### 7.5 Rule of Thumb

```text
Plain text only      -> setText(text, "UTF-8")
HTML only            -> setText(html, "UTF-8", "html") atau setContent(html, "text/html; charset=UTF-8")
Plain + HTML         -> Multipart alternative
HTML + attachment    -> Multipart mixed/related/alternative nested
```

Jangan panggil `setText` lalu `setContent` dengan ekspektasi keduanya digabung. Pemanggilan content setter biasanya mengganti content sebelumnya.

Salah:

```java
message.setText("Plain fallback", "UTF-8");
message.setContent("<b>HTML</b>", "text/html; charset=UTF-8");
```

Hasil akhirnya hanya HTML, bukan plain + HTML.

Benar untuk plain + HTML akan dibahas mendalam di Part 6, tetapi ringkasnya memakai `Multipart`:

```java
MimeBodyPart textPart = new MimeBodyPart();
textPart.setText("Plain fallback", StandardCharsets.UTF_8.name());

MimeBodyPart htmlPart = new MimeBodyPart();
htmlPart.setContent("<b>HTML</b>", "text/html; charset=UTF-8");

MimeMultipart alternative = new MimeMultipart("alternative");
alternative.addBodyPart(textPart);
alternative.addBodyPart(htmlPart);

message.setContent(alternative);
```

---

## 8. Subject Encoding

Subject terlihat sederhana, tetapi punya aturan encoding.

Contoh subject ASCII:

```java
message.setSubject("Account created");
```

Contoh subject Unicode:

```java
message.setSubject("Akun berhasil dibuat — Selamat datang", StandardCharsets.UTF_8.name());
```

Jika subject mengandung karakter non-ASCII dan kamu memakai low-level raw header seperti ini:

```java
message.setHeader("Subject", "Akun berhasil dibuat — Selamat datang");
```

itu berisiko tidak valid, karena raw header tidak otomatis selalu aman untuk non-ASCII tergantung API usage.

Gunakan high-level API:

```java
message.setSubject(subject, "UTF-8");
```

Mental model:

> High-level setters seperti `setSubject` dan `setRecipients` membantu encoding/formatting. Raw header manipulation memindahkan tanggung jawab correctness ke developer.

---

## 9. Address Construction dengan `InternetAddress`

Email address bukan hanya string.

```text
Personal Name <local@domain>
```

Contoh:

```java
InternetAddress from = new InternetAddress(
    "noreply@example.com",
    "Example Notification Service",
    StandardCharsets.UTF_8.name()
);

message.setFrom(from);
```

Recipient:

```java
InternetAddress to = new InternetAddress(
    "fajar@example.net",
    "Fajar Abdi Nugraha",
    StandardCharsets.UTF_8.name()
);

message.setRecipient(Message.RecipientType.TO, to);
```

Multiple recipients:

```java
message.setRecipients(
    Message.RecipientType.TO,
    new InternetAddress[] {
        new InternetAddress("alice@example.net", "Alice", "UTF-8"),
        new InternetAddress("bob@example.net", "Bob", "UTF-8")
    }
);
```

Parsing string address:

```java
InternetAddress[] addresses = InternetAddress.parse("alice@example.net,bob@example.net", true);
message.setRecipients(Message.RecipientType.TO, addresses);
```

`strict = true` lebih aman untuk input yang harus valid.

---

## 10. Recipient Type: TO, CC, BCC

Jakarta Mail menyediakan:

```java
Message.RecipientType.TO
Message.RecipientType.CC
Message.RecipientType.BCC
```

### 10.1 TO

Penerima utama.

```java
message.setRecipient(Message.RecipientType.TO, new InternetAddress("user@example.net"));
```

### 10.2 CC

Penerima yang terlihat sebagai copy recipient.

```java
message.addRecipient(Message.RecipientType.CC, new InternetAddress("manager@example.net"));
```

### 10.3 BCC

Penerima yang tidak seharusnya terlihat oleh penerima lain.

```java
message.addRecipient(Message.RecipientType.BCC, new InternetAddress("audit@example.net"));
```

Namun secara production, hati-hati:

1. BCC bergantung pada proses SMTP/client untuk tidak memasukkan header BCC ke message akhir.
2. Untuk notifikasi penting, lebih aman mengirim satu message per recipient jika personalization, privacy, atau tracking penting.
3. Jangan kirim email massal dengan semua orang di TO/CC.

### 10.4 Kesalahan Fatal

Salah:

```java
message.setRecipients(Message.RecipientType.TO, InternetAddress.parse(allUsersAsCommaString));
```

Untuk email bulk/personalized, ini membuat seluruh penerima melihat satu sama lain.

Benar:

```text
for each recipient:
  create separate message
  send only to that recipient
```

---

## 11. From, Sender, Reply-To, Return-Path

Header identity harus dipahami dengan benar.

### 11.1 `From`

```java
message.setFrom(new InternetAddress("noreply@example.com", "Example App", "UTF-8"));
```

`From` adalah identity yang terlihat sebagai pengirim.

### 11.2 `Sender`

`Sender` dapat digunakan ketika agent yang mengirim berbeda dari author.

Contoh:

```text
From: Case Officer <officer@example.com>
Sender: Notification Platform <noreply@example.com>
```

Tidak semua aplikasi butuh `Sender`.

### 11.3 `Reply-To`

```java
message.setReplyTo(new Address[] {
    new InternetAddress("support@example.com", "Support Team", "UTF-8")
});
```

`Reply-To` menentukan ke mana reply diarahkan.

### 11.4 `Return-Path`

`Return-Path` biasanya ditambahkan oleh receiving server berdasarkan SMTP envelope sender. Jangan mengandalkan `message.setHeader("Return-Path", ...)` untuk mengontrol bounce.

Untuk JavaMail/Jakarta Mail SMTP, envelope sender biasanya dikontrol via properti seperti:

```java
props.put("mail.smtp.from", "bounce@example.com");
```

atau provider-specific behavior.

Mental model:

```text
Header From      -> terlihat oleh user
Reply-To         -> ketika user klik reply
Envelope sender  -> bounce/return path, SPF alignment relevance
```

---

## 12. Date dan Message-ID

### 12.1 Sent Date

```java
message.setSentDate(new Date());
```

Jika tidak diset, `saveChanges()` atau send process dapat menambahkannya.

Lebih eksplisit:

```java
message.setSentDate(Date.from(Instant.now()));
```

### 12.2 Message-ID

`Message-ID` adalah identifier message-level.

Biasanya Jakarta Mail akan generate saat `saveChanges()` jika belum ada.

Jangan samakan `Message-ID` dengan:

1. business notification id;
2. outbox id;
3. provider message id;
4. SMTP queue id;
5. correlation id.

Untuk observability, kamu bisa simpan mapping:

```text
business_notification_id -> mime_message_id -> provider_response_id
```

### 12.3 Custom Message-ID

Kadang ingin custom untuk correlation. Tetapi hati-hati: `Message-ID` punya format khusus:

```text
<unique-id@domain>
```

Lebih aman tambahkan header aplikasi sendiri:

```java
message.setHeader("X-App-Notification-Id", notificationId);
message.setHeader("X-Correlation-Id", correlationId);
```

Tetapi sanitize dulu nilainya.

---

## 13. MIME-Version dan Content-Type

Email MIME biasanya memiliki:

```text
MIME-Version: 1.0
Content-Type: text/plain; charset=UTF-8
```

Jika kamu memakai high-level API seperti `setText`, `setContent`, dan `setContent(Multipart)`, Jakarta Mail akan membantu menghasilkan header terkait saat message disimpan/dikirim.

Namun jika kamu melakukan raw header manipulation, kamu bertanggung jawab menjaga konsistensi.

Salah:

```java
message.setText("Hello", "UTF-8");
message.setHeader("Content-Type", "text/html");
```

Ini bisa membuat header dan body semantics tidak konsisten.

Benar:

```java
message.setText("<b>Hello</b>", "UTF-8", "html");
```

atau:

```java
message.setContent("<b>Hello</b>", "text/html; charset=UTF-8");
```

---

## 14. Charset: Kenapa UTF-8 Harus Eksplisit

Email lama tumbuh dari dunia ASCII. Banyak bug modern muncul karena developer menganggap semua string Java otomatis akan diperlakukan sebagai UTF-8 di email.

Java `String` adalah Unicode. Tetapi ketika dikirim melalui MIME, string harus diubah menjadi bytes dengan charset tertentu.

Contoh data:

```text
Halo Fajar — permohonan Anda telah disetujui ✅
```

Jika charset salah, hasil bisa menjadi:

```text
Halo Fajar â€” permohonan Anda telah disetujui âœ…
```

Rule:

```java
private static final String UTF_8 = StandardCharsets.UTF_8.name();
```

Gunakan secara eksplisit:

```java
message.setSubject(subject, UTF_8);
message.setText(body, UTF_8);
new InternetAddress(email, displayName, UTF_8);
```

Untuk HTML:

```java
message.setContent(html, "text/html; charset=UTF-8");
```

HTML juga sebaiknya punya meta charset:

```html
<!doctype html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Notification</title>
</head>
<body>
  <p>Halo Fajar — permohonan Anda telah disetujui.</p>
</body>
</html>
```

Catatan: MIME `Content-Type` charset lebih fundamental untuk transport. `<meta charset>` membantu client rendering, tetapi jangan hanya mengandalkan HTML meta.

---

## 15. Content-Transfer-Encoding

Selain charset, MIME punya `Content-Transfer-Encoding`.

Contoh:

```text
Content-Transfer-Encoding: quoted-printable
```

atau:

```text
Content-Transfer-Encoding: base64
```

Encoding ini menjawab pertanyaan:

> Bagaimana bytes content direpresentasikan agar aman melewati email transport yang historisnya terbatas?

Umumnya Jakarta Mail memilih encoding yang sesuai. Kamu jarang perlu set manual untuk text sederhana.

### 15.1 7bit

Untuk ASCII sederhana.

### 15.2 quoted-printable

Cocok untuk text yang sebagian besar ASCII tetapi punya karakter non-ASCII.

### 15.3 base64

Cocok untuk binary atau content yang banyak non-ASCII.

### 15.4 Jangan Over-Control

Salah satu kesalahan engineer adalah terlalu cepat melakukan manual encoding.

Salah:

```java
String encoded = Base64.getEncoder().encodeToString(html.getBytes(StandardCharsets.UTF_8));
message.setText(encoded, "UTF-8", "html");
```

Ini membuat penerima melihat base64 text, bukan HTML.

Biarkan Jakarta Mail memilih encoding kecuali kamu punya alasan kuat.

---

## 16. Plain Text Email yang Baik

Plain text masih penting:

1. fallback untuk client tertentu;
2. accessibility;
3. spam scoring;
4. readability di notification pipeline;
5. operational email sederhana.

Contoh:

```java
MimeMessage message = new MimeMessage(session);
message.setFrom(new InternetAddress("noreply@example.com", "Example App", "UTF-8"));
message.setRecipient(Message.RecipientType.TO, new InternetAddress("user@example.net", "User", "UTF-8"));
message.setSubject("Your case has been updated", "UTF-8");
message.setText("""
Hello User,

Your case CASE-2026-0001 has been updated.

Status: Pending Review
Updated At: 2026-06-18 10:00 Jakarta Time

Open the system to view details.

Regards,
Example App
""", "UTF-8");
```

Untuk Java 8, text block belum tersedia:

```java
String body =
    "Hello User,\n\n" +
    "Your case CASE-2026-0001 has been updated.\n\n" +
    "Status: Pending Review\n" +
    "Updated At: 2026-06-18 10:00 Jakarta Time\n\n" +
    "Open the system to view details.\n\n" +
    "Regards,\n" +
    "Example App\n";

message.setText(body, "UTF-8");
```

### 16.1 Plain Text Formatting Guidelines

Gunakan:

```text
Short paragraphs
Clear labels
Stable IDs
No huge raw JSON
No excessive decorative symbols
```

Hindari:

```text
All content in one long line
ASCII art berlebihan
Sensitive data lengkap
Link tanpa context
```

---

## 17. HTML Email Sederhana

Contoh HTML-only:

```java
String html = """
<!doctype html>
<html>
<head>
  <meta charset="UTF-8">
</head>
<body>
  <h1>Your case has been updated</h1>
  <p>Hello User,</p>
  <p>Your case <strong>CASE-2026-0001</strong> has been updated.</p>
  <p>Status: <strong>Pending Review</strong></p>
</body>
</html>
""";

message.setContent(html, "text/html; charset=UTF-8");
```

Atau:

```java
message.setText(html, "UTF-8", "html");
```

### 17.1 HTML-only Tradeoff

HTML-only cepat, tetapi tidak ideal untuk semua kasus.

Lebih baik untuk production:

```text
multipart/alternative
  text/plain
  text/html
```

Ini akan dibahas detail di Part 6.

### 17.2 HTML Escaping

Jika memasukkan variable user/domain ke HTML, escape.

Salah:

```java
String html = "<p>Hello " + displayName + "</p>";
```

Jika `displayName` berisi:

```html
<script>alert(1)</script>
```

Maka HTML email menjadi tidak aman/berantakan.

Benar:

```java
String html = "<p>Hello " + escapeHtml(displayName) + "</p>";
```

Gunakan template engine yang melakukan escaping by default jika memungkinkan.

---

## 18. Header Manipulation: High-Level vs Low-Level API

Jakarta Mail menyediakan high-level setters:

```java
message.setFrom(...)
message.setRecipients(...)
message.setSubject(...)
message.setSentDate(...)
message.setReplyTo(...)
```

Dan low-level methods:

```java
message.setHeader("X-Correlation-Id", correlationId);
message.addHeader("X-Tag", "value");
message.addHeaderLine("Raw-Header: value");
```

Rule:

```text
Gunakan high-level setter untuk standard headers.
Gunakan setHeader/addHeader hanya untuk custom metadata yang benar-benar perlu.
Hindari addHeaderLine kecuali sedang membangun tool/proxy/debug khusus.
```

### 18.1 `setHeader` vs `addHeader`

`setHeader` mengganti header dengan nama tersebut.

```java
message.setHeader("X-Correlation-Id", correlationId);
```

`addHeader` menambah value baru untuk header yang sama.

```java
message.addHeader("X-Tag", "case");
message.addHeader("X-Tag", "notification");
```

### 18.2 Custom Headers

Custom header umum:

```text
X-Correlation-Id
X-Request-Id
X-Notification-Id
X-Template-Id
X-Tenant-Id
```

Contoh:

```java
message.setHeader("X-Correlation-Id", sanitizeHeaderValue(correlationId));
message.setHeader("X-Notification-Id", sanitizeHeaderValue(notificationId));
message.setHeader("X-Template-Id", sanitizeHeaderValue(templateId));
```

Jangan taruh data sensitif:

```text
X-User-NRIC: S1234567A      // buruk
X-Access-Token: eyJ...      // sangat buruk
X-Full-Address: ...         // buruk
```

---

## 19. Header Injection

Header injection adalah risiko ketika input user dimasukkan ke header tanpa validasi.

Contoh input jahat:

```text
Victim <victim@example.net>\r\nBcc: attacker@example.com
```

Jika digunakan mentah sebagai header, attacker bisa menyisipkan header baru.

### 19.1 Salah

```java
String subject = request.getSubject();
message.setHeader("Subject", subject);
```

atau:

```java
message.addHeader("X-User-Comment", userComment);
```

Jika value mengandung CR/LF, header bisa rusak.

### 19.2 Minimal Sanitizer untuk Header Value

```java
static String sanitizeHeaderValue(String value) {
    if (value == null) {
        return "";
    }
    if (value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0) {
        throw new IllegalArgumentException("Header value must not contain CR or LF");
    }
    return value;
}
```

### 19.3 Minimal Sanitizer untuk Display Name

Lebih baik gunakan `InternetAddress(email, personal, charset)` daripada menyusun string manual.

Salah:

```java
message.setFrom(new InternetAddress(displayName + " <" + email + ">"));
```

Benar:

```java
message.setFrom(new InternetAddress(email, displayName, "UTF-8"));
```

Tetap validasi email dan batasi displayName.

### 19.4 Subject Handling

Lebih baik:

```java
String subject = sanitizeHeaderValue(inputSubject);
message.setSubject(subject, "UTF-8");
```

Jangan:

```java
message.setHeader("Subject", inputSubject);
```

---

## 20. Address Validation: Jangan Terlalu Naif

Email address validation sulit. Jangan membuat regex raksasa sendiri kecuali ada alasan.

Gunakan `InternetAddress` parsing untuk syntax-level validation:

```java
static InternetAddress parseMailbox(String email, String displayName) throws Exception {
    InternetAddress address = new InternetAddress(email, displayName, "UTF-8");
    address.validate();
    return address;
}
```

Namun ini bukan jaminan:

1. domain benar-benar ada;
2. mailbox aktif;
3. mailbox menerima email;
4. email akan masuk inbox.

Validation layer sebaiknya dibagi:

```text
Syntax validation       -> sebelum menerima request
Business validation     -> apakah recipient boleh dikirimi email?
Suppression validation  -> apakah hard bounce/unsubscribed?
Delivery validation     -> feedback loop/bounce/webhook
```

---

## 21. Message Builder yang Aman

Untuk production, jangan sebar kode seperti ini di banyak tempat:

```java
MimeMessage message = new MimeMessage(session);
message.setFrom(...);
message.setRecipient(...);
message.setSubject(...);
message.setContent(...);
```

Lebih baik punya builder/composer tunggal yang enforce invariant.

### 21.1 Domain Request

```java
public final class EmailRequest {
    private final String fromEmail;
    private final String fromName;
    private final String toEmail;
    private final String toName;
    private final String replyToEmail;
    private final String subject;
    private final String plainText;
    private final String html;
    private final String notificationId;
    private final String correlationId;

    public EmailRequest(
            String fromEmail,
            String fromName,
            String toEmail,
            String toName,
            String replyToEmail,
            String subject,
            String plainText,
            String html,
            String notificationId,
            String correlationId
    ) {
        this.fromEmail = fromEmail;
        this.fromName = fromName;
        this.toEmail = toEmail;
        this.toName = toName;
        this.replyToEmail = replyToEmail;
        this.subject = subject;
        this.plainText = plainText;
        this.html = html;
        this.notificationId = notificationId;
        this.correlationId = correlationId;
    }

    public String fromEmail() { return fromEmail; }
    public String fromName() { return fromName; }
    public String toEmail() { return toEmail; }
    public String toName() { return toName; }
    public String replyToEmail() { return replyToEmail; }
    public String subject() { return subject; }
    public String plainText() { return plainText; }
    public String html() { return html; }
    public String notificationId() { return notificationId; }
    public String correlationId() { return correlationId; }
}
```

Untuk Java 16+, bisa pakai `record`:

```java
public record EmailRequest(
    String fromEmail,
    String fromName,
    String toEmail,
    String toName,
    String replyToEmail,
    String subject,
    String plainText,
    String html,
    String notificationId,
    String correlationId
) {}
```

### 21.2 Composer

```java
public final class MimeMessageComposer {
    private static final String UTF_8 = StandardCharsets.UTF_8.name();

    public MimeMessage compose(Session session, EmailRequest request) throws MessagingException, UnsupportedEncodingException {
        validateRequest(request);

        MimeMessage message = new MimeMessage(session);

        message.setFrom(address(request.fromEmail(), request.fromName()));
        message.setRecipient(Message.RecipientType.TO, address(request.toEmail(), request.toName()));

        if (hasText(request.replyToEmail())) {
            message.setReplyTo(new Address[] { new InternetAddress(request.replyToEmail()) });
        }

        message.setSubject(sanitizeHeaderValue(request.subject()), UTF_8);
        message.setSentDate(new Date());

        setBody(message, request);

        message.setHeader("X-Notification-Id", sanitizeHeaderValue(request.notificationId()));
        message.setHeader("X-Correlation-Id", sanitizeHeaderValue(request.correlationId()));

        message.saveChanges();
        return message;
    }

    private void setBody(MimeMessage message, EmailRequest request) throws MessagingException {
        boolean hasPlain = hasText(request.plainText());
        boolean hasHtml = hasText(request.html());

        if (hasPlain && hasHtml) {
            MimeBodyPart textPart = new MimeBodyPart();
            textPart.setText(request.plainText(), UTF_8);

            MimeBodyPart htmlPart = new MimeBodyPart();
            htmlPart.setContent(request.html(), "text/html; charset=UTF-8");

            MimeMultipart alternative = new MimeMultipart("alternative");
            alternative.addBodyPart(textPart);
            alternative.addBodyPart(htmlPart);

            message.setContent(alternative);
            return;
        }

        if (hasHtml) {
            message.setContent(request.html(), "text/html; charset=UTF-8");
            return;
        }

        if (hasPlain) {
            message.setText(request.plainText(), UTF_8);
            return;
        }

        throw new IllegalArgumentException("Email body must contain plain text or HTML");
    }

    private InternetAddress address(String email, String personal) throws UnsupportedEncodingException, AddressException {
        InternetAddress address;
        if (hasText(personal)) {
            address = new InternetAddress(email, personal, UTF_8);
        } else {
            address = new InternetAddress(email);
        }
        address.validate();
        return address;
    }

    private void validateRequest(EmailRequest request) {
        requireText(request.fromEmail(), "fromEmail");
        requireText(request.toEmail(), "toEmail");
        requireText(request.subject(), "subject");
        requireText(request.notificationId(), "notificationId");
        requireText(request.correlationId(), "correlationId");
    }

    private static void requireText(String value, String field) {
        if (!hasText(value)) {
            throw new IllegalArgumentException(field + " is required");
        }
    }

    private static boolean hasText(String value) {
        return value != null && !value.trim().isEmpty();
    }

    private static String sanitizeHeaderValue(String value) {
        if (value == null) {
            return "";
        }
        if (value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0) {
            throw new IllegalArgumentException("Header value must not contain CR or LF");
        }
        return value;
    }
}
```

Catatan: contoh di atas belum membahas attachment, inline image, dan nested multipart lengkap. Itu masuk Part 6 dan Part 7.

### 21.3 Invariant Builder

Builder harus menjaga invariant:

```text
- from wajib valid
- minimal satu recipient valid
- subject wajib ada
- body wajib ada
- charset selalu UTF-8
- header custom tidak boleh CR/LF
- body HTML harus escaped dari template layer
- message tidak dikirim di composer
```

Composer hanya membangun message. Sending dilakukan oleh gateway/transport layer.

---

## 22. Clean Separation: Template vs MIME Composer vs Transport

Production design yang baik memisahkan tiga hal:

```text
Template Renderer
  input: domain data
  output: plainText/html/subject

MIME Composer
  input: rendered content + addressing metadata
  output: MimeMessage

Mail Transport Gateway
  input: MimeMessage
  output: send result/failure
```

Jangan campur seperti ini:

```java
public void sendCaseApprovedEmail(Case c) {
    String html = "<p>Case " + c.getId() + " approved</p>";
    MimeMessage msg = new MimeMessage(session);
    msg.setContent(html, "text/html");
    Transport.send(msg);
}
```

Masalah:

1. domain logic bercampur SMTP;
2. sulit test template;
3. sulit test MIME structure;
4. sulit retry;
5. sulit audit;
6. sulit ganti provider;
7. sulit memastikan escaping;
8. raw SMTP failure bocor ke business use case.

Lebih baik:

```text
CaseApprovedEvent
  -> NotificationUseCase
  -> TemplateRenderer
  -> EmailRequest
  -> Outbox
  -> MailWorker
  -> MimeMessageComposer
  -> MailGateway
```

---

## 23. Raw MIME Debugging

Kadang perlu melihat hasil MIME mentah.

```java
ByteArrayOutputStream out = new ByteArrayOutputStream();
message.writeTo(out);
String raw = out.toString(StandardCharsets.UTF_8);
System.out.println(raw);
```

Untuk Java 8:

```java
String raw = new String(out.toByteArray(), StandardCharsets.UTF_8);
```

Namun hati-hati: raw MIME bisa mengandung PII, token, attachment content, dan private data. Jangan log raw MIME di production.

### 23.1 Apa yang Dicek di Raw MIME

Untuk plain text:

```text
Subject: =?UTF-8?...?=
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable/base64/7bit
```

Untuk HTML:

```text
Content-Type: text/html; charset=UTF-8
```

Untuk multipart alternative:

```text
Content-Type: multipart/alternative; boundary="..."

--...
Content-Type: text/plain; charset=UTF-8

Plain
--...
Content-Type: text/html; charset=UTF-8

<html>...</html>
--...--
```

### 23.2 Golden MIME Test

Untuk message composer, kamu bisa punya test yang menulis raw MIME lalu assert bagian penting:

```java
assertThat(raw).contains("Content-Type: text/html");
assertThat(raw).contains("X-Correlation-Id: corr-123");
assertThat(raw).doesNotContain("\r\nBcc: attacker@example.com");
```

Hindari assert exact boundary karena boundary dapat generated dan berubah.

---

## 24. API Usage Patterns yang Harus Dihindari

### 24.1 Manual String MIME

Salah:

```java
String raw = "From: ...\r\n" +
             "To: ...\r\n" +
             "Subject: ...\r\n" +
             "Content-Type: text/html\r\n" +
             "\r\n" +
             html;
```

Kecuali kamu sedang menulis mail gateway/proxy tingkat rendah, hindari manual MIME assembly.

### 24.2 Raw Header untuk Standard Fields

Salah:

```java
message.setHeader("To", userEmail);
message.setHeader("From", fromEmail);
message.setHeader("Subject", subject);
```

Benar:

```java
message.setFrom(...);
message.setRecipient(...);
message.setSubject(..., "UTF-8");
```

### 24.3 Charset Tidak Eksplisit

Salah:

```java
message.setText(body);
message.setSubject(subject);
```

Lebih aman:

```java
message.setText(body, "UTF-8");
message.setSubject(subject, "UTF-8");
```

### 24.4 Mengirim Banyak User Dalam Satu TO

Salah untuk notifikasi personal:

```java
message.setRecipients(Message.RecipientType.TO, InternetAddress.parse("a@example.com,b@example.com,c@example.com"));
```

Benar:

```text
create one message per recipient
```

### 24.5 Menganggap `sent` Berarti `delivered`

Composer hanya membuat message. Transport success berarti SMTP handoff berhasil. Itu belum berarti inbox delivered.

---

## 25. Java 8 vs Java 21/25 Considerations

### 25.1 Java 8

Karakteristik:

1. banyak sistem masih memakai `javax.mail`;
2. tidak ada text block;
3. tidak ada record;
4. dependency sering dari `com.sun.mail:javax.mail` atau `javax.mail:mail` legacy;
5. Activation dependency perlu diperhatikan.

Contoh style Java 8:

```java
public final class EmailRequest {
    private final String toEmail;
    private final String subject;
    private final String body;

    public EmailRequest(String toEmail, String subject, String body) {
        this.toEmail = toEmail;
        this.subject = subject;
        this.body = body;
    }

    public String getToEmail() { return toEmail; }
    public String getSubject() { return subject; }
    public String getBody() { return body; }
}
```

### 25.2 Java 11+

Java EE modules tidak lagi bundled seperti era lama. Dependency mail/activation harus eksplisit.

### 25.3 Java 17/21/25

Keuntungan:

1. records untuk immutable request;
2. text blocks untuk HTML template kecil/test;
3. switch expressions untuk failure classification;
4. virtual threads dapat membantu worker blocking IO, tetapi tetap perlu rate limit dan timeout;
5. modern Jakarta namespace lebih umum di Spring Boot 3/Jakarta EE 10+.

Contoh record:

```java
public record RenderedEmail(
    String subject,
    String plainText,
    String html
) {}
```

Text block cocok untuk test, bukan selalu untuk production template besar:

```java
String html = """
<!doctype html>
<html>
<body>
  <p>Hello ${name}</p>
</body>
</html>
""";
```

Production biasanya tetap memakai template engine dan template repository.

---

## 26. Header and Content Safety Checklist

Sebelum message dikirim, cek:

```text
[ ] From valid dan sesuai domain pengirim
[ ] To/Cc/Bcc valid
[ ] Subject tidak kosong
[ ] Subject memakai UTF-8
[ ] Subject tidak mengandung CR/LF
[ ] Body tidak kosong
[ ] Plain text ada jika email penting/transactional
[ ] HTML escaped dari template layer
[ ] Content-Type benar
[ ] Charset UTF-8 eksplisit
[ ] Custom headers tidak mengandung PII sensitif
[ ] Custom headers tidak mengandung CR/LF
[ ] Correlation ID ada
[ ] Notification ID ada
[ ] Message dapat ditulis ke raw MIME di test
[ ] Tidak ada attachment besar tanpa desain streaming/scanning
```

---

## 27. Regulatory/Enterprise Perspective

Dalam sistem enterprise atau regulatory, email sering menjadi evidence atau bagian dari lifecycle komunikasi. Maka message construction harus defensible.

Pertanyaan audit:

1. Siapa recipient sebenarnya?
2. Apa subject yang dikirim?
3. Template versi berapa?
4. Data apa yang dirender?
5. Apakah ada PII dalam body?
6. Apakah attachment dikirim?
7. Apakah user preference/consent diperiksa?
8. Apakah message ID disimpan?
9. Apakah SMTP handoff berhasil?
10. Apakah bounce diterima kemudian?

Message composer tidak harus menyelesaikan semua, tetapi harus menyediakan hook:

```text
X-Notification-Id
X-Correlation-Id
X-Template-Id
```

Dan hasil compose harus bisa diaudit tanpa membuka PII penuh.

---

## 28. Design Pattern: Notification Identity Triple

Untuk production, bedakan tiga identity:

```text
Business Notification ID
  ID dari domain notification/outbox.

MIME Message-ID
  ID message internet.

Provider/SMTP Response ID
  ID dari provider/relay jika tersedia.
```

Contoh:

```text
notification_id: NOTIF-2026-000001
mime_message_id: <189f2a@example.com>
provider_id: ses-010201...
```

Kenapa penting?

1. business bisa retry notification yang sama;
2. MIME message id bisa berubah per attempt jika message dibuat ulang;
3. provider id hanya ada setelah handoff;
4. bounce/webhook mungkin merujuk provider id atau envelope id;
5. audit butuh mapping.

---

## 29. Latihan Bertahap

### Latihan 1 — Plain Text Message

Buat `MimeMessage` dengan:

```text
From: noreply@example.com
To: learner@example.net
Subject: Permohonan disetujui — CASE-001
Body: plain text UTF-8
```

Lalu tulis raw MIME ke `ByteArrayOutputStream` dan cek header `Content-Type`.

### Latihan 2 — HTML Message

Buat HTML message dengan:

```html
<p>Halo Fajar — status Anda: <strong>Approved</strong></p>
```

Pastikan:

```text
Content-Type: text/html; charset=UTF-8
```

### Latihan 3 — Header Injection Defense

Coba subject:

```text
Hello\r\nBcc: attacker@example.com
```

Pastikan composer menolak.

### Latihan 4 — Display Name Unicode

Buat recipient:

```text
Fajar Abdi Nugraha — Tim Regulasi <fajar@example.net>
```

Pastikan raw MIME menampilkan encoded-word, bukan karakter rusak.

### Latihan 5 — Separate Composer and Sender

Buat interface:

```java
public interface MailGateway {
    SendResult send(MimeMessage message);
}
```

Pastikan composer tidak memanggil `Transport.send`.

---

## 30. Common Production Bugs dan Root Cause

| Symptom | Kemungkinan Root Cause | Fix |
|---|---|---|
| Subject karakter aneh | charset tidak eksplisit | gunakan `setSubject(subject, "UTF-8")` |
| Body karakter rusak | body charset salah | gunakan `setText(body, "UTF-8")` atau `text/html; charset=UTF-8` |
| HTML tampil sebagai teks | content type salah | gunakan `setContent(html, "text/html; charset=UTF-8")` |
| Plain fallback hilang | `setText` lalu `setContent` overwrite | gunakan multipart/alternative |
| Email bocor ke banyak penerima | semua recipient di TO/CC | satu message per recipient |
| Header tambahan muncul aneh | raw header tidak disanitasi | tolak CR/LF |
| BCC terlihat | manual header manipulation | gunakan RecipientType.BCC, jangan set header Bcc manual |
| Reply masuk noreply | `Reply-To` tidak diset | set reply-to sesuai support mailbox |
| Bounce tidak masuk mailbox benar | envelope sender tidak dikontrol | konfigurasi SMTP envelope sender/provider |
| Log berisi data sensitif | raw MIME dilog | redaction dan structured event logging |

---

## 31. Senior Engineer Heuristics

Saat melihat kode email, engineer senior biasanya langsung bertanya:

1. Apakah charset eksplisit?
2. Apakah standard header memakai high-level API?
3. Apakah custom header disanitasi?
4. Apakah body HTML escaped?
5. Apakah plain text fallback ada?
6. Apakah message per recipient atau shared?
7. Apakah MIME structure benar?
8. Apakah `Message-ID`/correlation disimpan?
9. Apakah composer terpisah dari transport?
10. Apakah test memverifikasi raw MIME?
11. Apakah tidak ada PII di header/log?
12. Apakah envelope sender dipahami, bukan disamakan dengan header From?

Kalau jawaban atas beberapa pertanyaan ini tidak jelas, sistem email tersebut belum production-grade.

---

## 32. Minimal Production-Grade Example

Contoh ini belum mencakup attachment dan inline image, tetapi cukup baik untuk transactional email sederhana.

```java
import jakarta.mail.Address;
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.Session;
import jakarta.mail.internet.AddressException;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeBodyPart;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.internet.MimeMultipart;

import java.io.UnsupportedEncodingException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.Objects;

public final class SafeMimeMessageComposer {
    private static final String UTF_8 = StandardCharsets.UTF_8.name();

    public MimeMessage compose(Session session, Request request)
            throws MessagingException, UnsupportedEncodingException {

        Objects.requireNonNull(session, "session");
        validate(request);

        MimeMessage message = new MimeMessage(session);
        message.setFrom(address(request.fromEmail(), request.fromName()));
        message.setRecipient(Message.RecipientType.TO, address(request.toEmail(), request.toName()));

        if (hasText(request.replyToEmail())) {
            InternetAddress replyTo = new InternetAddress(request.replyToEmail());
            replyTo.validate();
            message.setReplyTo(new Address[] { replyTo });
        }

        message.setSubject(sanitizeHeaderValue(request.subject()), UTF_8);
        message.setSentDate(Date.from(Instant.now()));

        if (hasText(request.plainText()) && hasText(request.html())) {
            setAlternativeBody(message, request.plainText(), request.html());
        } else if (hasText(request.html())) {
            message.setContent(request.html(), "text/html; charset=UTF-8");
        } else {
            message.setText(request.plainText(), UTF_8);
        }

        message.setHeader("X-Notification-Id", sanitizeHeaderValue(request.notificationId()));
        message.setHeader("X-Correlation-Id", sanitizeHeaderValue(request.correlationId()));
        message.setHeader("X-Template-Id", sanitizeHeaderValue(request.templateId()));

        message.saveChanges();
        return message;
    }

    private static void setAlternativeBody(MimeMessage message, String plainText, String html)
            throws MessagingException {
        MimeBodyPart textPart = new MimeBodyPart();
        textPart.setText(plainText, UTF_8);

        MimeBodyPart htmlPart = new MimeBodyPart();
        htmlPart.setContent(html, "text/html; charset=UTF-8");

        MimeMultipart alternative = new MimeMultipart("alternative");
        alternative.addBodyPart(textPart);
        alternative.addBodyPart(htmlPart);

        message.setContent(alternative);
    }

    private static InternetAddress address(String email, String personal)
            throws UnsupportedEncodingException, AddressException {
        InternetAddress address = hasText(personal)
                ? new InternetAddress(email, personal, UTF_8)
                : new InternetAddress(email);
        address.validate();
        return address;
    }

    private static void validate(Request request) {
        Objects.requireNonNull(request, "request");
        requireText(request.fromEmail(), "fromEmail");
        requireText(request.toEmail(), "toEmail");
        requireText(request.subject(), "subject");
        requireText(request.notificationId(), "notificationId");
        requireText(request.correlationId(), "correlationId");
        requireText(request.templateId(), "templateId");

        if (!hasText(request.plainText()) && !hasText(request.html())) {
            throw new IllegalArgumentException("plainText or html body is required");
        }
    }

    private static void requireText(String value, String field) {
        if (!hasText(value)) {
            throw new IllegalArgumentException(field + " is required");
        }
    }

    private static boolean hasText(String value) {
        return value != null && !value.trim().isEmpty();
    }

    private static String sanitizeHeaderValue(String value) {
        if (value == null) {
            return "";
        }
        if (value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0) {
            throw new IllegalArgumentException("Header value must not contain CR or LF");
        }
        return value;
    }

    public record Request(
            String fromEmail,
            String fromName,
            String toEmail,
            String toName,
            String replyToEmail,
            String subject,
            String plainText,
            String html,
            String notificationId,
            String correlationId,
            String templateId
    ) {}
}
```

Untuk Java 8, ganti `record` dengan class biasa dan ubah import ke `javax.mail.*` jika memakai JavaMail legacy.

---

## 33. Ringkasan Mental Model

Hal yang harus tertanam:

1. `MimeMessage` adalah root message + MIME part.
2. Email punya header dan body, tetapi SMTP envelope berbeda dari header.
3. Gunakan high-level API untuk standard header.
4. Gunakan UTF-8 eksplisit untuk subject, body, dan display name.
5. `setText` cocok untuk plain text; `setContent` cocok untuk HTML/object content; multipart diperlukan untuk kombinasi.
6. Jangan menggabungkan plain dan HTML dengan memanggil setter dua kali.
7. Raw header harus disanitasi dari CR/LF.
8. HTML content harus escaped dari template layer.
9. One personalized recipient biasanya one message.
10. Composer harus terpisah dari transport.
11. Production email perlu correlation, audit, dan test raw MIME.

---

## 34. Referensi

- Jakarta Mail Specification and API documentation.
- Eclipse Angus Mail API documentation.
- Jakarta Mail `MimeMessage`, `Message`, `InternetAddress`, and `MimeUtility` API documentation.
- MIME and Internet Message Format concepts: RFC 5322, RFC 2045–2049, RFC 2047.

---

## 35. Status Seri

Progress seri:

```text
[x] Part 0 — Orientation: Email as a Distributed System
[x] Part 1 — Email Protocol Stack: SMTP, MIME, POP3, IMAP
[x] Part 2 — JavaMail to Jakarta Mail: History, Namespace, Compatibility, Migration
[x] Part 3 — Core API: Session, Store, Folder, Transport, Message
[x] Part 4 — SMTP Sending: Properties, Transport, Timeout, TLS, Auth
[x] Part 5 — MIME Message Construction: Text, HTML, Charset, Headers
[ ] Part 6 — Multipart Email: Alternative, Mixed, Related, Nested Structure
[ ] Part 7 — Attachment Handling and Jakarta Activation
[ ] Part 8 — HTML Email Engineering: Templates, CSS, Images, and Client Compatibility
[ ] Part 9 — Mail Addressing, Identity, and Header Semantics
[ ] Part 10 — Error Model: MessagingException, SendFailedException, SMTPAddressFailedException
[ ] Part 11 — Reliable Email Delivery Architecture: Queue, Outbox, Retry, Idempotency
[ ] Part 12 — Bulk, Batch, and Rate-Limited Sending
[ ] Part 13 — Security Deep Dive: TLS, Credential, OAuth2, Secret Management
[ ] Part 14 — Deliverability Fundamentals: SPF, DKIM, DMARC, Reputation, Bounce
[ ] Part 15 — Inbound Mail: IMAP/POP3, Store, Folder, Message Reading
[ ] Part 16 — MIME Parsing: Reading Complex Messages Safely
[ ] Part 17 — Jakarta Mail in Jakarta EE Containers
[ ] Part 18 — Jakarta Mail in Spring Boot and Modern Java Applications
[ ] Part 19 — Testing Mail Systems: Unit, Integration, Contract, E2E
[ ] Part 20 — Observability: Logs, Metrics, Tracing, Audit
[ ] Part 21 — Performance and Resource Management
[ ] Part 22 — Provider Integration Patterns: SMTP Relay vs API-Based Email Provider
[ ] Part 23 — Bounce, Complaint, Webhook, and Delivery Feedback Loop
[ ] Part 24 — Template Architecture and Domain Notification Design
[ ] Part 25 — Compliance, Privacy, and Regulatory-Grade Mail Systems
[ ] Part 26 — Advanced MIME and Internationalization
[ ] Part 27 — Failure Modelling and Production Incident Playbook
[ ] Part 28 — End-to-End Reference Implementation: Java 8 Legacy and Java 21/25 Modern
[ ] Part 29 — Top 1% Design Review: Evaluating a Mail Subsystem Like an Architect
```

Seri belum selesai. Bagian berikutnya adalah **Part 6 — Multipart Email: Alternative, Mixed, Related, Nested Structure**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./04-smtp-sending-timeout-tls-auth.md">⬅️ Part 4 — SMTP Sending: Properties, Transport, Timeout, TLS, Auth</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./06-multipart-email-alternative-mixed-related.md">Part 6 — Multipart Email: Alternative, Mixed, Related, Nested Structure ➡️</a>
</div>
