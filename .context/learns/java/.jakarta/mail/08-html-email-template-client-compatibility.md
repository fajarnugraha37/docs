# Part 8 — HTML Email Engineering: Templates, CSS, Images, and Client Compatibility

> Series: `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery`  
> File: `08-html-email-template-client-compatibility.md`  
> Scope: Java 8–25, JavaMail `javax.mail`, Jakarta Mail `jakarta.mail`, Jakarta Activation, HTML email engineering, template rendering, CSS limitations, images, dark mode, accessibility, testing, and production readiness.

---

## 1. Tujuan Pembelajaran

Di part sebelumnya kita sudah membahas MIME message, multipart structure, dan attachment/Activation. Sekarang kita naik satu level ke problem yang sering disepelekan: **HTML email**.

Banyak engineer mengira HTML email sama seperti membuat halaman web kecil lalu dikirim lewat SMTP. Ini asumsi yang salah. HTML email bukan web page. HTML email adalah **dokumen HTML yang dirender oleh banyak mail client dengan engine, sanitization, CSS support, image policy, security rule, dan dark mode behavior yang tidak seragam**.

Setelah bagian ini, kamu harus mampu:

1. memahami kenapa HTML email berbeda dari web UI biasa;
2. membedakan tanggung jawab Jakarta Mail vs template engine vs design system;
3. membangun MIME structure yang benar untuk plain text + HTML + image;
4. mendesain template email yang maintainable, testable, versioned, dan aman;
5. menghindari bug umum pada Outlook, Gmail, Apple Mail, mobile client, dan enterprise mailbox;
6. memahami inline CSS, table layout, responsive email, dark mode, accessibility, dan preview text;
7. mendesain rendering pipeline yang cocok untuk sistem enterprise/regulatory;
8. membuat boundary antara business notification, template rendering, dan mail transport.

Targetnya bukan hanya “email terlihat bagus di laptop saya”, tetapi:

> HTML email harus bisa diproduksi secara konsisten, bisa diaudit, aman terhadap input tidak terpercaya, dapat diuji, dan tetap terbaca ketika mail client memodifikasi rendering.

---

## 2. Mental Model: HTML Email Adalah UI di Lingkungan Tidak Stabil

Pada web application biasa, kamu relatif mengontrol:

- browser target;
- CSS bundle;
- JavaScript runtime;
- asset hosting;
- deployment version;
- CSP/security policy;
- session/auth context;
- observability frontend;
- browser compatibility matrix.

Pada HTML email, kontrol itu jauh lebih lemah.

Mail client dapat:

- menghapus `<script>`;
- menghapus atau mengubah `<style>`;
- memblokir remote image;
- mengubah warna dalam dark mode;
- rewrite link;
- proxy image;
- menambahkan banner keamanan;
- menampilkan warning phishing;
- memotong email yang terlalu besar;
- menampilkan plain text fallback;
- tidak mendukung sebagian CSS modern;
- menampilkan preview/snippet dari bagian body yang tidak kamu prediksi;
- mengubah font;
- mengabaikan media query;
- menampilkan attachment inline secara berbeda;
- mengubah layout tabel;
- memodifikasi HTML untuk sanitization.

Jadi mental model yang lebih benar:

```text
HTML email = constrained document rendering
           + MIME packaging
           + mail client sanitization
           + security policy
           + content transformation
           + deliverability constraints
           + accessibility requirement
           + audit requirement
```

HTML email bukan SPA. Bukan mini web app. Bukan landing page. Bukan PDF. Ia adalah **robust degraded document**.

Top 1% engineer tidak bertanya:

> “Bagaimana cara membuat email cantik?”

Mereka bertanya:

> “Apa struktur email paling sederhana yang tetap benar, terbaca, aman, compatible, dan bisa dioperasikan?”

---

## 3. Boundary: Apa Tugas Jakarta Mail dan Apa Bukan

Jakarta Mail dapat membantu membuat dan mengirim MIME message. `MimeMessage` merepresentasikan MIME-style email message, dan method seperti `setContent` dapat digunakan untuk menetapkan content object atau multipart object pada message/body part.

Tetapi Jakarta Mail **tidak** menyelesaikan:

- desain HTML;
- CSS compatibility;
- template rendering;
- dark mode;
- email client testing;
- accessibility;
- deliverability;
- phishing perception;
- unsubscribe management;
- click tracking;
- image CDN;
- template approval workflow;
- brand consistency;
- responsive layout;
- content governance.

Jakarta Mail beroperasi pada layer:

```text
application data
  -> template renderer
  -> HTML/plain text output
  -> MIME composer
  -> Jakarta Mail MimeMessage
  -> SMTP Transport
  -> SMTP relay/provider
  -> recipient mailbox/client
```

Kesalahan desain yang sering terjadi adalah mencampur semua layer:

```java
// Bad mental model
public void sendInvoiceEmail(User user, Invoice invoice) {
    MimeMessage message = new MimeMessage(session);
    message.setSubject("Invoice " + invoice.getNumber());
    message.setContent("<html>..." + user.getName() + "...</html>", "text/html");
    Transport.send(message);
}
```

Masalahnya:

- business logic tercampur dengan rendering;
- escaping raw HTML tidak jelas;
- template tidak versioned;
- tidak ada plain text fallback;
- tidak ada audit template version;
- tidak ada test terhadap MIME structure;
- tidak ada retry/idempotency;
- tidak ada safe defaults;
- tidak bisa preview;
- tidak bisa approval;
- tidak bisa localization dengan bersih.

Model yang lebih matang:

```text
Domain Event
  -> Notification Policy
  -> Notification Request
  -> Template Resolution
  -> Template Rendering
  -> MIME Composition
  -> Outbox
  -> Mail Gateway
  -> SMTP/API Provider
  -> Delivery Feedback
```

---

## 4. HTML Email Harus Punya Plain Text Fallback

Email modern sebaiknya tidak hanya `text/html`. Gunakan `multipart/alternative`:

```text
multipart/alternative
  ├── text/plain; charset=UTF-8
  └── text/html; charset=UTF-8
```

Plain text fallback penting karena:

1. beberapa client/security gateway menampilkan plain text;
2. screen reader atau accessibility workflow bisa memanfaatkan versi plain;
3. deliverability sering lebih baik ketika HTML disertai text alternative yang wajar;
4. debugging lebih mudah;
5. email tetap berguna ketika HTML rusak;
6. sistem audit dapat membaca body inti tanpa HTML parsing.

Plain text bukan harus identik byte-by-byte dengan HTML, tetapi harus membawa informasi utama:

- greeting;
- alasan email dikirim;
- informasi utama;
- call to action dalam bentuk URL penuh;
- kontak/support;
- footer/legal notice.

Contoh struktur:

```text
Subject: Your application has been approved

Hello Fajar,

Your application APP-2026-00031 has been approved.

You can view the details here:
https://example.gov/applications/APP-2026-00031

If you did not expect this email, please contact support.

Regards,
ACEAS Team
```

HTML version boleh lebih kaya, tetapi plain version harus tetap bernilai.

---

## 5. Baseline MIME Structure untuk HTML Email

### 5.1 Plain + HTML sederhana

```text
MimeMessage
└── multipart/alternative
    ├── text/plain
    └── text/html
```

### 5.2 HTML + attachment

```text
MimeMessage
└── multipart/mixed
    ├── multipart/alternative
    │   ├── text/plain
    │   └── text/html
    └── application/pdf attachment
```

### 5.3 HTML + inline image

```text
MimeMessage
└── multipart/alternative
    ├── text/plain
    └── multipart/related
        ├── text/html
        └── image/png inline; Content-ID=<logo>
```

### 5.4 HTML + inline image + attachment

```text
MimeMessage
└── multipart/mixed
    ├── multipart/alternative
    │   ├── text/plain
    │   └── multipart/related
    │       ├── text/html
    │       └── image/png inline; Content-ID=<logo>
    └── application/pdf attachment
```

Rule of thumb:

- `alternative` = beberapa representasi konten yang sama;
- `related` = HTML dan resource yang dibutuhkan HTML;
- `mixed` = body utama plus attachment tambahan.

Jangan asal membuat semua body part di satu level. Banyak client masih toleran, tetapi rendering bisa berbeda.

---

## 6. Java/Jakarta Mail Example: HTML + Plain Text

### 6.1 Jakarta Mail version

```java
import jakarta.mail.Message;
import jakarta.mail.Session;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeBodyPart;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.internet.MimeMultipart;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;

public final class BasicHtmlEmailComposer {

    public MimeMessage compose(Session session, EmailView view) throws Exception {
        MimeMessage message = new MimeMessage(session);

        message.setFrom(new InternetAddress(view.fromAddress(), view.fromName(), StandardCharsets.UTF_8.name()));
        message.setRecipient(Message.RecipientType.TO, new InternetAddress(view.toAddress(), view.toName(), StandardCharsets.UTF_8.name()));
        message.setSubject(view.subject(), StandardCharsets.UTF_8.name());
        message.setSentDate(Date.from(Instant.now()));

        MimeBodyPart plainPart = new MimeBodyPart();
        plainPart.setText(view.plainText(), StandardCharsets.UTF_8.name());

        MimeBodyPart htmlPart = new MimeBodyPart();
        htmlPart.setContent(view.html(), "text/html; charset=UTF-8");

        MimeMultipart alternative = new MimeMultipart("alternative");
        alternative.addBodyPart(plainPart);
        alternative.addBodyPart(htmlPart);

        message.setContent(alternative);
        message.saveChanges();

        return message;
    }
}
```

### 6.2 JavaMail `javax.mail` version

Perbedaannya terutama package import:

```java
import javax.mail.Message;
import javax.mail.Session;
import javax.mail.internet.InternetAddress;
import javax.mail.internet.MimeBodyPart;
import javax.mail.internet.MimeMessage;
import javax.mail.internet.MimeMultipart;
```

Desain object dan konsep MIME tetap sama.

---

## 7. HTML Email Bukan Tempat JavaScript

Hampir semua mail client utama memblokir JavaScript karena risiko keamanan. Jadi hindari:

```html
<script>alert('hello')</script>
```

Hindari juga desain yang bergantung pada:

- form interaktif kompleks;
- client-side validation;
- SPA behavior;
- external JavaScript;
- local storage;
- cookies;
- websocket;
- dynamic runtime rendering;
- CSS framework penuh seperti Bootstrap tanpa inlining/adaptation.

Email harus berisi **state final yang sudah dirender oleh server**.

Model yang benar:

```text
server-side data -> server-side template -> static HTML email
```

Bukan:

```text
email opens -> JavaScript fetches data -> renders UI
```

---

## 8. CSS Reality: Inline First, Conservative Always

HTML email client tidak setara dengan browser modern. CSS support bervariasi antar mobile, desktop, dan webmail. Campaign Monitor menyediakan CSS support guide yang menguji banyak CSS property dan email client, yang menunjukkan bahwa compatibility harus diperlakukan sebagai matrix, bukan asumsi global.

Prinsip aman:

1. gunakan inline CSS untuk style kritikal;
2. gunakan table layout untuk struktur utama;
3. gunakan `<style>` hanya untuk enhancement seperti media query;
4. jangan bergantung pada CSS modern tanpa compatibility check;
5. jangan bergantung pada external stylesheet;
6. buat desain yang tetap terbaca ketika CSS tertentu hilang;
7. test pada target client utama.

Contoh style yang lebih aman:

```html
<td style="padding: 24px; font-family: Arial, sans-serif; font-size: 16px; line-height: 24px; color: #111111;">
  Your application has been approved.
</td>
```

Bukan:

```html
<link rel="stylesheet" href="https://cdn.example.com/email.css">
<div class="card application-status approved">...</div>
```

External CSS sering tidak reliable.

---

## 9. Table Layout: Kenapa Masih Dipakai

Pada web modern, table layout untuk page layout dianggap kuno. Pada email, table layout masih sering dipakai karena beberapa client, terutama Outlook desktop legacy/enterprise environment, punya rendering engine dan support CSS yang berbeda dari browser modern.

Mental model:

```text
Web UI:
  semantic HTML + CSS layout engine modern

HTML Email:
  table-based structural skeleton + inline CSS + progressive enhancement
```

Contoh skeleton:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Notification</title>
</head>
<body style="margin:0; padding:0; background-color:#f5f5f5;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f5f5f5;">
    <tr>
      <td align="center" style="padding:24px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:600px; max-width:600px; background-color:#ffffff;">
          <tr>
            <td style="padding:24px; font-family:Arial, sans-serif; font-size:20px; line-height:28px; font-weight:bold; color:#111111;">
              Application Approved
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 24px 24px; font-family:Arial, sans-serif; font-size:16px; line-height:24px; color:#333333;">
              Your application has been approved.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

Perhatikan:

- `role="presentation"` membantu screen reader memahami table sebagai layout, bukan data table;
- width fixed + max width umum untuk compatibility;
- inline CSS untuk property penting;
- struktur sederhana;
- tidak ada JavaScript;
- tidak ada external CSS.

---

## 10. Responsive Email

Responsive email tidak bisa mengandalkan semua teknik web modern. Beberapa client mendukung media query, beberapa tidak lengkap.

Strategi aman:

1. desain single-column jika memungkinkan;
2. gunakan max width sekitar 600px untuk desktop;
3. pastikan layout tetap terbaca jika media query tidak jalan;
4. gunakan button yang cukup besar untuk mobile;
5. hindari grid kompleks;
6. hindari multi-column untuk informasi penting;
7. gunakan progressive enhancement untuk layar kecil.

Contoh media query enhancement:

```html
<style>
  @media screen and (max-width: 600px) {
    .container {
      width: 100% !important;
    }
    .content {
      padding: 16px !important;
    }
    .button {
      display: block !important;
      width: 100% !important;
    }
  }
</style>
```

Tetapi jangan membuat informasi inti bergantung pada class ini. Kalau media query dihapus, email tetap harus bisa dibaca.

---

## 11. Dark Mode: Client Bisa Mengubah Warna Tanpa Izinmu

Dark mode email adalah salah satu sumber bug modern. Litmus mencatat bahwa dark mode menjadi pertimbangan penting karena email client menerapkan dark mode secara berbeda; sebagian client melakukan partial color adjustment, sebagian dapat melakukan full color inversion.

Konsekuensi:

- logo PNG hitam bisa hilang di background gelap;
- teks abu-abu bisa menjadi terlalu redup;
- border bisa hilang;
- button brand color bisa berubah;
- background image bisa tidak cocok;
- shadow/elevation bisa terlihat aneh;
- warna status seperti green/red/yellow bisa kehilangan makna.

Strategi aman:

1. gunakan contrast yang cukup tinggi;
2. jangan encode makna hanya dengan warna;
3. sediakan alt text untuk image/logo;
4. gunakan logo yang aman untuk light/dark background;
5. gunakan border atau container separation yang tetap terlihat;
6. test pada client target;
7. hindari teks tipis;
8. jangan terlalu bergantung pada background image;
9. buat CTA tetap jelas ketika warna berubah.

Contoh dark-mode-friendly thinking:

```text
Bad:
  Status approved hanya ditunjukkan dengan teks hijau muda.

Better:
  Teks: "Approved"
  Icon/text label: "Status: Approved"
  Warna sebagai enhancement, bukan satu-satunya sinyal.
```

---

## 12. Images: Remote vs Inline CID vs Attachment

Ada tiga cara umum menyertakan image.

### 12.1 Remote image

HTML:

```html
<img src="https://cdn.example.com/email/logo.png" width="120" alt="Company Logo">
```

Kelebihan:

- ukuran email kecil;
- image bisa di-cache/CDN;
- mudah diganti untuk future email view, walau ini bisa buruk untuk audit;
- umum untuk marketing email.

Kekurangan:

- image bisa diblokir;
- privacy proxy bisa mengubah tracking semantics;
- butuh public HTTPS URL;
- data residency/compliance perlu diperhatikan;
- email lama bisa berubah tampilan jika asset diganti;
- penerima offline tidak melihat image.

### 12.2 Inline CID image

HTML:

```html
<img src="cid:logo" width="120" alt="Company Logo">
```

MIME:

```text
multipart/related
  ├── text/html
  └── image/png; Content-ID=<logo>; Content-Disposition=inline
```

Kelebihan:

- image dikirim bersama email;
- tidak butuh external fetch;
- lebih deterministic untuk audit;
- cocok untuk logo kecil atau image penting.

Kekurangan:

- ukuran email membesar;
- beberapa client menampilkan inline image sebagai attachment;
- CID handling kadang inconsistent;
- tidak cocok untuk banyak/large images.

### 12.3 Normal attachment

Image dikirim sebagai attachment, bukan bagian rendering.

Cocok untuk:

- file yang memang perlu diunduh;
- evidence image;
- screenshot;
- supporting document.

Tidak cocok untuk:

- logo UI;
- icon dekoratif;
- layout image.

---

## 13. Java Example: HTML + Inline Logo + Plain Fallback

```java
import jakarta.activation.DataHandler;
import jakarta.activation.DataSource;
import jakarta.mail.Message;
import jakarta.mail.Session;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeBodyPart;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.internet.MimeMultipart;
import jakarta.mail.util.ByteArrayDataSource;

import java.nio.charset.StandardCharsets;
import java.util.Date;

public final class InlineImageEmailComposer {

    public MimeMessage compose(
            Session session,
            String from,
            String to,
            String subject,
            String plainText,
            String html,
            byte[] logoPng
    ) throws Exception {
        MimeMessage message = new MimeMessage(session);
        message.setFrom(new InternetAddress(from));
        message.setRecipient(Message.RecipientType.TO, new InternetAddress(to));
        message.setSubject(subject, StandardCharsets.UTF_8.name());
        message.setSentDate(new Date());

        MimeBodyPart plainPart = new MimeBodyPart();
        plainPart.setText(plainText, StandardCharsets.UTF_8.name());

        MimeBodyPart htmlPart = new MimeBodyPart();
        htmlPart.setContent(html, "text/html; charset=UTF-8");

        MimeBodyPart logoPart = new MimeBodyPart();
        DataSource logoDataSource = new ByteArrayDataSource(logoPng, "image/png");
        logoPart.setDataHandler(new DataHandler(logoDataSource));
        logoPart.setHeader("Content-ID", "<logo>");
        logoPart.setDisposition(MimeBodyPart.INLINE);
        logoPart.setFileName("logo.png");

        MimeMultipart related = new MimeMultipart("related");
        related.addBodyPart(htmlPart);
        related.addBodyPart(logoPart);

        MimeBodyPart relatedWrapper = new MimeBodyPart();
        relatedWrapper.setContent(related);

        MimeMultipart alternative = new MimeMultipart("alternative");
        alternative.addBodyPart(plainPart);
        alternative.addBodyPart(relatedWrapper);

        message.setContent(alternative);
        message.saveChanges();

        return message;
    }
}
```

HTML body:

```html
<img src="cid:logo" width="120" alt="Company Logo" style="display:block; border:0; outline:none; text-decoration:none;">
```

Important detail:

- `Content-ID` header harus memakai angle bracket: `<logo>`;
- HTML reference memakai `cid:logo`, tanpa bracket;
- inline image sebaiknya kecil;
- selalu ada `alt` text;
- jangan jadikan image satu-satunya pembawa informasi penting.

---

## 14. Template Engine: Thymeleaf, FreeMarker, Mustache, Pebble

Jakarta Mail tidak punya template engine bawaan. Kamu perlu memilih rendering layer.

Common options:

| Engine | Karakter | Cocok untuk |
|---|---|---|
| Thymeleaf | HTML-oriented, natural template | Spring-heavy apps, designer-friendly template |
| FreeMarker | Powerful text templating | Complex template logic, legacy enterprise |
| Mustache | Logic-less | Strict separation data vs template |
| Pebble | Modern syntax, inheritance | Clean template architecture |
| Hand-rolled string | Simple but risky | Hanya untuk very small internal email |

Top 1% rule:

> Template engine adalah boundary. Jangan biarkan business logic tumbuh liar di template.

Template sebaiknya hanya menangani:

- conditional display sederhana;
- looping list kecil;
- formatting yang aman;
- escaping;
- localization key placement.

Template sebaiknya tidak berisi:

- database query;
- authorization logic;
- state transition;
- retry decision;
- provider routing;
- complex business rule;
- hidden side effect.

---

## 15. Rendering Pipeline yang Bersih

Desain pipeline:

```text
Domain object
  -> Notification model
  -> Template model
  -> Renderer
  -> RenderedEmail
  -> MimeComposer
  -> MailOutbox
```

Contoh model:

```java
public record RenderedEmail(
        String subject,
        String plainText,
        String html,
        String templateCode,
        String templateVersion,
        String locale
) {}
```

```java
public interface EmailTemplateRenderer {
    RenderedEmail render(EmailTemplateRequest request);
}
```

```java
public record EmailTemplateRequest(
        String templateCode,
        String locale,
        String recipientDisplayName,
        Map<String, Object> variables
) {}
```

Keuntungan:

- subject, text, dan HTML dirender bersama;
- template code/version bisa diaudit;
- test bisa fokus pada rendering output;
- MIME composer tidak tahu business domain;
- mail transport tidak tahu template engine;
- provider adapter tidak tahu HTML semantics.

---

## 16. Escaping: Masalah Keamanan yang Sering Diremehkan

Email bisa membawa input dari user:

- nama penerima;
- komentar;
- reason/rejection note;
- nama file;
- alamat;
- nama organisasi;
- case description;
- free text form;
- remark internal;
- attachment label.

Kalau input itu dimasukkan ke HTML tanpa escaping:

```html
<p>Hello ${userDisplayName}</p>
```

Dan `userDisplayName` bernilai:

```html
<img src=x onerror=alert(1)>
```

Mail client biasanya membatasi script, tetapi jangan bergantung pada sanitization client. Ini tetap bisa menyebabkan:

- broken layout;
- malicious link injection;
- spoofed content;
- hidden text;
- phishing-like email;
- audit confusion;
- trust degradation.

Rule:

1. escape semua variable HTML by default;
2. hanya allow raw HTML untuk field yang benar-benar trusted;
3. sanitasi rich text dengan allowlist;
4. validasi URL;
5. jangan masukkan user input ke header tanpa validasi;
6. jangan render internal remark mentah ke external email;
7. test malicious input.

Contoh prinsip:

```text
Trusted template HTML: allowed
Untrusted variable data: escaped
Untrusted rich text: sanitized with allowlist
Untrusted URL: validated and encoded
Header values: CR/LF rejected
```

---

## 17. Header Injection dan HTML Injection Itu Berbeda

HTML escaping melindungi body HTML. Header injection adalah masalah lain.

Contoh bahaya:

```text
Subject: Hello\r\nBcc: attacker@example.com
```

Jika subject dari user input tidak divalidasi, attacker bisa mencoba menyisipkan header baru.

Gunakan API high-level:

```java
message.setSubject(subject, "UTF-8");
```

Dan tetap validasi:

```java
public static String safeHeaderValue(String value) {
    if (value == null) {
        return "";
    }
    if (value.contains("\r") || value.contains("\n")) {
        throw new IllegalArgumentException("Header value must not contain CR/LF");
    }
    return value;
}
```

Untuk HTML body, gunakan template engine escaping. Untuk header, reject CR/LF.

---

## 18. Preview Text / Preheader

Mail client sering menampilkan snippet setelah subject. Jika tidak dikontrol, snippet bisa mengambil:

- teks header tersembunyi;
- navigation;
- logo alt text;
- legal disclaimer;
- random whitespace;
- unsubscribe text;
- first visible text yang tidak ideal.

Preheader adalah teks pendek di awal body HTML yang dirancang sebagai preview.

Contoh:

```html
<div style="display:none; max-height:0; overflow:hidden; opacity:0; color:transparent; mso-hide:all;">
  Your application APP-2026-00031 has been approved.
</div>
```

Caution:

- beberapa client bisa tetap menampilkan hidden text;
- jangan menyimpan informasi sensitif di preheader;
- jangan membuat preheader misleading;
- plain text harus tetap jelas.

Good preheader:

```text
Your application status has been updated.
```

Bad preheader:

```text
Urgent!!! Click now or account will be suspended!!!
```

---

## 19. Call-to-Action Button yang Aman

Button HTML email biasanya table-based agar compatible.

```html
<table role="presentation" cellspacing="0" cellpadding="0" border="0">
  <tr>
    <td style="border-radius:4px; background-color:#1a73e8;">
      <a href="https://example.gov/applications/APP-2026-00031"
         style="display:inline-block; padding:12px 20px; font-family:Arial, sans-serif; font-size:16px; line-height:20px; color:#ffffff; text-decoration:none; border-radius:4px;">
        View application
      </a>
    </td>
  </tr>
</table>
```

Rules:

1. link text harus jelas;
2. URL harus HTTPS;
3. domain harus recognizable;
4. jangan gunakan URL shortener untuk official/regulatory email;
5. jangan buat CTA sebagai image-only;
6. plain text fallback harus punya URL penuh;
7. hindari banyak CTA yang membingungkan;
8. tracking parameter jangan membocorkan PII.

---

## 20. Link Security dan Phishing Perception

Email adalah medium yang sangat sensitif terhadap phishing. Engineer harus berpikir seperti recipient dan security gateway.

Hindari:

```html
<a href="https://strange-tracking-domain.example/abc">Login to Government Portal</a>
```

Lebih baik:

```html
<a href="https://service.example.gov/applications/APP-2026-00031">View application</a>
```

Dalam plain text:

```text
https://service.example.gov/applications/APP-2026-00031
```

Design rules:

- domain harus konsisten;
- link display tidak boleh menipu destination;
- jangan pakai raw token panjang di URL jika bisa pakai authenticated portal;
- tokenized link harus short-lived dan scoped;
- jangan kirim password atau secret;
- jangan minta user membalas email dengan data sensitif;
- gunakan wording yang tidak panic-inducing.

---

## 21. Accessibility

HTML email harus tetap bisa dipahami oleh pengguna dengan assistive technology.

Checklist:

1. gunakan struktur heading secara wajar;
2. gunakan `alt` text pada image penting;
3. decorative image bisa `alt=""`;
4. gunakan contrast yang cukup;
5. jangan encode makna hanya dengan warna;
6. link text harus descriptive;
7. hindari font terlalu kecil;
8. line-height cukup;
9. button cukup besar untuk mobile;
10. table layout diberi `role="presentation"`;
11. jangan membuat email image-only;
12. plain text fallback harus bernilai.

Bad:

```html
<a href="https://example.gov/x">Click here</a>
```

Better:

```html
<a href="https://example.gov/applications/APP-2026-00031">View application APP-2026-00031</a>
```

---

## 22. Localization dan Internationalization

Email sering dikirim lintas bahasa. Tantangannya bukan hanya menerjemahkan string.

Pertimbangan:

- subject localization;
- plain text localization;
- HTML localization;
- date/time format;
- currency;
- number format;
- address format;
- name order;
- salutation;
- right-to-left language;
- font support;
- attachment filename;
- legal/footer text per locale;
- fallback locale.

Template key model:

```text
APPLICATION_APPROVED
  en-SG v3
  id-ID v2
  zh-SG v1
```

Jangan menyimpan satu template HTML lalu mengganti beberapa kata secara ad-hoc. Untuk sistem enterprise, template should be versioned per locale.

---

## 23. Template Versioning dan Audit

Untuk sistem regulatory, template bukan sekadar file UI. Template adalah bagian dari evidence.

Ketika user bertanya:

> “Email apa yang dikirim ke recipient pada 2026-06-18?”

Jawaban yang defensible bukan hanya:

> “Kami mengirim template APPLICATION_APPROVED.”

Tetapi:

```text
notification_id: NOTIF-2026-000912
recipient: hash/redacted
template_code: APPLICATION_APPROVED
template_version: 3.2.1
locale: en-SG
rendered_subject: Your application has been approved
rendered_at: 2026-06-18T10:33:11+07:00
transport_status: SMTP_ACCEPTED
provider_message_id: abc123
```

Pertanyaan penting:

- apakah rendered HTML disimpan?
- apakah hanya template data yang disimpan?
- apakah template lama immutable?
- apakah variable yang digunakan disimpan?
- apakah PII boleh disimpan dalam rendered copy?
- berapa retention period?
- siapa bisa melihat rendered email?

Trade-off:

| Approach | Kelebihan | Risiko |
|---|---|---|
| Store rendered email | Audit kuat | PII retention besar |
| Store template version + variables | Bisa re-render | Butuh template immutability |
| Store summary only | Privacy lebih baik | Evidence lemah |
| Store encrypted rendered email | Audit + protection | Key management kompleks |

Untuk regulatory system, sering masuk akal menyimpan:

- template code;
- template version;
- locale;
- rendering timestamp;
- recipient reference;
- subject;
- normalized text summary;
- variable snapshot minimal;
- raw rendered body hanya jika policy memperbolehkan.

---

## 24. Template Approval Workflow

Pada organisasi besar, template email sering melibatkan:

- product owner;
- legal/compliance;
- business user;
- design/UX;
- security;
- engineering;
- operation/support.

Workflow yang matang:

```text
Draft
  -> Technical Validation
  -> Business Review
  -> Compliance Review
  -> Preview Approval
  -> Published
  -> Deprecated
  -> Retired
```

Template metadata:

```yaml
templateCode: APPLICATION_APPROVED
version: 3.2.1
locale: en-SG
owner: Application Management
status: PUBLISHED
approvedBy: compliance-team
approvedAt: 2026-05-12T09:10:00+08:00
containsPII: true
requiresAttachment: false
channel: EMAIL
```

Engineer top-tier akan menanyakan:

- siapa owner template?
- bagaimana rollback?
- bagaimana preview sebelum publish?
- apakah version immutable?
- apakah approval tercatat?
- apakah template variable schema divalidasi?
- apakah ada test rendering per locale?

---

## 25. Variable Schema: Jangan Biarkan Template Menerima Map Bebas Tanpa Kontrak

Banyak sistem memakai:

```java
Map<String, Object> variables
```

Ini fleksibel, tetapi berbahaya jika tidak ada schema.

Masalah:

- variable hilang baru ketahuan saat runtime;
- tipe salah;
- nullable tidak jelas;
- template gagal rendering di worker;
- fallback buruk;
- production email cacat;
- test coverage rendah.

Lebih baik ada schema:

```java
public record ApplicationApprovedTemplateModel(
        String recipientName,
        String applicationNumber,
        String applicationUrl,
        String supportEmail
) {}
```

Atau minimal metadata:

```yaml
variables:
  recipientName:
    type: string
    required: true
    escape: html
  applicationNumber:
    type: string
    required: true
  applicationUrl:
    type: url
    required: true
  supportEmail:
    type: email
    required: true
```

Renderer harus fail fast sebelum email masuk outbox.

---

## 26. Design System untuk Email

Email template juga butuh design system, tetapi bukan design system web yang sama persis.

Komponen email:

- layout container;
- header;
- footer;
- salutation;
- paragraph;
- key-value table;
- status badge;
- CTA button;
- warning box;
- attachment notice;
- legal disclaimer;
- support contact;
- signature.

Namun komponennya harus dikompilasi menjadi HTML email compatible.

Contoh component abstraction:

```text
EmailButton(label, url, variant)
  -> table-based button HTML with inline style

EmailKeyValueTable(rows)
  -> presentation-safe table layout

EmailStatusBadge(status)
  -> text + color enhancement
```

Rule:

> Build reusable email components, not reusable random HTML fragments.

---

## 27. HTML Size dan Clipping

Beberapa webmail client dapat memotong email yang terlalu besar. Salah satu contoh terkenal adalah clipping pada Gmail untuk pesan besar. Terlepas dari threshold spesifik yang bisa berubah, prinsip engineering-nya tetap: **email harus kecil dan fokus**.

Penyebab HTML membesar:

- CSS inline berlebihan;
- duplicated style;
- base64 image embedded di HTML;
- huge tracking metadata;
- long legal disclaimer;
- large table data;
- verbose templating output;
- hidden content;
- accidental debug dump.

Mitigasi:

- jangan embed base64 image langsung di HTML;
- gunakan attachment atau secure link untuk data besar;
- ringkas legal text;
- gunakan portal link untuk detail panjang;
- compress style melalui component discipline;
- test raw MIME size;
- set internal maximum body size.

Rule:

> Email is notification, not data warehouse export.

---

## 28. Jangan Kirim Data Sensitif Berlebihan di HTML Email

Email sering diteruskan, disimpan lama, diindeks, dibackup, dan bisa dibaca di perangkat pribadi. Untuk sistem enterprise/regulatory, email harus minim data.

Hindari mengirim:

- password;
- full identity number;
- sensitive case detail;
- confidential evidence;
- personal medical/legal detail;
- internal note;
- full audit record;
- token jangka panjang;
- attachment sensitif tanpa proteksi.

Lebih aman:

```text
Your application status has been updated.
Please log in to the portal to view details.
```

Daripada:

```text
Your application was rejected because [long sensitive reason containing internal remarks].
```

Design pattern:

```text
Email = alert + safe summary + authenticated link
Portal = detailed sensitive data
```

---

## 29. HTML Email Testing Strategy

Testing harus dibagi beberapa level.

### 29.1 Unit test template model

Validasi:

- required variable tersedia;
- URL valid;
- locale valid;
- nullable field aman;
- subject tidak mengandung CR/LF.

### 29.2 Unit test rendering

Assert:

- subject benar;
- plain text mengandung informasi penting;
- HTML mengandung escaped value;
- tidak ada placeholder tersisa seperti `${name}`;
- tidak ada forbidden tag seperti `<script>`;
- link domain benar.

### 29.3 MIME structure test

Assert:

```text
multipart/alternative
  text/plain
  text/html
```

Atau nested structure untuk inline image/attachment.

### 29.4 Snapshot test

Simpan rendered HTML sebagai golden snapshot untuk mendeteksi accidental change.

Caution:

- snapshot jangan terlalu brittle;
- normalize timestamp/random IDs;
- review snapshot change dengan serius.

### 29.5 Visual/client test

Gunakan tool atau mailbox test untuk target client:

- Gmail web;
- Outlook desktop;
- Outlook web;
- Apple Mail;
- iOS Mail;
- Android Gmail;
- corporate mail gateway.

### 29.6 Security test

Input malicious:

```text
<script>alert(1)</script>
<img src=x onerror=alert(1)>
Bob\r\nBcc: attacker@example.com
https://evil.example/phish
```

Expected:

- HTML escaped;
- header rejected;
- URL rejected/normalized;
- no script in output;
- no layout break.

---

## 30. Example Test: Ensure HTML Escaping

Pseudo-example:

```java
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class ApplicationApprovedTemplateTest {

    @Test
    void shouldEscapeRecipientNameInHtml() {
        ApplicationApprovedTemplateModel model = new ApplicationApprovedTemplateModel(
                "<img src=x onerror=alert(1)>",
                "APP-2026-00031",
                "https://service.example.gov/applications/APP-2026-00031",
                "support@example.gov"
        );

        RenderedEmail rendered = renderer.renderApplicationApproved(model, "en-SG");

        assertThat(rendered.html()).doesNotContain("<img src=x");
        assertThat(rendered.html()).contains("&lt;img");
        assertThat(rendered.plainText()).contains("APP-2026-00031");
    }
}
```

---

## 31. Example Test: Ensure No Placeholder Leakage

```java
@Test
void shouldNotLeakTemplatePlaceholders() {
    RenderedEmail rendered = renderer.render(request);

    assertThat(rendered.subject()).doesNotContain("${");
    assertThat(rendered.plainText()).doesNotContain("${");
    assertThat(rendered.html()).doesNotContain("${");
    assertThat(rendered.html()).doesNotContain("{{");
    assertThat(rendered.html()).doesNotContain("}}");
}
```

Placeholder leakage in production email indicates:

- missing variable;
- wrong template version;
- renderer misconfiguration;
- test gap;
- poor release validation.

---

## 32. Example Test: MIME Structure

```java
@Test
void shouldCreateMultipartAlternativeMessage() throws Exception {
    MimeMessage message = composer.compose(session, view);

    Object content = message.getContent();
    assertThat(content).isInstanceOf(MimeMultipart.class);

    MimeMultipart root = (MimeMultipart) content;
    assertThat(root.getContentType()).contains("multipart/alternative");
    assertThat(root.getCount()).isEqualTo(2);

    assertThat(root.getBodyPart(0).getContentType()).contains("text/plain");
    assertThat(root.getBodyPart(1).getContentType()).contains("text/html");
}
```

Test ini memastikan email tidak accidentally berubah dari multipart alternative menjadi HTML-only.

---

## 33. Operational Preview Tool

Untuk sistem enterprise, sangat berguna punya preview endpoint internal:

```text
GET /internal/email-templates/{templateCode}/preview?version=3.2.1&locale=en-SG
```

Fitur preview:

- render subject;
- render plain text;
- render HTML;
- show variable schema;
- validate missing variables;
- show MIME structure;
- show approximate size;
- show links extracted;
- show attachment requirements;
- show template version metadata.

Security:

- hanya internal/admin;
- jangan pakai data production sembarangan;
- mask PII;
- audit access;
- jangan expose secret token.

---

## 34. Logging: Jangan Log Full HTML Email Sembarangan

Full HTML email bisa mengandung PII. Logging full body di production adalah anti-pattern kecuali environment dan policy sangat jelas.

Lebih baik log:

```json
{
  "notificationId": "NOTIF-2026-000912",
  "templateCode": "APPLICATION_APPROVED",
  "templateVersion": "3.2.1",
  "locale": "en-SG",
  "recipientHash": "sha256:...",
  "subjectHash": "sha256:...",
  "htmlSizeBytes": 18422,
  "plainTextSizeBytes": 642,
  "containsAttachment": false,
  "renderResult": "SUCCESS"
}
```

Untuk debugging non-prod, boleh menyimpan rendered output dengan policy sanitization.

---

## 35. Common Anti-Patterns

### 35.1 HTML-only email

Masalah:

- buruk untuk fallback;
- buruk untuk accessibility;
- lebih sulit audit text content;
- bisa terlihat kosong jika HTML dirusak client.

### 35.2 Image-only email

Masalah:

- image blocked = email kosong;
- tidak accessible;
- deliverability buruk;
- tidak searchable;
- phishing-like.

### 35.3 Business logic di template

Masalah:

- sulit test;
- sulit audit;
- template jadi programming language liar;
- behavior berubah tanpa code review yang memadai.

### 35.4 No versioning

Masalah:

- tidak bisa menjelaskan isi email historis;
- rollback sulit;
- approval tidak jelas.

### 35.5 Remote image untuk data penting

Masalah:

- image bisa diblokir;
- data tidak terlihat;
- external dependency;
- privacy issue.

### 35.6 Full detail sensitif di email

Masalah:

- forwarding risk;
- retention risk;
- mailbox compromise impact;
- audit exposure.

### 35.7 CSS modern tanpa testing

Masalah:

- layout rusak di Outlook/Gmail/mobile;
- dark mode unreadable;
- inconsistent rendering.

### 35.8 No template schema

Masalah:

- missing variable;
- runtime rendering failure;
- placeholder leakage.

---

## 36. Architecture Pattern: Email Rendering Module

Struktur module yang bersih:

```text
notification-mail/
  domain/
    NotificationType.java
    Recipient.java
    NotificationRequest.java
  template/
    EmailTemplateRenderer.java
    TemplateRegistry.java
    TemplateVersion.java
    TemplateVariableSchema.java
  template/application-approved/
    application-approved.en-SG.v3.html
    application-approved.en-SG.v3.txt
    application-approved.en-SG.v3.yml
  mime/
    MimeMessageComposer.java
    InlineResource.java
    AttachmentDescriptor.java
  transport/
    MailGateway.java
    JakartaSmtpMailGateway.java
  test/
    TemplateRenderingTest.java
    MimeStructureTest.java
```

Boundary:

```text
TemplateRenderer:
  input: template model
  output: subject/plain/html

MimeMessageComposer:
  input: rendered email + attachments/resources
  output: MimeMessage

MailGateway:
  input: MimeMessage or mail command
  output: provider acceptance/failure
```

---

## 37. Example: Template Metadata File

```yaml
templateCode: APPLICATION_APPROVED
version: 3.2.1
locale: en-SG
channel: EMAIL
owner: Application Management
status: PUBLISHED
subject: "Your application has been approved"
containsPII: true
requiresAuthenticationLink: true
allowedRecipientTypes:
  - APPLICANT
variables:
  recipientName:
    type: string
    required: true
    escape: html
  applicationNumber:
    type: string
    required: true
    pattern: "^APP-[0-9]{4}-[0-9]{5}$"
  applicationUrl:
    type: url
    required: true
    allowedDomains:
      - service.example.gov
  supportEmail:
    type: email
    required: true
approval:
  approvedBy: compliance-team
  approvedAt: "2026-05-12T09:10:00+08:00"
```

Metadata seperti ini membuat template menjadi artifact yang bisa di-review, bukan sekadar file HTML liar.

---

## 38. Example: Safe Template Output Contract

Renderer harus menghasilkan:

```java
public record RenderedEmail(
        String subject,
        String preheader,
        String plainText,
        String html,
        String templateCode,
        String templateVersion,
        String locale,
        List<RenderedLink> links,
        int htmlSizeBytes,
        int plainTextSizeBytes
) {}
```

Kenapa `links` diekstrak?

- validasi domain;
- audit;
- security review;
- link checker;
- prevent accidental localhost/staging link;
- detect PII in query string.

---

## 39. Production Checklist

Sebelum template email dipublish:

- [ ] punya plain text version;
- [ ] subject localized;
- [ ] preheader aman;
- [ ] HTML valid enough;
- [ ] CSS critical inline;
- [ ] tidak bergantung pada JavaScript;
- [ ] tidak image-only;
- [ ] semua image punya alt text;
- [ ] link HTTPS;
- [ ] link domain approved;
- [ ] tidak ada staging/local URL;
- [ ] variable schema lengkap;
- [ ] user input escaped;
- [ ] header values reject CR/LF;
- [ ] rendered size wajar;
- [ ] dark mode tested;
- [ ] mobile tested;
- [ ] Outlook/Gmail tested sesuai target;
- [ ] legal footer approved;
- [ ] template version immutable;
- [ ] approval tercatat;
- [ ] audit metadata tersedia;
- [ ] snapshot test ada;
- [ ] MIME structure test ada;
- [ ] no sensitive over-sharing;
- [ ] fallback URL ada di plain text.

---

## 40. Decision Matrix: Remote Image vs CID vs No Image

| Situation | Recommended |
|---|---|
| Logo kecil untuk official notification | CID atau remote stable CDN, tergantung audit/privacy |
| Banyak decorative image marketing | Remote image/CDN |
| Informasi penting seperti status approval | Text, bukan image |
| Chart/report besar | Secure portal link atau attachment, bukan inline image |
| Sensitive image | Jangan remote public; pertimbangkan secure portal |
| Email harus deterministic untuk evidence | CID atau stored rendered artifact |
| Ukuran email harus kecil | Remote image atau no image |
| Client sering block image | Text-first design |

---

## 41. Design Principle: Text First, Visual Second

Email yang baik tetap berguna saat:

- image diblokir;
- CSS partial;
- dark mode mengubah warna;
- mobile width kecil;
- HTML di-strip;
- client menampilkan plain text;
- recipient memakai screen reader.

Urutan prioritas:

```text
1. Informasi inti benar
2. Link aman dan jelas
3. Plain text fallback tersedia
4. HTML readable
5. Visual branding
6. Enhancement/responsiveness
```

Jangan dibalik.

---

## 42. Top 1% Mental Model

Engineer biasa melihat HTML email sebagai:

```text
HTML string + Transport.send()
```

Engineer matang melihatnya sebagai:

```text
policy-controlled communication artifact
  + protocol-constrained MIME package
  + client-hostile rendering target
  + security-sensitive content surface
  + audit-relevant business evidence
  + operationally observable notification unit
```

Dengan mental model ini, pertanyaan desain berubah:

- bukan “pakai template engine apa?” tetapi “bagaimana template menjadi artifact versioned dan approved?”;
- bukan “bagaimana membuat HTML cantik?” tetapi “bagaimana HTML tetap benar saat client merusak sebagian style?”;
- bukan “bagaimana menaruh logo?” tetapi “apakah logo dibutuhkan untuk memahami pesan?”;
- bukan “bagaimana kirim attachment?” tetapi “apakah attachment aman dikirim lewat email?”;
- bukan “bagaimana tahu email terkirim?” tetapi “apa arti terkirim: rendered, queued, SMTP accepted, delivered, opened, acted upon?”

---

## 43. Ringkasan

Di bagian ini kita membahas bahwa HTML email adalah constrained UI artifact, bukan web page biasa.

Poin utama:

1. Jakarta Mail mengirim MIME message, bukan menyelesaikan HTML compatibility.
2. HTML email harus punya plain text fallback.
3. Struktur MIME harus benar: `alternative`, `related`, `mixed` sesuai peran.
4. CSS email harus conservative: inline critical CSS, table layout, progressive enhancement.
5. Dark mode dan client compatibility harus diuji, bukan diasumsikan.
6. Image bisa remote, CID inline, atau attachment; masing-masing punya trade-off.
7. Template engine harus menjadi boundary bersih antara domain dan rendering.
8. User input harus escaped; header value harus reject CR/LF.
9. Template harus versioned, schema-based, testable, dan auditable.
10. Untuk sistem enterprise/regulatory, email adalah communication evidence, bukan sekadar tampilan.

---

## 44. Latihan

### Latihan 1 — MIME Structure Design

Desain MIME structure untuk email berikut:

- plain text fallback;
- HTML body;
- logo inline;
- PDF attachment;
- satu CSV attachment.

Tulis tree MIME-nya.

### Latihan 2 — Template Schema

Buat schema untuk template `PASSWORD_RESET_REQUESTED` dengan constraints:

- recipient name;
- reset URL;
- expiry time;
- support email;
- request IP optional.

Tentukan field mana yang boleh tampil di email dan mana yang sebaiknya tidak.

### Latihan 3 — Security Review

Review template berikut:

```html
<p>Hello ${name}</p>
<p>Your request: ${requestDescription}</p>
<a href="${actionUrl}">Click here</a>
```

Identifikasi risiko:

- HTML injection;
- malicious URL;
- weak link text;
- sensitive data exposure;
- missing plain fallback;
- no localization;
- no audit metadata.

### Latihan 4 — Production Checklist

Ambil satu email notification di sistem nyata. Buat checklist:

- plain text ada/tidak;
- link domain;
- PII exposure;
- template version;
- dark mode readability;
- mobile readability;
- audit data;
- testing strategy.

---

## 45. Referensi

- Jakarta Mail API documentation: `MimeMessage` represents MIME-style email messages and supports setting content/multipart content.
- Jakarta Mail specification: `MimeMessage` exposes common characteristics of Internet mail messages as defined by RFC822 and MIME standards.
- Eclipse Angus/Jakarta Mail documentation: `MimeMultipart` is the MIME-based implementation of `Multipart` used for multipart message creation.
- Campaign Monitor CSS Support Guide: CSS support varies across email clients and should be treated as compatibility matrix.
- Litmus dark mode resources: email clients apply dark mode differently, including partial and full color changes, so dark mode must be tested explicitly.
- Microsoft email dark mode/accessibility guidance: readability and contrast remain important in light and dark modes.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 7 — Attachment Handling and Jakarta Activation](./07-attachment-handling-jakarta-activation.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 9 — Mail Addressing, Identity, and Header Semantics](./09-addressing-identity-header-semantics.md)
