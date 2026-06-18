# Part 26 — Advanced MIME and Internationalization

> Series: `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery`  
> File: `26-advanced-mime-internationalization.md`  
> Scope: Java 8–25, JavaMail `javax.mail`, Jakarta Mail `jakarta.mail`, Jakarta Activation, Eclipse Angus Mail, SMTP/MIME interoperability

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas:

- dasar SMTP/MIME;
- `MimeMessage`, `MimeMultipart`, `MimeBodyPart`;
- attachment dan Jakarta Activation;
- inbound parsing;
- testing, observability, security, deliverability, dan regulatory-grade design.

Part ini masuk ke area yang lebih halus: **internationalization dan MIME edge cases**.

Ini bukan materi “cara kirim email Bahasa Indonesia”. Ini tentang bagaimana email tetap benar ketika bertemu:

- subject berisi Unicode;
- display name berisi aksen, CJK, Arab, emoji;
- filename attachment non-ASCII;
- domain internationalized;
- local-part non-ASCII;
- SMTP server yang tidak support `SMTPUTF8`;
- mail client lama yang salah encode filename;
- body dengan charset berbeda;
- header yang terlalu panjang;
- transfer encoding yang salah;
- inbound email malformed tapi tetap harus diproses.

Di level top engineer, skill pentingnya bukan menghafal RFC, tetapi tahu **di layer mana encoding berlaku** dan **API mana yang boleh dipakai agar tidak merusak message**.

---

## 1. Mental Model Utama: Email Bukan “String UTF-8 Biasa”

Di aplikasi modern, hampir semua string internal memakai Unicode/UTF-8. Developer sering menganggap email juga begitu:

```java
message.setSubject("Pembayaran disetujui – 東京支店");
```

Secara API terlihat sederhana. Tetapi di wire format, email historically lahir dari dunia 7-bit ASCII. MIME menambahkan cara membawa content non-ASCII, attachment, HTML, binary, dan metadata internasional.

Mental model yang benar:

```text
Java String / Unicode
        |
        | high-level Jakarta Mail API
        v
MIME header encoding / MIME body encoding / parameter encoding
        |
        | SMTP transport constraint
        v
Mail server / relay / recipient server / mail client
```

Tidak semua bagian email di-encode dengan aturan yang sama.

| Bagian | Contoh | Encoding yang relevan |
|---|---|---|
| Header unstructured | `Subject` | RFC 2047 encoded-word atau RFC 6532 jika SMTPUTF8 path valid |
| Header structured address | `From`, `To` display name | RFC 2047 untuk display name; address syntax tetap punya aturan sendiri |
| MIME parameter | `filename`, `name` | RFC 2231 parameter encoding; real world juga perlu toleransi legacy RFC 2047 misuse |
| Body text | plain text / HTML | `charset`, quoted-printable/base64/8bit |
| Binary attachment | PDF, ZIP, image | base64 biasanya |
| Domain non-ASCII | `bücher.example` | IDNA/Punycode untuk domain, tergantung layer |
| Local-part non-ASCII | `用户@example.com` | SMTPUTF8/EAI support diperlukan |

Kesalahan besar: memakai satu fungsi encoding untuk semua tempat.

Contoh salah:

```java
// Salah secara konsep: RFC 2047 encoded-word tidak boleh dipakai sembarang
// untuk seluruh header structured atau parameter MIME.
message.setHeader("Content-Disposition", "attachment; filename=\"=?UTF-8?B?...?=\"");
```

Contoh benar secara arah desain:

```java
// Gunakan API level tinggi sebanyak mungkin.
message.setSubject(subject, StandardCharsets.UTF_8.name());
bodyPart.setFileName(fileName);
address = new InternetAddress(email, displayName, StandardCharsets.UTF_8.name());
```

Lalu konfigurasi/implementation Jakarta Mail menangani detail encoding sesuai konteks.

---

## 2. Kenapa Internationalized Email Sulit?

Ada empat penyebab utama.

### 2.1 Email Format Sangat Tua

Internet message format awalnya didesain untuk ASCII. MIME kemudian menambahkan mekanisme extension. Akibatnya, banyak encoding rule bersifat kompatibilitas historis.

### 2.2 Ada Banyak Layer

Email punya beberapa layer yang sering tercampur:

```text
SMTP envelope
  MAIL FROM
  RCPT TO

Internet message headers
  From
  To
  Subject
  Content-Type
  Content-Disposition

MIME body structure
  multipart/mixed
  multipart/alternative
  text/plain
  text/html
  application/pdf

Body content bytes
  charset + transfer encoding
```

Satu string seperti nama file bisa muncul di MIME parameter, bukan body text. Satu nama orang bisa muncul di structured address header, bukan subject.

### 2.3 Mail Clients Tidak Semua Patuh Standar

Real world client mungkin:

- encode filename memakai RFC 2047 padahal semestinya parameter encoding;
- mengabaikan `filename*`;
- salah render quoted-printable;
- memotong header panjang;
- tidak support `SMTPUTF8`;
- salah decode emoji di subject;
- mengganti font/fallback glyph.

Top engineer tidak hanya membuat “valid menurut spec”, tetapi juga membuat sistem robust terhadap **interoperability debt**.

### 2.4 SMTP Server Path Bisa Menolak Internationalized Address

Subject Unicode biasanya bisa dibawa via encoded-word. Tetapi alamat email dengan Unicode di local-part, seperti:

```text
用户@example.com
```

memerlukan SMTPUTF8 support di jalur SMTP. Jika server tidak advertise capability tersebut, pengiriman dapat gagal atau harus ditolak sebelum send.

---

## 3. Vocabulary Penting

| Istilah | Makna praktis |
|---|---|
| Unicode | Model character universal, bukan encoding byte tertentu |
| UTF-8 | Encoding Unicode menjadi byte sequence |
| Charset | Cara interpretasi byte menjadi character |
| Content-Type charset | Charset body part, misalnya `text/plain; charset=UTF-8` |
| Content-Transfer-Encoding | Cara body bytes dibawa lewat email transport, misalnya quoted-printable/base64 |
| Encoded-word | Format RFC 2047 untuk non-ASCII text di header tertentu |
| MIME parameter encoding | Encoding parameter seperti `filename*=` menurut RFC 2231 |
| IDN | Internationalized Domain Name |
| IDNA/Punycode | Cara representasi domain non-ASCII ke ASCII-compatible form |
| EAI | Email Address Internationalization |
| SMTPUTF8 | SMTP extension untuk internationalized email addresses/header info |
| Header folding | Pemecahan header panjang menjadi beberapa continuation line |
| Q encoding | Encoded-word style mirip quoted-printable untuk header |
| B encoding | Encoded-word style Base64 untuk header |

---

## 4. Unicode, Charset, dan Byte: Jangan Campur Mental Model

Java `String` menyimpan sequence Unicode character. Tetapi email di wire adalah bytes.

```text
Java String: "Résumé 東京 ✅"
        |
        | encode using UTF-8
        v
Bytes: 52 C3 A9 73 75 6D C3 A9 20 E6 9D B1 E4 BA AC 20 E2 9C 85
        |
        | MIME header/body encoding depending context
        v
Wire-safe representation
```

### 4.1 Charset Body vs Charset Header

Body text:

```text
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

R=C3=A9sum=C3=A9 Tokyo ...
```

Subject header:

```text
Subject: =?UTF-8?Q?R=C3=A9sum=C3=A9_Tokyo?=
```

MIME parameter filename:

```text
Content-Disposition: attachment;
 filename*=UTF-8''R%C3%A9sum%C3%A9%20Tokyo.pdf
```

Ketiganya membawa informasi non-ASCII, tetapi formatnya berbeda.

---

## 5. RFC 2047 Encoded-Word: Untuk Header Text, Bukan Untuk Semua Hal

RFC 2047 menyediakan mekanisme untuk memasukkan non-ASCII text ke header email tertentu.

Format umum:

```text
=?charset?encoding?encoded-text?=
```

Contoh:

```text
Subject: =?UTF-8?B?44GT44KT44Gr44Gh44Gv?=
```

Atau Q encoding:

```text
Subject: =?UTF-8?Q?R=C3=A9sum=C3=A9_Approved?=
```

### 5.1 Kapan Encoded-Word Dipakai?

Dipakai untuk text dalam header seperti:

- `Subject`;
- display name dalam `From`, `To`, `Cc`;
- beberapa extension header yang memang berupa text.

Contoh header address:

```text
From: =?UTF-8?B?5bCP5piO?= <xiaoming@example.com>
```

### 5.2 Kapan Jangan Dipakai?

Jangan asal memakai RFC 2047 untuk:

- entire structured header;
- email address local-part;
- MIME parameter seperti `filename=`;
- boundary;
- message-id;
- date;
- raw body.

Salah:

```text
Content-Disposition: attachment; filename="=?UTF-8?B?44OG44K544OI.pdf?="
```

Di real world, beberapa client memang mengirim seperti itu. Parser robust boleh menoleransi. Tetapi generator kita sebaiknya memakai parameter encoding yang benar.

---

## 6. Jakarta Mail `MimeUtility`: Kapan Dipakai?

Jakarta Mail/Angus Mail menyediakan `jakarta.mail.internet.MimeUtility` untuk encoding dan decoding MIME headers.

Namun prinsip desainnya:

> Pakai high-level API jika ada. Pakai `MimeUtility` hanya saat benar-benar memanipulasi raw header.

### 6.1 Untuk Subject

Prefer:

```java
message.setSubject("Résumé approved – 東京", StandardCharsets.UTF_8.name());
```

Bukan:

```java
message.setHeader(
    "Subject",
    MimeUtility.encodeText("Résumé approved – 東京", "UTF-8", null)
);
```

Kenapa? Karena `setSubject` memahami konteks subject dan akan mengatur header dengan benar.

### 6.2 Untuk Display Name

Prefer:

```java
InternetAddress from = new InternetAddress(
    "noreply@example.com",
    "Biro Layanan 東京",
    StandardCharsets.UTF_8.name()
);
message.setFrom(from);
```

Jangan merangkai sendiri:

```java
message.setHeader("From", "Biro Layanan 東京 <noreply@example.com>");
```

### 6.3 Untuk Custom Header Text

Jika custom header memang text dan perlu non-ASCII, pertimbangkan ulang dulu. Banyak custom header sebaiknya ASCII-only untuk interoperability.

Lebih aman:

```java
message.setHeader("X-Notification-Type", "CASE_APPROVED");
message.setHeader("X-Correlation-Id", correlationId);
```

Hindari:

```java
message.setHeader("X-User-Display-Name", "José 東京");
```

Jika memang harus, encode dengan benar dan test dengan real mail clients.

---

## 7. Subject Unicode: Praktik Aman

### 7.1 Rule Praktis

Untuk outbound email modern:

```java
message.setSubject(subject, StandardCharsets.UTF_8.name());
```

Buat subject sebagai Unicode domain string, bukan pre-encoded string.

Salah:

```java
String subject = "=?UTF-8?B?UmVzdW3DqQ==?=";
message.setSubject(subject, "UTF-8");
```

Ini bisa menghasilkan double encoding atau subject literal yang terlihat aneh.

### 7.2 Subject Sanitization

Subject berasal dari template dan data domain. Jangan izinkan newline.

```java
public final class MailHeaderSanitizer {
    public static String singleLineHeaderValue(String value) {
        if (value == null) {
            return "";
        }
        String trimmed = value.trim();
        if (trimmed.indexOf('\r') >= 0 || trimmed.indexOf('\n') >= 0) {
            throw new IllegalArgumentException("Header value must not contain CR/LF");
        }
        return trimmed;
    }
}
```

Lalu:

```java
message.setSubject(
    MailHeaderSanitizer.singleLineHeaderValue(subject),
    StandardCharsets.UTF_8.name()
);
```

### 7.3 Emoji di Subject

Secara teknis emoji bisa di-encode sebagai UTF-8 encoded-word. Tetapi secara product/enterprise:

- bisa meningkatkan spam suspicion untuk transactional mail;
- bisa tidak cocok dengan regulatory-grade communication;
- bisa dirender berbeda;
- bisa terpotong dalam mobile notification.

Rule enterprise konservatif:

```text
Transactional/regulatory: avoid emoji in subject.
Marketing/engagement: allowed only with brand/testing approval.
```

---

## 8. Display Name Internationalization

Email address terdiri dari dua bagian konsep:

```text
Display Name <addr-spec>
```

Contoh:

```text
"Biro Layanan 東京" <noreply@example.com>
```

Display name boleh di-encode sebagai header text. Address syntax punya constraint sendiri.

### 8.1 Outbound Address Builder

```java
public final class MailAddresses {
    private MailAddresses() {}

    public static InternetAddress mailbox(String email, String displayName) {
        try {
            InternetAddress address = new InternetAddress(
                email,
                displayName,
                StandardCharsets.UTF_8.name()
            );
            address.validate();
            return address;
        } catch (UnsupportedEncodingException | AddressException e) {
            throw new IllegalArgumentException("Invalid email address", e);
        }
    }
}
```

Usage:

```java
message.setFrom(MailAddresses.mailbox(
    "noreply@example.com",
    "Biro Layanan 東京"
));
```

### 8.2 Jangan Gabungkan Manual

Salah:

```java
String from = displayName + " <" + email + ">";
message.setHeader("From", from);
```

Masalah:

- display name perlu quote/escape;
- non-ASCII perlu encoded-word;
- special character seperti comma bisa merusak parsing;
- CR/LF injection risk;
- invalid address tidak tervalidasi.

### 8.3 Display Name dengan Comma

Contoh nama organisasi:

```text
CEA, Licensing Division <noreply@example.com>
```

Harus diquote/encode dengan benar. API `InternetAddress` menangani lebih aman dibanding manual string concatenation.

---

## 9. Internationalized Domain Name: IDN dan Punycode

Alamat seperti:

```text
user@bücher.example
```

punya domain non-ASCII. Untuk banyak sistem, domain dikonversi ke ASCII-compatible form:

```text
user@xn--bcher-kva.example
```

Java menyediakan `java.net.IDN`.

```java
String asciiDomain = IDN.toASCII("bücher.example");
String email = "user@" + asciiDomain;
```

### 9.1 Domain vs Local-Part

Penting: `IDN.toASCII` hanya untuk domain, bukan seluruh email.

Salah:

```java
IDN.toASCII("用户@例子.公司"); // salah konsep
```

Benar secara layer:

```java
String localPart = "user";
String domain = IDN.toASCII("例子.公司");
String address = localPart + "@" + domain;
```

### 9.2 Local-Part Unicode Butuh SMTPUTF8

Alamat ini:

```text
用户@example.com
```

bukan sekadar perlu Punycode. Local-part `用户` tidak bisa diubah dengan IDN. Itu butuh EAI/SMTPUTF8 support.

---

## 10. SMTPUTF8 dan EAI: Kapan Unicode Address Bisa Dikirim?

SMTPUTF8 adalah extension SMTP untuk internationalized email address dan header information.

Jika penerima:

```text
用户@example.com
```

maka sistem harus memastikan jalur SMTP support `SMTPUTF8`.

### 10.1 SMTP Capability

SMTP server mengiklankan capability saat `EHLO`:

```text
250-smtp.example.com
250-STARTTLS
250-AUTH PLAIN LOGIN
250-SMTPUTF8
250 SIZE 35882577
```

Jika tidak ada `SMTPUTF8`, pengiriman alamat local-part Unicode tidak aman/valid.

### 10.2 Rule Praktis Enterprise

Untuk transactional/regulatory systems:

```text
Default: support ASCII local-part only.
Allow IDN domain via IDNA/Punycode if tested.
Allow SMTPUTF8 recipient only if provider, relay, bounce processing, and downstream support are verified.
```

### 10.3 Validation Policy

Buat policy eksplisit:

```java
public enum InternationalAddressPolicy {
    ASCII_ONLY,
    ASCII_LOCAL_PART_ALLOW_IDN_DOMAIN,
    SMTPUTF8_ALLOWED
}
```

Lalu validator:

```java
public final class EmailAddressPolicyValidator {
    public static void validate(String email, InternationalAddressPolicy policy) {
        int at = email.lastIndexOf('@');
        if (at <= 0 || at == email.length() - 1) {
            throw new IllegalArgumentException("Invalid email address");
        }

        String local = email.substring(0, at);
        String domain = email.substring(at + 1);

        switch (policy) {
            case ASCII_ONLY -> {
                requireAscii(local, "local-part");
                requireAscii(domain, "domain");
            }
            case ASCII_LOCAL_PART_ALLOW_IDN_DOMAIN -> {
                requireAscii(local, "local-part");
                IDN.toASCII(domain); // throws on invalid domain
            }
            case SMTPUTF8_ALLOWED -> {
                // Still validate syntax and provider support elsewhere.
                IDN.toASCII(domain);
            }
            default -> throw new IllegalStateException("Unknown policy");
        }
    }

    private static void requireAscii(String s, String field) {
        for (int i = 0; i < s.length(); i++) {
            if (s.charAt(i) > 0x7F) {
                throw new IllegalArgumentException(field + " must be ASCII");
            }
        }
    }
}
```

Untuk Java 8, switch expression perlu diganti switch statement klasik.

---

## 11. MIME Parameter Encoding: Filename Attachment Non-ASCII

Attachment filename adalah salah satu sumber bug terbesar.

Contoh filename:

```text
Laporan résumé 東京 2026.pdf
```

Header ideal menggunakan parameter encoding:

```text
Content-Disposition: attachment;
 filename*=UTF-8''Laporan%20r%C3%A9sum%C3%A9%20%E6%9D%B1%E4%BA%AC%202026.pdf
```

Untuk filename panjang, parameter bisa di-split:

```text
Content-Disposition: attachment;
 filename*0*=UTF-8''very-long-%E6%9D%B1%E4%BA%AC-;
 filename*1*=%E6%96%87%E4%BB%B6-name.pdf
```

### 11.1 Dengan Jakarta Mail

Prefer:

```java
MimeBodyPart attachment = new MimeBodyPart();
attachment.setDataHandler(new DataHandler(dataSource));
attachment.setFileName("Laporan résumé 東京 2026.pdf");
```

Jangan manual set header kecuali benar-benar perlu.

### 11.2 Compatibility Properties

Dalam ekosistem JavaMail/Jakarta Mail, ada beberapa property MIME yang sering relevan untuk filename interop, misalnya encoding/decoding filename dan parameter. Nama dan perilaku detail dapat berbeda antar versi/implementation, jadi harus diverifikasi terhadap implementation yang dipakai.

Contoh konfigurasi yang sering ditemukan:

```java
Properties props = new Properties();
props.put("mail.mime.encodeparameters", "true");
props.put("mail.mime.decodeparameters", "true");
props.put("mail.mime.encodefilename", "true");
props.put("mail.mime.decodefilename", "true");
```

Namun ada nuance penting:

- `encodeparameters`/`decodeparameters` lebih dekat ke RFC 2231 parameter encoding;
- `encodefilename`/`decodefilename` sering dipakai untuk interoperabilitas dengan client yang menggunakan encoded-word pada filename, meskipun itu tidak ideal menurut MIME parameter rule;
- jangan blindly enable tanpa integration test dengan mail clients target.

### 11.3 Safe Filename Policy

Walaupun filename bisa Unicode, tetap harus disanitasi.

```java
public final class AttachmentFileNames {
    public static String safeDisplayFileName(String input) {
        if (input == null || input.isBlank()) {
            return "attachment";
        }

        String normalized = java.text.Normalizer.normalize(
            input,
            java.text.Normalizer.Form.NFC
        );

        String noControls = normalized
            .replace('\r', '_')
            .replace('\n', '_')
            .replace('\t', ' ');

        // Remove common path separators and dangerous shell-ish chars.
        String safe = noControls.replaceAll("[\\\\/:*?\"<>|]", "_").trim();

        if (safe.isEmpty()) {
            return "attachment";
        }

        if (safe.length() > 180) {
            safe = safe.substring(0, 180).trim();
        }

        return safe;
    }
}
```

Rationale:

- filename attachment adalah display name, bukan trusted filesystem path;
- jangan preserve slash/path;
- jangan izinkan CR/LF;
- normalize Unicode agar comparison/logging lebih konsisten;
- batasi panjang.

---

## 12. Unicode Normalization: Karakter Sama, Byte Berbeda

Unicode punya beberapa cara merepresentasikan karakter yang tampak sama.

Contoh `é`:

```text
U+00E9 LATIN SMALL LETTER E WITH ACUTE
```

atau:

```text
U+0065 LATIN SMALL LETTER E
U+0301 COMBINING ACUTE ACCENT
```

Secara visual sama, tetapi byte UTF-8 berbeda.

### 12.1 Kenapa Penting untuk Mail?

- filename deduplication;
- audit search;
- template variable comparison;
- security review;
- user support investigation;
- hash/correlation value jika memakai normalized text.

### 12.2 Rekomendasi

Gunakan NFC untuk display strings yang akan dimasukkan ke email.

```java
String normalized = Normalizer.normalize(value, Normalizer.Form.NFC);
```

Tapi jangan normalize blindly untuk cryptographic identifiers, token, signature, atau data yang harus byte-exact.

---

## 13. Body Charset: Plain Text dan HTML

### 13.1 Plain Text

```java
MimeBodyPart text = new MimeBodyPart();
text.setText("Halo José, pembayaran disetujui.", StandardCharsets.UTF_8.name());
```

Ini menghasilkan text part dengan charset yang sesuai.

### 13.2 HTML

Untuk HTML, jangan hanya:

```java
message.setContent(html, "text/html"); // charset bisa ambigu
```

Lebih eksplisit:

```java
message.setContent(html, "text/html; charset=UTF-8");
```

Atau body part:

```java
MimeBodyPart htmlPart = new MimeBodyPart();
htmlPart.setContent(html, "text/html; charset=UTF-8");
```

### 13.3 HTML Meta Charset Tidak Cukup

HTML email sebaiknya punya:

```html
<meta charset="UTF-8">
```

Tetapi MIME `Content-Type` tetap authoritative untuk email transport. Jangan mengandalkan meta tag saja.

Benar:

```text
Content-Type: text/html; charset=UTF-8
```

plus:

```html
<meta charset="UTF-8">
```

---

## 14. Content-Transfer-Encoding: 7bit, 8bit, Quoted-Printable, Base64, Binary

MIME body punya header:

```text
Content-Transfer-Encoding: quoted-printable
```

atau:

```text
Content-Transfer-Encoding: base64
```

### 14.1 7bit

Hanya ASCII safe. Cocok untuk body ASCII sederhana.

### 14.2 8bit

Memungkinkan byte non-ASCII. Tetapi tidak semua transport path historis aman. Di sistem modern biasanya lebih aman, tapi untuk compatibility enterprise, quoted-printable/base64 sering dipakai oleh library.

### 14.3 Quoted-Printable

Cocok untuk text yang sebagian besar ASCII dengan sedikit non-ASCII.

Contoh:

```text
R=C3=A9sum=C3=A9 approved
```

Kelebihan:

- masih relatif readable;
- efisien untuk text Latin dengan beberapa karakter aksen.

Kekurangan:

- long line wrapping harus benar;
- HTML bisa terlihat verbose.

### 14.4 Base64

Cocok untuk binary attachment atau text dengan banyak non-ASCII.

Kelebihan:

- aman untuk arbitrary bytes;
- predictable.

Kekurangan:

- tidak readable;
- overhead ukuran sekitar 33%;
- untuk text email bisa mengganggu debugging manual.

### 14.5 Binary

Jarang dipakai untuk email transport biasa. Jangan assume aman.

### 14.6 Prinsip Praktis

Biasanya biarkan Jakarta Mail memilih transfer encoding. Intervensi hanya jika:

- ada interoperability issue yang terbukti;
- compliance/test mengharuskan format tertentu;
- provider/client target punya bug spesifik.

---

## 15. Header Folding: Header Panjang Harus Dipecah dengan Benar

Header email punya batas panjang practical. Header panjang harus difold:

```text
Subject: =?UTF-8?B?...?=
 =?UTF-8?B?...?=
```

Continuation line dimulai whitespace.

### 15.1 Jangan Fold Manual Sembarangan

Salah:

```java
message.setHeader("Subject", longSubject.substring(0, 70) + "\r\n " + longSubject.substring(70));
```

Risiko:

- memotong encoded-word di tengah;
- header injection;
- invalid CRLF;
- rendering aneh.

Prefer high-level API:

```java
message.setSubject(longSubject, "UTF-8");
```

### 15.2 Batasi Panjang Subject Secara Product

Walaupun MIME bisa fold, user experience buruk jika subject terlalu panjang.

Rekomendasi enterprise:

```text
Hard technical max: enforce no CR/LF, reasonable length, e.g. 200–250 chars.
UX recommended: 60–100 chars depending notification type.
```

---

## 16. Advanced Address Validation: Apa yang Sebaiknya Tidak Dilakukan

Email address syntax sangat kompleks. Banyak regex internet populer salah.

### 16.1 Jangan Pakai Regex “Sempurna”

Salah arah:

```java
Pattern.compile("^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$")
```

Regex ini:

- menolak beberapa alamat valid;
- menerima beberapa alamat invalid;
- tidak menangani IDN;
- tidak menjawab deliverability;
- tidak menjawab mailbox exists.

### 16.2 Layered Validation

Lebih baik:

```text
Layer 1: trim + reject CR/LF/control
Layer 2: parse with InternetAddress strict enough
Layer 3: enforce product policy ASCII/IDN/SMTPUTF8
Layer 4: optional domain validation/MX check outside request path
Layer 5: bounce feedback loop untuk truth over time
```

### 16.3 Example Validator

```java
public final class RecipientAddressValidator {
    public static InternetAddress parseRecipient(
        String raw,
        InternationalAddressPolicy policy
    ) {
        if (raw == null || raw.isBlank()) {
            throw new IllegalArgumentException("Recipient email is required");
        }
        if (containsControlOrCrlf(raw)) {
            throw new IllegalArgumentException("Recipient email contains illegal control characters");
        }

        String trimmed = raw.trim();
        EmailAddressPolicyValidator.validate(trimmed, policy);

        try {
            InternetAddress address = new InternetAddress(trimmed, true);
            address.validate();
            return address;
        } catch (AddressException e) {
            throw new IllegalArgumentException("Invalid recipient email", e);
        }
    }

    private static boolean containsControlOrCrlf(String value) {
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            if (c == '\r' || c == '\n' || Character.isISOControl(c)) {
                return true;
            }
        }
        return false;
    }
}
```

Catatan Java 8: `String.isBlank()` tidak tersedia; gunakan `trim().isEmpty()`.

---

## 17. SMTPUTF8 Failure Modelling

Jika sistem mendukung SMTPUTF8, failure model harus jelas.

### 17.1 Capability Tidak Didukung

State:

```text
FAILED_PERMANENT / ADDRESS_NOT_SUPPORTED_BY_SMTP_RELAY
```

Bukan retry terus-menerus.

### 17.2 Provider Mendukung, Recipient MX Tidak

Jika provider menerima message via API/SMTP tetapi downstream gagal, bounce bisa datang belakangan.

State awal:

```text
SENT_TO_PROVIDER
```

Lalu bounce:

```text
BOUNCED_PERMANENT / SMTPUTF8_NOT_SUPPORTED_DOWNSTREAM
```

### 17.3 Product Decision

Untuk government/regulatory system, sering lebih defensible untuk fase awal:

```text
Reject non-ASCII local-part during recipient registration or notification enrollment.
Allow Unicode display names and message content.
Allow IDN domain only if explicitly tested.
```

---

## 18. Inbound: Decoding Subject, From, Filename, Body

Outbound lebih mudah karena kita memilih format. Inbound lebih sulit karena email dari luar bisa malformed.

### 18.1 Subject

```java
String subject = message.getSubject();
```

High-level API biasanya decode encoded-word.

Tapi tetap sanitize sebelum display/logging:

```java
String safeSubject = HeaderDisplay.sanitizeForUi(subject);
```

### 18.2 From Display Name

```java
Address[] from = message.getFrom();
for (Address address : from) {
    if (address instanceof InternetAddress ia) {
        String email = ia.getAddress();
        String personal = ia.getPersonal();
    }
}
```

Java 8 variant:

```java
if (address instanceof InternetAddress) {
    InternetAddress ia = (InternetAddress) address;
    String email = ia.getAddress();
    String personal = ia.getPersonal();
}
```

### 18.3 Filename

```java
String fileName = part.getFileName();
String safeFileName = AttachmentFileNames.safeDisplayFileName(fileName);
```

Jangan gunakan filename inbound sebagai path.

Salah:

```java
Path target = uploadDir.resolve(part.getFileName());
```

Benar:

```java
Path target = uploadDir.resolve(UUID.randomUUID() + ".bin");
```

Simpan original filename sebagai metadata display setelah sanitasi.

### 18.4 Body Charset Tidak Selalu Benar

Inbound email bisa mengklaim:

```text
Content-Type: text/plain; charset=UTF-8
```

tetapi bytes-nya Windows-1252. Parser bisa gagal atau menghasilkan replacement character.

Policy:

- simpan raw message jika perlu forensic;
- parse best effort;
- jangan crash worker hanya karena satu malformed message;
- tandai `PARSE_WARNING_CHARSET_MISMATCH`;
- batasi size;
- jangan menampilkan raw HTML tanpa sanitization.

---

## 19. Robust MIME Tree Traversal dengan Internationalization Awareness

Parsing body harus mempertimbangkan charset, filename, disposition, dan nesting.

```java
public final class MimeTreeExtractor {
    public ExtractedMail extract(Message message) throws MessagingException, IOException {
        ExtractedMail result = new ExtractedMail();
        walkPart(message, result, 0);
        return result;
    }

    private void walkPart(Part part, ExtractedMail result, int depth)
        throws MessagingException, IOException {

        if (depth > 30) {
            result.addWarning("MIME tree too deep");
            return;
        }

        if (part.isMimeType("text/plain")) {
            Object content = part.getContent();
            if (content instanceof String text) {
                result.addPlainText(text);
            }
            return;
        }

        if (part.isMimeType("text/html")) {
            Object content = part.getContent();
            if (content instanceof String html) {
                result.addHtml(html);
            }
            return;
        }

        if (part.isMimeType("multipart/*")) {
            Multipart multipart = (Multipart) part.getContent();
            for (int i = 0; i < multipart.getCount(); i++) {
                walkPart(multipart.getBodyPart(i), result, depth + 1);
            }
            return;
        }

        if (Part.ATTACHMENT.equalsIgnoreCase(part.getDisposition()) || part.getFileName() != null) {
            result.addAttachmentMetadata(
                AttachmentFileNames.safeDisplayFileName(part.getFileName()),
                part.getContentType()
            );
            return;
        }

        result.addWarning("Unsupported MIME part: " + part.getContentType());
    }
}
```

Java 8 perlu mengganti pattern matching `instanceof`.

### 19.1 Jangan Percaya `isMimeType` Saja untuk Security

`Content-Type` bisa bohong:

```text
Content-Type: image/png
filename="invoice.pdf.exe"
```

Security pipeline harus punya:

- magic byte sniffing;
- extension allowlist;
- antivirus scan;
- size limit;
- decompression limit;
- storage quarantine.

---

## 20. Encoding Attachment Content vs Encoding Filename

Dua hal berbeda:

```text
Attachment content: bytes PDF
Attachment filename: metadata text
```

PDF bytes biasanya base64.

Filename Unicode pakai parameter encoding.

Jangan mencampur:

```java
// Salah: meng-base64 nama file sendiri bukan solusi MIME parameter.
String encodedFileName = Base64.getEncoder().encodeToString(fileName.getBytes(UTF_8));
attachment.setFileName(encodedFileName);
```

Benar:

```java
attachment.setDataHandler(new DataHandler(dataSource));
attachment.setFileName(fileName);
```

Biarkan library encode sesuai konteks.

---

## 21. Content-Language dan Localization Metadata

Untuk email multi bahasa, body content bukan hanya charset. Kadang perlu metadata language.

Header yang bisa dipertimbangkan:

```text
Content-Language: id-ID
```

Atau untuk multipart alternative:

```text
Content-Type: text/html; charset=UTF-8
Content-Language: ja-JP
```

Namun jangan over-engineer. Biasanya language tracking lebih baik ada di domain notification metadata:

```text
notification.locale = id-ID
notification.templateVersion = CASE_APPROVED.v3.id-ID
```

Mail header language adalah tambahan, bukan sumber utama audit.

---

## 22. Template Internationalization vs MIME Internationalization

Jangan campur dua konsep:

| Concern | Layer |
|---|---|
| Pilih bahasa template | Domain/application layer |
| Format tanggal/angka/mata uang | Localization layer |
| Escape HTML | Template rendering layer |
| Encode subject/header | Jakarta Mail/MIME layer |
| Charset body | MIME layer |
| SMTPUTF8 support | SMTP/provider layer |

Contoh pipeline benar:

```text
Domain event
  -> select locale/template
  -> render Unicode subject/plain/html
  -> validate/sanitize header text
  -> build MimeMessage with UTF-8
  -> send through provider with known address policy
```

Jangan render template sebagai pre-encoded MIME.

Salah:

```text
Template menghasilkan: =?UTF-8?B?...?=
```

Benar:

```text
Template menghasilkan: Pembayaran disetujui – 東京
Jakarta Mail meng-encode header.
```

---

## 23. Date, Number, Currency, dan Locale dalam Email

Internationalization email sering gagal bukan karena Unicode, tetapi karena format data.

### 23.1 Date

Salah:

```text
Your appointment is on 03/04/2026.
```

Ambigu: 3 April atau 4 March?

Lebih baik:

```text
Your appointment is on 3 April 2026.
```

Atau lokal:

```text
Janji temu Anda pada 3 April 2026.
```

### 23.2 Time Zone

Email regulatory harus jelas time zone.

```text
18 June 2026, 09:30 SGT
```

atau:

```text
18 June 2026, 08:30 WIB (UTC+07:00)
```

### 23.3 Currency

Jangan hanya:

```text
$100
```

Jika multi-country:

```text
SGD 100.00
USD 100.00
IDR 100,000
```

### 23.4 Java Formatter

```java
Locale locale = Locale.forLanguageTag("id-ID");
NumberFormat currency = NumberFormat.getCurrencyInstance(locale);
currency.setCurrency(Currency.getInstance("IDR"));

String amount = currency.format(new BigDecimal("1500000"));
```

Untuk tanggal modern gunakan `java.time`.

```java
DateTimeFormatter formatter = DateTimeFormatter
    .ofPattern("d MMMM uuuu, HH:mm z")
    .withLocale(Locale.forLanguageTag("id-ID"));

String text = formatter.format(zonedDateTime);
```

---

## 24. Charset Defaults: Jangan Mengandalkan Default JVM

Masalah klasik:

```java
byte[] bytes = text.getBytes(); // default charset JVM
```

Di Java 8–17 default charset tergantung environment. Di Java 18+, default charset distandardisasi ke UTF-8 oleh JEP 400, tetapi code enterprise tetap sebaiknya eksplisit agar portable dan jelas.

Benar:

```java
byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
String text = new String(bytes, StandardCharsets.UTF_8);
```

Untuk email:

```java
message.setSubject(subject, StandardCharsets.UTF_8.name());
textPart.setText(plainText, StandardCharsets.UTF_8.name());
htmlPart.setContent(html, "text/html; charset=UTF-8");
```

Rule:

```text
Never rely on platform default charset in mail code.
```

---

## 25. Java 8 hingga 25: Version-Specific Notes

### 25.1 Java 8

- Umumnya legacy stack masih memakai `javax.mail`.
- Tidak ada `String.isBlank()`.
- Tidak ada switch expression.
- Tidak ada records.
- Tidak ada virtual threads.
- Charset default bergantung environment.

### 25.2 Java 11

- Java EE modules tidak lagi bundled seperti era lama.
- Dependency mail/activation harus eksplisit.
- Banyak migration mulai dari sini.

### 25.3 Java 17

- LTS modern yang banyak dipakai enterprise.
- Jakarta namespace migration umum terjadi bersama Spring Boot 3/Jakarta EE 10 stack.

### 25.4 Java 21

- Virtual threads tersedia sebagai fitur final.
- Berguna untuk blocking SMTP worker, tetapi tidak menghapus kebutuhan rate limit, timeout, dan backpressure.

### 25.5 Java 25

- Perlakukan sebagai modern Java runtime: gunakan API eksplisit, structured design, dan hindari reliance pada legacy default.
- Jakarta Mail/Angus dependency tetap perlu dipilih berdasarkan ecosystem version, bukan hanya JDK version.

---

## 26. Cross-Version API Style

Untuk materi seri ini, Java modern code bisa memakai:

```java
if (content instanceof String text) {
    // Java 16+
}
```

Untuk Java 8 compatibility, pakai:

```java
if (content instanceof String) {
    String text = (String) content;
}
```

Untuk immutable data, Java modern:

```java
public record LocalizedSubject(String value, Locale locale) {}
```

Java 8:

```java
public final class LocalizedSubject {
    private final String value;
    private final Locale locale;

    public LocalizedSubject(String value, Locale locale) {
        this.value = Objects.requireNonNull(value);
        this.locale = Objects.requireNonNull(locale);
    }

    public String getValue() {
        return value;
    }

    public Locale getLocale() {
        return locale;
    }
}
```

Core MIME principle sama. Yang berubah hanya style bahasa Java.

---

## 27. Building an Internationalized Mail Composer

### 27.1 Domain Input

```java
public final class InternationalMailRequest {
    private final String fromEmail;
    private final String fromDisplayName;
    private final String recipientEmail;
    private final String recipientDisplayName;
    private final String subject;
    private final String plainText;
    private final String html;
    private final Locale locale;

    // constructor/getters omitted
}
```

### 27.2 Composer

```java
public final class InternationalMimeMessageComposer {
    private final Session session;
    private final InternationalAddressPolicy addressPolicy;

    public InternationalMimeMessageComposer(
        Session session,
        InternationalAddressPolicy addressPolicy
    ) {
        this.session = Objects.requireNonNull(session);
        this.addressPolicy = Objects.requireNonNull(addressPolicy);
    }

    public MimeMessage compose(InternationalMailRequest request)
        throws MessagingException, UnsupportedEncodingException {

        MimeMessage message = new MimeMessage(session);

        InternetAddress from = MailAddresses.mailbox(
            request.getFromEmail(),
            normalizeHeaderText(request.getFromDisplayName())
        );
        message.setFrom(from);

        EmailAddressPolicyValidator.validate(request.getRecipientEmail(), addressPolicy);
        InternetAddress to = new InternetAddress(
            request.getRecipientEmail(),
            normalizeHeaderText(request.getRecipientDisplayName()),
            StandardCharsets.UTF_8.name()
        );
        to.validate();
        message.setRecipient(Message.RecipientType.TO, to);

        message.setSubject(
            MailHeaderSanitizer.singleLineHeaderValue(normalizeHeaderText(request.getSubject())),
            StandardCharsets.UTF_8.name()
        );

        message.setHeader("Content-Language", request.getLocale().toLanguageTag());

        MimeMultipart alternative = new MimeMultipart("alternative");

        MimeBodyPart plain = new MimeBodyPart();
        plain.setText(normalizeBodyText(request.getPlainText()), StandardCharsets.UTF_8.name());
        alternative.addBodyPart(plain);

        MimeBodyPart html = new MimeBodyPart();
        html.setContent(normalizeBodyText(request.getHtml()), "text/html; charset=UTF-8");
        alternative.addBodyPart(html);

        message.setContent(alternative);
        message.saveChanges();

        return message;
    }

    private static String normalizeHeaderText(String value) {
        if (value == null) {
            return "";
        }
        return Normalizer.normalize(value, Normalizer.Form.NFC);
    }

    private static String normalizeBodyText(String value) {
        if (value == null) {
            return "";
        }
        return Normalizer.normalize(value, Normalizer.Form.NFC);
    }
}
```

### 27.3 Design Notes

- Composer menerima Unicode domain strings.
- Composer tidak menerima pre-encoded header.
- Charset selalu eksplisit UTF-8.
- Address policy eksplisit.
- Header text disanitasi CR/LF.
- Locale disimpan sebagai metadata header tambahan dan tetap harus disimpan di domain record.

---

## 28. Testing Internationalization

### 28.1 Test Matrix

Buat test case minimal:

| Case | Subject | Display name | Filename | Body |
|---|---|---|---|---|
| ASCII | `Case approved` | `Admin` | `report.pdf` | English |
| Latin accent | `Résumé approved` | `José Álvarez` | `résumé.pdf` | French/Spanish chars |
| CJK | `申請が承認されました` | `東京支店` | `東京レポート.pdf` | Japanese |
| Arabic/Hebrew | RTL text | RTL display | RTL filename | RTL body |
| Emoji | limited subject/body | name no emoji | filename no emoji | emoji body if allowed |
| Long filename | normal subject | normal name | >150 chars | normal body |
| Combining chars | decomposed accent | decomposed name | decomposed filename | normalized output |

### 28.2 Assert Raw MIME

Integration test dengan fake SMTP:

```java
MimeMessage received = greenMail.getReceivedMessages()[0];
assertEquals("Résumé approved – 東京", received.getSubject());
```

Raw MIME snapshot penting untuk memastikan header encoding benar:

```java
ByteArrayOutputStream out = new ByteArrayOutputStream();
received.writeTo(out);
String raw = out.toString(StandardCharsets.US_ASCII);

assertThat(raw).contains("Subject:");
assertThat(raw).contains("UTF-8");
```

Catatan: raw MIME bisa fold dan encoded text tidak selalu deterministic antar versi library. Snapshot harus cukup toleran.

### 28.3 Test Attachment Filename

```java
MimeBodyPart attachment = new MimeBodyPart();
attachment.setDataHandler(new DataHandler(dataSource));
attachment.setFileName("Laporan résumé 東京.pdf");

assertEquals("Laporan résumé 東京.pdf", attachment.getFileName());
```

Lalu integration test kirim ke fake SMTP dan parse ulang message.

### 28.4 Test Address Policy

```java
assertThrows(IllegalArgumentException.class, () ->
    EmailAddressPolicyValidator.validate(
        "用户@example.com",
        InternationalAddressPolicy.ASCII_LOCAL_PART_ALLOW_IDN_DOMAIN
    )
);

assertDoesNotThrow(() ->
    EmailAddressPolicyValidator.validate(
        "user@例子.公司",
        InternationalAddressPolicy.ASCII_LOCAL_PART_ALLOW_IDN_DOMAIN
    )
);
```

Java 8 JUnit style berbeda, tapi konsep sama.

---

## 29. Internationalization Failure Table

| Symptom | Likely cause | Layer | Fix |
|---|---|---|---|
| Subject terlihat `=?UTF-8?...?=` literal | client/parser decode issue atau double encoding | Header | Jangan pre-encode; pakai `setSubject` |
| Subject jadi `????` | charset salah atau non-Unicode handling | Header/body | Gunakan UTF-8 eksplisit |
| Attachment filename rusak | parameter encoding/client compatibility | MIME parameter | Pakai `setFileName`, enable/test parameter encoding |
| Email gagal ke alamat Unicode | SMTPUTF8 tidak didukung | SMTP/address | Policy reject atau provider support SMTPUTF8 |
| Domain IDN gagal | domain belum Punycode/IDNA | Address/domain | `IDN.toASCII(domain)` |
| HTML body karakter rusak | `Content-Type` tanpa charset | Body MIME | `text/html; charset=UTF-8` |
| Inbound parser crash | malformed MIME/charset | Parser | best-effort parsing + quarantine |
| Header injection | CR/LF dalam subject/name | Security/header | sanitize single-line header values |
| Duplicate-looking filename berbeda | Unicode normalization beda | Application/i18n | normalize NFC for display metadata |
| Raw MIME snapshot flaky | folding/encoding library variation | Test | assert semantic + flexible raw checks |

---

## 30. Production Checklist

### 30.1 Outbound Generation

- [ ] Subject dibuat sebagai Unicode string, bukan pre-encoded MIME.
- [ ] `setSubject(subject, "UTF-8")` digunakan.
- [ ] Display name dibuat via `InternetAddress(email, personal, "UTF-8")`.
- [ ] Header values ditolak jika mengandung CR/LF.
- [ ] HTML memakai `text/html; charset=UTF-8`.
- [ ] Plain text memakai UTF-8.
- [ ] Filename attachment disanitasi dan diset via `setFileName`.
- [ ] Tidak ada manual raw MIME header kecuali benar-benar perlu.
- [ ] Address policy eksplisit: ASCII-only, IDN domain, atau SMTPUTF8.
- [ ] Java default charset tidak dipakai.

### 30.2 Inbound Processing

- [ ] Parser membatasi depth MIME tree.
- [ ] Parser membatasi size message dan attachment.
- [ ] Filename inbound tidak dipakai sebagai filesystem path.
- [ ] Raw message disimpan hanya jika policy/security mengizinkan.
- [ ] Malformed MIME tidak membuat worker mati permanen.
- [ ] Charset mismatch menjadi warning, bukan crash massal.
- [ ] HTML inbound disanitasi sebelum display.

### 30.3 Testing

- [ ] Test subject Unicode.
- [ ] Test display name Unicode.
- [ ] Test filename Unicode.
- [ ] Test long header folding indirectly.
- [ ] Test IDN domain policy.
- [ ] Test non-ASCII local-part rejection/SMTPUTF8 policy.
- [ ] Test fake SMTP round-trip.
- [ ] Test client compatibility untuk target utama.

### 30.4 Operational

- [ ] Log tidak menyimpan raw body sensitif.
- [ ] Log tidak menyimpan full recipient jika policy melarang.
- [ ] Failure SMTPUTF8 diklasifikasi jelas.
- [ ] Bounce untuk internationalized recipient diproses.
- [ ] Support team punya raw message sample yang sudah disanitasi.

---

## 31. Anti-Patterns

### Anti-Pattern 1 — Pre-Encoding Subject di Template

```text
Template output: =?UTF-8?B?...?=
```

Masalah:

- template layer tahu terlalu banyak tentang MIME;
- mudah double encoding;
- sulit preview;
- sulit localization.

Perbaikan:

```text
Template output: human-readable Unicode
Mail layer: MIME encoding
```

### Anti-Pattern 2 — Manual Header Concatenation

```java
message.setHeader("From", displayName + " <" + email + ">");
```

Perbaikan:

```java
message.setFrom(new InternetAddress(email, displayName, "UTF-8"));
```

### Anti-Pattern 3 — Regex Email Validation sebagai Sumber Kebenaran

Regex sederhana tidak cukup untuk email real-world. Gunakan parser, policy, dan feedback loop.

### Anti-Pattern 4 — Menganggap IDN Sama dengan SMTPUTF8

IDN hanya domain. Unicode local-part butuh SMTPUTF8.

### Anti-Pattern 5 — Menggunakan Filename Inbound sebagai Path

Attachment filename adalah untrusted display metadata.

### Anti-Pattern 6 — Mengandalkan Default Charset

```java
text.getBytes()
```

Perbaikan:

```java
text.getBytes(StandardCharsets.UTF_8)
```

### Anti-Pattern 7 — Semua Custom Header Boleh Unicode

Untuk observability/custom metadata, gunakan ASCII stable identifiers.

---

## 32. Architect-Level Invariants

Gunakan invariants berikut saat review mail subsystem:

1. **Application domain menghasilkan Unicode text; MIME layer melakukan encoding.**
2. **Tidak boleh ada pre-encoded MIME string di template.**
3. **Header text selalu single-line sebelum diserahkan ke Jakarta Mail.**
4. **Charset body selalu eksplisit.**
5. **Address internationalization policy harus eksplisit, bukan accidental.**
6. **IDN domain dan SMTPUTF8 local-part adalah concern berbeda.**
7. **Attachment filename adalah metadata tidak tepercaya.**
8. **Inbound MIME parsing harus best-effort dan bounded.**
9. **Default JVM charset tidak boleh menjadi dependency correctness.**
10. **Compatibility dengan client/provider target harus diuji, bukan diasumsikan dari spec.**

---

## 33. Mini Case Study: Regulatory Notification Multi-Language

### Scenario

Sistem regulatory mengirim notifikasi approval ke recipient di beberapa locale:

- English;
- Bahasa Indonesia;
- Japanese;
- recipient display name bisa Unicode;
- attachment filename berisi nomor case dan judul lokal;
- recipient email harus ASCII local-part untuk fase pertama.

### Design

```text
Domain event:
  CaseApproved(caseId, recipientId, locale)

Notification planner:
  select template CASE_APPROVED.v4.<locale>
  resolve recipient preference
  enforce recipient address policy

Renderer:
  subject Unicode
  plain text Unicode
  HTML Unicode
  attachment display filename Unicode

MIME composer:
  UTF-8 subject
  UTF-8 text/html
  sanitized filename
  RFC-compatible MIME parameters via Jakarta Mail

Sender:
  SMTP relay without SMTPUTF8 requirement because local-part ASCII-only

Audit:
  store template version, locale, recipient hash, normalized subject, attachment metadata
```

### Why This Is Strong

- Internationalization is explicit.
- MIME encoding is centralized.
- Address support is not accidental.
- Audit can explain what language/template was used.
- Future SMTPUTF8 support can be added as a deliberate capability upgrade.

---

## 34. What Top 1% Engineers Notice

Average implementation:

```java
message.setSubject(subject);
message.setText(body);
```

Strong implementation:

```java
message.setSubject(subject, "UTF-8");
textPart.setText(plain, "UTF-8");
htmlPart.setContent(html, "text/html; charset=UTF-8");
```

Top-tier implementation asks:

- What is our address internationalization policy?
- Do we support IDN domains?
- Do we support SMTPUTF8 local-parts?
- Are templates generating Unicode or pre-encoded MIME?
- Are filenames sanitized and encoded correctly?
- Do we test Japanese, Arabic, accent, long filename, and malformed inbound samples?
- Are raw MIME snapshots too brittle across library versions?
- Can support/debug investigate without exposing PII?
- Do we classify SMTPUTF8 unsupported as permanent failure?
- Are we relying on default charset anywhere?

That difference is architectural maturity.

---

## 35. Summary

Advanced MIME internationalization is about separating concerns:

```text
Human text        -> Unicode domain string
Header text       -> RFC 2047 / library-managed encoding
MIME parameter    -> RFC 2231 / library-managed parameter encoding
Body text         -> charset + transfer encoding
Binary content    -> transfer encoding, usually base64
Domain IDN        -> IDNA/Punycode
Unicode localpart -> SMTPUTF8 capability
```

For Java/Jakarta Mail systems:

- use high-level APIs first;
- make UTF-8 explicit;
- do not pre-encode templates;
- sanitize header values;
- treat inbound email as untrusted;
- test real international cases;
- document address policy;
- distinguish “valid Unicode text” from “deliverable SMTP address”.

If you internalize this, you stop treating email as string concatenation and start treating it as a protocol artifact with strict layer boundaries.

---

## 36. References

- Jakarta Mail API documentation — `MimeUtility`, `MimeMessage`, `InternetAddress`, MIME APIs.
- Eclipse Angus Mail documentation — modern Jakarta Mail implementation and MIME utility behavior.
- RFC 2047 — MIME Message Header Extensions for Non-ASCII Text.
- RFC 2231 — MIME Parameter Value and Encoded Word Extensions.
- RFC 6531 — SMTP Extension for Internationalized Email.
- RFC 6532 — Internationalized Email Headers.
- Java `java.net.IDN` documentation.
- Java `java.text.Normalizer` documentation.
