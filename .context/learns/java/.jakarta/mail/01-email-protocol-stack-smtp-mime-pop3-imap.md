# Part 1 — Email Protocol Stack: SMTP, MIME, POP3, IMAP

> Series: `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery`  
> File: `01-email-protocol-stack-smtp-mime-pop3-imap.md`  
> Scope: Java 8–25, JavaMail `javax.mail`, Jakarta Mail `jakarta.mail`, SMTP, MIME, POP3, IMAP, TLS, envelope/header/body mental model.

---

## 0. Tujuan Part Ini

Di Part 0 kita membangun mental model besar: **email adalah distributed system**, bukan sekadar API call `send()`.

Part ini masuk satu level lebih rendah: **protokol dan format**.

Tujuannya bukan menjadikan kita “hafal RFC”, tetapi membuat kita bisa membaca, men-debug, dan mendesain mail system dengan benar. Banyak bug email di production terjadi karena engineer mencampur-adukkan hal-hal ini:

- SMTP envelope vs email header.
- `MAIL FROM` vs `From`.
- `RCPT TO` vs `To`/`Cc`/`Bcc`.
- SMTP accepted vs email delivered.
- MIME body vs attachment.
- HTML email vs multipart email.
- SMTP submission vs SMTP relay.
- STARTTLS vs implicit TLS.
- POP3 download vs IMAP mailbox synchronization.
- JavaMail/Jakarta Mail API object vs actual protocol semantics.

Seorang engineer yang kuat tidak melihat email seperti ini:

```java
Transport.send(message);
```

Ia melihat pipeline seperti ini:

```text
Application
  -> message construction
  -> MIME serialization
  -> SMTP submission
  -> SMTP relay chain
  -> recipient MX
  -> spam/content filtering
  -> mailbox delivery
  -> recipient client rendering
```

Dan setiap panah punya failure mode sendiri.

---

## 1. Peta Besar Email Stack

Secara konseptual, email modern terdiri dari beberapa layer:

```text
+--------------------------------------------------------------+
| Application / Business Notification Layer                    |
| - invoice sent                                               |
| - password reset                                             |
| - case escalation                                            |
| - regulatory notice                                          |
+--------------------------------------------------------------+
| Java Mail Abstraction Layer                                  |
| - JavaMail / Jakarta Mail                                    |
| - Session, Message, MimeMessage, Transport, Store, Folder     |
| - DataHandler, DataSource via Activation                     |
+--------------------------------------------------------------+
| Message Format Layer                                         |
| - RFC 5322 Internet Message Format                           |
| - Headers: From, To, Subject, Date, Message-ID                |
| - Body                                                       |
+--------------------------------------------------------------+
| MIME Layer                                                   |
| - text/plain                                                 |
| - text/html                                                  |
| - multipart/alternative                                      |
| - multipart/mixed                                            |
| - multipart/related                                          |
| - attachment encoding                                        |
+--------------------------------------------------------------+
| Transport / Access Protocol Layer                            |
| - SMTP / Submission / SMTPS                                  |
| - IMAP                                                       |
| - POP3                                                       |
+--------------------------------------------------------------+
| Security / Authentication Layer                              |
| - TLS / STARTTLS / implicit TLS                              |
| - SASL / username-password / OAuth2                          |
| - SPF / DKIM / DMARC ecosystem                               |
+--------------------------------------------------------------+
| Mail Infrastructure                                          |
| - SMTP relay                                                 |
| - MTA                                                        |
| - DNS MX                                                     |
| - mailbox provider                                           |
| - spam filter                                                |
+--------------------------------------------------------------+
```

Jakarta Mail berada di layer abstraction. Ia membantu aplikasi Java membuat message, mengirim via SMTP, membaca mailbox via IMAP/POP3, dan memproses MIME. Tetapi Jakarta Mail tidak menghapus realitas protokol di bawahnya.

Kalau SMTP server menolak recipient, Jakarta Mail hanya bisa melaporkan error. Kalau recipient provider menerima SMTP tetapi menaruh email di spam, Jakarta Mail tidak otomatis tahu. Kalau HTML email rusak di Outlook, Jakarta Mail tidak bisa memperbaiki desain HTML kita.

---

## 2. Empat Konsep yang Harus Dipisahkan

Sebelum masuk SMTP/MIME/IMAP/POP3, pisahkan dulu empat konsep ini.

| Konsep | Pertanyaan utama | Contoh |
|---|---|---|
| Envelope | Bagaimana email dikirim antar server? | `MAIL FROM`, `RCPT TO` |
| Headers | Metadata yang terlihat/terpakai oleh mail client | `From`, `To`, `Subject`, `Message-ID` |
| Body | Isi pesan yang dibaca user | plain text, HTML |
| Transport/access protocol | Cara mengirim atau mengambil email | SMTP, IMAP, POP3 |

Analogi fisik:

```text
Amplop fisik:
  alamat pengirim logistik   -> SMTP envelope sender
  alamat tujuan logistik      -> SMTP envelope recipient

Surat di dalam amplop:
  kop surat / metadata        -> message headers
  isi surat                   -> body
  lampiran                    -> MIME parts
```

Kesalahan klasik adalah menganggap `From` header sama dengan `MAIL FROM`. Mereka berbeda.

---

## 3. SMTP: Protocol untuk Mengirim Email

SMTP adalah protokol utama untuk **mengirim** email. Dalam konteks aplikasi Java, SMTP biasanya dipakai untuk menyerahkan email dari aplikasi ke SMTP relay/provider.

```text
Java application
  -> SMTP submission server / relay
  -> recipient mail exchanger(s)
  -> mailbox provider
```

SMTP bukan protokol untuk membaca inbox. Untuk membaca inbox, biasanya IMAP atau POP3.

### 3.1 SMTP sebagai Push Protocol

SMTP bersifat push. Client aktif membuka koneksi ke server dan menyerahkan pesan.

```text
Client: saya punya pesan untuk dikirim
Server: silakan
Client: pengirim envelope ini
Server: ok
Client: recipient ini
Server: ok / rejected
Client: ini data message-nya
Server: accepted / rejected
```

Ini berbeda dari IMAP/POP3, di mana client mengambil atau menyinkronkan pesan dari mailbox.

### 3.2 SMTP Bukan “Delivery Guarantee”

Ketika SMTP relay menjawab sukses, artinya biasanya:

```text
Server SMTP menerima tanggung jawab untuk memproses pesan berikutnya.
```

Bukan berarti:

```text
Recipient sudah membaca email.
Recipient sudah menerima di inbox.
Email tidak masuk spam.
Email tidak akan bounce nanti.
```

Ini sangat penting untuk domain bisnis.

Dalam sistem regulatory/case management, status `EMAIL_SENT` sering misleading. Lebih aman membedakan:

```text
GENERATED
QUEUED
SUBMITTING
ACCEPTED_BY_SMTP
BOUNCED
DELIVERED_IF_PROVIDER_CONFIRMS
FAILED_RETRYABLE
FAILED_PERMANENT
```

Jakarta Mail bisa membantu sampai tahap “submitted/accepted by SMTP”. Setelah itu, delivery feedback membutuhkan bounce mailbox, webhook provider, log provider, atau integration lain.

---

## 4. SMTP Transaction Lifecycle

SMTP transaction secara sederhana dapat divisualkan seperti ini:

```text
TCP connect
  -> server greeting
  -> EHLO / HELO
  -> optional STARTTLS
  -> optional AUTH
  -> MAIL FROM
  -> RCPT TO one or more times
  -> DATA
  -> message headers + body
  -> end with <CRLF>.<CRLF>
  -> server final response
  -> QUIT
```

Contoh transcript konseptual:

```text
S: 220 smtp.example.com ESMTP ready
C: EHLO app.example.com
S: 250-smtp.example.com
S: 250-STARTTLS
S: 250-AUTH PLAIN LOGIN
S: 250 SIZE 35882577
C: STARTTLS
S: 220 Ready to start TLS

[TLS handshake happens]

C: EHLO app.example.com
S: 250-smtp.example.com
S: 250-AUTH PLAIN LOGIN
C: AUTH PLAIN ******
S: 235 Authentication successful
C: MAIL FROM:<bounce@example.com>
S: 250 Sender accepted
C: RCPT TO:<user@example.net>
S: 250 Recipient accepted
C: DATA
S: 354 End data with <CR><LF>.<CR><LF>
C: From: Notification <no-reply@example.com>
C: To: User <user@example.net>
C: Subject: Your Case Has Been Updated
C: Date: Tue, 16 Jun 2026 10:00:00 +0700
C: Message-ID: <abc123@example.com>
C:
C: Hello, your case has been updated.
C: .
S: 250 Message accepted for delivery
C: QUIT
S: 221 Bye
```

Perhatikan ada dua level alamat:

```text
MAIL FROM:<bounce@example.com>       -> envelope sender
From: Notification <no-reply@...>    -> visible header sender

RCPT TO:<user@example.net>           -> envelope recipient
To: User <user@example.net>          -> visible header recipient
```

Mereka bisa sama, tetapi tidak wajib sama.

---

## 5. Envelope vs Header: Sumber Banyak Bug Production

### 5.1 Envelope Sender

Envelope sender adalah alamat yang digunakan SMTP untuk routing error/bounce.

Dalam SMTP transaction:

```text
MAIL FROM:<bounce@example.com>
```

Ini bukan selalu alamat yang dilihat user di email client.

Envelope sender sering dipakai untuk:

- bounce handling,
- SPF alignment,
- provider tracking,
- VERP,
- return-path,
- suppression management.

### 5.2 Header From

Header `From` adalah identitas pengirim yang terlihat di email client.

```text
From: ACEAS Notification <no-reply@example.com>
```

Ini dipakai oleh:

- user interface email client,
- DMARC alignment,
- filtering,
- trust perception,
- reply behavior bersama `Reply-To`.

### 5.3 Envelope Recipient

Envelope recipient dikirim via:

```text
RCPT TO:<actual-recipient@example.net>
```

Ini adalah tujuan delivery SMTP.

### 5.4 Header To/Cc/Bcc

Header `To` dan `Cc` terlihat di pesan. `Bcc` berbeda: Bcc dipakai saat pengiriman, tetapi biasanya tidak ditulis sebagai header visible di message final.

Ini menciptakan beberapa edge case:

| Kasus | Implikasi |
|---|---|
| `RCPT TO` ada, tapi `To` kosong | Email tetap bisa terkirim, tapi terlihat aneh |
| `To` berisi A, `RCPT TO` berisi B | B menerima email yang terlihat ditujukan ke A |
| Bcc recipient | Ada di envelope, tidak terlihat di header |
| Mailing list | Envelope recipient bisa berbeda dari visible header |

### 5.5 Java/Jakarta Mail Mapping

Di Jakarta Mail, kita sering menulis:

```java
message.setFrom(new InternetAddress("no-reply@example.com", "Notification"));
message.setRecipients(Message.RecipientType.TO, "user@example.net");
Transport.send(message);
```

Itu terlihat seperti hanya header operation. Tetapi ketika `Transport.send()` dipanggil, implementation akan menggunakan recipients dari message untuk SMTP `RCPT TO`, kecuali kita override recipient/envelope behavior dengan konfigurasi/provider-specific API.

Artinya: API tampak object-oriented, tetapi efek akhirnya tetap SMTP transaction.

---

## 6. SMTP Response Codes: Membaca Bahasa Server

SMTP server menjawab dengan status code tiga digit.

Secara mental model:

| Kode | Makna umum | Treatment umum |
|---|---|---|
| 2xx | Success | lanjut / mark accepted |
| 3xx | Intermediate | lanjutkan step berikutnya |
| 4xx | Temporary failure | retry dengan backoff |
| 5xx | Permanent failure | jangan retry kecuali ada alasan khusus |

Contoh:

```text
250 OK
354 Start mail input
421 Service not available
450 Mailbox unavailable temporarily
451 Local error in processing
452 Insufficient system storage
535 Authentication failed
550 Mailbox unavailable / user unknown
552 Message size exceeded
554 Transaction failed / rejected
```

Namun jangan membuat classifier terlalu naif. Real provider bisa memakai variasi message. Contoh `550` bisa berarti user unknown, policy reject, spam reject, attachment reject, domain issue, atau DMARC failure.

Arsitektur yang baik membuat layer normalisasi:

```text
SMTP raw response
  -> provider-specific parser
  -> normalized failure category
  -> retry policy
  -> business status
```

Contoh domain classification:

```text
AUTH_FAILED                -> permanent until config fixed
RECIPIENT_REJECTED         -> permanent for that recipient
PROVIDER_TEMPORARY_FAILURE -> retryable
RATE_LIMITED               -> retryable with longer backoff
MESSAGE_TOO_LARGE          -> permanent unless content changed
CONTENT_REJECTED           -> usually permanent, needs review
NETWORK_TIMEOUT            -> retryable
TLS_NEGOTIATION_FAILED     -> config/security incident
```

---

## 7. SMTP Submission vs SMTP Relay vs Direct-to-MX

Banyak engineer mencampur istilah “SMTP server”. Ada beberapa peran berbeda.

### 7.1 Mail Submission Server

Ini server tempat application/mail client submit email. Biasanya menggunakan port 587 atau 465 dan membutuhkan authentication.

```text
Application -> submission server
```

Contoh:

```text
app -> smtp.office365.com
app -> smtp.gmail.com
app -> email-smtp.<region>.amazonaws.com
app -> internal corporate relay
```

### 7.2 SMTP Relay

Relay meneruskan email ke server lain. Dalam enterprise, aplikasi biasanya hanya bicara ke relay internal/provider.

```text
Application -> enterprise relay -> internet recipient MX
```

Manfaat relay:

- central credential management,
- DKIM signing,
- SPF alignment,
- audit,
- rate limiting,
- outbound policy enforcement,
- provider failover,
- network allowlist.

### 7.3 Direct-to-MX

Direct-to-MX berarti aplikasi langsung mencari DNS MX domain recipient dan mengirim ke server recipient.

```text
Application -> DNS MX lookup -> recipient MX
```

Ini hampir selalu buruk untuk aplikasi bisnis biasa karena:

- harus mengelola retry per domain,
- reputasi IP rendah,
- blocked port 25,
- DNS complexity,
- deliverability buruk,
- tidak ada centralized policy,
- sulit audit,
- harus handle greylisting,
- harus DKIM/SPF/DMARC dengan benar.

Rule of thumb:

```text
Enterprise Java application should submit to a trusted relay/provider,
not act as a full internet MTA.
```

---

## 8. Port Email: 25, 465, 587, 993, 995, 110, 143

Port sering membuat deployment issue, terutama di cloud/network enterprise.

| Port | Protocol/use | Catatan |
|---:|---|---|
| 25 | SMTP server-to-server relay | Sering diblok cloud/ISP; bukan pilihan utama app submission |
| 587 | Mail submission with STARTTLS | Umum untuk authenticated submission |
| 465 | SMTP over implicit TLS | Modern kembali direkomendasikan untuk submission TLS eksplisit sejak RFC 8314 context |
| 143 | IMAP plain/STARTTLS | Akses mailbox, bisa upgrade STARTTLS |
| 993 | IMAP over implicit TLS | Umum untuk IMAPS |
| 110 | POP3 plain/STARTTLS | Legacy retrieval |
| 995 | POP3 over implicit TLS | POP3S |

Mental model:

```text
Sending:
  587 STARTTLS or 465 implicit TLS

Receiving/access:
  993 IMAPS or 143 STARTTLS
  995 POP3S or 110 STARTTLS

Server-to-server relay:
  25
```

Di production, jangan hanya bertanya “host SMTP apa?”. Tanyakan:

```text
host?
port?
TLS mode?
auth mechanism?
username format?
from domain allowed?
rate limit?
max message size?
allowed attachment type?
source IP allowlist?
```

---

## 9. TLS: STARTTLS vs Implicit TLS

### 9.1 Cleartext Problem

Email protocols awalnya lahir di era yang jauh lebih trusting. Banyak mekanisme awal bisa berjalan cleartext. Modern production tidak boleh menganggap cleartext aman.

TLS dibutuhkan untuk:

- melindungi credentials,
- melindungi message saat submission/access,
- mencegah passive sniffing,
- memenuhi baseline security policy.

### 9.2 STARTTLS

STARTTLS berarti koneksi dimulai plain, lalu dinegosiasikan naik menjadi TLS.

```text
TCP connect
EHLO
server advertises STARTTLS
client sends STARTTLS
TLS handshake
EHLO again
AUTH / MAIL FROM / RCPT TO / DATA
```

Dalam Jakarta Mail SMTP, konsepnya biasanya dikonfigurasi dengan property seperti:

```properties
mail.smtp.starttls.enable=true
mail.smtp.starttls.required=true
```

`enable=true` berarti gunakan STARTTLS kalau tersedia. `required=true` berarti gagal kalau server tidak menyediakan STARTTLS. Untuk security-sensitive system, `required=true` biasanya lebih defensible.

### 9.3 Implicit TLS

Implicit TLS berarti koneksi TLS dimulai sejak awal TCP connection.

```text
TCP connect
TLS handshake immediately
EHLO
AUTH / MAIL FROM / RCPT TO / DATA
```

SMTP implicit TLS biasanya port 465.

Dalam Jakarta Mail SMTP, konsepnya biasanya:

```properties
mail.smtp.ssl.enable=true
```

### 9.4 Downgrade Risk

Jika aplikasi hanya mengaktifkan STARTTLS tapi tidak mewajibkan, attacker/network misconfiguration bisa membuat server tampak tidak menawarkan STARTTLS, lalu client melanjutkan cleartext.

Untuk sistem enterprise:

```text
Prefer fail-closed over silently sending credentials/message without TLS.
```

### 9.5 Certificate Validation

Jangan matikan certificate validation untuk “biar connect”. Itu mengubah TLS menjadi enkripsi tanpa identitas server yang kuat.

Anti-pattern:

```properties
mail.smtp.ssl.trust=*
```

Ini kadang dipakai saat debugging, tetapi sangat berbahaya jika lolos ke production.

---

## 10. Authentication di Email Protocol

SMTP submission biasanya membutuhkan authentication.

Common mechanism:

```text
AUTH PLAIN
AUTH LOGIN
AUTH XOAUTH2
```

### 10.1 Username/Password

Paling sederhana, tetapi punya risiko:

- secret harus disimpan aman,
- rotasi credential,
- provider bisa disable basic auth,
- password leak berdampak besar.

### 10.2 App Password

Beberapa provider menggunakan app password, bukan password akun utama. Lebih baik daripada password user utama, tetapi tetap secret statis.

### 10.3 OAuth2 / XOAUTH2

OAuth2 lebih modern untuk provider tertentu. Aplikasi mendapat access token dan menggunakannya untuk autentikasi SMTP/IMAP.

Trade-off:

- lebih aman secara policy,
- bisa dicabut/scoped,
- tetapi implementasi refresh token, expiry, dan provider-specific config lebih kompleks.

### 10.4 Enterprise Relay Tanpa Auth tapi Dengan Network Control

Beberapa enterprise menyediakan internal relay yang tidak meminta username/password, tetapi membatasi berdasarkan:

- source IP,
- VPC/subnet,
- mTLS,
- allowlist host,
- firewall,
- Kubernetes namespace/network policy.

Ini bisa valid, tetapi jangan disalahartikan sebagai “tanpa security”. Security-nya pindah ke network boundary dan relay policy.

---

## 11. Internet Message Format: Header + Body

SMTP mengirim message. Format message internet diatur oleh Internet Message Format.

Secara sederhana:

```text
Header-Name: header value

Another-Header: another value



Body starts here

```

Ada blank line yang memisahkan headers dan body.

Contoh:

```text
From: Notification <no-reply@example.com>
To: Fajar <fajar@example.net>
Subject: Case Updated
Date: Tue, 16 Jun 2026 10:00:00 +0700
Message-ID: <case-123@example.com>
MIME-Version: 1.0
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: quoted-printable

Your case has been updated.
```

Header bukan JSON. Header punya grammar sendiri:

- line folding,
- encoded words,
- comments,
- address syntax,
- date syntax,
- message-id syntax,
- CRLF line endings.

Karena itu jangan membuat raw email string manual kecuali benar-benar tahu formatnya.

Gunakan `MimeMessage`, `InternetAddress`, `MimeBodyPart`, `MimeMultipart`, dan utility Jakarta Mail.

---

## 12. Header Penting dalam Email

| Header | Fungsi |
|---|---|
| `From` | Pengirim visible |
| `Sender` | Sender actual jika berbeda dari From |
| `To` | Recipient visible utama |
| `Cc` | Recipient visible copy |
| `Bcc` | Biasanya tidak muncul di final message header |
| `Reply-To` | Alamat balasan user |
| `Subject` | Judul email |
| `Date` | Waktu message dibuat |
| `Message-ID` | Identifier unik message |
| `In-Reply-To` | Untuk reply threading |
| `References` | Untuk conversation threading |
| `MIME-Version` | Biasanya `1.0` untuk MIME message |
| `Content-Type` | Tipe body atau multipart |
| `Content-Transfer-Encoding` | Encoding transfer body |
| `Content-Disposition` | Inline/attachment |
| `Content-ID` | Referensi inline resource |
| `Return-Path` | Biasanya ditambahkan saat delivery, terkait bounce path |
| `Received` | Ditambahkan oleh server-server yang dilalui |

Untuk engineer Java, yang paling sering dikelola manual:

```text
From
To/Cc/Bcc
Reply-To
Subject
Message-ID sometimes
Content-Type via MIME API
Content-Disposition for attachment
Content-ID for inline images
```

Yang sebaiknya tidak asal override:

```text
Received
Return-Path
DKIM-Signature
Authentication-Results
```

Header tersebut biasanya milik mail infrastructure/provider.

---

## 13. MIME: Kenapa Email Bisa Punya HTML dan Attachment

Internet Message Format awalnya sederhana: header + text body. MIME memperluas email agar bisa membawa:

- non-ASCII text,
- HTML,
- attachment,
- image,
- PDF,
- nested messages,
- multipart alternatives.

Tanpa MIME, email modern tidak bisa bekerja seperti sekarang.

### 13.1 Content-Type

`Content-Type` memberi tahu jenis content.

Contoh:

```text
Content-Type: text/plain; charset=UTF-8
```

```text
Content-Type: text/html; charset=UTF-8
```

```text
Content-Type: application/pdf; name="invoice.pdf"
```

```text
Content-Type: multipart/mixed; boundary="----=_Part_123"
```

### 13.2 Content-Transfer-Encoding

SMTP historically punya batasan terhadap data binary/non-ASCII. MIME memakai encoding seperti:

```text
7bit
8bit
quoted-printable
base64
binary
```

Praktisnya:

- text dengan karakter non-ASCII sering `quoted-printable` atau `base64`,
- attachment binary biasanya `base64`,
- jangan encode manual kecuali perlu.

Jakarta Mail biasanya mengurus banyak detail encoding jika API digunakan benar.

### 13.3 MIME Boundary

Multipart email memakai boundary untuk memisahkan body part.

Contoh konseptual:

```text
Content-Type: multipart/alternative; boundary="abc"

--abc
Content-Type: text/plain; charset=UTF-8

Plain text version.

--abc
Content-Type: text/html; charset=UTF-8

<html><body><p>HTML version.</p></body></html>

--abc--
```

Boundary harus unik dan tidak boleh bentrok dengan content.

Biasanya jangan set boundary manual. Biarkan Jakarta Mail generate.

---

## 14. Multipart Types yang Wajib Dikuasai

### 14.1 `multipart/alternative`

Dipakai untuk menyediakan beberapa representasi dari content yang sama.

```text
multipart/alternative
  - text/plain
  - text/html
```

Makna:

```text
Ini isi yang sama, pilih versi terbaik yang client bisa render.
```

Ordering penting: versi paling sederhana dulu, versi paling kaya belakangan.

```text
text/plain first
text/html second
```

### 14.2 `multipart/mixed`

Dipakai untuk message dengan attachment.

```text
multipart/mixed
  - body
  - attachment.pdf
  - attachment.xlsx
```

Makna:

```text
Ini beberapa bagian berbeda dalam satu email.
```

### 14.3 `multipart/related`

Dipakai saat beberapa part saling terkait, misalnya HTML yang mereferensikan inline image.

```text
multipart/related
  - text/html
  - image/png with Content-ID: <logo123>
```

HTML:

```html
<img src="cid:logo123" />
```

### 14.4 Nested Multipart Realistis

Email production sering butuh:

- plain text fallback,
- HTML body,
- inline logo,
- PDF attachment.

Struktur yang benar biasanya nested:

```text
multipart/mixed
  ├─ multipart/related
  │    ├─ multipart/alternative
  │    │    ├─ text/plain
  │    │    └─ text/html
  │    └─ image/png inline logo
  └─ application/pdf attachment
```

Kenapa tidak flat saja?

Karena semantics MIME menentukan bagaimana client memahami hubungan antar part.

Kalau struktur salah:

- attachment bisa muncul sebagai inline image aneh,
- logo bisa muncul sebagai attachment,
- plain text fallback hilang,
- HTML tidak dirender,
- Outlook/Gmail beda behavior.

---

## 15. POP3: Protocol Pengambilan Email yang Sederhana

POP3 adalah protokol akses mailbox yang lebih sederhana dan lebih tua.

Mental model:

```text
Client connects to mailbox
  -> lists messages
  -> downloads messages
  -> optionally deletes messages from server
```

POP3 cocok untuk model:

```text
Ambil semua email dari mailbox, simpan lokal, mungkin hapus dari server.
```

Keterbatasan POP3:

- folder support minimal,
- synchronization terbatas,
- metadata/flags terbatas,
- kurang cocok untuk multi-client modern,
- kurang cocok untuk workflow mailbox kompleks.

Dalam enterprise Java, POP3 masih kadang dipakai untuk:

- legacy inbound mailbox polling,
- simple mailbox ingestion,
- sistem lama yang hanya expose POP3.

Tetapi untuk mailbox modern, IMAP biasanya lebih tepat.

---

## 16. IMAP: Protocol Sinkronisasi Mailbox

IMAP adalah protokol untuk mengakses dan memanipulasi mailbox di server.

IMAP memungkinkan:

- folder/mailbox remote,
- list folder,
- read message,
- search message,
- flags seperti Seen/Answered/Deleted,
- partial fetch,
- server-side state,
- multi-client synchronization,
- offline resync.

Mental model:

```text
Mailbox remains on server.
Client views/synchronizes/manipulates remote mailbox.
```

Contoh konsep folder:

```text
INBOX
Sent
Archive
Spam
Trash
Custom/CaseReplies
```

Dalam Jakarta Mail:

```java
Store store = session.getStore("imap");
store.connect(host, username, password);
Folder inbox = store.getFolder("INBOX");
inbox.open(Folder.READ_WRITE);
Message[] messages = inbox.getMessages();
```

Tetapi API sederhana ini menutupi banyak kompleksitas:

- message sequence number bisa berubah,
- UID lebih stabil daripada sequence number,
- folder state bisa berubah oleh client lain,
- search behavior provider-specific,
- large mailbox harus diproses incremental,
- parsing message eksternal berisiko.

---

## 17. SMTP vs IMAP vs POP3 dalam Jakarta Mail

Jakarta Mail punya abstraction:

```text
Transport -> sending
Store     -> message store access
Folder    -> mailbox folder
Message   -> message object
```

Mapping konseptual:

| Protokol | Jakarta Mail object | Fungsi |
|---|---|---|
| SMTP | `Transport` | Mengirim email |
| IMAP | `Store`, `Folder`, `Message` | Mengakses mailbox remote |
| POP3 | `Store`, `Folder`, `Message` | Mengambil email dari mailbox sederhana |
| MIME | `MimeMessage`, `MimeBodyPart`, `MimeMultipart` | Format message/body/attachment |

Contoh flow outbound:

```text
Session
  -> MimeMessage
  -> set headers/body
  -> Transport
  -> SMTP server
```

Contoh flow inbound:

```text
Session
  -> Store(IMAP)
  -> Folder(INBOX)
  -> Message[]
  -> parse MIME content
```

Jangan menyamakan `Message` object dengan “email sudah terkirim”. `Message` adalah representasi data. Delivery adalah proses protokol.

---

## 18. JavaMail/Jakarta Mail Bukan SMTP Library Saja

Banyak orang menyebut “JavaMail” untuk kirim SMTP. Padahal API-nya lebih luas:

```text
jakarta.mail
  - Session
  - Message
  - Transport
  - Store
  - Folder
  - Address
  - Multipart
  - BodyPart

jakarta.mail.internet
  - MimeMessage
  - MimeBodyPart
  - MimeMultipart
  - InternetAddress
  - MimeUtility
```

Package `jakarta.mail.internet` berisi class yang spesifik untuk internet mail standards seperti MIME, SMTP, POP3, dan IMAP.

Namun implementasi provider penting. API saja tidak cukup. Pada Jakarta Mail modern, Eclipse Angus Mail adalah implementasi penting untuk Jakarta Mail 2.1+.

Mental model:

```text
Specification/API:
  jakarta.mail-api

Implementation/provider:
  Angus Mail or another compatible implementation

Activation API/implementation:
  jakarta.activation-api + Angus Activation / compatible implementation
```

Kalau dependency salah, error yang muncul bisa membingungkan:

```text
No provider for smtp
ClassNotFoundException
NoClassDefFoundError: jakarta/activation/DataSource
mixed javax.mail and jakarta.mail types
```

Part 2 akan membahas ini secara khusus.

---

## 19. Email Sending dari Sudut Pandang Java Object

Mari hubungkan protocol dengan object.

### 19.1 Minimal outbound message

```java
Properties props = new Properties();
props.put("mail.smtp.host", "smtp.example.com");
props.put("mail.smtp.port", "587");
props.put("mail.smtp.auth", "true");
props.put("mail.smtp.starttls.enable", "true");
props.put("mail.smtp.starttls.required", "true");

Session session = Session.getInstance(props, new Authenticator() {
    @Override
    protected PasswordAuthentication getPasswordAuthentication() {
        return new PasswordAuthentication("username", "password");
    }
});

MimeMessage message = new MimeMessage(session);
message.setFrom(new InternetAddress("no-reply@example.com", "Notification"));
message.setRecipients(Message.RecipientType.TO, "user@example.net");
message.setSubject("Case Updated", StandardCharsets.UTF_8.name());
message.setText("Your case has been updated.", StandardCharsets.UTF_8.name());

Transport.send(message);
```

Behind the scenes:

```text
Properties -> SMTP connection/auth/TLS behavior
Session    -> configuration and provider lookup
MimeMessage -> RFC 5322 + MIME content
Transport.send -> SMTP transaction
```

### 19.2 Apa yang terlihat sederhana tapi sebenarnya kompleks

```java
message.setSubject("Case Updated", "UTF-8");
```

Ini dapat menyebabkan encoded header jika perlu.

```java
message.setText("...");
```

Ini menentukan content type text/plain dan charset jika overload benar dipakai.

```java
Transport.send(message);
```

Ini dapat:

- resolve SMTP provider,
- connect,
- authenticate,
- negotiate TLS,
- extract recipients,
- serialize message,
- stream data,
- receive SMTP response,
- throw exception with nested SMTP details.

---

## 20. Message Serialization: Object Akan Menjadi Bytes

Email akhirnya dikirim sebagai bytes melalui network.

`MimeMessage` bukan magic. Ia akan diserialisasi menjadi format seperti:

```text
Date: Tue, 16 Jun 2026 10:00:00 +0700

From: Notification <no-reply@example.com>

To: user@example.net

Subject: Case Updated

MIME-Version: 1.0

Content-Type: text/plain; charset=UTF-8

Content-Transfer-Encoding: quoted-printable



Your case has been updated.

```

Konsekuensi:

1. Header injection itu nyata.
2. Charset salah akan terlihat rusak di client.
3. Attachment besar menjadi stream/base64 data besar.
4. Newline handling penting.
5. Raw MIME bisa diinspeksi untuk debugging.

Untuk debugging, engineer top-tier tidak hanya melihat exception. Ia juga bisa membaca raw MIME dan SMTP transcript.

---

## 21. Header Injection: Kenapa Validasi Input Penting

Karena header berbasis line, input user yang mengandung CR/LF bisa berbahaya.

Misalnya user mengisi display name:

```text
Alice
Bcc: attacker@example.com
```

Kalau aplikasi membangun header manual secara naive:

```text
From: Alice

Bcc: attacker@example.com <alice@example.com>
```

Itu bisa menyisipkan header baru.

Gunakan API seperti `InternetAddress`, tetapi tetap validasi input. Jangan izinkan CR/LF dalam field yang masuk ke header.

Rule praktis:

```text
Any user-controlled value that becomes email header must reject CR and LF.
```

Field berisiko:

- display name,
- subject,
- reply-to,
- custom header,
- attachment filename,
- template-provided header.

---

## 22. Mailbox Access: Inbound Email Bukan Sekadar `getMessages()`

Inbound processing sering dipakai untuk:

- case reply ingestion,
- support ticket creation,
- document submission by email,
- bounce mailbox processing,
- approval via email,
- legacy integration.

Risikonya besar karena email masuk adalah untrusted input.

Threat/failure model:

```text
malformed MIME
huge attachment
zip bomb
HTML with malicious link
spoofed sender
duplicate message
same mailbox processed by two workers
provider search inconsistency
timeout while reading attachment
partial read
folder expunge by another client
```

Inbound architecture tidak boleh seperti ini:

```java
for (Message message : inbox.getMessages()) {
    process(message);
    message.setFlag(Flags.Flag.DELETED, true);
}
```

Tanpa:

- UID checkpoint,
- duplicate detection,
- safe MIME parser,
- attachment size limit,
- transactional processing,
- quarantine,
- retry state,
- observability.

Kita akan bahas detail di Part 15 dan Part 16.

---

## 23. MIME Tree Mental Model

Email MIME sebaiknya dilihat sebagai tree.

Simple plain text:

```text
MimeMessage
  └─ text/plain
```

HTML only:

```text
MimeMessage
  └─ text/html
```

Plain + HTML:

```text
MimeMessage
  └─ multipart/alternative
       ├─ text/plain
       └─ text/html
```

HTML + inline image:

```text
MimeMessage
  └─ multipart/related
       ├─ text/html
       └─ image/png; Content-ID=<logo>
```

HTML + attachment:

```text
MimeMessage
  └─ multipart/mixed
       ├─ text/html
       └─ application/pdf; Content-Disposition=attachment
```

Full robust email:

```text
MimeMessage
  └─ multipart/mixed
       ├─ multipart/related
       │    ├─ multipart/alternative
       │    │    ├─ text/plain
       │    │    └─ text/html
       │    └─ image/png; Content-ID=<logo>
       └─ application/pdf; Content-Disposition=attachment
```

Saat membaca inbound email, traversal harus recursive:

```text
visit part
  if text/plain -> collect text
  if text/html -> collect html
  if multipart -> visit children
  if attachment -> validate and store/quarantine
  if message/rfc822 -> parse nested message carefully
```

---

## 24. Email Address Syntax: Lebih Rumit dari Kelihatannya

Email address umum terlihat seperti:

```text
local-part@domain
```

Tetapi real syntax bisa mencakup:

```text
User Name <user@example.com>
"Doe, John" <john.doe@example.com>
group: alice@example.com, bob@example.com;
```

Ada juga isu:

- display name non-ASCII,
- internationalized domain name,
- quoted local part,
- plus addressing,
- case sensitivity local-part secara teori,
- provider normalization secara praktik.

Jangan validasi email address dengan regex sederhana yang terlalu agresif.

Rule praktis:

```text
Use InternetAddress for parsing/formatting,
but combine with business validation appropriate to your domain.
```

Contoh:

- Untuk login identity, aturan bisa ketat.
- Untuk notification recipient, aturan harus cukup menerima alamat valid real-world.
- Untuk regulatory notice, perlu audit dan verification process.

---

## 25. DNS MX dan Routing Email

Saat email dikirim ke domain recipient, MTA biasanya mencari DNS MX record domain tersebut.

```text
user@example.net
  -> lookup MX for example.net
  -> connect to MX host
  -> submit/relay message
```

Tetapi aplikasi Java business biasanya tidak melakukan MX lookup langsung. SMTP relay/provider yang melakukannya.

Kenapa tetap perlu tahu MX?

Karena incident sering melibatkan:

- recipient domain MX down,
- DNS misconfiguration,
- domain expired,
- SPF/DKIM/DMARC issue,
- provider cannot route,
- temporary deferral,
- greylisting.

Saat user bilang “email tidak sampai”, kemungkinan bukan di Java code, tetapi di routing/filtering layer.

---

## 26. SPF, DKIM, DMARC: Bukan SMTP API, Tapi Mempengaruhi Hasil

Walau Part 14 akan membahas deliverability mendalam, di sini kita perlu tahu posisinya.

### 26.1 SPF

SPF membantu recipient memeriksa apakah server/IP yang mengirim berwenang untuk envelope sender domain.

### 26.2 DKIM

DKIM menandatangani header/body tertentu dengan private key domain. Recipient memverifikasi dengan DNS public key.

### 26.3 DMARC

DMARC menghubungkan policy domain `From` dengan hasil SPF/DKIM dan alignment.

Implikasi untuk Java engineer:

```text
Changing From domain is not just UI choice.
```

Kalau aplikasi memakai:

```text
From: official-agency.gov.sg
```

Tetapi SMTP relay/provider tidak dikonfigurasi untuk domain tersebut, email bisa ditolak atau masuk spam.

Jangan membuat fitur “user can set arbitrary From address” tanpa governance.

---

## 27. Where Jakarta Activation Fits

Jakarta Activation bukan protokol email. Ia membantu Jakarta Mail menangani data dan MIME type.

Mental model:

```text
Attachment file / bytes / stream
  -> DataSource
  -> DataHandler
  -> MimeBodyPart
  -> MIME serialization
  -> SMTP DATA stream
```

Contoh attachment:

```java
MimeBodyPart attachmentPart = new MimeBodyPart();
DataSource source = new FileDataSource(file);
attachmentPart.setDataHandler(new DataHandler(source));
attachmentPart.setFileName(file.getName());
```

Tanpa Activation, Java Mail/Jakarta Mail akan kesulitan mengabstraksikan content data, MIME type, dan handler operations.

Di Java 8 lama, `javax.activation` kadang tersedia/terikut tergantung environment. Di Java modern, dependency eksplisit lebih penting.

---

## 28. Java 8–25 Compatibility Mental Model

Untuk seri ini, kita akan sering membedakan:

### 28.1 Legacy Java 8 Stack

```text
Java 8
javax.mail.*
javax.activation.*
JavaMail 1.6.x style
Java EE / older Spring applications
```

### 28.2 Modern Jakarta Stack

```text
Java 11+
jakarta.mail.*
jakarta.activation.*
Jakarta Mail 2.x
Eclipse Angus implementation
Spring Boot 3 / Jakarta EE 10+
```

### 28.3 Java 17/21/25 Runtime Consideration

Mail API usage tidak berubah drastis karena Java version. Yang berubah lebih banyak:

- dependency/module path,
- TLS defaults,
- disabled legacy algorithms,
- container/runtime packaging,
- virtual thread possibility for blocking SMTP workers,
- observability ecosystem,
- framework namespace migration.

Jangan berpikir “Java 25 punya email API baru”. Yang penting adalah dependency, runtime security, dan framework compatibility.

---

## 29. Anti-Pattern yang Harus Dihindari Sejak Awal

### 29.1 Mengirim Email Langsung di Request Transaction

```text
HTTP request
  -> DB transaction open
  -> send SMTP
  -> SMTP timeout 30 seconds
  -> DB lock held too long
```

Lebih baik:

```text
HTTP request
  -> save business transaction
  -> save outbox notification
  -> commit
  -> async worker sends email
```

### 29.2 Menganggap SMTP Success Sama dengan Delivered

```text
SMTP 250 accepted != recipient read email
SMTP 250 accepted != inbox delivery
SMTP 250 accepted != no future bounce
```

### 29.3 Tidak Mengatur Timeout

Tanpa timeout eksplisit, thread bisa menggantung terlalu lama tergantung implementation/default/network.

Harus ada:

```properties
mail.smtp.connectiontimeout=...
mail.smtp.timeout=...
mail.smtp.writetimeout=...
```

### 29.4 Membuat Raw MIME Manual

Raw MIME manual rawan:

- boundary salah,
- encoding salah,
- CRLF salah,
- header injection,
- attachment corrupt.

Gunakan API.

### 29.5 Satu Email ke Banyak Recipient untuk Personalized Content

Kalau setiap recipient harus dapat content personal, jangan pakai satu message dengan banyak `To`.

Salah:

```text
To: user1, user2, user3
Body: Dear {name}
```

Benar:

```text
one logical notification per recipient
```

### 29.6 Log Raw Email Lengkap di Production

Raw email bisa mengandung:

- PII,
- token reset password,
- document link,
- attachment metadata,
- recipient list,
- case details.

Log harus redacted.

### 29.7 Memakai User Input untuk Header Tanpa Sanitization

Header injection bisa terjadi jika CR/LF lolos.

### 29.8 Tidak Ada Idempotency

Retry bisa mengirim duplicate email.

Solusi:

```text
notification_id
idempotency_key
business_event_id
template_version
recipient identity
send attempt tracking
```

---

## 30. Production Debugging: Pertanyaan yang Benar

Ketika ada tiket “email tidak sampai”, jangan langsung cek Java code saja. Gunakan flow pertanyaan:

### 30.1 Apakah aplikasi membuat notification?

```text
Apakah business event terjadi?
Apakah notification request dibuat?
Apakah template render sukses?
Apakah recipient resolved?
```

### 30.2 Apakah email masuk queue/outbox?

```text
Status PENDING?
PROCESSING?
FAILED?
SENT/ACCEPTED?
Dead letter?
```

### 30.3 Apakah SMTP submission terjadi?

```text
Ada attempt?
SMTP host benar?
TLS sukses?
AUTH sukses?
MAIL FROM accepted?
RCPT TO accepted?
DATA accepted?
```

### 30.4 Apa response server?

```text
2xx?
4xx?
5xx?
Timeout?
Connection refused?
TLS handshake failed?
```

### 30.5 Apakah provider menerima lalu memproses?

```text
Provider dashboard?
Message ID?
Queue ID?
Bounce event?
Suppression list?
Rate limit?
```

### 30.6 Apakah recipient side menolak/filter?

```text
Spam folder?
Corporate gateway quarantine?
DMARC fail?
Attachment blocked?
Mailbox full?
User unknown?
```

### 30.7 Apakah content/client rendering bermasalah?

```text
HTML blank?
Attachment missing?
Inline image broken?
Subject garbled?
Wrong charset?
```

Top-tier engineer melakukan diagnosis end-to-end, bukan hanya “di log app sudah sent”.

---

## 31. Design Mental Model: Mail as a State Machine

Untuk enterprise system, email delivery sebaiknya dimodelkan sebagai state machine.

Contoh outbound state:

```text
DRAFTED
  -> RENDERED
  -> QUEUED
  -> SUBMITTING
  -> ACCEPTED_BY_SMTP
  -> DELIVERY_CONFIRMED      optional provider feedback
  -> BOUNCED                 async negative feedback
  -> FAILED_RETRYABLE
  -> FAILED_PERMANENT
  -> DEAD_LETTER
  -> CANCELLED
```

Dengan transition rules:

```text
QUEUED -> SUBMITTING
  only worker lock acquired

SUBMITTING -> ACCEPTED_BY_SMTP
  only SMTP final response success

SUBMITTING -> FAILED_RETRYABLE
  network timeout, 4xx, provider temporary failure

SUBMITTING -> FAILED_PERMANENT
  invalid recipient, 5xx non-retryable, message too large

ACCEPTED_BY_SMTP -> BOUNCED
  async bounce/webhook received

FAILED_RETRYABLE -> QUEUED
  retry schedule due and attempt count not exceeded

FAILED_RETRYABLE -> DEAD_LETTER
  max attempt exceeded
```

Invariants:

```text
No send without notification id.
No retry without attempt record.
No user-visible final success based only on queue insertion.
No permanent failure retried forever.
No raw recipient PII in low-trust logs.
No attachment sent without size/type validation.
```

---

## 32. How This Protocol Knowledge Maps to Later Parts

| Knowledge from Part 1 | Akan dipakai di |
|---|---|
| SMTP transaction | Part 4, Part 10, Part 27 |
| Envelope vs header | Part 9, Part 14, Part 23 |
| MIME tree | Part 5, Part 6, Part 7, Part 16 |
| TLS modes | Part 4, Part 13 |
| SMTP status code | Part 10, Part 11 |
| IMAP/POP3 | Part 15, Part 16 |
| Activation role | Part 7, Part 28 |
| Java 8 vs Jakarta | Part 2, Part 28 |
| Deliverability boundary | Part 14, Part 23, Part 25 |

Part ini sengaja tidak langsung membuat banyak kode production karena kode tanpa protokol akan menghasilkan abstraction yang rapuh.

---

## 33. Mini Checklist: Sebelum Menulis Kode Mail

Sebelum membuat mail module, jawab pertanyaan ini:

```text
1. Apakah sistem hanya outbound, inbound, atau dua-duanya?
2. SMTP relay/provider apa yang dipakai?
3. Port dan TLS mode apa?
4. Authentication mechanism apa?
5. From domain apa yang authorized?
6. Envelope sender/return path bagaimana?
7. Apakah perlu bounce handling?
8. Apakah email transactional atau bulk?
9. Apakah ada attachment?
10. Batas ukuran message berapa?
11. Apakah content personal per recipient?
12. Apakah perlu plain text fallback?
13. Apakah perlu HTML template versioning?
14. Apakah send harus async/outbox?
15. Apa retry policy?
16. Apa permanent failure policy?
17. Apa yang boleh/tidak boleh masuk log?
18. Metrics apa yang wajib ada?
19. Bagaimana testing tanpa mengirim email nyata?
20. Bagaimana incident “email tidak sampai” akan di-debug?
```

Jika pertanyaan ini tidak dijawab, kemungkinan mail subsystem akan terlihat sederhana di awal tetapi mahal saat production.

---

## 34. Ringkasan Mental Model

Email stack bisa diringkas seperti ini:

```text
SMTP answers: how message is submitted/transferred.
IMAP answers: how mailbox is accessed/synchronized.
POP3 answers: how mailbox messages are downloaded simply.
RFC 5322 answers: what an internet message looks like.
MIME answers: how body, HTML, attachment, charset, and multipart work.
Jakarta Mail answers: how Java represents and operates on those concepts.
Jakarta Activation answers: how Java represents typed data used by MIME parts.
Deliverability answers: whether accepted mail reaches inbox and is trusted.
Architecture answers: whether the whole thing is reliable, observable, and safe.
```

Most beginner bugs happen at API level.
Most senior bugs happen at boundary level.
Most top-tier design decisions happen at state, ownership, and failure-model level.

---

## 35. Practical Takeaway

Setelah Part 1, kita harus punya intuisi berikut:

1. `Transport.send()` adalah ujung kecil dari pipeline besar.
2. SMTP success tidak sama dengan inbox delivery.
3. Header dan envelope adalah dua dunia berbeda.
4. MIME adalah tree, bukan sekadar string body.
5. Attachment adalah data stream + MIME metadata + encoding + security risk.
6. IMAP/POP3 adalah access protocol, bukan send protocol.
7. Jakarta Mail adalah abstraction, bukan pengganti pemahaman protokol.
8. Production email harus didesain sebagai reliable asynchronous subsystem.

---

## 36. Referensi

- Jakarta Mail 2.1 Specification — Jakarta EE, Eclipse Foundation.
- Jakarta Mail API overview and package documentation.
- Eclipse Angus Mail documentation and API docs.
- RFC 5321 — Simple Mail Transfer Protocol.
- RFC 5322 — Internet Message Format.
- RFC 2045–2049 — MIME specifications.
- RFC 8314 — Cleartext Considered Obsolete: Use of TLS for Email Submission and Access.
- RFC 9051 — IMAP4rev2.

---

## 37. Status Seri

```text
[x] Part 0  — Orientation: Email as a Distributed System
[x] Part 1  — Email Protocol Stack: SMTP, MIME, POP3, IMAP
[ ] Part 2  — JavaMail to Jakarta Mail: History, Namespace, Compatibility, Migration
[ ] Part 3  — Core API: Session, Store, Folder, Transport, Message
[ ] Part 4  — SMTP Sending: Properties, Transport, Timeout, TLS, Auth
[ ] Part 5  — MIME Message Construction: Text, HTML, Charset, Headers
[ ] Part 6  — Multipart Email: Alternative, Mixed, Related, Nested Structure
[ ] Part 7  — Attachment Handling and Jakarta Activation
[ ] Part 8  — HTML Email Engineering: Templates, CSS, Images, Client Compatibility
[ ] Part 9  — Mail Addressing, Identity, and Header Semantics
[ ] Part 10 — Error Model: MessagingException, SendFailedException, SMTP Exceptions
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

Seri belum selesai. Bagian berikutnya adalah:

```text
Part 2 — JavaMail to Jakarta Mail: History, Namespace, Compatibility, and Migration Strategy
```


<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 0 — Orientation: Email as a Distributed System](./00-orientation-email-as-distributed-system.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 2 — JavaMail to Jakarta Mail: History, Namespace, Compatibility, and Migration Strategy](./02-javamail-to-jakarta-mail-migration.md)
