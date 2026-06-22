# Part 4 — SMTP Sending: Properties, Transport, Timeout, TLS, Auth

> Series: `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery`  
> File: `04-smtp-sending-timeout-tls-auth.md`  
> Scope: Java 8–25, JavaMail `javax.mail`, Jakarta Mail `jakarta.mail`, Eclipse Angus Mail, SMTP sending in enterprise systems

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas object model utama Jakarta Mail:

- `Session`
- `Transport`
- `Store`
- `Folder`
- `Message`
- `MimeMessage`
- `Address`
- provider model

Part ini fokus pada **sending path** lewat SMTP.

Kita belum akan membahas MIME multipart secara dalam, attachment, template, retry architecture, outbox, bounce, dan deliverability. Semua itu akan dibahas di part berikutnya. Di sini fokusnya adalah:

> bagaimana Java/Jakarta Mail melakukan koneksi ke SMTP server, bagaimana mengatur properti yang benar, bagaimana TLS dan authentication bekerja, bagaimana timeout harus dipasang, dan bagaimana membuat sending code yang aman untuk production.

---

## 1. Mental Model: SMTP Sending Bukan Sekadar `Transport.send(message)`

Contoh paling umum yang sering ditemukan:

```java
Transport.send(message);
```

Secara demo, itu valid. Secara production, itu terlalu menyederhanakan realita.

Ketika aplikasi Java mengirim email via SMTP, flow yang sebenarnya kira-kira seperti ini:

```text
Application
  |
  | build MimeMessage
  v
Jakarta Mail SMTP provider
  |
  | open TCP socket
  v
SMTP relay / SMTP submission server
  |
  | optional TLS negotiation
  | optional authentication
  | SMTP command exchange
  v
Accepted / rejected / timed out / partially accepted
```

Di balik satu pemanggilan `send`, ada banyak hal yang bisa gagal:

```text
DNS lookup failed
TCP connect failed
Connection hung forever
TLS handshake failed
Certificate invalid
STARTTLS not offered
Authentication rejected
Sender rejected
Some recipients rejected
Message content rejected
Server timed out during DATA
Network dropped mid-send
Server accepted message but later bounced
```

Maka cara berpikir yang tepat:

> `Transport.send()` bukan business operation “email delivered”. Itu hanya attempt untuk menyerahkan message ke SMTP server.

SMTP server bisa menerima message, tetapi email tetap bisa:

- masuk spam,
- bounce setelah diterima,
- ditolak oleh downstream MTA,
- delayed,
- blocked karena reputation,
- silently filtered oleh recipient provider.

Part ini membahas batas paling awal: **application → SMTP relay**.

---

## 2. SMTP Role: Submission Server vs Relay vs Direct-to-MX

Sebelum konfigurasi Java, pahami dulu target SMTP yang dipakai.

Ada tiga pola umum:

```text
1. Application -> SMTP submission server
2. Application -> enterprise SMTP relay
3. Application -> recipient MX server directly
```

### 2.1 SMTP Submission Server

Ini server yang memang disediakan untuk client mengirim email. Biasanya:

- menggunakan port `587`,
- membutuhkan authentication,
- memakai STARTTLS,
- melakukan policy check,
- meneruskan email ke sistem delivery provider.

Contoh:

```text
smtp.gmail.com:587
smtp.office365.com:587
email-smtp.<region>.amazonaws.com:587
smtp.sendgrid.net:587
```

Untuk aplikasi enterprise, ini pola paling umum.

### 2.2 Enterprise SMTP Relay

Di organisasi besar, aplikasi internal sering tidak langsung mengirim ke provider publik. Flow-nya:

```text
Application -> Internal SMTP Relay -> External Mail Gateway -> Internet
```

Relay internal bisa melakukan:

- allowlist source IP,
- policy enforcement,
- centralized logging,
- DLP scanning,
- attachment scanning,
- routing per domain,
- DKIM signing,
- rate limiting.

Dalam pola ini, aplikasi kadang tidak perlu username/password karena relay mempercayai source IP atau jaringan internal. Tetapi bukan berarti aman tanpa TLS. Tergantung network trust model.

### 2.3 Direct-to-MX

Direct-to-MX berarti aplikasi lookup MX record domain recipient lalu mengirim langsung ke mail exchanger penerima.

Contoh:

```text
Application -> gmail-smtp-in.l.google.com
```

Ini hampir selalu buruk untuk enterprise app biasa karena:

- harus menangani DNS MX,
- harus punya IP reputation,
- reverse DNS,
- SPF/DKIM/DMARC alignment,
- queueing dan retry MTA-grade,
- greylisting,
- throttling per domain,
- bounce handling,
- abuse prevention.

Prinsip:

> Application bukan MTA. Application sebaiknya mengirim ke relay/provider yang memang bertugas menjadi MTA.

---

## 3. Port SMTP: 25, 465, 587

Port sering menjadi sumber konfigurasi salah.

| Port | Umum Dipakai Untuk | TLS Model | Catatan |
|---:|---|---|---|
| 25 | server-to-server relay | plaintext lalu STARTTLS optional | sering diblok cloud/ISP; bukan default submission app modern |
| 465 | SMTPS / implicit TLS | TLS sejak awal koneksi | historis, sekarang banyak provider tetap mendukung |
| 587 | message submission | plaintext connect lalu STARTTLS | paling umum untuk authenticated client submission |

Mental model:

```text
Port 587:
  TCP connect
  SMTP greeting
  EHLO
  STARTTLS
  TLS handshake
  EHLO again
  AUTH
  MAIL FROM
  RCPT TO
  DATA

Port 465:
  TCP connect
  TLS handshake immediately
  SMTP greeting inside TLS
  EHLO
  AUTH
  MAIL FROM
  RCPT TO
  DATA
```

Konsekuensi JavaMail/Jakarta Mail:

- untuk port `587`, biasanya pakai `mail.smtp.starttls.enable=true`;
- untuk port `465`, biasanya pakai `mail.smtp.ssl.enable=true`;
- jangan mencampur implicit TLS dan STARTTLS tanpa memahami server behavior.

---

## 4. JavaMail/Jakarta Mail Provider Naming

Walaupun API namespace berubah dari `javax.mail` ke `jakarta.mail`, banyak properti SMTP tetap memakai prefix historis:

```text
mail.smtp.*
mail.smtps.*
```

Contoh:

```properties
mail.smtp.host=smtp.example.com
mail.smtp.port=587
mail.smtp.auth=true
mail.smtp.starttls.enable=true
mail.smtp.connectiontimeout=5000
mail.smtp.timeout=10000
mail.smtp.writetimeout=10000
```

Kenapa masih `smtp` bukan `jakarta.smtp`?

Karena ini adalah properti provider protocol, bukan package Java. Jakarta Mail mempertahankan kompatibilitas konfigurasi yang sudah lama dipakai.

---

## 5. Minimal SMTP Configuration: Demo vs Production

### 5.1 Demo Configuration

```java
Properties props = new Properties();
props.put("mail.smtp.host", "smtp.example.com");
props.put("mail.smtp.port", "587");
props.put("mail.smtp.auth", "true");
props.put("mail.smtp.starttls.enable", "true");

Session session = Session.getInstance(props, new Authenticator() {
    @Override
    protected PasswordAuthentication getPasswordAuthentication() {
        return new PasswordAuthentication("user", "password");
    }
});
```

Ini bisa jalan untuk demo, tetapi belum production-ready karena belum ada timeout.

### 5.2 Production Minimum Configuration

```java
Properties props = new Properties();

props.put("mail.smtp.host", "smtp.example.com");
props.put("mail.smtp.port", "587");
props.put("mail.smtp.auth", "true");
props.put("mail.smtp.starttls.enable", "true");
props.put("mail.smtp.starttls.required", "true");

props.put("mail.smtp.connectiontimeout", "5000");
props.put("mail.smtp.timeout", "10000");
props.put("mail.smtp.writetimeout", "10000");

props.put("mail.smtp.localhost", "app-node-01.example.internal");

Session session = Session.getInstance(props, new Authenticator() {
    @Override
    protected PasswordAuthentication getPasswordAuthentication() {
        return new PasswordAuthentication("smtp-user", "smtp-secret");
    }
});
```

Perbedaan penting:

- `starttls.required=true` mencegah fallback diam-diam ke plaintext jika server tidak menawarkan STARTTLS.
- timeout mencegah thread menggantung tanpa batas.
- `mail.smtp.localhost` membantu EHLO identity jika environment hostname bermasalah.

---

## 6. Properti SMTP Paling Penting

### 6.1 Host dan Port

```properties
mail.smtp.host=smtp.example.com
mail.smtp.port=587
```

`host` adalah SMTP server yang dituju.

`port` harus sesuai mode TLS:

```text
587 -> STARTTLS
465 -> implicit SSL/TLS
25  -> relay/server-to-server, STARTTLS optional/required tergantung policy
```

### 6.2 Authentication

```properties
mail.smtp.auth=true
```

Jika `true`, provider akan mencoba melakukan SMTP AUTH setelah koneksi dan EHLO.

Jika memakai internal relay yang tidak membutuhkan auth:

```properties
mail.smtp.auth=false
```

Tetapi hati-hati: no-auth relay harus dikontrol dengan network, source IP, dan policy yang kuat.

### 6.3 STARTTLS

```properties
mail.smtp.starttls.enable=true
mail.smtp.starttls.required=true
```

`starttls.enable=true` berarti client akan menggunakan STARTTLS jika server mendukung.

`starttls.required=true` berarti koneksi gagal jika STARTTLS tidak tersedia.

Untuk sistem enterprise, lebih aman menganggap TLS harus required kecuali ada alasan eksplisit.

### 6.4 Implicit TLS / SMTPS

```properties
mail.smtp.ssl.enable=true
mail.smtp.port=465
```

Ini dipakai untuk port `465`.

Jangan pakai `ssl.enable=true` untuk port 587 kecuali provider secara eksplisit meminta demikian.

### 6.5 Timeout

```properties
mail.smtp.connectiontimeout=5000
mail.smtp.timeout=10000
mail.smtp.writetimeout=10000
```

Ini wajib untuk production.

Tanpa timeout, default historis provider adalah bisa sangat lama atau effectively infinite. Ini berbahaya karena request thread, worker thread, atau scheduler thread bisa stuck.

### 6.6 Debug

```properties
mail.debug=true
```

Atau:

```java
session.setDebug(true);
```

Debug sangat berguna untuk diagnosis SMTP transcript, tetapi berbahaya jika diaktifkan sembarangan karena bisa mengekspos:

- host,
- username,
- auth mechanism,
- recipient,
- message metadata,
- kadang content/body tergantung flow.

Prinsip:

> Debug SMTP hanya untuk controlled troubleshooting, bukan default production logging.

---

## 7. Timeout Deep Dive

Timeout adalah salah satu perbedaan paling besar antara demo code dan production-grade code.

Ada tiga timeout penting:

```text
connectiontimeout -> batas waktu membuka koneksi TCP
                timeout -> batas waktu membaca response dari server
           writetimeout -> batas waktu menulis data ke socket
```

### 7.1 `mail.smtp.connectiontimeout`

```properties
mail.smtp.connectiontimeout=5000
```

Mengontrol berapa lama client menunggu saat membuka koneksi TCP.

Failure yang ditangani:

```text
SMTP host unreachable
Firewall silently drops packet
Network routing problem
Server port closed/hung
```

Tanpa ini, thread bisa menunggu terlalu lama pada fase connect.

### 7.2 `mail.smtp.timeout`

```properties
mail.smtp.timeout=10000
```

Mengontrol read timeout, yaitu berapa lama client menunggu response SMTP server.

Contoh titik baca:

```text
after connect: waiting 220 greeting
EHLO: waiting server capability response
AUTH: waiting auth result
MAIL FROM: waiting accepted/rejected
RCPT TO: waiting accepted/rejected
DATA: waiting 354 go ahead
end of DATA: waiting final acceptance
```

Failure yang ditangani:

```text
server accepted connection but stopped responding
server slow during SMTP command
network blackhole after connect
server overload
```

### 7.3 `mail.smtp.writetimeout`

```properties
mail.smtp.writetimeout=10000
```

Mengontrol waktu maksimum saat menulis data ke socket.

Ini penting saat:

- message besar,
- attachment besar,
- network lambat,
- server menerima data sangat lambat,
- TCP buffer penuh.

Catatan penting: pada implementasi JavaMail/Jakarta Mail historis, write timeout diimplementasikan dengan scheduled executor per connection yang menutup socket jika timeout terjadi. Artinya ada overhead thread/resource per connection.

Maka jangan asal membuat ribuan parallel SMTP connection dengan write timeout tanpa capacity planning.

### 7.4 Timeout Value yang Masuk Akal

Tidak ada angka universal. Tetapi starting point realistis:

```properties
mail.smtp.connectiontimeout=5000
mail.smtp.timeout=10000
mail.smtp.writetimeout=10000
```

Untuk attachment besar atau provider lambat:

```properties
mail.smtp.connectiontimeout=5000
mail.smtp.timeout=30000
mail.smtp.writetimeout=30000
```

Jangan mulai dari timeout sangat besar seperti 5 menit kecuali ada alasan kuat.

Timeout harus selaras dengan:

- worker thread count,
- queue retry policy,
- provider SLA,
- user-facing SLA,
- max attachment size,
- batch throughput target.

### 7.5 Timeout dan User Request Thread

Anti-pattern:

```java
@PostMapping("/submit")
public ResponseEntity<?> submit(...) {
    saveBusinessData();
    mailService.sendEmailSynchronously();
    return ok();
}
```

Masalah:

```text
User request latency depends on SMTP server
SMTP timeout consumes web thread
Retry becomes awkward
Business transaction mixed with external side effect
Duplicate risk on retry
```

Lebih baik:

```text
Request thread:
  validate input
  save business data
  create notification/outbox record
  return response

Worker:
  pick pending email
  send via SMTP
  update status
  retry if needed
```

Detail outbox akan dibahas di Part 11.

---

## 8. STARTTLS Deep Dive

STARTTLS bukan sama dengan implicit TLS.

Flow STARTTLS:

```text
Client -> Server: TCP connect
Server -> Client: 220 smtp.example.com ESMTP
Client -> Server: EHLO app.example.com
Server -> Client: 250-STARTTLS
Client -> Server: STARTTLS
Server -> Client: 220 Ready to start TLS
Client <-> Server: TLS handshake
Client -> Server: EHLO app.example.com
Server -> Client: 250-AUTH ...
Client -> Server: AUTH ...
```

Kenapa EHLO dilakukan dua kali?

Karena capability sebelum TLS dan setelah TLS bisa berbeda. Server biasanya hanya menawarkan `AUTH` setelah koneksi aman.

### 8.1 `starttls.enable` vs `starttls.required`

```properties
mail.smtp.starttls.enable=true
```

Artinya: gunakan STARTTLS jika tersedia.

```properties
mail.smtp.starttls.required=true
```

Artinya: gagal jika STARTTLS tidak tersedia.

Untuk production, sering kali kombinasi yang benar:

```properties
mail.smtp.starttls.enable=true
mail.smtp.starttls.required=true
```

Tanpa `required`, aplikasi bisa fallback ke koneksi plaintext jika server tidak menawarkan STARTTLS. Ini membuka risiko downgrade, terutama jika network path tidak sepenuhnya trusted.

### 8.2 STARTTLS Failure Modes

Kemungkinan gagal:

```text
Server tidak menawarkan STARTTLS
Server menawarkan STARTTLS tetapi handshake gagal
Certificate expired
Hostname mismatch
Unknown CA
TLS protocol/cipher tidak kompatibel
Middlebox memodifikasi traffic
```

Cara berpikir:

> STARTTLS failure bukan sekadar “email gagal dikirim”. Itu bisa menjadi signal security misconfiguration.

Untuk sistem sensitif, failure TLS harus diperlakukan sebagai incident/config issue, bukan retry normal tanpa investigasi.

---

## 9. Implicit TLS / SMTPS Deep Dive

Implicit TLS biasanya port `465`.

Flow:

```text
Client -> Server: TCP connect
Client <-> Server: TLS handshake immediately
Server -> Client: 220 smtp.example.com ESMTP
Client -> Server: EHLO app.example.com
Client -> Server: AUTH ...
```

Konfigurasi:

```properties
mail.smtp.host=smtp.example.com
mail.smtp.port=465
mail.smtp.auth=true
mail.smtp.ssl.enable=true
mail.smtp.connectiontimeout=5000
mail.smtp.timeout=10000
mail.smtp.writetimeout=10000
```

Alternatif protocol `smtps` juga ada secara historis:

```java
Transport transport = session.getTransport("smtps");
```

Dengan properti:

```properties
mail.smtps.host=smtp.example.com
mail.smtps.port=465
mail.smtps.auth=true
mail.smtps.timeout=10000
```

Tetapi banyak aplikasi modern tetap memakai protocol `smtp` + `mail.smtp.ssl.enable=true` untuk simplicity.

Yang penting: konsisten.

---

## 10. TLS Trust, Certificate Validation, and Anti-Patterns

### 10.1 Default Trust Behavior

Secara default, Java menggunakan truststore JVM untuk memvalidasi sertifikat server.

Jika SMTP server memakai certificate public CA, biasanya langsung berjalan.

Jika memakai internal CA, maka JVM/container perlu trust CA tersebut.

### 10.2 Internal SMTP Relay dengan Private CA

Pola yang benar:

```text
1. Export internal CA certificate
2. Import ke truststore aplikasi/JVM/container
3. Mount truststore dengan secure config
4. Set JVM SSL properties jika perlu
5. Keep hostname verification valid
```

Contoh JVM args:

```bash
-Djavax.net.ssl.trustStore=/opt/app/truststore.p12
-Djavax.net.ssl.trustStorePassword=${TRUSTSTORE_PASSWORD}
-Djavax.net.ssl.trustStoreType=PKCS12
```

### 10.3 Anti-Pattern: Trust All Certificates

Sering ditemukan:

```properties
mail.smtp.ssl.trust=*
```

Atau custom socket factory yang menerima semua certificate.

Ini berbahaya karena:

- membuka risiko man-in-the-middle,
- menyembunyikan certificate misconfiguration,
- melemahkan compliance posture,
- membuat incident sulit dideteksi.

Ada properti seperti `mail.smtp.ssl.trust` yang bisa dipakai untuk mempercayai host tertentu, tetapi penggunaan harus sangat hati-hati dan sebaiknya bukan solusi default.

Lebih baik memperbaiki truststore.

### 10.4 Hostname Verification

Jika certificate CN/SAN tidak cocok dengan hostname yang dipakai aplikasi, TLS harus gagal.

Contoh salah:

```properties
mail.smtp.host=10.10.1.20
```

Tetapi certificate untuk:

```text
smtp.internal.example.com
```

Lebih baik pakai hostname yang sesuai certificate:

```properties
mail.smtp.host=smtp.internal.example.com
```

---

## 11. SMTP Authentication

SMTP AUTH terjadi setelah EHLO dan biasanya setelah STARTTLS.

Common mechanisms:

```text
PLAIN
LOGIN
XOAUTH2
CRAM-MD5 legacy
```

### 11.1 Username/Password Auth

Konfigurasi umum:

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
        return new PasswordAuthentication(username, password);
    }
});
```

### 11.2 Secret Management

Jangan hardcode:

```java
new PasswordAuthentication("user", "password123");
```

Production pattern:

```text
Secret manager / parameter store / vault
  -> application config binding
  -> MailProperties
  -> Authenticator
```

Contoh struktur config:

```yaml
mail:
  smtp:
    host: smtp.example.com
    port: 587
    username: ${SMTP_USERNAME}
    password: ${SMTP_PASSWORD}
    starttls-required: true
    connection-timeout-ms: 5000
    read-timeout-ms: 10000
    write-timeout-ms: 10000
```

### 11.3 Auth Failure

Common SMTP auth failure codes:

```text
535 Authentication failed
534 Authentication mechanism too weak / provider-specific policy
530 Authentication required
454 Temporary authentication failure
```

Classification:

| Failure | Likely Type | Action |
|---|---|---|
| wrong password | permanent until config fixed | alert, stop retry storm |
| expired credential | permanent until rotation | alert config owner |
| provider temporary auth outage | retryable | backoff |
| auth mechanism disabled | config/policy issue | investigate |
| TLS required before auth | config issue | require STARTTLS |

Important:

> Jangan retry cepat untuk auth failure permanen. Itu hanya membuat noise dan bisa lock account.

---

## 12. OAuth2 / XOAUTH2 Overview

Beberapa provider modern, terutama consumer/enterprise mailbox provider, mengurangi atau menolak password auth biasa.

XOAUTH2 secara konsep:

```text
Application obtains OAuth2 access token
Application connects to SMTP server
Application authenticates using XOAUTH2 mechanism
SMTP server validates token
```

Konfigurasi sangat provider-specific.

High-level concern:

- token lifecycle,
- refresh token storage,
- service account vs delegated user,
- tenant consent,
- scope,
- token expiry,
- retry after token refresh,
- audit.

Mental model:

> Jakarta Mail bisa menjadi SMTP protocol client, tetapi OAuth2 token acquisition bukan tanggung jawab utama Jakarta Mail. Biasanya token didapat dari identity SDK/provider-specific flow, lalu dipakai untuk SMTP AUTH XOAUTH2.

Untuk enterprise app, sering lebih sederhana memakai:

- SMTP relay internal,
- provider API dengan service credential,
- email delivery provider seperti SES/SendGrid/Mailgun/Postmark,
- bukan mailbox-user SMTP auth.

---

## 13. `Transport.send()` vs Manual `Transport`

Ada dua pola utama.

### 13.1 Static `Transport.send(message)`

```java
Transport.send(message);
```

Kelebihan:

- sederhana,
- cocok untuk quick send,
- otomatis memilih transport berdasarkan message/session.

Kekurangan:

- kurang eksplisit,
- connection lifecycle kurang terlihat,
- kurang cocok untuk batch sending,
- sulit melakukan connection reuse,
- partial failure handling tetap perlu dibaca dari exception.

### 13.2 Manual Transport

```java
Transport transport = session.getTransport("smtp");
try {
    transport.connect(host, port, username, password);
    transport.sendMessage(message, message.getAllRecipients());
} finally {
    transport.close();
}
```

Kelebihan:

- connection lifecycle eksplisit,
- bisa reuse connection untuk beberapa message,
- lebih mudah instrumentasi,
- lebih mudah custom failure handling.

Kekurangan:

- harus disiplin close,
- harus mengelola connection state,
- connection reuse harus hati-hati terhadap provider limit.

### 13.3 Kapan Pakai Mana?

| Situation | Recommended |
|---|---|
| simple low-volume transactional email | `Transport.send` acceptable |
| production service with observability | manual `Transport` better |
| batch send many emails | manual `Transport` with controlled reuse |
| provider-specific transport details | manual `Transport` |
| clean architecture gateway | manual under `MailGateway` |

---

## 14. Basic Sending Example: Jakarta Mail Modern

Contoh minimal tetapi lebih aman:

```java
package example.mail;

import jakarta.mail.Authenticator;
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.PasswordAuthentication;
import jakarta.mail.Session;
import jakarta.mail.Transport;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;

import java.nio.charset.StandardCharsets;
import java.util.Properties;

public final class JakartaSmtpSendExample {

    public static void main(String[] args) throws Exception {
        String host = "smtp.example.com";
        int port = 587;
        String username = System.getenv("SMTP_USERNAME");
        String password = System.getenv("SMTP_PASSWORD");

        Properties props = new Properties();
        props.put("mail.smtp.host", host);
        props.put("mail.smtp.port", String.valueOf(port));
        props.put("mail.smtp.auth", "true");
        props.put("mail.smtp.starttls.enable", "true");
        props.put("mail.smtp.starttls.required", "true");
        props.put("mail.smtp.connectiontimeout", "5000");
        props.put("mail.smtp.timeout", "10000");
        props.put("mail.smtp.writetimeout", "10000");

        Session session = Session.getInstance(props, new Authenticator() {
            @Override
            protected PasswordAuthentication getPasswordAuthentication() {
                return new PasswordAuthentication(username, password);
            }
        });

        MimeMessage message = new MimeMessage(session);
        message.setFrom(new InternetAddress("no-reply@example.com", "Example App"));
        message.setRecipient(Message.RecipientType.TO, new InternetAddress("user@example.net"));
        message.setSubject("Test email", StandardCharsets.UTF_8.name());
        message.setText("Hello from Jakarta Mail.", StandardCharsets.UTF_8.name());

        Transport.send(message);
    }
}
```

Catatan:

- `setSubject(..., UTF_8)` membantu subject non-ASCII.
- `setText(..., UTF_8)` membantu body non-ASCII.
- timeout selalu dipasang.
- STARTTLS required.
- secret dari environment hanya contoh; di production gunakan secret manager.

---

## 15. Basic Sending Example: Java 8 / JavaMail Legacy

Untuk Java 8 legacy, import berubah:

```java
package example.mail;

import javax.mail.Authenticator;
import javax.mail.Message;
import javax.mail.PasswordAuthentication;
import javax.mail.Session;
import javax.mail.Transport;
import javax.mail.internet.InternetAddress;
import javax.mail.internet.MimeMessage;

import java.nio.charset.StandardCharsets;
import java.util.Properties;

public final class JavaxSmtpSendExample {

    public static void main(String[] args) throws Exception {
        String host = "smtp.example.com";
        int port = 587;
        String username = System.getenv("SMTP_USERNAME");
        String password = System.getenv("SMTP_PASSWORD");

        Properties props = new Properties();
        props.put("mail.smtp.host", host);
        props.put("mail.smtp.port", String.valueOf(port));
        props.put("mail.smtp.auth", "true");
        props.put("mail.smtp.starttls.enable", "true");
        props.put("mail.smtp.starttls.required", "true");
        props.put("mail.smtp.connectiontimeout", "5000");
        props.put("mail.smtp.timeout", "10000");
        props.put("mail.smtp.writetimeout", "10000");

        Session session = Session.getInstance(props, new Authenticator() {
            @Override
            protected PasswordAuthentication getPasswordAuthentication() {
                return new PasswordAuthentication(username, password);
            }
        });

        MimeMessage message = new MimeMessage(session);
        message.setFrom(new InternetAddress("no-reply@example.com", "Example App"));
        message.setRecipient(Message.RecipientType.TO, new InternetAddress("user@example.net"));
        message.setSubject("Test email", StandardCharsets.UTF_8.name());
        message.setText("Hello from JavaMail.", StandardCharsets.UTF_8.name());

        Transport.send(message);
    }
}
```

Concept sama. Namespace berbeda.

---

## 16. Production-Oriented `MailGateway` Design

Jangan sebar kode Jakarta Mail di controller, service bisnis, atau job logic.

Buat boundary:

```text
Business Service
  -> NotificationService
      -> MailGateway interface
          -> JakartaMailSmtpGateway implementation
```

### 16.1 Interface

```java
public interface MailGateway {
    MailSendResult send(MailEnvelope envelope) throws MailGatewayException;
}
```

### 16.2 Domain Request

```java
import java.util.List;
import java.util.Map;

public final class MailEnvelope {
    private final String from;
    private final List<String> to;
    private final List<String> cc;
    private final List<String> bcc;
    private final String subject;
    private final String textBody;
    private final String htmlBody;
    private final Map<String, String> headers;

    public MailEnvelope(
            String from,
            List<String> to,
            List<String> cc,
            List<String> bcc,
            String subject,
            String textBody,
            String htmlBody,
            Map<String, String> headers
    ) {
        this.from = from;
        this.to = to;
        this.cc = cc;
        this.bcc = bcc;
        this.subject = subject;
        this.textBody = textBody;
        this.htmlBody = htmlBody;
        this.headers = headers;
    }

    public String from() { return from; }
    public List<String> to() { return to; }
    public List<String> cc() { return cc; }
    public List<String> bcc() { return bcc; }
    public String subject() { return subject; }
    public String textBody() { return textBody; }
    public String htmlBody() { return htmlBody; }
    public Map<String, String> headers() { return headers; }
}
```

### 16.3 Result Model

```java
public final class MailSendResult {
    private final boolean acceptedBySmtp;
    private final String providerMessageId;
    private final long durationMillis;

    public MailSendResult(boolean acceptedBySmtp, String providerMessageId, long durationMillis) {
        this.acceptedBySmtp = acceptedBySmtp;
        this.providerMessageId = providerMessageId;
        this.durationMillis = durationMillis;
    }

    public boolean acceptedBySmtp() { return acceptedBySmtp; }
    public String providerMessageId() { return providerMessageId; }
    public long durationMillis() { return durationMillis; }
}
```

Catatan: SMTP tidak selalu memberi provider message id yang stabil seperti email API provider. `Message-ID` header bisa dibuat client-side, tetapi itu bukan bukti final delivery.

---

## 17. Manual Transport with Explicit Lifecycle

Contoh Jakarta Mail:

```java
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.Session;
import jakarta.mail.Transport;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.ArrayList;
import java.util.List;

public final class JakartaMailSmtpGateway implements MailGateway {

    private final Session session;
    private final String host;
    private final int port;
    private final String username;
    private final String password;
    private final Clock clock;

    public JakartaMailSmtpGateway(
            Session session,
            String host,
            int port,
            String username,
            String password,
            Clock clock
    ) {
        this.session = session;
        this.host = host;
        this.port = port;
        this.username = username;
        this.password = password;
        this.clock = clock;
    }

    @Override
    public MailSendResult send(MailEnvelope envelope) throws MailGatewayException {
        long start = clock.millis();

        try {
            MimeMessage message = buildMessage(envelope);

            Transport transport = session.getTransport("smtp");
            try {
                transport.connect(host, port, username, password);
                transport.sendMessage(message, message.getAllRecipients());
            } finally {
                try {
                    transport.close();
                } catch (MessagingException closeError) {
                    // Usually log as warning. Do not mask original send failure if one exists.
                }
            }

            long duration = clock.millis() - start;
            return new MailSendResult(true, message.getMessageID(), duration);
        } catch (MessagingException ex) {
            throw MailGatewayException.fromMessagingException(ex);
        } catch (Exception ex) {
            throw new MailGatewayException(MailFailureKind.UNKNOWN, "Unexpected mail send failure", ex);
        }
    }

    private MimeMessage buildMessage(MailEnvelope envelope) throws Exception {
        MimeMessage message = new MimeMessage(session);
        message.setFrom(new InternetAddress(envelope.from()));

        for (String to : envelope.to()) {
            message.addRecipient(Message.RecipientType.TO, new InternetAddress(to));
        }
        for (String cc : safeList(envelope.cc())) {
            message.addRecipient(Message.RecipientType.CC, new InternetAddress(cc));
        }
        for (String bcc : safeList(envelope.bcc())) {
            message.addRecipient(Message.RecipientType.BCC, new InternetAddress(bcc));
        }

        message.setSubject(envelope.subject(), StandardCharsets.UTF_8.name());
        message.setText(envelope.textBody(), StandardCharsets.UTF_8.name());

        for (var entry : envelope.headers().entrySet()) {
            validateHeader(entry.getKey(), entry.getValue());
            message.setHeader(entry.getKey(), entry.getValue());
        }

        message.saveChanges();
        return message;
    }

    private static List<String> safeList(List<String> value) {
        return value == null ? new ArrayList<>() : value;
    }

    private static void validateHeader(String name, String value) {
        if (name == null || name.contains("\r") || name.contains("\n")) {
            throw new IllegalArgumentException("Invalid header name");
        }
        if (value != null && (value.contains("\r") || value.contains("\n"))) {
            throw new IllegalArgumentException("Invalid header value");
        }
    }
}
```

Catatan untuk Java 8:

- ganti import `jakarta.mail.*` ke `javax.mail.*`;
- ganti `var` di loop menjadi explicit `Map.Entry<String, String>`;
- gunakan JavaMail dependency legacy.

---

## 18. Failure Classification Layer

Jangan biarkan `MessagingException` bocor ke domain layer.

Buat failure kind:

```java
public enum MailFailureKind {
    CONFIGURATION,
    AUTHENTICATION,
    TLS,
    CONNECT_TIMEOUT,
    READ_TIMEOUT,
    WRITE_TIMEOUT,
    RECIPIENT_REJECTED,
    SENDER_REJECTED,
    CONTENT_REJECTED,
    SERVER_TEMPORARY_FAILURE,
    SERVER_PERMANENT_FAILURE,
    PARTIAL_SEND,
    UNKNOWN
}
```

Exception wrapper:

```java
public final class MailGatewayException extends Exception {
    private final MailFailureKind kind;

    public MailGatewayException(MailFailureKind kind, String message, Throwable cause) {
        super(message, cause);
        this.kind = kind;
    }

    public MailFailureKind kind() {
        return kind;
    }

    public static MailGatewayException fromMessagingException(MessagingException ex) {
        String message = ex.getMessage() == null ? "" : ex.getMessage().toLowerCase();

        if (message.contains("authentication") || message.contains("auth") || message.contains("535")) {
            return new MailGatewayException(MailFailureKind.AUTHENTICATION, "SMTP authentication failed", ex);
        }
        if (message.contains("could not connect") || message.contains("connection timed out")) {
            return new MailGatewayException(MailFailureKind.CONNECT_TIMEOUT, "SMTP connection failed", ex);
        }
        if (message.contains("starttls") || message.contains("tls") || message.contains("ssl")) {
            return new MailGatewayException(MailFailureKind.TLS, "SMTP TLS failure", ex);
        }

        return new MailGatewayException(MailFailureKind.UNKNOWN, "SMTP send failed", ex);
    }
}
```

Ini masih sederhana. Di Part 10 kita akan membuat classifier yang lebih serius memakai:

- `SendFailedException`,
- `SMTPAddressFailedException`,
- `SMTPSendFailedException`,
- nested exception,
- SMTP code,
- valid sent/unsent/invalid addresses.

Prinsipnya sudah jelas:

> Business layer butuh semantic failure, bukan raw library exception.

---

## 19. Partial Recipient Failure

Satu message bisa punya banyak recipient:

```text
To: a@example.com, b@example.com, c@example.com
```

SMTP server bisa menerima sebagian dan menolak sebagian.

Contoh:

```text
MAIL FROM:<no-reply@example.com>
250 OK
RCPT TO:<a@example.com>
250 OK
RCPT TO:<b@example.com>
550 No such user
RCPT TO:<c@example.com>
250 OK
DATA
354 End data with <CR><LF>.<CR><LF>
...
250 Accepted
```

Pertanyaan production:

```text
Apakah message dianggap berhasil?
Apakah perlu retry b@example.com saja?
Apakah a dan c akan menerima duplicate jika seluruh message di-retry?
Apakah business notification tracking per email atau per recipient?
```

Untuk transactional email penting, lebih aman:

> satu logical notification recipient = satu email send attempt.

Bukan karena SMTP tidak bisa multi-recipient, tetapi karena state tracking, personalization, audit, privacy, dan retry jauh lebih bersih.

Anti-pattern:

```text
Send one message to 500 recipients via TO/CC
```

Masalah:

- privacy leak,
- partial failure sulit,
- personalization impossible,
- one recipient rejection bisa mempengaruhi batch,
- audit per recipient lemah.

Lebih baik:

```text
500 recipients -> 500 logical send records -> controlled worker/rate limit
```

---

## 20. SMTP Envelope vs Message Headers in JavaMail

Salah satu konsep paling penting:

```text
Message header From != SMTP envelope MAIL FROM
Message header To   != necessarily SMTP envelope RCPT TO
```

Dalam Jakarta Mail, `message.setFrom()` mengatur header `From`.

Recipients di `message.setRecipient()` biasanya dipakai sebagai envelope recipients ketika `sendMessage(message, message.getAllRecipients())`.

Tetapi envelope sender bisa dikontrol dengan properti tertentu seperti:

```properties
mail.smtp.from=bounce@example.com
```

Ini dapat mempengaruhi SMTP `MAIL FROM`, bukan header `From`.

Contoh use case:

```text
Header From: no-reply@example.com
Envelope MAIL FROM: bounce-handler@example.com
```

Kenapa penting?

- bounce routing,
- SPF alignment,
- DMARC alignment,
- return-path handling,
- multi-tenant sending,
- deliverability.

Detail deliverability akan dibahas di Part 14 dan bounce di Part 23.

---

## 21. EHLO/HELO Identity and `mail.smtp.localhost`

SMTP client mengirim EHLO identity:

```text
EHLO app-node-01.example.internal
```

Kadang environment container/Kubernetes menghasilkan hostname aneh:

```text
EHLO 7f9cdb8d77-abc12
```

Beberapa SMTP relay mungkin tidak peduli. Sebagian policy engine bisa memakai EHLO untuk diagnostics/policy.

Jakarta Mail property:

```properties
mail.smtp.localhost=app-service.example.internal
```

Gunakan bila:

- hostname container tidak stabil,
- relay policy butuh EHLO tertentu,
- logs SMTP perlu identity yang mudah dibaca,
- troubleshooting multi-node.

Jangan jadikan ini security boundary. EHLO mudah dipalsukan.

---

## 22. Debugging SMTP Transcript

Debug output SMTP kira-kira seperti:

```text
DEBUG SMTP: trying to connect to host "smtp.example.com", port 587, isSSL false
220 smtp.example.com ESMTP
EHLO app-node-01
250-smtp.example.com
250-STARTTLS
250-AUTH PLAIN LOGIN
STARTTLS
220 Ready to start TLS
EHLO app-node-01
250-AUTH PLAIN LOGIN
AUTH LOGIN
235 Authentication successful
MAIL FROM:<no-reply@example.com>
250 Sender OK
RCPT TO:<user@example.net>
250 Recipient OK
DATA
354 End data with <CR><LF>.<CR><LF>
250 Message accepted
QUIT
221 Bye
```

Yang bisa dipelajari:

- server yang dipakai benar atau tidak,
- port benar atau tidak,
- STARTTLS ditawarkan atau tidak,
- AUTH mechanism tersedia atau tidak,
- sender/recipient ditolak di tahap mana,
- timeout terjadi sebelum/selepas command apa.

Namun jangan log secara bebas:

- recipient adalah PII,
- subject bisa sensitif,
- body bisa sangat sensitif,
- debug auth bisa membuka detail mekanisme.

Production approach:

```text
Default: structured sanitized logs
Troubleshooting: enable debug temporarily in lower env or targeted production session with redaction
After incident: disable debug
```

---

## 23. Structured Logging for SMTP Sending

Log yang buruk:

```text
Failed to send email: jakarta.mail.MessagingException: ... full message body ...
```

Log yang baik:

```json
{
  "event": "mail_send_failed",
  "notificationId": "NOTIF-2026-000123",
  "attempt": 3,
  "smtpHost": "smtp.example.com",
  "smtpPort": 587,
  "tlsMode": "STARTTLS_REQUIRED",
  "failureKind": "AUTHENTICATION",
  "smtpCode": "535",
  "recipientCount": 1,
  "durationMs": 842,
  "correlationId": "7d6c...",
  "message": "SMTP authentication failed"
}
```

Hindari:

- full recipient kalau tidak perlu,
- body,
- attachment filename sensitif,
- SMTP password,
- OAuth token,
- full MIME raw.

Jika perlu recipient analytics, gunakan hashing atau masking:

```text
u***@example.net
sha256(normalizedEmail + tenantSalt)
```

---

## 24. Connection Reuse

Manual `Transport` memungkinkan reuse:

```java
Transport transport = session.getTransport("smtp");
try {
    transport.connect(host, port, username, password);

    for (MimeMessage message : messages) {
        transport.sendMessage(message, message.getAllRecipients());
    }
} finally {
    transport.close();
}
```

Kelebihan:

- mengurangi TCP/TLS/auth overhead,
- throughput lebih baik,
- cocok untuk batch kecil/medium.

Risiko:

- connection bisa stale,
- provider bisa limit messages per connection,
- failure di tengah batch harus diisolasi,
- long-lived connection bisa terputus idle,
- concurrent use satu `Transport` tidak aman sebagai shared object.

Prinsip:

```text
Reuse within bounded worker scope.
Do not keep one global SMTP connection forever.
Do not share one Transport concurrently between threads.
```

Pola realistis:

```text
Worker picks up to N pending emails
Open transport
Send up to N or until failure threshold
Close transport
Commit statuses
```

Atau:

```text
Open per send for low volume
Open per small batch for controlled high volume
```

---

## 25. Threading and Resource Model

`Session` dapat dipakai sebagai shared configuration object.

`Message` adalah mutable object. Jangan share antar thread.

`Transport` merepresentasikan connection/session state. Jangan share concurrent antar thread.

Safe mental model:

| Object | Share Across Threads? | Reason |
|---|---:|---|
| `Properties` after build | yes if immutable by convention | config only |
| `Session` | generally yes | shared mail config/provider context |
| `MimeMessage` | no | mutable message state |
| `Transport` | no | connection state |
| `Authenticator` | yes if immutable/secret-safe | credential provider |

Worker pool pattern:

```text
Shared Session
  Worker 1 -> creates message -> gets Transport -> sends -> closes
  Worker 2 -> creates message -> gets Transport -> sends -> closes
  Worker 3 -> creates message -> gets Transport -> sends -> closes
```

Do not mutate `Session` debug/config during concurrent sending.

---

## 26. Java 21+ Virtual Threads: Helpful but Not Magic

SMTP sending is blocking I/O.

Java 21 virtual threads can make blocking code cheaper from thread perspective.

Potential benefit:

```text
Many concurrent send attempts with simpler blocking code
Less pressure on platform thread pool
```

But virtual threads do not remove:

- SMTP provider rate limits,
- network bandwidth limit,
- TLS handshake cost,
- SMTP server concurrency limit,
- write timeout overhead,
- memory cost of message/attachment,
- need for backpressure.

Bad use:

```text
Create 10,000 virtual threads and send 10,000 SMTP messages at once
```

Better use:

```text
Queue + rate limiter + bounded concurrency
Virtual threads only as execution mechanism
```

Principle:

> Virtual threads make blocking cheaper, not external systems infinite.

---

## 27. SMTP Sending State Machine

A useful production mental model:

```text
CREATED
  |
  v
MESSAGE_BUILT
  |
  v
CONNECTING
  |
  +-- connect timeout -> FAILED_CONNECT_TIMEOUT
  +-- connect error   -> FAILED_CONNECT
  v
CONNECTED
  |
  v
TLS_NEGOTIATING
  |
  +-- tls failure -> FAILED_TLS
  v
AUTHENTICATING
  |
  +-- auth failure -> FAILED_AUTH
  v
SENDING_ENVELOPE
  |
  +-- sender rejected    -> FAILED_SENDER
  +-- recipient rejected -> FAILED_RECIPIENT/PARTIAL
  v
SENDING_DATA
  |
  +-- write timeout -> FAILED_WRITE_TIMEOUT
  +-- content reject -> FAILED_CONTENT
  v
ACCEPTED_BY_SMTP
  |
  v
CLOSED
```

This state machine matters because each failure has different action:

| State | Failure | Retry? | Alert? |
|---|---|---:|---:|
| CONNECTING | network timeout | yes with backoff | if spike |
| TLS_NEGOTIATING | cert invalid | usually no | yes |
| AUTHENTICATING | bad credential | no fast retry | yes |
| SENDING_ENVELOPE | invalid recipient | no | maybe not |
| SENDING_DATA | temporary server error | yes | if spike |
| ACCEPTED_BY_SMTP | later bounce | separate flow | depends |

---

## 28. Retriability at SMTP Layer

SMTP codes:

```text
2xx -> success
4xx -> transient failure
5xx -> permanent failure
```

But real classification still needs context.

Examples:

| Code | Meaning | General Action |
|---:|---|---|
| 421 | service not available | retry with backoff |
| 450 | mailbox unavailable temporary | retry |
| 451 | local error | retry |
| 452 | insufficient storage | retry later |
| 550 | mailbox unavailable / rejected | usually permanent |
| 551 | user not local | permanent/manual |
| 552 | exceeded storage allocation | sometimes permanent-ish |
| 553 | mailbox name invalid | permanent |
| 554 | transaction failed/content rejected | depends |

Important:

> Retrying a permanent recipient rejection wastes resources and can harm reputation.

But also:

> Treating all 5xx as business-final without inspecting provider behavior can be too naive.

Part 10 and Part 11 will build a stronger classifier and retry model.

---

## 29. Avoiding Duplicate Sends

SMTP duplicate risk is subtle.

Scenario:

```text
Client sends DATA
Server accepts message
Server replies: 250 OK
Network drops before client reads 250
Client sees timeout
Client retries
Recipient receives duplicate
```

From client perspective:

```text
Timeout after DATA may mean unknown outcome.
```

This is why exactly-once email sending is hard.

Mitigation:

1. Generate stable business notification id.
2. Generate stable `Message-ID` header per logical send.
3. Store send attempt state.
4. Avoid blind retry if failure occurred after DATA completion and outcome is unknown.
5. Use provider API/webhook if stronger state is needed.
6. Make recipients tolerate duplicates where possible.
7. Avoid sending inside retried DB transaction.

Example custom header:

```text
X-App-Notification-Id: NOTIF-2026-000123
```

But remember: custom header does not prevent duplicate delivery. It helps trace and deduplicate downstream if you control ingestion.

---

## 30. `Message-ID` and `saveChanges()`

`MimeMessage.saveChanges()` updates headers such as date and message id if needed.

`Transport.send()` typically calls `saveChanges()` before sending.

Manual flow can explicitly call:

```java
message.saveChanges();
```

If you need stable `Message-ID`, you can set it intentionally, but be careful. Message-ID should be globally unique.

Possible pattern:

```text
<notificationId.randomSuffix@app.example.com>
```

Do not reuse the same `Message-ID` for logically different email messages.

For retry of the same logical message, reusing same Message-ID can help identify duplicate attempts, but provider/client behavior varies.

---

## 31. Header Injection Defense

If any header value comes from user input, validate it.

Dangerous input:

```text
Subject: Hello\r\nBcc: attacker@example.com
```

If library or wrapper incorrectly accepts CRLF injection, attacker may inject additional headers.

Defensive rules:

```text
Header names: no CR/LF, allowed known names only
Header values: no raw CR/LF unless using proper folded header API
Address fields: parse using InternetAddress validation
Subject: use setSubject(value, charset), reject control chars
```

Example:

```java
private static void rejectHeaderInjection(String value) {
    if (value != null && (value.contains("\r") || value.contains("\n"))) {
        throw new IllegalArgumentException("Header injection detected");
    }
}
```

Do not build raw message strings manually unless you deeply understand RFC formatting.

---

## 32. Recipient Validation: Syntax vs Deliverability

`InternetAddress` can validate syntax:

```java
InternetAddress address = new InternetAddress("user@example.com");
address.validate();
```

But syntax validation does not prove:

- mailbox exists,
- domain accepts mail,
- user wants email,
- email will be delivered,
- provider will not reject later.

Validation levels:

```text
Level 1: not blank
Level 2: syntactically valid address
Level 3: domain policy / MX check
Level 4: provider acceptance during SMTP RCPT
Level 5: actual delivery/inbox placement
```

Most applications should do level 1–2 before attempting send. Higher levels are operational/deliverability concerns.

---

## 33. BCC Handling

`Bcc` is a message header concept but should not be visible to recipients.

Jakarta Mail normally removes/does not expose BCC in sent message content according to send behavior. But you should still reason carefully.

Safer enterprise pattern:

```text
For transactional messages, avoid BCC for business recipients.
Use separate per-recipient messages.
Use BCC only for controlled internal archive/compliance use if approved.
```

Why?

- privacy,
- audit clarity,
- partial failure handling,
- personalization,
- unsubscribe/preference,
- recipient-level status.

---

## 34. Sender Rewriting and Provider Policy

You may set:

```java
message.setFrom("no-reply@your-domain.com");
```

But SMTP provider may reject or rewrite if:

- authenticated account is not allowed to send as that domain,
- domain not verified,
- SPF/DKIM not configured,
- tenant policy disallows sender spoofing,
- From domain violates DMARC alignment.

Possible errors:

```text
550 Sender not authorized
553 From address not verified
554 Message rejected due to policy
```

Design implication:

> Sender identity is not just application config. It is provider/domain governance.

For multi-tenant systems, never let arbitrary tenant configure `From` without verification.

---

## 35. SMTP Configuration Object

Avoid raw `Properties` scattered everywhere.

Create typed config:

```java
public final class SmtpConfig {
    private final String host;
    private final int port;
    private final boolean auth;
    private final String username;
    private final String password;
    private final boolean startTlsEnabled;
    private final boolean startTlsRequired;
    private final boolean sslEnabled;
    private final int connectionTimeoutMs;
    private final int readTimeoutMs;
    private final int writeTimeoutMs;
    private final String localhost;

    // constructor/getters omitted

    public Properties toProperties() {
        Properties props = new Properties();
        props.put("mail.smtp.host", host);
        props.put("mail.smtp.port", String.valueOf(port));
        props.put("mail.smtp.auth", String.valueOf(auth));
        props.put("mail.smtp.starttls.enable", String.valueOf(startTlsEnabled));
        props.put("mail.smtp.starttls.required", String.valueOf(startTlsRequired));
        props.put("mail.smtp.ssl.enable", String.valueOf(sslEnabled));
        props.put("mail.smtp.connectiontimeout", String.valueOf(connectionTimeoutMs));
        props.put("mail.smtp.timeout", String.valueOf(readTimeoutMs));
        props.put("mail.smtp.writetimeout", String.valueOf(writeTimeoutMs));
        if (localhost != null && !localhost.isBlank()) {
            props.put("mail.smtp.localhost", localhost);
        }
        return props;
    }
}
```

For Java 8, replace `isBlank()` with trim check.

Add validation:

```text
host required
port 1..65535
timeouts > 0
if sslEnabled then starttls usually false
if port 465 then sslEnabled expected
if port 587 then starttls expected
if auth true then username/password required
```

---

## 36. Configuration Validation Rules

Example validation matrix:

| Rule | Why |
|---|---|
| `host` must not be blank | no target SMTP server |
| `port` must be valid | fail fast |
| timeout must be set | avoid infinite blocking |
| timeout not too high | avoid worker starvation |
| `starttls.required=true` when STARTTLS enabled | avoid silent plaintext fallback |
| do not enable both implicit SSL and STARTTLS casually | confused TLS mode |
| auth credential required if `auth=true` | avoid runtime auth failure |
| no debug in production by default | avoid data leakage |
| configured sender domain must be allowed | avoid provider rejection |

Fail fast on startup if config invalid.

Bad:

```text
Application starts fine, first email fails after deployment.
```

Better:

```text
Application refuses startup or marks mail subsystem unhealthy if required config missing.
```

---

## 37. Health Check: Be Careful

A naive health check may send real email every minute. Bad.

Options:

### 37.1 Config Health

Checks:

```text
host configured
port configured
timeout configured
credential present
TLS mode sane
```

No network call.

### 37.2 Connectivity Health

Open SMTP connection and maybe EHLO/STARTTLS/auth, then quit.

Risk:

- provider rate limits,
- auth logs noise,
- health endpoint becomes slow,
- credential lockout if misconfigured.

### 37.3 Synthetic Email Health

Send test email to controlled mailbox.

Use sparingly:

- scheduled canary,
- lower env,
- production only if approved.

Principle:

> Health check should not become a mail traffic generator or security risk.

---

## 38. Kubernetes / Cloud Runtime Concerns

Mail sending from cloud/Kubernetes has extra concerns:

### 38.1 Egress Rules

SMTP ports may be blocked:

```text
25 blocked by cloud provider
587 allowed only via NAT/firewall
465 blocked by corporate policy
```

Failure symptom:

```text
Connection timeout
Connection refused
No route to host
```

### 38.2 NAT IP Reputation

If SMTP provider uses source IP allowlist, scaling nodes/NAT gateway changes can break sending.

Track:

- NAT gateway IP,
- egress firewall,
- VPC endpoint if provider supports,
- source IP allowlist.

### 38.3 DNS

SMTP host resolution can fail due to:

- CoreDNS issue,
- search domain misconfiguration,
- DNS cache stale,
- split-horizon DNS.

### 38.4 Secret Rotation

Credential rotation in Kubernetes:

```text
Secret updated
Pod may not reload env var automatically
App may need restart or dynamic config reload
SMTP auth starts failing after old credential revoked
```

Design rotation process explicitly.

---

## 39. SMTP Sending and Transactions

Never treat SMTP send as part of DB transaction in the same way as database writes.

Bad:

```java
@Transactional
public void approveApplication(String id) {
    application.approve(id);
    mailGateway.send(approvalEmail);
}
```

Possible failures:

```text
DB commit fails after email sent -> user receives approval for uncommitted state
SMTP fails before commit -> transaction rollback though business state could have succeeded
Transaction retried -> duplicate email
Long SMTP timeout holds DB transaction open
```

Better:

```java
@Transactional
public void approveApplication(String id) {
    application.approve(id);
    outbox.insertApprovalEmailRequested(id);
}
```

Then worker sends after commit.

Detailed architecture in Part 11.

---

## 40. Recommended SMTP Sending Defaults

Starting point for enterprise transactional email:

```properties
mail.smtp.host=smtp.example.com
mail.smtp.port=587
mail.smtp.auth=true
mail.smtp.starttls.enable=true
mail.smtp.starttls.required=true
mail.smtp.connectiontimeout=5000
mail.smtp.timeout=10000
mail.smtp.writetimeout=10000
mail.debug=false
```

If port 465:

```properties
mail.smtp.host=smtp.example.com
mail.smtp.port=465
mail.smtp.auth=true
mail.smtp.ssl.enable=true
mail.smtp.connectiontimeout=5000
mail.smtp.timeout=10000
mail.smtp.writetimeout=10000
mail.debug=false
```

For internal trusted relay without auth:

```properties
mail.smtp.host=smtp-relay.internal.example.com
mail.smtp.port=25
mail.smtp.auth=false
mail.smtp.starttls.enable=true
mail.smtp.starttls.required=true
mail.smtp.connectiontimeout=5000
mail.smtp.timeout=10000
mail.smtp.writetimeout=10000
mail.debug=false
```

But if internal relay cannot support TLS, document the exception and compensate with network controls. Do not silently accept insecure defaults.

---

## 41. Common Mistakes and Corrections

### Mistake 1: No Timeout

Bad:

```java
props.put("mail.smtp.host", host);
```

Correction:

```java
props.put("mail.smtp.connectiontimeout", "5000");
props.put("mail.smtp.timeout", "10000");
props.put("mail.smtp.writetimeout", "10000");
```

### Mistake 2: STARTTLS Optional in Sensitive System

Bad:

```properties
mail.smtp.starttls.enable=true
```

Correction:

```properties
mail.smtp.starttls.enable=true
mail.smtp.starttls.required=true
```

### Mistake 3: Wrong TLS Mode for Port

Bad:

```properties
mail.smtp.port=587
mail.smtp.ssl.enable=true
```

Usually correction:

```properties
mail.smtp.port=587
mail.smtp.starttls.enable=true
mail.smtp.starttls.required=true
```

For port 465:

```properties
mail.smtp.port=465
mail.smtp.ssl.enable=true
```

### Mistake 4: Sending in Request Transaction

Bad:

```text
HTTP request -> DB update -> SMTP send -> response
```

Correction:

```text
HTTP request -> DB update + outbox -> response
Worker -> SMTP send
```

### Mistake 5: Multi-Recipient Transactional Message

Bad:

```text
One email to many users in TO/CC
```

Correction:

```text
One logical notification per recipient
```

### Mistake 6: Trust All TLS

Bad:

```properties
mail.smtp.ssl.trust=*
```

Correction:

```text
Configure proper JVM/container truststore
Use hostname matching certificate
```

### Mistake 7: Raw Header Concatenation

Bad:

```java
message.addHeader("X-User", userInput);
```

Without validation.

Correction:

```java
validateNoCrLf(userInput);
message.addHeader("X-User", userInput);
```

Or avoid user-supplied custom headers entirely.

---

## 42. Design Checklist

Before a mail sending module goes to production, answer these:

### Configuration

- Is SMTP host explicit per environment?
- Is port correct for TLS mode?
- Are all three timeouts configured?
- Is STARTTLS required where applicable?
- Are credentials stored in secret manager?
- Is debug disabled by default?
- Is sender domain verified/allowed?

### Runtime

- Is sending outside request transaction?
- Is concurrency bounded?
- Is rate limit respected?
- Is connection reuse controlled?
- Are large messages/attachments limited?
- Is `Transport` closed reliably?

### Failure Handling

- Are auth failures classified separately?
- Are TLS failures alertable?
- Are recipient rejections not retried forever?
- Are unknown outcomes handled carefully?
- Is partial recipient failure understood?

### Observability

- Is there correlation ID?
- Is notification ID logged?
- Is recipient PII masked?
- Are latency and failure metrics recorded?
- Can SMTP transcript be enabled safely for diagnosis?

### Security

- Are headers protected from injection?
- Is TLS certificate validation preserved?
- Are secrets redacted?
- Is no raw MIME/body logged?
- Is multi-tenant sender spoofing prevented?

---

## 43. Top 1% Mental Model

A normal engineer asks:

> “How do I send email from Java?”

A stronger engineer asks:

> “What exactly does successful send mean?”

A top-tier engineer asks:

```text
Which boundary am I crossing?
What is the timeout at every blocking point?
What is the retry classification?
What happens if server accepted but client timed out?
Can this produce duplicate emails?
Is recipient state tracked per recipient?
Are secrets and PII protected?
Is TLS actually required or just preferred?
Can we explain this behavior during an incident?
Can we prove what happened to a specific notification?
```

The API call is small. The engineering surface is large.

Jakarta Mail is just the SMTP client library. The production system around it determines whether your mail subsystem is reliable, secure, and operable.

---

## 44. Practical Exercises

### Exercise 1 — Config Review

Given:

```properties
mail.smtp.host=smtp.example.com
mail.smtp.port=587
mail.smtp.auth=true
mail.smtp.starttls.enable=true
```

Identify what is missing for production.

Expected answer:

```text
Missing connection timeout
Missing read timeout
Missing write timeout
STARTTLS not required
No debug policy
No secret handling shown
No sender domain policy shown
```

### Exercise 2 — TLS Mode

Given:

```properties
mail.smtp.port=465
mail.smtp.starttls.enable=true
```

What is suspicious?

Expected answer:

```text
Port 465 usually expects implicit TLS.
Use mail.smtp.ssl.enable=true unless provider explicitly documents otherwise.
```

### Exercise 3 — Failure Classification

Given failure:

```text
535 5.7.8 Authentication credentials invalid
```

Should the worker retry every 10 seconds?

Expected answer:

```text
No. This is likely configuration/credential failure. Alert and suppress fast retry to avoid account lockout/noise.
```

### Exercise 4 — Duplicate Risk

Given:

```text
Client sent DATA.
Server may have accepted.
Client timed out waiting final 250.
```

Can retry create duplicate?

Expected answer:

```text
Yes. Outcome is unknown. Retrying may duplicate if server accepted the first message.
```

### Exercise 5 — Transaction Boundary

Given:

```java
@Transactional
public void submit() {
    repository.save(entity);
    mailGateway.send(email);
}
```

Explain the risk.

Expected answer:

```text
SMTP side effect is outside DB transaction semantics. Email can be sent even if DB rolls back; DB transaction can stay open during network delay; retry can duplicate email.
```

---

## 45. Summary

SMTP sending from Java is conceptually simple but operationally deep.

The essential production lessons:

1. `Transport.send()` means attempted SMTP handoff, not final delivery.
2. Always configure connection, read, and write timeout.
3. Understand port/TLS mode: 587 STARTTLS, 465 implicit TLS.
4. Prefer `starttls.required=true` for secure submission.
5. Do not disable certificate validation as a shortcut.
6. Keep credentials in secret manager and rotate safely.
7. Do not send inside DB transaction/request path for critical flows.
8. Avoid multi-recipient transactional messages if per-recipient state matters.
9. Classify failures semantically.
10. Treat unknown outcome after DATA carefully because duplicates are possible.
11. Log and observe without exposing PII/secrets.
12. Put Jakarta Mail behind a clean gateway boundary.

This part gives the operational foundation for actual sending. The next part moves into the content layer: `MimeMessage`, text, HTML, charset, headers, and safe message construction.

---

## 46. References

- Jakarta Mail Specification and API: https://jakarta.ee/specifications/mail/
- Jakarta Mail 2.1 API package summary: https://jakarta.ee/specifications/mail/2.1/apidocs/jakarta.mail/jakarta/mail/package-summary
- JavaMail SMTP provider package documentation: https://jakarta.ee/specifications/mail/1.6/apidocs/com/sun/mail/smtp/package-summary
- Eclipse Angus Mail: https://eclipse-ee4j.github.io/angus-mail/
- Eclipse Angus SMTP provider API: https://eclipse-ee4j.github.io/angus-mail/docs/api/org.eclipse.angus.mail/org/eclipse/angus/mail/smtp/package-summary.html
- Jakarta Activation Specification: https://jakarta.ee/specifications/activation/

---

## 47. Status Seri

Selesai:

- Part 0 — Orientation: Email as a Distributed System
- Part 1 — Email Protocol Stack: SMTP, MIME, POP3, IMAP
- Part 2 — JavaMail to Jakarta Mail: History, Namespace, Compatibility, Migration
- Part 3 — Core API: Session, Store, Folder, Transport, Message
- Part 4 — SMTP Sending: Properties, Transport, Timeout, TLS, Auth

Belum selesai. Lanjut ke:

- Part 5 — MIME Message Construction: Text, HTML, Charset, Headers

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./03-core-api-session-transport-store-message.md">⬅️ Part 3 — Core API Mental Model: `Session`, `Store`, `Folder`, `Transport`, `Message`</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./05-mime-message-text-html-headers-charset.md">Part 5 — MIME Message Construction: Text, HTML, Charset, Headers ➡️</a>
</div>
