# Part 6 — Multipart Email: Alternative, Mixed, Related, Nested Structure

> Seri: `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery`  
> File: `06-multipart-email-alternative-mixed-related.md`  
> Scope: Java 8 sampai Java 25, JavaMail `javax.mail`, Jakarta Mail `jakarta.mail`, MIME multipart, `MimeMultipart`, `MimeBodyPart`, struktur nested email modern.

---

## 1. Tujuan Part Ini

Pada part sebelumnya, kita sudah membahas konstruksi `MimeMessage` untuk text, HTML, charset, dan header. Namun email production modern hampir tidak pernah hanya berupa satu body sederhana.

Email real-world biasanya berisi kombinasi:

- plain text fallback;
- HTML body;
- inline image;
- logo;
- attachment PDF;
- attachment CSV;
- calendar invite;
- nested forwarded message;
- signed/encrypted content;
- bounce report;
- delivery status notification.

Semua itu tidak bisa direpresentasikan secara benar dengan satu `setText()` atau satu `setContent("...", "text/html")` saja. Untuk itu, email memakai **MIME multipart**.

Target setelah mempelajari bagian ini:

1. Memahami bahwa multipart bukan “attachment feature”, melainkan **tree structure untuk message body**.
2. Memahami perbedaan `multipart/alternative`, `multipart/mixed`, dan `multipart/related`.
3. Bisa menentukan struktur MIME yang benar untuk kasus:
   - text + HTML;
   - HTML + inline image;
   - HTML + attachment;
   - text + HTML + inline image + attachment;
   - multiple attachment;
   - nested message.
4. Bisa membuat struktur tersebut dengan JavaMail/Jakarta Mail.
5. Bisa membaca raw MIME dan men-debug kenapa email tampil aneh di Gmail/Outlook/mobile client.
6. Bisa mendesain composer abstraction yang rapi, testable, dan tidak bergantung pada template engine tertentu.

---

## 2. Mental Model Utama: Email Body Itu Tree, Bukan String

Kesalahan paling umum saat developer belajar email:

```java
message.setContent(html, "text/html; charset=UTF-8");
```

Lalu ketika butuh attachment:

```java
message.setContent(attachment?);
```

Developer kemudian bingung karena `Message` seolah hanya punya satu content.

Mental model yang benar:

```text
MimeMessage
└── content
    ├── simple content
    │   └── text/plain atau text/html
    │
    └── multipart content
        ├── body part 1
        ├── body part 2
        ├── body part 3
        └── ...
```

`MimeMessage` memang hanya punya satu top-level content. Tetapi content tersebut bisa berupa `Multipart`. `Multipart` adalah container yang berisi beberapa `BodyPart`. Setiap `BodyPart` sendiri dapat berisi content biasa atau multipart lagi.

Jadi struktur email bisa menjadi tree:

```text
MimeMessage
└── multipart/mixed
    ├── multipart/alternative
    │   ├── text/plain
    │   └── text/html
    ├── application/pdf attachment
    └── image/png attachment
```

Atau:

```text
MimeMessage
└── multipart/mixed
    ├── multipart/related
    │   ├── multipart/alternative
    │   │   ├── text/plain
    │   │   └── text/html
    │   └── image/png inline logo
    └── application/pdf attachment
```

Ini poin penting: **multipart dapat dinest**.

---

## 3. API Object Model: `Multipart`, `MimeMultipart`, `BodyPart`, `MimeBodyPart`

Di Jakarta Mail, konsep utamanya:

```text
jakarta.mail.Multipart
└── jakarta.mail.internet.MimeMultipart

jakarta.mail.BodyPart
└── jakarta.mail.internet.MimeBodyPart
```

Untuk JavaMail lama:

```text
javax.mail.Multipart
└── javax.mail.internet.MimeMultipart

javax.mail.BodyPart
└── javax.mail.internet.MimeBodyPart
```

Perbedaan utamanya hanya namespace. Konsepnya sama.

### 3.1 `Multipart`

`Multipart` adalah container yang menyimpan banyak body part.

Secara mental:

```text
Multipart = list of BodyPart + subtype + boundary
```

Subtype menentukan semantic relation antar part:

- `mixed`
- `alternative`
- `related`
- `signed`
- `encrypted`
- `report`
- dan lain-lain.

Dalam Jakarta Mail, `Multipart` adalah abstract base class, sedangkan implementasi MIME umumnya adalah `MimeMultipart`.

### 3.2 `MimeMultipart`

`MimeMultipart` adalah implementasi multipart berdasarkan MIME convention.

Contoh:

```java
MimeMultipart mixed = new MimeMultipart("mixed");
```

Jika subtype tidak diberikan:

```java
MimeMultipart multipart = new MimeMultipart();
```

Default subtype umumnya adalah `mixed`.

### 3.3 `BodyPart`

`BodyPart` adalah satu node/leaf di dalam multipart.

Sebuah body part dapat berisi:

- plain text;
- HTML;
- attachment;
- inline image;
- nested multipart;
- nested message.

### 3.4 `MimeBodyPart`

`MimeBodyPart` adalah body part yang mengikuti MIME header/content convention.

Contoh sederhana:

```java
MimeBodyPart textPart = new MimeBodyPart();
textPart.setText("Hello", StandardCharsets.UTF_8.name());
```

Contoh HTML:

```java
MimeBodyPart htmlPart = new MimeBodyPart();
htmlPart.setContent("<h1>Hello</h1>", "text/html; charset=UTF-8");
```

Contoh attachment:

```java
MimeBodyPart attachmentPart = new MimeBodyPart();
attachmentPart.attachFile(file);
```

---

## 4. MIME Multipart Bukan Sekadar “Beberapa File”

Kata “multipart” sering membuat orang mengira ini hanya terkait attachment. Itu salah.

Multipart memiliki beberapa bentuk semantic.

### 4.1 `multipart/mixed`

Makna:

> Part-part di dalamnya adalah gabungan item berbeda yang harus dipresentasikan sebagai satu message, biasanya body + attachment.

Contoh:

```text
multipart/mixed
├── text/html
└── application/pdf attachment
```

Gunakan `mixed` ketika email punya attachment.

### 4.2 `multipart/alternative`

Makna:

> Part-part di dalamnya adalah alternatif representasi dari konten yang sama.

Contoh:

```text
multipart/alternative
├── text/plain
└── text/html
```

Keduanya mewakili pesan yang sama. Client memilih yang paling mampu ia render.

Plain text bukan attachment. HTML bukan attachment. Keduanya adalah versi alternatif dari body.

### 4.3 `multipart/related`

Makna:

> Part-part di dalamnya saling bergantung; biasanya HTML body membutuhkan inline image/CSS/object lain melalui Content-ID.

Contoh:

```text
multipart/related
├── text/html
└── image/png inline, Content-ID: <logo123>
```

HTML bisa refer ke image:

```html
<img src="cid:logo123" alt="Logo">
```

### 4.4 Kenapa subtype matters?

Karena mail client memakai subtype untuk mengambil keputusan:

- Apakah part harus ditampilkan sebagai pilihan alternatif?
- Apakah part harus dianggap attachment?
- Apakah inline image harus dirender dalam HTML?
- Apakah attachment harus muncul di paperclip?
- Apakah HTML dan plain text dianggap duplicate atau fallback?

Jika subtype salah, email tetap bisa terkirim, tetapi rendering bisa kacau.

---

## 5. Boundary: Separator yang Mengubah Tree Menjadi Text

Secara wire format, email tetap text. Multipart tree dikodekan memakai boundary.

Contoh raw MIME sederhana:

```text
Content-Type: multipart/alternative; boundary="abc123"

--abc123
Content-Type: text/plain; charset=UTF-8

Hello Fajar

--abc123
Content-Type: text/html; charset=UTF-8

<p>Hello <b>Fajar</b></p>

--abc123--
```

Boundary adalah separator antar body part.

Developer biasanya tidak perlu membuat boundary manual. `MimeMultipart` akan mengatur boundary saat message disimpan/dikirim.

Namun saat debugging raw MIME, boundary sangat penting untuk membaca struktur.

### 5.1 Boundary sebagai serialization detail

Mental model:

```text
Object tree in Java
    ↓ saveChanges/send
Raw MIME text with boundary
    ↓ SMTP transport
Recipient mail client parses boundary
    ↓ UI rendering
```

Jangan berpikir boundary sebagai domain concept. Boundary adalah serialization mechanism.

### 5.2 Masalah jika boundary rusak

Jika boundary malformed:

- email bisa muncul sebagai plain raw MIME;
- attachment tidak dikenali;
- HTML tidak muncul;
- client hanya menampilkan part pertama;
- mail gateway menolak message.

Biasanya masalah ini muncul jika developer:

- membuat MIME manual dengan string concatenation;
- mencampur newline `\n` dan `\r\n` secara tidak benar;
- memodifikasi raw source setelah `MimeMessage` terbentuk;
- memaksa `Content-Type` manual tanpa sinkron dengan object tree.

Rule: **jangan buat raw MIME manual kecuali benar-benar perlu**.

---

## 6. Struktur 1: Plain Text Only

Kasus paling sederhana:

```text
MimeMessage
└── text/plain
```

Kode Jakarta Mail:

```java
MimeMessage message = new MimeMessage(session);
message.setFrom(new InternetAddress("noreply@example.com", "Example App"));
message.setRecipients(Message.RecipientType.TO, InternetAddress.parse("user@example.com"));
message.setSubject("Plain Text Email", StandardCharsets.UTF_8.name());
message.setText("Hello, this is a plain text email.", StandardCharsets.UTF_8.name());
```

Ini tidak membutuhkan multipart.

Gunakan untuk:

- simple internal notification;
- low-risk plain message;
- fallback testing;
- system-to-system message yang tidak butuh HTML.

Namun untuk customer-facing email, umumnya tetap disediakan HTML + plain fallback.

---

## 7. Struktur 2: HTML Only

```text
MimeMessage
└── text/html
```

Kode:

```java
MimeMessage message = new MimeMessage(session);
message.setFrom(new InternetAddress("noreply@example.com", "Example App"));
message.setRecipients(Message.RecipientType.TO, InternetAddress.parse("user@example.com"));
message.setSubject("HTML Email", StandardCharsets.UTF_8.name());
message.setContent("<p>Hello <b>Fajar</b></p>", "text/html; charset=UTF-8");
```

Ini bekerja, tetapi kurang ideal.

Masalah:

- client yang memblokir HTML tidak punya fallback;
- accessibility lebih buruk;
- spam filter bisa melihat HTML-only sebagai sinyal kurang baik;
- text preview bisa buruk;
- plain text archive/search bisa kurang optimal.

Untuk production, lebih baik gunakan `multipart/alternative`.

---

## 8. Struktur 3: Plain + HTML dengan `multipart/alternative`

Ini struktur paling umum untuk email modern tanpa attachment.

```text
MimeMessage
└── multipart/alternative
    ├── text/plain
    └── text/html
```

Raw MIME kira-kira:

```text
Content-Type: multipart/alternative; boundary="alt"

--alt
Content-Type: text/plain; charset=UTF-8

Hello Fajar.

--alt
Content-Type: text/html; charset=UTF-8

<p>Hello <b>Fajar</b>.</p>

--alt--
```

### 8.1 Kenapa plain dulu, HTML setelahnya?

Dalam `multipart/alternative`, convention umum: part disusun dari format paling sederhana ke format paling kaya.

```text
text/plain first
text/html second
```

Client biasanya memilih last supported alternative. Jika client mendukung HTML, ia memilih HTML. Jika tidak, ia memilih plain text.

### 8.2 Kode Jakarta Mail

```java
MimeMessage message = new MimeMessage(session);
message.setFrom(new InternetAddress("noreply@example.com", "Example App"));
message.setRecipients(Message.RecipientType.TO, InternetAddress.parse("user@example.com"));
message.setSubject("Alternative Email", StandardCharsets.UTF_8.name());

MimeBodyPart plainPart = new MimeBodyPart();
plainPart.setText("Hello Fajar.\nThis is the plain text version.", StandardCharsets.UTF_8.name());

MimeBodyPart htmlPart = new MimeBodyPart();
htmlPart.setContent(
    "<p>Hello <b>Fajar</b>.</p><p>This is the HTML version.</p>",
    "text/html; charset=UTF-8"
);

MimeMultipart alternative = new MimeMultipart("alternative");
alternative.addBodyPart(plainPart);
alternative.addBodyPart(htmlPart);

message.setContent(alternative);
message.saveChanges();
```

### 8.3 JavaMail `javax.mail` version

Untuk Java 8 legacy, import-nya berbeda:

```java
import javax.mail.Message;
import javax.mail.Session;
import javax.mail.internet.InternetAddress;
import javax.mail.internet.MimeBodyPart;
import javax.mail.internet.MimeMessage;
import javax.mail.internet.MimeMultipart;
```

Untuk Jakarta Mail modern:

```java
import jakarta.mail.Message;
import jakarta.mail.Session;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeBodyPart;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.internet.MimeMultipart;
```

Kode konsepnya sama.

---

## 9. Struktur 4: HTML + Inline Image dengan `multipart/related`

Inline image bukan attachment biasa. Inline image adalah resource yang dipakai oleh HTML.

Struktur:

```text
MimeMessage
└── multipart/related
    ├── text/html
    └── image/png inline Content-ID: <logo>
```

HTML:

```html
<p>Hello</p>
<img src="cid:logo" alt="Company Logo">
```

Body part image:

```text
Content-Type: image/png
Content-Disposition: inline
Content-ID: <logo>
```

### 9.1 Kode Jakarta Mail

```java
MimeMessage message = new MimeMessage(session);
message.setFrom(new InternetAddress("noreply@example.com", "Example App"));
message.setRecipients(Message.RecipientType.TO, InternetAddress.parse("user@example.com"));
message.setSubject("Inline Image Email", StandardCharsets.UTF_8.name());

String cid = "logo-001";

MimeBodyPart htmlPart = new MimeBodyPart();
htmlPart.setContent(
    "<html><body>" +
    "<p>Hello Fajar.</p>" +
    "<img src=\"cid:" + cid + "\" alt=\"Logo\">" +
    "</body></html>",
    "text/html; charset=UTF-8"
);

MimeBodyPart imagePart = new MimeBodyPart();
imagePart.attachFile(new File("/path/to/logo.png"));
imagePart.setDisposition(MimeBodyPart.INLINE);
imagePart.setHeader("Content-ID", "<" + cid + ">");
imagePart.setHeader("Content-Type", "image/png");

MimeMultipart related = new MimeMultipart("related");
related.addBodyPart(htmlPart);
related.addBodyPart(imagePart);

message.setContent(related);
message.saveChanges();
```

### 9.2 Content-ID rules

Jika HTML memakai:

```html
<img src="cid:logo-001">
```

MIME header harus:

```text
Content-ID: <logo-001>
```

Perhatikan:

- HTML `cid:` tidak memakai angle bracket.
- Header `Content-ID` biasanya memakai angle bracket.

### 9.3 Inline image tradeoff

Inline image dengan CID punya kelebihan:

- tidak perlu external URL;
- cocok untuk internal secure environment;
- image tetap ada saat email dibuka offline;
- tidak expose tracking URL.

Namun ada kekurangan:

- ukuran email lebih besar;
- beberapa client tetap menampilkan sebagai attachment;
- CID rendering bisa berbeda antar client;
- attachment paperclip bisa muncul walau image inline;
- caching tidak sebaik remote image.

Untuk logo kecil, CID masih masuk akal. Untuk gambar besar, remote image sering lebih praktis.

---

## 10. Struktur 5: Plain + HTML + Inline Image

Ini lebih kompleks. Kita butuh plain fallback dan HTML yang memiliki inline image.

Struktur ideal:

```text
MimeMessage
└── multipart/related
    ├── multipart/alternative
    │   ├── text/plain
    │   └── text/html
    └── image/png inline Content-ID: <logo>
```

Kenapa begitu?

Karena plain dan HTML adalah alternative representation dari pesan yang sama, tetapi HTML membutuhkan related resource.

Jadi `alternative` menjadi part pertama di dalam `related`.

### 10.1 Kode Jakarta Mail

```java
String cid = "logo-001";

MimeBodyPart plainPart = new MimeBodyPart();
plainPart.setText(
    "Hello Fajar.\nOpen this email in an HTML-capable client to see the logo.",
    StandardCharsets.UTF_8.name()
);

MimeBodyPart htmlPart = new MimeBodyPart();
htmlPart.setContent(
    "<html><body>" +
    "<p>Hello <b>Fajar</b>.</p>" +
    "<img src=\"cid:" + cid + "\" alt=\"Logo\">" +
    "</body></html>",
    "text/html; charset=UTF-8"
);

MimeMultipart alternative = new MimeMultipart("alternative");
alternative.addBodyPart(plainPart);
alternative.addBodyPart(htmlPart);

MimeBodyPart alternativePart = new MimeBodyPart();
alternativePart.setContent(alternative);

MimeBodyPart imagePart = new MimeBodyPart();
imagePart.attachFile(new File("/path/to/logo.png"));
imagePart.setDisposition(MimeBodyPart.INLINE);
imagePart.setHeader("Content-ID", "<" + cid + ">");
imagePart.setHeader("Content-Type", "image/png");

MimeMultipart related = new MimeMultipart("related");
related.addBodyPart(alternativePart);
related.addBodyPart(imagePart);

message.setContent(related);
message.saveChanges();
```

### 10.2 Kenapa tidak begini?

```text
multipart/alternative
├── text/plain
└── multipart/related
    ├── text/html
    └── image/png inline
```

Struktur ini juga sering ditemukan dan banyak client bisa memprosesnya.

Namun untuk mental model kita, yang penting adalah:

- plain dan HTML harus tetap dalam relasi alternative;
- image harus berada dalam relasi related dengan HTML;
- jangan meletakkan attachment external sebagai alternative;
- jangan meletakkan inline image sebagai sibling biasa di mixed tanpa related wrapper.

Dalam praktik, beberapa client lebih toleran dibanding spec. Tetapi top 1% engineer tidak bergantung pada toleransi client.

---

## 11. Struktur 6: HTML + Attachment dengan `multipart/mixed`

Jika email punya attachment, top-level biasanya `multipart/mixed`.

```text
MimeMessage
└── multipart/mixed
    ├── text/html
    └── application/pdf attachment
```

Kode:

```java
MimeBodyPart htmlPart = new MimeBodyPart();
htmlPart.setContent(
    "<p>Please see attached report.</p>",
    "text/html; charset=UTF-8"
);

MimeBodyPart pdfPart = new MimeBodyPart();
pdfPart.attachFile(new File("/path/to/report.pdf"));
pdfPart.setDisposition(MimeBodyPart.ATTACHMENT);
pdfPart.setFileName("report.pdf");

MimeMultipart mixed = new MimeMultipart("mixed");
mixed.addBodyPart(htmlPart);
mixed.addBodyPart(pdfPart);

message.setContent(mixed);
message.saveChanges();
```

Namun ini tidak punya plain fallback. Versi lebih baik:

```text
MimeMessage
└── multipart/mixed
    ├── multipart/alternative
    │   ├── text/plain
    │   └── text/html
    └── application/pdf attachment
```

---

## 12. Struktur 7: Plain + HTML + Attachment

Ini struktur production umum untuk notification dengan attachment.

```text
MimeMessage
└── multipart/mixed
    ├── multipart/alternative
    │   ├── text/plain
    │   └── text/html
    └── application/pdf attachment
```

### 12.1 Kode Jakarta Mail

```java
MimeBodyPart plainPart = new MimeBodyPart();
plainPart.setText(
    "Dear Fajar,\n\nPlease see the attached report.\n",
    StandardCharsets.UTF_8.name()
);

MimeBodyPart htmlPart = new MimeBodyPart();
htmlPart.setContent(
    "<p>Dear Fajar,</p><p>Please see the attached report.</p>",
    "text/html; charset=UTF-8"
);

MimeMultipart alternative = new MimeMultipart("alternative");
alternative.addBodyPart(plainPart);
alternative.addBodyPart(htmlPart);

MimeBodyPart bodyPart = new MimeBodyPart();
bodyPart.setContent(alternative);

MimeBodyPart attachmentPart = new MimeBodyPart();
attachmentPart.attachFile(new File("/path/to/report.pdf"));
attachmentPart.setDisposition(MimeBodyPart.ATTACHMENT);
attachmentPart.setFileName("report.pdf");

MimeMultipart mixed = new MimeMultipart("mixed");
mixed.addBodyPart(bodyPart);
mixed.addBodyPart(attachmentPart);

message.setContent(mixed);
message.saveChanges();
```

### 12.2 Kenapa alternative harus dibungkus body part?

Karena `MimeMultipart` tidak bisa langsung menjadi child dari `MimeMultipart`. Child dari multipart harus `BodyPart`.

Jadi nested multipart harus dibungkus:

```java
MimeBodyPart bodyPart = new MimeBodyPart();
bodyPart.setContent(alternative);
mixed.addBodyPart(bodyPart);
```

---

## 13. Struktur 8: Plain + HTML + Inline Image + Attachment

Ini struktur paling umum untuk email enterprise modern.

Contoh: email approval letter dengan logo inline dan PDF attachment.

Struktur yang direkomendasikan:

```text
MimeMessage
└── multipart/mixed
    ├── multipart/related
    │   ├── multipart/alternative
    │   │   ├── text/plain
    │   │   └── text/html
    │   └── image/png inline Content-ID: <logo>
    └── application/pdf attachment
```

Layer logic:

```text
mixed
├── main body group
│   └── related
│       ├── body alternatives
│       │   └── alternative
│       │       ├── plain
│       │       └── html
│       └── inline resources used by html
└── independent attachments
```

### 13.1 Kode lengkap Jakarta Mail

```java
public static MimeMessage buildComplexEmail(
        Session session,
        String from,
        String to,
        File logoFile,
        File attachmentFile
) throws Exception {
    MimeMessage message = new MimeMessage(session);
    message.setFrom(new InternetAddress(from, "Example App"));
    message.setRecipients(Message.RecipientType.TO, InternetAddress.parse(to));
    message.setSubject("Approval Letter", StandardCharsets.UTF_8.name());

    String cid = "company-logo";

    MimeBodyPart plainPart = new MimeBodyPart();
    plainPart.setText(
        "Dear user,\n\nYour approval letter is attached.\n\nRegards,\nExample App",
        StandardCharsets.UTF_8.name()
    );

    MimeBodyPart htmlPart = new MimeBodyPart();
    htmlPart.setContent(
        "<html><body>" +
        "<img src=\"cid:" + cid + "\" alt=\"Company Logo\" style=\"max-width:120px\">" +
        "<p>Dear user,</p>" +
        "<p>Your approval letter is attached.</p>" +
        "<p>Regards,<br>Example App</p>" +
        "</body></html>",
        "text/html; charset=UTF-8"
    );

    MimeMultipart alternative = new MimeMultipart("alternative");
    alternative.addBodyPart(plainPart);
    alternative.addBodyPart(htmlPart);

    MimeBodyPart alternativeWrapper = new MimeBodyPart();
    alternativeWrapper.setContent(alternative);

    MimeBodyPart logoPart = new MimeBodyPart();
    logoPart.attachFile(logoFile);
    logoPart.setDisposition(MimeBodyPart.INLINE);
    logoPart.setHeader("Content-ID", "<" + cid + ">");
    logoPart.setHeader("Content-Type", "image/png");

    MimeMultipart related = new MimeMultipart("related");
    related.addBodyPart(alternativeWrapper);
    related.addBodyPart(logoPart);

    MimeBodyPart relatedWrapper = new MimeBodyPart();
    relatedWrapper.setContent(related);

    MimeBodyPart attachmentPart = new MimeBodyPart();
    attachmentPart.attachFile(attachmentFile);
    attachmentPart.setDisposition(MimeBodyPart.ATTACHMENT);
    attachmentPart.setFileName("approval-letter.pdf");

    MimeMultipart mixed = new MimeMultipart("mixed");
    mixed.addBodyPart(relatedWrapper);
    mixed.addBodyPart(attachmentPart);

    message.setContent(mixed);
    message.saveChanges();
    return message;
}
```

### 13.2 Struktur visual dari kode di atas

```text
MimeMessage
└── mixed
    ├── relatedWrapper
    │   └── related
    │       ├── alternativeWrapper
    │       │   └── alternative
    │       │       ├── plainPart
    │       │       └── htmlPart
    │       └── logoPart
    └── attachmentPart
```

Ini pattern yang harus tertanam kuat.

---

## 14. Jangan Menghafal Struktur, Pahami Relasi Semantic

Pertanyaan utama saat membangun MIME:

### 14.1 Apakah dua part adalah representasi alternatif dari konten yang sama?

Jika ya:

```text
multipart/alternative
```

Contoh:

```text
text/plain
text/html
```

### 14.2 Apakah satu part membutuhkan resource lain untuk render?

Jika ya:

```text
multipart/related
```

Contoh:

```text
html
inline image
```

### 14.3 Apakah beberapa part adalah item berbeda yang dikirim bersama?

Jika ya:

```text
multipart/mixed
```

Contoh:

```text
body
pdf attachment
csv attachment
```

### 14.4 Rule of thumb

```text
alternative = same meaning, different representation
related     = one representation plus its dependent resources
mixed       = independent items bundled together
```

---

## 15. Common MIME Structure Patterns

### 15.1 Plain only

```text
text/plain
```

### 15.2 HTML only

```text
text/html
```

### 15.3 Plain + HTML

```text
multipart/alternative
├── text/plain
└── text/html
```

### 15.4 HTML + inline image

```text
multipart/related
├── text/html
└── image/png inline
```

### 15.5 Plain + HTML + inline image

```text
multipart/related
├── multipart/alternative
│   ├── text/plain
│   └── text/html
└── image/png inline
```

### 15.6 Plain + HTML + attachment

```text
multipart/mixed
├── multipart/alternative
│   ├── text/plain
│   └── text/html
└── application/pdf attachment
```

### 15.7 Plain + HTML + inline image + attachment

```text
multipart/mixed
├── multipart/related
│   ├── multipart/alternative
│   │   ├── text/plain
│   │   └── text/html
│   └── image/png inline
└── application/pdf attachment
```

### 15.8 Multiple attachments

```text
multipart/mixed
├── multipart/alternative
│   ├── text/plain
│   └── text/html
├── application/pdf attachment
├── text/csv attachment
└── image/png attachment
```

### 15.9 Forwarded email as attachment

```text
multipart/mixed
├── text/plain
└── message/rfc822 attachment
```

### 15.10 Delivery status report

```text
multipart/report
├── human-readable explanation
├── message/delivery-status
└── original message or headers
```

`multipart/report` akan dibahas lebih detail saat bounce/feedback loop.

---

## 16. Message Ordering: Kenapa Urutan Part Penting

MIME tidak hanya tentang subtype. Urutan juga penting.

### 16.1 `multipart/alternative`

Urutan yang benar:

```text
text/plain
text/html
```

Lebih umum:

```text
least faithful/simple first
most faithful/rich last
```

Jangan:

```text
multipart/alternative
├── text/html
└── text/plain
```

Risiko:

- client memilih plain text walau bisa HTML;
- preview aneh;
- rendering fallback tidak sesuai.

### 16.2 `multipart/mixed`

Umumnya body diletakkan pertama, attachment setelahnya.

```text
multipart/mixed
├── body
├── attachment 1
└── attachment 2
```

Jika attachment diletakkan pertama, beberapa client bisa menampilkan attachment sebagai konten utama atau preview menjadi kacau.

### 16.3 `multipart/related`

Root body biasanya diletakkan pertama.

```text
multipart/related
├── html root
└── inline resources
```

Pada struktur nested:

```text
multipart/related
├── multipart/alternative root
└── inline resources
```

---

## 17. `Content-Disposition`: Inline vs Attachment

`Content-Disposition` memberi hint bagaimana body part harus diperlakukan.

Nilai umum:

```text
inline
attachment
```

### 17.1 Inline

```java
imagePart.setDisposition(MimeBodyPart.INLINE);
```

Makna:

> Body part ini boleh dirender sebagai bagian dari message body.

Contoh:

- inline logo;
- inline chart;
- inline signature image.

### 17.2 Attachment

```java
attachmentPart.setDisposition(MimeBodyPart.ATTACHMENT);
```

Makna:

> Body part ini adalah file terpisah yang user bisa download/open.

Contoh:

- PDF report;
- invoice;
- CSV export;
- document.

### 17.3 Client tetap punya interpretasi sendiri

Walaupun kita set inline, client bisa tetap menampilkan paperclip.

Kenapa?

- security setting;
- content type tidak dipercaya;
- missing Content-ID;
- unsupported rendering;
- client-specific behavior;
- corporate mail gateway rewrite.

Jadi `Content-Disposition` adalah strong hint, bukan absolute command.

---

## 18. `Content-ID`: Identitas Resource Inline

Inline resource biasanya direfer oleh HTML menggunakan CID.

HTML:

```html
<img src="cid:chart-2026-06">
```

MIME part:

```text
Content-ID: <chart-2026-06>
```

Kode:

```java
String cid = "chart-2026-06";
imagePart.setHeader("Content-ID", "<" + cid + ">");
```

### 18.1 CID harus unik dalam message

Jangan gunakan CID generik untuk semua gambar:

```text
logo
image
file
```

Lebih baik:

```text
logo-tenant-a-20260618
chart-case-12345-01
```

Namun jangan masukkan PII sensitif ke CID karena header bisa terekspos.

### 18.2 CID tidak sama dengan filename

CID adalah identifier untuk reference. Filename adalah nama file. Jangan menganggap keduanya sama.

```text
Content-ID: <logo-main>
Content-Disposition: inline; filename="logo.png"
```

HTML memakai CID:

```html
<img src="cid:logo-main">
```

Bukan:

```html
<img src="logo.png">
```

---

## 19. Filename Encoding dan Attachment Name

Attachment filename terlihat sederhana, tetapi bisa bermasalah jika mengandung:

- spasi;
- unicode;
- tanda kurung;
- koma;
- karakter non-ASCII;
- path separator;
- emoji;
- nama sangat panjang.

Contoh:

```java
attachmentPart.setFileName("Laporan Persetujuan.pdf");
```

Jakarta Mail biasanya membantu encoding parameter. Namun dalam sistem enterprise, lebih aman membuat policy filename:

```text
- normalize unicode
- remove path separator
- trim length
- avoid control characters
- preserve safe extension
- avoid user-controlled raw filename without validation
```

Contoh sanitizer sederhana:

```java
public static String safeAttachmentName(String input, String fallback) {
    if (input == null || input.isBlank()) {
        return fallback;
    }

    String normalized = java.text.Normalizer.normalize(input, java.text.Normalizer.Form.NFKC);
    String safe = normalized
        .replaceAll("[\\r\\n\\t]", " ")
        .replaceAll("[\\\\/:*?\"<>|]", "_")
        .trim();

    if (safe.isEmpty()) {
        return fallback;
    }

    if (safe.length() > 120) {
        safe = safe.substring(0, 120).trim();
    }

    return safe;
}
```

Catatan Java 8:

- `String.isBlank()` belum tersedia.
- Gunakan `input.trim().isEmpty()`.

Versi Java 8:

```java
public static String safeAttachmentNameJava8(String input, String fallback) {
    if (input == null || input.trim().isEmpty()) {
        return fallback;
    }

    String normalized = java.text.Normalizer.normalize(input, java.text.Normalizer.Form.NFKC);
    String safe = normalized
        .replaceAll("[\\r\\n\\t]", " ")
        .replaceAll("[\\\\/:*?\"<>|]", "_")
        .trim();

    if (safe.isEmpty()) {
        return fallback;
    }

    if (safe.length() > 120) {
        safe = safe.substring(0, 120).trim();
    }

    return safe;
}
```

---

## 20. Jangan Menjadikan Attachment sebagai Alternative

Anti-pattern:

```text
multipart/alternative
├── text/html
└── application/pdf
```

Ini salah secara semantic.

Artinya seolah PDF adalah alternatif dari HTML body. Client bisa memilih PDF sebagai body utama, bukan attachment.

Yang benar:

```text
multipart/mixed
├── multipart/alternative
│   ├── text/plain
│   └── text/html
└── application/pdf attachment
```

---

## 21. Jangan Menaruh Inline Image sebagai Mixed Attachment Biasa

Anti-pattern:

```text
multipart/mixed
├── text/html with cid:logo
└── image/png inline logo
```

Bisa bekerja di beberapa client, tetapi semantic-nya kurang tepat karena HTML dan image memiliki dependency relation.

Lebih benar:

```text
multipart/related
├── text/html
└── image/png inline logo
```

Jika ada attachment juga:

```text
multipart/mixed
├── multipart/related
│   ├── text/html
│   └── image/png inline logo
└── application/pdf attachment
```

---

## 22. Jangan Mengirim Plain dan HTML sebagai Dua Email Berbeda

Anti-pattern:

```text
Send email 1: plain text
Send email 2: HTML
```

Masalah:

- user menerima duplicate;
- thread berbeda;
- audit kacau;
- unsubscribe/preference kacau;
- retry bisa mengirim salah satu saja;
- deliverability noise.

Plain dan HTML harus menjadi satu message dengan `multipart/alternative`.

---

## 23. `saveChanges()`: Kapan Perlu?

Saat `Transport.send(message)` dipanggil, Jakarta Mail biasanya akan memastikan message siap dikirim, termasuk mengisi beberapa header seperti `Date` dan `Message-ID` jika belum ada.

Namun dalam testing atau saat ingin melihat raw MIME sebelum send, `saveChanges()` penting.

Contoh:

```java
message.setContent(mixed);
message.saveChanges();
message.writeTo(System.out);
```

Tanpa `saveChanges()`, raw output bisa belum sepenuhnya final tergantung perubahan yang dilakukan.

Gunakan `saveChanges()` sebelum:

- snapshot test raw MIME;
- logging redacted raw MIME di non-production;
- menghitung final message size;
- signing message;
- debugging MIME structure.

Jangan gunakan untuk mengubah business semantics. Anggap `saveChanges()` sebagai finalization step.

---

## 24. Debugging Raw MIME

Untuk melihat struktur sebenarnya:

```java
ByteArrayOutputStream out = new ByteArrayOutputStream();
message.saveChanges();
message.writeTo(out);
String raw = out.toString(StandardCharsets.UTF_8.name());
System.out.println(raw);
```

Java 8 compatible:

```java
ByteArrayOutputStream out = new ByteArrayOutputStream();
message.saveChanges();
message.writeTo(out);
String raw = new String(out.toByteArray(), StandardCharsets.UTF_8);
System.out.println(raw);
```

### 24.1 Jangan log raw MIME di production sembarangan

Raw MIME bisa mengandung:

- recipient email;
- subject;
- body content;
- attachment content base64;
- tokenized links;
- PII;
- regulatory data.

Gunakan raw MIME dump hanya untuk:

- local dev;
- isolated test;
- redacted diagnostic;
- controlled incident environment.

### 24.2 Cara membaca raw MIME

Cari header top-level:

```text
Content-Type: multipart/mixed; boundary="----=_Part_123"
```

Lalu cari boundary:

```text
------=_Part_123
Content-Type: multipart/related; boundary="----=_Part_124"
```

Lalu masuk ke boundary nested.

Buat indentation manual:

```text
mixed boundary Part_123
  related boundary Part_124
    alternative boundary Part_125
      text/plain
      text/html
    image/png inline
  application/pdf attachment
```

Jika struktur mental tidak cocok dengan raw MIME, bug ada di composer.

---

## 25. Building a Reusable MIME Composer

Jangan biarkan business service membangun `MimeMultipart` manual di mana-mana.

Anti-pattern:

```java
public void approveCase(...) {
    MimeMessage message = new MimeMessage(session);
    MimeBodyPart part1 = new MimeBodyPart();
    MimeMultipart mixed = new MimeMultipart("mixed");
    // 100 lines MIME construction here
}
```

Masalah:

- sulit test;
- duplicate logic;
- struktur MIME tidak konsisten;
- security validation tersebar;
- attachment policy tersebar;
- sulit migrasi `javax` ke `jakarta`;
- business service tahu terlalu banyak tentang MIME.

Lebih baik:

```text
Business Service
└── NotificationService
    └── MailComposer
        ├── AddressPolicy
        ├── TemplateRenderer
        ├── AttachmentPolicy
        └── MimeStructureBuilder
```

### 25.1 Domain model composer

```java
public final class OutboundEmail {
    private final String subject;
    private final String plainText;
    private final String html;
    private final List<InlineResource> inlineResources;
    private final List<MailAttachment> attachments;

    // constructor/getters omitted
}
```

```java
public final class InlineResource {
    private final String contentId;
    private final String contentType;
    private final File file;

    // constructor/getters omitted
}
```

```java
public final class MailAttachment {
    private final String fileName;
    private final String contentType;
    private final File file;

    // constructor/getters omitted
}
```

### 25.2 Composer decision tree

```text
if has attachments:
    top = mixed
    body = buildBodyWithoutAttachments()
    add body as first part
    add attachments
else:
    top = buildBodyWithoutAttachments()

buildBodyWithoutAttachments():
    if has inline resources:
        related
        add alternative/simple body as root
        add inline resources
    else:
        alternative/simple body

buildAlternativeOrSimpleBody():
    if plain and html:
        alternative
    else if html:
        text/html
    else:
        text/plain
```

### 25.3 Jakarta Mail composer example

```java
public final class MimeEmailComposer {

    public void applyContent(MimeMessage message, OutboundEmail email) throws MessagingException, IOException {
        Object bodyContent = buildBodyContent(email);

        if (email.getAttachments().isEmpty()) {
            setMessageContent(message, bodyContent);
        } else {
            MimeMultipart mixed = new MimeMultipart("mixed");
            mixed.addBodyPart(wrap(bodyContent));

            for (MailAttachment attachment : email.getAttachments()) {
                mixed.addBodyPart(toAttachmentPart(attachment));
            }

            message.setContent(mixed);
        }

        message.saveChanges();
    }

    private Object buildBodyContent(OutboundEmail email) throws MessagingException, IOException {
        Object body = buildAlternativeOrSimple(email);

        if (email.getInlineResources().isEmpty()) {
            return body;
        }

        MimeMultipart related = new MimeMultipart("related");
        related.addBodyPart(wrap(body));

        for (InlineResource resource : email.getInlineResources()) {
            related.addBodyPart(toInlinePart(resource));
        }

        return related;
    }

    private Object buildAlternativeOrSimple(OutboundEmail email) throws MessagingException {
        boolean hasPlain = email.getPlainText() != null && !email.getPlainText().isEmpty();
        boolean hasHtml = email.getHtml() != null && !email.getHtml().isEmpty();

        if (hasPlain && hasHtml) {
            MimeMultipart alternative = new MimeMultipart("alternative");
            alternative.addBodyPart(textPart(email.getPlainText()));
            alternative.addBodyPart(htmlPart(email.getHtml()));
            return alternative;
        }

        if (hasHtml) {
            return htmlPart(email.getHtml());
        }

        return textPart(email.getPlainText() == null ? "" : email.getPlainText());
    }

    private MimeBodyPart wrap(Object content) throws MessagingException {
        if (content instanceof MimeBodyPart) {
            return (MimeBodyPart) content;
        }

        if (content instanceof MimeMultipart) {
            MimeBodyPart wrapper = new MimeBodyPart();
            wrapper.setContent((MimeMultipart) content);
            return wrapper;
        }

        throw new IllegalArgumentException("Unsupported MIME content: " + content.getClass());
    }

    private void setMessageContent(MimeMessage message, Object content) throws MessagingException {
        if (content instanceof MimeBodyPart) {
            MimeBodyPart part = (MimeBodyPart) content;
            Object partContent;
            try {
                partContent = part.getContent();
            } catch (IOException e) {
                throw new MessagingException("Failed to read body part content", e);
            }
            message.setContent(partContent, part.getContentType());
            return;
        }

        if (content instanceof MimeMultipart) {
            message.setContent((MimeMultipart) content);
            return;
        }

        throw new IllegalArgumentException("Unsupported MIME content: " + content.getClass());
    }

    private MimeBodyPart textPart(String text) throws MessagingException {
        MimeBodyPart part = new MimeBodyPart();
        part.setText(text, StandardCharsets.UTF_8.name());
        return part;
    }

    private MimeBodyPart htmlPart(String html) throws MessagingException {
        MimeBodyPart part = new MimeBodyPart();
        part.setContent(html, "text/html; charset=UTF-8");
        return part;
    }

    private MimeBodyPart toInlinePart(InlineResource resource) throws MessagingException, IOException {
        MimeBodyPart part = new MimeBodyPart();
        part.attachFile(resource.getFile());
        part.setDisposition(MimeBodyPart.INLINE);
        part.setHeader("Content-ID", "<" + resource.getContentId() + ">");
        part.setHeader("Content-Type", resource.getContentType());
        return part;
    }

    private MimeBodyPart toAttachmentPart(MailAttachment attachment) throws MessagingException, IOException {
        MimeBodyPart part = new MimeBodyPart();
        part.attachFile(attachment.getFile());
        part.setDisposition(MimeBodyPart.ATTACHMENT);
        part.setFileName(attachment.getFileName());
        part.setHeader("Content-Type", attachment.getContentType());
        return part;
    }
}
```

Catatan: implementasi di atas adalah teaching implementation. Di production, kita akan memperbaiki:

- abstraction agar tidak tergantung `File` saja;
- support stream/DataSource;
- content type validation;
- max size validation;
- filename encoding policy;
- safer `setMessageContent` untuk simple body;
- richer error model.

Bagian attachment dan Activation akan memperdalam ini di Part 7.

---

## 26. Java 8 vs Java 21/25 Considerations

### 26.1 Namespace

Java 8 legacy biasanya:

```java
javax.mail.*
javax.activation.*
```

Modern Jakarta:

```java
jakarta.mail.*
jakarta.activation.*
```

### 26.2 Language features

Java 8:

- no `var`;
- no `List.of`;
- no records;
- no `String.isBlank()`;
- no text blocks;
- no virtual threads.

Java 15+:

```java
String html = """
    <html>
      <body>
        <p>Hello</p>
      </body>
    </html>
    """;
```

Java 16+ records could model immutable mail request:

```java
public record MailAttachment(
    String fileName,
    String contentType,
    Path path
) {}
```

Java 21+ virtual threads can make blocking SMTP workers easier to scale, but do not remove need for:

- timeout;
- rate limit;
- retry control;
- provider quota;
- queue backpressure.

### 26.3 API concept remains stable

Across Java 8 to 25, the MIME model remains:

```text
Message
Multipart
BodyPart
MimeMultipart
MimeBodyPart
```

The main changes are ecosystem/dependency/language-level, not conceptual MIME design.

---

## 27. Testing Multipart Structure

Testing email by “send to my Gmail and see” is not enough.

You need automated tests for MIME structure.

### 27.1 Assert top-level content type

```java
message.saveChanges();
String contentType = message.getContentType();
assertTrue(contentType.toLowerCase(Locale.ROOT).startsWith("multipart/mixed"));
```

### 27.2 Traverse multipart

```java
Object content = message.getContent();
assertTrue(content instanceof MimeMultipart);

MimeMultipart mixed = (MimeMultipart) content;
assertEquals(2, mixed.getCount());
```

### 27.3 Helper to print MIME tree

```java
public static void printPart(Object content, int depth) throws Exception {
    String indent = "  ".repeat(depth);

    if (content instanceof Message) {
        Message message = (Message) content;
        System.out.println(indent + "Message: " + message.getContentType());
        printPart(message.getContent(), depth + 1);
        return;
    }

    if (content instanceof BodyPart) {
        BodyPart part = (BodyPart) content;
        System.out.println(indent + "BodyPart: " + part.getContentType());
        printPart(part.getContent(), depth + 1);
        return;
    }

    if (content instanceof Multipart) {
        Multipart multipart = (Multipart) content;
        System.out.println(indent + "Multipart: " + multipart.getContentType());
        for (int i = 0; i < multipart.getCount(); i++) {
            printPart(multipart.getBodyPart(i), depth + 1);
        }
        return;
    }

    System.out.println(indent + "Content: " + content.getClass().getName());
}
```

Java 8 compatible indentation:

```java
private static String indent(int depth) {
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < depth; i++) {
        sb.append("  ");
    }
    return sb.toString();
}
```

### 27.4 Expected tree assertion

Untuk email plain + HTML + inline image + attachment, expected:

```text
multipart/mixed
  multipart/related
    multipart/alternative
      text/plain
      text/html
    image/png inline
  application/pdf attachment
```

Buat test berdasarkan semantic tree, bukan raw string boundary.

---

## 28. Mail Client Rendering Reality

MIME yang benar belum tentu tampil identik di semua client.

### 28.1 Gmail

Umumnya bagus untuk:

- `multipart/alternative`;
- attachment;
- HTML basic;
- remote images dengan blocking policy tertentu.

CID inline image kadang bisa tampil, tetapi behavior bisa berbeda pada Gmail web/mobile.

### 28.2 Outlook

Outlook memiliki rendering engine dan constraint sendiri. HTML email yang valid secara browser belum tentu bagus di Outlook.

Risiko:

- CSS tidak konsisten;
- inline image tampil sebagai attachment;
- spacing berubah;
- table layout lebih aman daripada modern CSS layout.

### 28.3 Mobile clients

Mobile client bisa:

- memilih plain text jika HTML dianggap berat;
- memotong email panjang;
- menyembunyikan image;
- menampilkan attachment berbeda.

### 28.4 Corporate gateway

Mail gateway bisa:

- menambahkan disclaimer;
- memindai attachment;
- rewrite link;
- remove inline image;
- convert attachment;
- append footer sebagai nested multipart tambahan.

Jadi saat troubleshooting, jangan hanya lihat MIME yang aplikasi kirim. Bandingkan:

```text
raw MIME generated by app
raw MIME received by mailbox
rendered UI in client
```

---

## 29. Size and Memory Considerations

Multipart sering membawa attachment dan inline resources. Ini berdampak pada size.

### 29.1 Base64 overhead

Binary attachment biasanya dikirim base64. Base64 menambah ukuran sekitar 33%.

Contoh kasar:

```text
10 MB PDF
→ ~13.3 MB base64
+ MIME headers/boundaries
→ mungkin 13.5 MB+
```

Jika provider limit 25 MB, jangan mengirim file 24 MB mentah dan berharap aman.

### 29.2 Inline image juga menambah ukuran

Logo 200 KB untuk 1 email mungkin terlihat kecil.

Jika dikirim ke 100.000 recipient:

```text
200 KB x 100.000 = ~20 GB payload tambahan sebelum overhead
```

Untuk bulk email, remote image bisa lebih efisien daripada CID.

### 29.3 Memory risk

Jika composer membaca attachment ke byte array:

```java
byte[] data = Files.readAllBytes(path);
```

Risiko:

- heap pressure;
- GC spike;
- OOM saat batch;
- latency besar;
- memory duplication karena encoding.

Lebih baik gunakan `DataSource`/file/stream-based handling. Ini akan dibahas di Part 7.

---

## 30. MIME Structure Decision Table

| Requirement | Top-Level Recommended | Nested Structure |
|---|---|---|
| Plain only | `text/plain` | none |
| HTML only | `text/html` | none |
| Plain + HTML | `multipart/alternative` | `plain`, `html` |
| HTML + inline image | `multipart/related` | `html`, inline resources |
| Plain + HTML + inline image | `multipart/related` | `alternative`, inline resources |
| HTML + attachment | `multipart/mixed` | `html`, attachment |
| Plain + HTML + attachment | `multipart/mixed` | `alternative`, attachment |
| Plain + HTML + inline image + attachment | `multipart/mixed` | `related` containing `alternative` + inline resources, then attachment |
| Multiple independent files | `multipart/mixed` | body + each attachment |
| Forwarded email as file | `multipart/mixed` | body + `message/rfc822` |

---

## 31. Production Invariants

Gunakan invariant ini dalam code review:

1. Jika email punya plain dan HTML, gunakan `multipart/alternative`.
2. Plain part diletakkan sebelum HTML part.
3. Jika HTML merefer inline resource, gunakan `multipart/related`.
4. Jika email punya attachment, gunakan top-level `multipart/mixed`.
5. Body utama diletakkan sebelum attachment.
6. Attachment tidak boleh menjadi alternative body.
7. Inline resource harus punya `Content-ID` yang cocok dengan `cid:` di HTML.
8. Attachment filename harus divalidasi/sanitized.
9. Jangan membuat raw MIME manual dengan string concatenation.
10. Jangan log raw MIME production tanpa redaction.
11. Jangan load attachment besar penuh ke heap tanpa alasan kuat.
12. Test MIME structure secara otomatis.
13. Treat MIME output as part of public contract with mail clients.
14. Composer harus reusable dan terpusat.
15. Business service tidak boleh tahu detail boundary/body part nesting.

---

## 32. Failure Modes yang Harus Bisa Anda Prediksi

### 32.1 User melihat dua body sekaligus

Kemungkinan:

- `plain` dan `html` tidak berada dalam `multipart/alternative`;
- salah subtype menjadi `mixed`;
- HTML body ditambahkan sebagai attachment.

### 32.2 Attachment tidak muncul

Kemungkinan:

- attachment part tidak ditambahkan ke `mixed`;
- disposition salah;
- file kosong;
- content type salah;
- gateway strip attachment;
- attachment melebihi limit.

### 32.3 Inline image tidak tampil

Kemungkinan:

- CID mismatch;
- missing angle bracket pada `Content-ID`;
- image tidak berada dalam `multipart/related`;
- client block image;
- gateway remove inline image;
- content type salah.

### 32.4 Email tampil sebagai raw MIME text

Kemungkinan:

- boundary rusak;
- content type manual salah;
- newline malformed;
- raw MIME dibuat manual;
- nested content tidak diset dengan benar.

### 32.5 Gmail/Outlook beda tampilan

Kemungkinan:

- HTML/CSS compatibility;
- CID behavior;
- corporate gateway;
- dark mode;
- unsupported CSS;
- client memilih alternative berbeda.

### 32.6 Attachment corrupt

Kemungkinan:

- stream tertutup sebelum send;
- file berubah saat send;
- encoding issue;
- manual base64 salah;
- content transfer encoding rusak;
- partial write karena timeout.

---

## 33. Design Exercise

Bayangkan sistem regulatory case management mengirim email berikut:

- subject: “Notice of Compliance Review”;
- recipient: external applicant;
- body harus punya plain text dan HTML;
- HTML punya logo agency inline;
- ada PDF notice sebagai attachment;
- ada CSV evidence summary sebagai attachment;
- semua harus traceable dan testable.

Struktur MIME yang benar:

```text
MimeMessage
└── multipart/mixed
    ├── multipart/related
    │   ├── multipart/alternative
    │   │   ├── text/plain
    │   │   └── text/html
    │   └── image/png inline agency logo
    ├── application/pdf attachment notice
    └── text/csv attachment evidence summary
```

Composer decision:

```text
has attachments? yes → top-level mixed
has inline resources? yes → body is related
has plain + html? yes → body root is alternative
add inline logo to related
add PDF and CSV to mixed
```

Test assertion:

```text
top-level content type starts with multipart/mixed
mixed count = 3
mixed[0] content type starts with multipart/related
related contains multipart/alternative and image/png inline
alternative contains text/plain then text/html
mixed[1] disposition attachment, filename notice.pdf
mixed[2] disposition attachment, filename evidence-summary.csv
```

---

## 34. Mini Checklist Sebelum Mengirim Multipart Email

Sebelum email production dikirim, tanyakan:

```text
[ ] Apakah body punya plain fallback?
[ ] Apakah HTML menggunakan charset UTF-8?
[ ] Apakah plain dan HTML berada dalam multipart/alternative?
[ ] Apakah urutan plain sebelum HTML?
[ ] Apakah inline resource punya CID yang cocok?
[ ] Apakah inline resource berada dalam multipart/related?
[ ] Apakah attachment berada dalam multipart/mixed?
[ ] Apakah body utama berada sebelum attachment?
[ ] Apakah filename aman?
[ ] Apakah content type benar?
[ ] Apakah ukuran total email masih di bawah limit provider?
[ ] Apakah raw MIME tidak dilog tanpa redaction?
[ ] Apakah struktur MIME punya automated test?
```

---

## 35. Ringkasan Mental Model

MIME multipart adalah cara email merepresentasikan tree content dalam format text.

Tiga subtype yang paling penting:

```text
alternative = beberapa representasi dari pesan yang sama
related     = body dengan resource dependennya
mixed       = body plus item independen seperti attachment
```

Struktur paling penting untuk production:

```text
multipart/mixed
├── multipart/related
│   ├── multipart/alternative
│   │   ├── text/plain
│   │   └── text/html
│   └── inline resources
└── attachments
```

Jika Anda memahami struktur ini, Anda tidak hanya bisa “mengirim email dengan attachment”, tetapi bisa mendesain message yang:

- benar secara MIME;
- lebih portable antar mail client;
- lebih mudah dites;
- lebih mudah di-debug;
- lebih aman untuk production;
- lebih siap untuk template, attachment, inline resource, dan compliance requirement.

---

## 36. Apa yang Belum Dibahas

Part ini fokus pada struktur multipart.

Yang belum dibahas mendalam:

- `DataSource` dan `DataHandler`;
- streaming attachment;
- MIME type detection;
- memory-safe attachment handling;
- Activation framework;
- attachment security scanning;
- large file policy;
- inline vs remote image tradeoff yang lebih luas;
- content transfer encoding detail;
- advanced i18n filename encoding.

Itu akan masuk ke part berikutnya.

---

## 37. Referensi Utama

- Jakarta Mail Specification dan API documentation: `MimeMessage`, `MimeMultipart`, `MimeBodyPart`, `Multipart`.
- Jakarta Mail API menjelaskan `MimeMultipart` sebagai implementasi `Multipart` berbasis MIME convention.
- Jakarta Mail API menjelaskan `MimeBodyPart` sebagai body part yang berada di dalam `MimeMultipart`.
- Jakarta Mail specification menjelaskan penggunaan `MimeBodyPart` dan `MimeMultipart` untuk membangun multipart `MimeMessage`.
- MIME RFC family secara konseptual: RFC 2045, RFC 2046, RFC 2047, RFC 2231, RFC 5322.

---

## 38. Status Seri

Progress saat ini:

```text
[x] Part 0 — Orientation: Email as a Distributed System
[x] Part 1 — Email Protocol Stack: SMTP, MIME, POP3, IMAP
[x] Part 2 — JavaMail to Jakarta Mail: History, Namespace, Compatibility, Migration
[x] Part 3 — Core API: Session, Store, Folder, Transport, Message
[x] Part 4 — SMTP Sending: Properties, Transport, Timeout, TLS, Auth
[x] Part 5 — MIME Message Construction: Text, HTML, Charset, Headers
[x] Part 6 — Multipart Email: Alternative, Mixed, Related, Nested Structure
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

Seri **belum selesai**. Bagian berikutnya adalah:

```text
Part 7 — Attachment Handling and Jakarta Activation
```


<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 5 — MIME Message Construction: Text, HTML, Charset, Headers](./05-mime-message-text-html-headers-charset.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 7 — Attachment Handling and Jakarta Activation](./07-attachment-handling-jakarta-activation.md)
