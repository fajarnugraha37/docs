# Part 3 — Core API Mental Model: `Session`, `Store`, `Folder`, `Transport`, `Message`

Series: `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery`  
File: `03-core-api-session-transport-store-message.md`  
Target: Java 8–25, JavaMail `javax.mail`, Jakarta Mail `jakarta.mail`, Eclipse Angus Mail  
Level: Advanced / Enterprise Architecture

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membangun konteks besar:

1. email adalah sistem terdistribusi, bukan sekadar API call;
2. SMTP adalah protokol pengiriman;
3. MIME adalah format isi pesan;
4. POP3/IMAP adalah protokol pengambilan pesan;
5. JavaMail/Jakarta Mail adalah abstraction layer di atas protokol-protokol tersebut;
6. namespace legacy adalah `javax.mail`, sedangkan namespace modern adalah `jakarta.mail`.

Sekarang kita masuk ke inti object model Jakarta Mail.

Bagian ini bertujuan agar kita tidak hanya hafal kode:

```java
Transport.send(message);
```

Tetapi benar-benar memahami:

- apa itu `Session`;
- mengapa `Session` bukan HTTP session;
- apa bedanya `Transport` dan `Store`;
- apa peran `Folder`;
- mengapa `Message` adalah abstraction, sedangkan `MimeMessage` adalah format internet mail;
- bagaimana `Address`, `InternetAddress`, `Authenticator`, dan `PasswordAuthentication` bekerja;
- bagaimana provider SMTP/IMAP/POP3 ditemukan dan digunakan;
- object mana yang boleh di-cache, object mana yang harus ditutup;
- bagaimana lifecycle sending dan receiving yang benar;
- bagaimana membangun boundary arsitektur yang sehat di aplikasi enterprise.

Inti mental modelnya:

> Jakarta Mail bukan “library kirim email”. Jakarta Mail adalah object model untuk merepresentasikan sistem mail: konfigurasi, transport, mailbox store, folder, pesan, alamat, body, attachment, event, dan provider protokol.

---

## 1. Peta Besar Object Model

Secara kasar, Jakarta Mail bisa dipahami sebagai beberapa kelompok object:

```text
+---------------------------------------------------------------+
|                         Application                           |
+------------------------------+--------------------------------+
                               |
                               v
+---------------------------------------------------------------+
|                           Session                             |
|  - configuration properties                                    |
|  - authenticator                                               |
|  - provider discovery                                          |
|  - debug settings                                              |
+------------------------------+--------------------------------+
                               |
             +-----------------+------------------+
             |                                    |
             v                                    v
+---------------------------+        +---------------------------+
|        Transport          |        |          Store            |
|  send outbound messages   |        |  access mailbox messages  |
|  SMTP / SMTPS             |        |  IMAP / POP3              |
+-------------+-------------+        +-------------+-------------+
              |                                    |
              v                                    v
+---------------------------+        +---------------------------+
|         Message           |        |          Folder           |
|  abstract mail message    |        |  INBOX, Sent, Archive     |
+-------------+-------------+        +-------------+-------------+
              |                                    |
              v                                    v
+---------------------------+        +---------------------------+
|       MimeMessage         |        |          Message          |
|  Internet/MIME message    |        |  retrieved mail message   |
+---------------------------+        +---------------------------+
```

Object-object utama:

| Object | Peran utama | Protokol terkait |
|---|---|---|
| `Session` | Konfigurasi, authenticator, provider registry | Semua |
| `Transport` | Mengirim pesan keluar | SMTP/SMTPS |
| `Store` | Mengakses mailbox | IMAP/POP3 |
| `Folder` | Representasi folder mailbox | IMAP/POP3 |
| `Message` | Abstraksi pesan | Semua |
| `MimeMessage` | Implementasi pesan internet/MIME | SMTP/IMAP/POP3 |
| `Address` | Abstraksi alamat | Semua |
| `InternetAddress` | Alamat email internet | SMTP/IMAP/POP3 |
| `Authenticator` | Callback kredensial | Semua protokol yang butuh auth |
| `PasswordAuthentication` | Username/password holder | Auth |

Jakarta Mail specification mendefinisikan framework yang platform-independent dan protocol-independent untuk membangun mail/messaging applications. Implementasi modern Jakarta Mail 2.1+ disediakan oleh Eclipse Angus Mail. Referensi spesifikasi dan API berada di Jakarta EE/Eclipse, sedangkan Angus menyediakan implementasi compatible untuk runtime modern.

---

## 2. Import Package: `javax.mail` vs `jakarta.mail`

Ada dua keluarga namespace yang perlu dipahami.

### 2.1 Legacy JavaMail / Jakarta Mail 1.x

Biasanya dipakai pada Java 8 legacy atau aplikasi Java EE 8:

```java
import javax.mail.Session;
import javax.mail.Transport;
import javax.mail.Message;
import javax.mail.MessagingException;
import javax.mail.internet.MimeMessage;
import javax.mail.internet.InternetAddress;
```

### 2.2 Jakarta Mail modern

Dipakai pada Jakarta EE 9+ dan aplikasi modern seperti Spring Boot 3+:

```java
import jakarta.mail.Session;
import jakarta.mail.Transport;
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.internet.InternetAddress;
```

Secara mental model, object modelnya sangat mirip. Perubahan terbesar adalah namespace:

```text
javax.mail.*    -> jakarta.mail.*
javax.activation.* -> jakarta.activation.*
```

Namun dalam praktik production, perubahannya tidak selalu sederhana karena bisa menyentuh:

- dependency tree;
- framework version;
- application server;
- classpath/module-path;
- transitive dependency;
- library internal yang masih menggunakan `javax.mail`;
- test library;
- SMTP provider implementation.

Dalam materi ini, contoh utama akan memakai `jakarta.mail.*`, tetapi prinsipnya bisa dipetakan ke `javax.mail.*`.

---

## 3. Mental Model Utama: Jakarta Mail Adalah Provider-Based API

Salah satu hal yang sering luput: Jakarta Mail API tidak hardcode SMTP/IMAP/POP3 secara langsung di API core. Ia menggunakan provider model.

Secara sederhana:

```text
Application code
     |
     v
Jakarta Mail API
     |
     v
Protocol Provider
     |-- SMTP provider
     |-- IMAP provider
     |-- POP3 provider
     |-- custom provider jika ada
```

Karena itu `Session` tidak hanya berisi property. `Session` juga menjadi entry point untuk mencari provider berdasarkan protocol name.

Contoh:

```java
Transport transport = session.getTransport("smtp");
Store store = session.getStore("imap");
```

Di sini string `smtp` dan `imap` bukan dekorasi. Itu adalah protocol identifier yang akan dipakai untuk mencari provider implementation.

Konsekuensinya:

1. dependency API saja belum tentu cukup;
2. butuh implementation/provider di runtime;
3. jika provider tidak ditemukan, aplikasi gagal saat runtime;
4. mixed dependency bisa menyebabkan provider ambigu;
5. container Jakarta EE bisa menyediakan provider sendiri;
6. standalone application perlu membawa provider implementation sendiri.

---

## 4. `Session`: Konteks Konfigurasi, Bukan HTTP Session

### 4.1 Definisi mental model

`Session` adalah object yang menyimpan:

- mail-related properties;
- authenticator;
- debug setting;
- provider registry;
- default behavior untuk protocol;
- factory untuk mendapatkan `Transport` dan `Store`;
- environment-level mail configuration.

`Session` bukan:

- user login session;
- browser session;
- servlet session;
- per-request state;
- transaction boundary;
- connection pool;
- queue;
- mail delivery guarantee.

Mental model yang lebih akurat:

```text
Session = configuration context + provider lookup context
```

Bukan:

```text
Session = one connected SMTP session
```

Ini penting karena nama `Session` sering menyesatkan.

### 4.2 Membuat `Session`

Contoh sederhana Jakarta Mail modern:

```java
Properties props = new Properties();
props.put("mail.smtp.host", "smtp.example.com");
props.put("mail.smtp.port", "587");
props.put("mail.smtp.auth", "true");
props.put("mail.smtp.starttls.enable", "true");
props.put("mail.smtp.connectiontimeout", "5000");
props.put("mail.smtp.timeout", "10000");
props.put("mail.smtp.writetimeout", "10000");

Session session = Session.getInstance(props, new Authenticator() {
    @Override
    protected PasswordAuthentication getPasswordAuthentication() {
        return new PasswordAuthentication("smtp-user", "smtp-password");
    }
});
```

Untuk JavaMail legacy, hanya import-nya berubah:

```java
import javax.mail.Session;
import javax.mail.Authenticator;
import javax.mail.PasswordAuthentication;
```

### 4.3 `Session.getInstance()` vs `Session.getDefaultInstance()`

Ada dua cara umum membuat session:

```java
Session session = Session.getInstance(props, authenticator);
```

Dan:

```java
Session session = Session.getDefaultInstance(props, authenticator);
```

Untuk aplikasi enterprise, prinsip praktisnya:

> Prefer `Session.getInstance(...)` untuk menghindari global default state yang sulit diprediksi.

Mengapa?

`getDefaultInstance` memakai default session yang dapat reuse konfigurasi global. Ini bisa terlihat praktis untuk aplikasi kecil, tetapi berbahaya untuk aplikasi besar karena:

- konfigurasi bisa bocor antar modul;
- test bisa saling mempengaruhi;
- multi-tenant setup sulit;
- credential bisa salah pakai;
- perubahan property di satu tempat berdampak ke tempat lain;
- debugging dependency menjadi sulit.

### 4.4 Kapan `Session` boleh di-cache?

Umumnya `Session` relatif aman untuk dibuat sekali per konfigurasi mail dan di-reuse.

Misalnya:

```text
one SMTP account + one provider config -> one Session bean
```

Namun jangan salah artikan reuse `Session` sebagai reuse koneksi SMTP. `Session` bukan connection.

Pola sehat:

```text
Application startup:
  create MailSession/MailGateway with immutable config

Per send attempt:
  create MimeMessage
  open Transport or use controlled sender
  send
  close Transport
```

### 4.5 Session sebagai boundary konfigurasi

Untuk aplikasi enterprise, lebih baik jangan menyebarkan `Session` ke seluruh business code.

Kurang sehat:

```java
public class CaseService {
    private final Session mailSession;

    public void approveCase(Case c) {
        MimeMessage msg = new MimeMessage(mailSession);
        // construct and send directly
    }
}
```

Lebih sehat:

```java
public interface MailGateway {
    MailSendResult send(MailRequest request);
}
```

Lalu implementation-nya yang tahu `Session`:

```java
public final class JakartaMailGateway implements MailGateway {
    private final Session session;

    @Override
    public MailSendResult send(MailRequest request) {
        // convert domain request -> MimeMessage -> Transport send
    }
}
```

Alasannya:

- business service tidak tahu detail SMTP;
- test lebih mudah;
- migration `javax` ke `jakarta` tidak menyentuh domain layer;
- provider bisa diganti;
- retry/error classification bisa dipusatkan;
- audit dan observability lebih konsisten.

---

## 5. `Authenticator` dan `PasswordAuthentication`

### 5.1 Fungsi `Authenticator`

`Authenticator` adalah callback yang dipakai Jakarta Mail saat protocol provider membutuhkan kredensial.

Contoh:

```java
Authenticator authenticator = new Authenticator() {
    @Override
    protected PasswordAuthentication getPasswordAuthentication() {
        return new PasswordAuthentication(username, password);
    }
};
```

Lalu:

```java
Session session = Session.getInstance(props, authenticator);
```

### 5.2 Jangan hardcode credential

Contoh buruk:

```java
return new PasswordAuthentication("prod-smtp-user", "SuperSecret123");
```

Masalah:

- credential masuk source code;
- bisa masuk Git history;
- rotasi sulit;
- environment tidak terpisah;
- audit buruk.

Pola lebih sehat:

```java
public final class SmtpCredentialProvider {
    public SmtpCredential get() {
        // read from secret manager, vault, env, parameter store, etc.
    }
}
```

Lalu:

```java
SmtpCredential credential = credentialProvider.get();

Session session = Session.getInstance(props, new Authenticator() {
    @Override
    protected PasswordAuthentication getPasswordAuthentication() {
        return new PasswordAuthentication(
            credential.username(),
            credential.password()
        );
    }
});
```

### 5.3 Credential rotation concern

Jika credential bisa berubah saat runtime, hati-hati dengan `Session` yang menyimpan authenticator lama.

Ada beberapa pilihan:

1. recreate `Session` saat credential berubah;
2. buat authenticator yang mengambil credential terbaru dari provider;
3. restart service saat secret rotation;
4. pakai provider mechanism yang mendukung token refresh.

Pola sederhana:

```java
protected PasswordAuthentication getPasswordAuthentication() {
    SmtpCredential latest = credentialProvider.getLatest();
    return new PasswordAuthentication(latest.username(), latest.password());
}
```

Namun ini juga harus mempertimbangkan:

- latency secret lookup;
- caching;
- failure saat secret manager down;
- secret version consistency;
- log redaction.

---

## 6. `Transport`: Object untuk Mengirim Pesan

### 6.1 Definisi mental model

`Transport` adalah abstraction untuk mengirim message ke mail transport protocol, biasanya SMTP.

Mental model:

```text
Transport = client-side connection/session to outbound mail transport provider
```

Dalam pemakaian paling umum:

```java
Transport.send(message);
```

Atau manual:

```java
Transport transport = session.getTransport("smtp");
try {
    transport.connect();
    transport.sendMessage(message, message.getAllRecipients());
} finally {
    transport.close();
}
```

### 6.2 `Transport.send(message)`

Convenience API:

```java
Transport.send(message);
```

Biasanya melakukan:

1. menentukan transport berdasarkan message/session;
2. connect;
3. send;
4. close.

Ini cocok untuk:

- email volume rendah;
- simple transactional send;
- prototype;
- tool internal kecil;
- test sederhana.

Namun untuk production dengan throughput tinggi, kita sering butuh kontrol lebih:

- connection lifecycle;
- per-attempt timeout;
- multi-recipient behavior;
- retry classification;
- metrics;
- logging correlation;
- partial failure handling;
- rate limiting.

### 6.3 Manual `Transport`

Contoh:

```java
MimeMessage message = new MimeMessage(session);
message.setFrom(new InternetAddress("no-reply@example.com", "Example App"));
message.setRecipients(Message.RecipientType.TO,
        InternetAddress.parse("user@example.com", false));
message.setSubject("Case Approved", StandardCharsets.UTF_8.name());
message.setText("Your case has been approved.", StandardCharsets.UTF_8.name());
message.saveChanges();

Transport transport = session.getTransport("smtp");
try {
    transport.connect();
    transport.sendMessage(message, message.getAllRecipients());
} finally {
    transport.close();
}
```

Manual transport memberi ruang untuk:

- metrics around connect vs send;
- tracing;
- reuse untuk batch tertentu;
- better exception classification;
- custom failure path;
- controlled close.

### 6.4 `Transport` harus ditutup

`Transport` adalah resource eksternal. Jika connect dilakukan manual, tutup di `finally` atau try-with-resource jika object mendukung pattern yang sesuai di versi runtime.

Pola aman:

```java
Transport transport = null;
try {
    transport = session.getTransport("smtp");
    transport.connect(host, port, username, password);
    transport.sendMessage(message, recipients);
} finally {
    if (transport != null) {
        try {
            transport.close();
        } catch (MessagingException ignored) {
            // log at debug/trace if needed, do not mask original send failure
        }
    }
}
```

Kesalahan umum:

```java
Transport transport = session.getTransport("smtp");
transport.connect();
transport.sendMessage(message, recipients);
// no close
```

Dampak:

- connection leak;
- socket leak;
- file descriptor leak;
- provider throttling;
- thread stuck;
- slow degradation;
- incident intermittent.

### 6.5 `Transport` bukan business delivery guarantee

Jika `Transport.sendMessage(...)` berhasil, itu biasanya berarti pesan diterima oleh SMTP server/relay pada titik tertentu.

Itu belum tentu berarti:

- email masuk inbox;
- email tidak masuk spam;
- recipient benar-benar membaca;
- downstream MTA berhasil deliver;
- bounce tidak akan terjadi nanti.

Mental model:

```text
Jakarta Mail send success = handoff success to configured transport
```

Bukan:

```text
Jakarta Mail send success = human recipient received email
```

Inilah alasan outbox dan delivery feedback loop penting pada part berikutnya.

---

## 7. `Store`: Object untuk Mengakses Mailbox

### 7.1 Definisi mental model

`Store` adalah abstraction untuk message store/mailbox. Biasanya memakai IMAP atau POP3.

```java
Store store = session.getStore("imap");
store.connect("imap.example.com", username, password);
```

Mental model:

```text
Store = connected client view of mailbox server
```

Beda dari `Transport`:

| Object | Arah | Umumnya protocol | Fungsi |
|---|---|---|---|
| `Transport` | outbound | SMTP | mengirim message |
| `Store` | inbound/read | IMAP/POP3 | mengambil message dari mailbox |

### 7.2 Kapan aplikasi butuh `Store`?

Banyak aplikasi hanya butuh outbound email. `Store` dipakai ketika aplikasi perlu:

- membaca inbox support;
- mengambil bounce email dari mailbox;
- memproses email reply;
- mengimpor attachment dari mailbox;
- membaca mailbox compliance;
- mengonsumsi mailbox sebagai integration channel;
- polling mailbox legacy system.

### 7.3 Store lifecycle

Contoh IMAP:

```java
Properties props = new Properties();
props.put("mail.store.protocol", "imap");
props.put("mail.imap.host", "imap.example.com");
props.put("mail.imap.port", "993");
props.put("mail.imap.ssl.enable", "true");

Session session = Session.getInstance(props);
Store store = session.getStore("imap");

try {
    store.connect("imap.example.com", username, password);
    Folder inbox = store.getFolder("INBOX");
    inbox.open(Folder.READ_ONLY);

    Message[] messages = inbox.getMessages();
    for (Message message : messages) {
        System.out.println(message.getSubject());
    }

    inbox.close(false);
} finally {
    store.close();
}
```

### 7.4 Store sebagai long-lived resource

IMAP `Store` bisa long-lived dalam beberapa kasus, tetapi itu memperbesar kompleksitas:

- connection idle timeout;
- server closes connection;
- reconnect logic;
- concurrent folder access;
- mailbox state changes;
- event listener lifecycle;
- memory retention;
- stuck reader;
- backpressure.

Untuk aplikasi enterprise, jangan membuat mailbox polling asal-asalan di request thread. Lebih baik jadikan inbound mail sebagai worker/subsystem tersendiri.

---

## 8. `Folder`: Representasi Folder Mailbox

### 8.1 Definisi mental model

`Folder` adalah representasi folder dalam mailbox store.

Contoh:

- `INBOX`;
- `Sent`;
- `Archive`;
- `Spam`;
- `Trash`;
- custom folder.

Dalam IMAP, folder bisa punya hierarchy. Dalam POP3, konsep folder biasanya sangat terbatas atau tidak ada seperti IMAP.

### 8.2 Folder harus dibuka

Sebelum membaca message, folder harus dibuka:

```java
Folder inbox = store.getFolder("INBOX");
inbox.open(Folder.READ_ONLY);
```

Mode umum:

```java
Folder.READ_ONLY
Folder.READ_WRITE
```

Gunakan `READ_ONLY` jika hanya membaca. Gunakan `READ_WRITE` jika akan:

- mark as seen;
- delete;
- move;
- set flags;
- expunge.

### 8.3 Folder close behavior

```java
inbox.close(false);
```

Parameter `false` berarti jangan expunge deleted messages saat close.

```java
inbox.close(true);
```

Parameter `true` berarti expunge messages yang ditandai deleted.

Ini penting. Salah close dapat menyebabkan message benar-benar hilang dari mailbox.

### 8.4 Folder dan concurrency

Jangan menganggap `Folder` bisa bebas dipakai parallel oleh banyak thread. Pada desain enterprise, sebaiknya:

- satu worker mengelola satu mailbox/folder stream;
- hindari shared mutable `Folder` antar thread;
- gunakan checkpoint/cursor;
- gunakan lock jika ada multiple worker;
- desain idempotent processing.

---

## 9. `Message`: Abstraksi Pesan

### 9.1 Definisi mental model

`Message` adalah abstract representation of a mail message.

Ia punya konsep:

- sender;
- recipients;
- subject;
- sent date;
- received date;
- headers;
- content;
- flags;
- message number;
- folder association.

Namun `Message` sendiri masih abstrak. Untuk internet email, concrete class paling penting adalah `MimeMessage`.

### 9.2 `Message` vs `MimeMessage`

| Type | Fungsi |
|---|---|
| `Message` | Abstraction generic pesan |
| `MimeMessage` | Implementasi internet email dengan MIME/RFC 822 style |

Saat mengirim email internet, hampir selalu menggunakan:

```java
MimeMessage message = new MimeMessage(session);
```

Bukan hanya:

```java
Message message = ...
```

Tetapi untuk dependency inversion, method bisa menerima abstraction:

```java
public void send(Message message) { ... }
```

Namun composer biasanya membutuhkan fitur MIME:

```java
MimeMessage mimeMessage = new MimeMessage(session);
```

### 9.3 Message state dan `saveChanges()`

Sebelum send, Jakarta Mail bisa mengisi atau memperbarui header tertentu seperti:

- `Date`;
- `Message-ID`;
- MIME-related headers;
- encoding metadata.

Sering kali `Transport.send(...)` akan memanggil proses yang diperlukan. Namun dalam desain advanced, eksplisit memanggil:

```java
message.saveChanges();
```

bisa berguna untuk:

- melihat raw MIME final sebelum send;
- audit snapshot;
- test assertion;
- memastikan header final terbentuk.

Namun hati-hati: setelah `saveChanges()`, perubahan lanjutan pada content/header perlu dipahami dengan benar.

### 9.4 Message content bisa mahal

`Message.getContent()` terlihat sederhana, tetapi dapat mahal karena:

- harus decode MIME;
- bisa membuka stream;
- bisa load body/attachment;
- bisa trigger network fetch pada IMAP;
- bisa menghasilkan object `Multipart`;
- bisa gagal karena malformed content.

Untuk inbound mail, jangan sembarang memanggil `getContent()` untuk ribuan email tanpa batas.

---

## 10. `MimeMessage`: Internet Email Concrete Model

### 10.1 Mengapa `MimeMessage` penting

Internet email adalah kombinasi:

- RFC-style headers;
- body;
- MIME structure;
- encoded text;
- multipart;
- attachments;
- content transfer encoding;
- addresses;
- dates.

`MimeMessage` adalah class utama untuk membangun dan membaca struktur ini.

Contoh minimal:

```java
MimeMessage message = new MimeMessage(session);
message.setFrom(new InternetAddress("no-reply@example.com", "Example App"));
message.setRecipient(Message.RecipientType.TO,
        new InternetAddress("user@example.com", "User Name"));
message.setSubject("Welcome", StandardCharsets.UTF_8.name());
message.setText("Hello from Jakarta Mail", StandardCharsets.UTF_8.name());
```

### 10.2 Message bukan hanya body

Kesalahan pemula:

```text
Email = subject + body + recipient
```

Model yang benar:

```text
Email message = envelope + headers + body structure + metadata + transport result
```

Di level `MimeMessage`, kita mengelola header/body. Envelope SMTP dikelola saat transport.

### 10.3 Header vs content

```java
message.setSubject("Hello", "UTF-8");
message.setHeader("X-Correlation-ID", correlationId);
message.setText("Body", "UTF-8");
```

Header adalah metadata. Body adalah content. Jangan menaruh data sensitif sembarangan di header karena header bisa lebih mudah terlihat, diteruskan, atau dilog oleh sistem mail.

### 10.4 Raw MIME output

Untuk debugging/test:

```java
ByteArrayOutputStream out = new ByteArrayOutputStream();
message.writeTo(out);
String raw = out.toString(StandardCharsets.UTF_8);
```

Namun untuk production logging, jangan log raw MIME penuh karena bisa mengandung:

- PII;
- token;
- attachment;
- business data;
- email address;
- HTML content;
- hidden tracking link.

---

## 11. `Address` dan `InternetAddress`

### 11.1 `Address` sebagai abstraction

`Address` adalah base abstraction. Dalam internet email, class yang umum dipakai adalah:

```java
InternetAddress
```

Contoh:

```java
InternetAddress address = new InternetAddress("user@example.com", "User Name");
```

### 11.2 Address parsing

```java
InternetAddress[] addresses = InternetAddress.parse("a@example.com,b@example.com");
```

Ada parameter strict:

```java
InternetAddress[] addresses = InternetAddress.parse(input, true);
```

Untuk input dari user, jangan terlalu percaya parsing longgar.

### 11.3 Display name

Email address bisa punya display name:

```text
"Finance Team" <finance@example.com>
```

Di Java:

```java
new InternetAddress("finance@example.com", "Finance Team", "UTF-8")
```

Display name perlu encoding jika mengandung non-ASCII.

### 11.4 Header injection risk

Alamat email dan display name dari user bisa berbahaya jika tidak divalidasi.

Contoh input jahat:

```text
attacker@example.com\r\nBcc: victim@example.com
```

Jika library/usage tidak aman, ini bisa menjadi header injection.

Prinsip:

- validasi email address;
- reject CR/LF pada header input;
- gunakan API typed seperti `InternetAddress`, bukan string concatenation;
- jangan buat raw header dari input user tanpa sanitasi;
- gunakan allowlist untuk sender domain.

---

## 12. Recipient Types: TO, CC, BCC

Jakarta Mail memakai:

```java
Message.RecipientType.TO
Message.RecipientType.CC
Message.RecipientType.BCC
```

Contoh:

```java
message.setRecipients(Message.RecipientType.TO,
        InternetAddress.parse("a@example.com,b@example.com"));

message.setRecipients(Message.RecipientType.CC,
        InternetAddress.parse("manager@example.com"));

message.setRecipients(Message.RecipientType.BCC,
        InternetAddress.parse("audit@example.com"));
```

### 12.1 BCC mental model

BCC recipient tidak terlihat di header final yang diterima recipient lain. Tetapi BCC tetap menjadi recipient di SMTP envelope.

Jangan gunakan BCC sebagai mekanisme audit yang tidak jelas. Dalam sistem enterprise, audit harus explicit di database/log audit, bukan diam-diam mengirim BCC ke mailbox tertentu tanpa governance.

### 12.2 Per-recipient personalization

Jika setiap recipient memiliki isi personal, jangan kirim satu message ke banyak recipient.

Buruk:

```text
One email to 100 recipients with personalized body impossible/salah
```

Benar:

```text
100 logical mail requests -> 100 MIME messages -> controlled rate-limited send
```

---

## 13. `Part`, `BodyPart`, dan `Multipart` sebagai Jembatan ke MIME

Walaupun bagian multipart dibahas detail di Part 6, kita perlu tahu posisi object-nya sejak sekarang.

Jakarta Mail memakai beberapa abstraction:

```text
Part
 ├── Message
 └── BodyPart

Multipart
 └── BodyPart[]
```

Mental model:

```text
Message is also a Part.
A Multipart contains multiple BodyPart objects.
Each BodyPart can contain text, HTML, attachment, or nested Multipart.
```

Contoh sederhana HTML + text alternative:

```java
MimeBodyPart textPart = new MimeBodyPart();
textPart.setText("Plain text version", "UTF-8");

MimeBodyPart htmlPart = new MimeBodyPart();
htmlPart.setContent("<html><body><p>HTML version</p></body></html>", "text/html; charset=UTF-8");

MimeMultipart alternative = new MimeMultipart("alternative");
alternative.addBodyPart(textPart);
alternative.addBodyPart(htmlPart);

message.setContent(alternative);
```

Penting:

- `Message` dan `BodyPart` sama-sama bisa punya content;
- content bisa string, multipart, stream, atau object lain;
- `getContent()` bisa mengembalikan tipe berbeda;
- MIME traversal harus recursive.

---

## 14. Data Handling: Di Mana Activation Masuk?

Jakarta Activation tidak selalu terlihat di contoh email sederhana. Ia menjadi penting ketika content bukan hanya plain string.

Object penting:

- `DataSource`;
- `DataHandler`;
- MIME type;
- file/stream-based data.

Contoh attachment:

```java
MimeBodyPart attachmentPart = new MimeBodyPart();
DataSource source = new FileDataSource("/tmp/report.pdf");
attachmentPart.setDataHandler(new DataHandler(source));
attachmentPart.setFileName("report.pdf");
```

Mental model:

```text
Jakarta Mail builds the message structure.
Jakarta Activation helps describe and access arbitrary data content.
```

Jangan anggap attachment selalu `byte[]`. Untuk file besar, stream-based approach jauh lebih sehat.

---

## 15. Lifecycle Sending: Dari Domain Event ke SMTP Handoff

Mari kita susun flow enterprise yang benar.

### 15.1 Flow naïve

```text
User approve case
  -> service updates DB
  -> service creates MimeMessage
  -> service calls Transport.send
  -> return success
```

Masalah:

- send terjadi di request thread;
- jika SMTP lambat, user request lambat;
- jika DB commit gagal setelah email terkirim, data tidak konsisten;
- jika SMTP berhasil tapi response app timeout, bisa duplicate retry;
- sulit audit;
- sulit retry aman;
- sulit observability.

### 15.2 Flow enterprise

```text
User approve case
  -> service validates command
  -> DB transaction:
       update case state
       insert notification outbox row
     commit

Mail worker:
  -> claim pending outbox row
  -> load template/data
  -> build MimeMessage
  -> send via MailGateway/Jakarta Mail
  -> classify result
  -> update outbox state
  -> emit metrics/audit
```

Di sini Jakarta Mail object model hanya berada dalam infrastructure layer:

```text
Domain Event / Notification Request
      |
      v
Mail Application Service
      |
      v
Outbox / Queue
      |
      v
Mail Worker
      |
      v
MailGateway
      |
      v
Session -> MimeMessage -> Transport
```

### 15.3 Minimal send lifecycle

```java
public MailSendResult send(MailRequest request) {
    MimeMessage message = new MimeMessage(session);

    try {
        compose(message, request);
        message.saveChanges();

        Transport transport = session.getTransport("smtp");
        try {
            transport.connect();
            transport.sendMessage(message, message.getAllRecipients());
            return MailSendResult.accepted(message.getMessageID());
        } finally {
            transport.close();
        }
    } catch (MessagingException ex) {
        return failureClassifier.classify(ex);
    } catch (Exception ex) {
        return MailSendResult.internalFailure(ex);
    }
}
```

Catatan:

- `message.getMessageID()` berguna untuk correlation, tapi bukan satu-satunya ID;
- simpan domain notification id sendiri;
- jangan expose raw exception ke business layer;
- close transport di semua path;
- log structured metadata, bukan raw content.

---

## 16. Lifecycle Receiving: Dari Mailbox ke Domain Event

Jika aplikasi membaca email masuk, flow-nya berbeda.

### 16.1 Flow naïve inbound

```text
Cron runs
  -> connect IMAP
  -> read all INBOX messages
  -> process all
  -> mark seen
```

Masalah:

- duplicate processing;
- message lama diproses ulang;
- attachment besar membuat memory penuh;
- parsing error menghentikan batch;
- malformed email dari external world bisa crash;
- sulit audit;
- tidak ada quarantine.

### 16.2 Flow enterprise inbound

```text
Inbound mail worker
  -> connect Store
  -> open Folder
  -> search candidates
  -> for each message:
       extract stable message identity
       check idempotency
       safely parse headers/body/attachments
       persist inbound_mail record
       quarantine suspicious attachment
       emit domain event if valid
       mark processed/move folder only after durable persist
  -> close Folder
  -> close Store
```

Object model:

```text
Session -> Store -> Folder -> Message -> Part/Multipart/DataHandler
```

---

## 17. Provider Discovery dan Configuration Properties

### 17.1 Protocol names

Common protocol names:

```text
smtp
smtps
imap
imaps
pop3
pop3s
```

Namun usage tergantung provider dan property.

Contoh SMTP STARTTLS:

```java
props.put("mail.transport.protocol", "smtp");
props.put("mail.smtp.host", "smtp.example.com");
props.put("mail.smtp.port", "587");
props.put("mail.smtp.starttls.enable", "true");
props.put("mail.smtp.auth", "true");
```

Contoh implicit TLS SMTP:

```java
props.put("mail.transport.protocol", "smtps");
props.put("mail.smtps.host", "smtp.example.com");
props.put("mail.smtps.port", "465");
props.put("mail.smtps.auth", "true");
props.put("mail.smtps.ssl.enable", "true");
```

Dalam praktik modern, port 587 + STARTTLS sering digunakan untuk submission.

### 17.2 Property prefix penting

Property biasanya mengikuti pola:

```text
mail.<protocol>.<property>
```

Contoh:

```text
mail.smtp.host
mail.smtp.port
mail.smtp.auth
mail.smtp.starttls.enable
mail.smtp.connectiontimeout
mail.smtp.timeout
mail.smtp.writetimeout
```

Untuk IMAP:

```text
mail.imap.host
mail.imap.port
mail.imap.ssl.enable
mail.imap.connectiontimeout
mail.imap.timeout
```

Kesalahan umum:

```text
mail.smtp.ssl.enable=true
```

tetapi memakai port 587 dan STARTTLS tanpa memahami mode TLS. Atau:

```text
mail.smtps.*
```

tetapi mengambil transport `smtp`, bukan `smtps`.

### 17.3 Debug property

```java
session.setDebug(true);
```

atau property:

```java
props.put("mail.debug", "true");
```

Debug SMTP sangat berguna, tetapi berbahaya di production karena bisa menampilkan detail sensitif.

Prinsip:

- aktifkan hanya sementara;
- batasi environment;
- redaksi credential;
- jangan log message body/attachment;
- gunakan correlation ID;
- matikan setelah incident selesai.

---

## 18. `Message` Construction: Urutan yang Masuk Akal

Urutan praktis membangun message:

```text
1. create MimeMessage(session)
2. set From/Sender/Reply-To
3. set recipients
4. set subject with charset
5. set sent date if needed
6. set custom safe headers
7. build body structure
8. attach content
9. saveChanges
10. send
```

Contoh:

```java
MimeMessage message = new MimeMessage(session);

message.setFrom(new InternetAddress("no-reply@example.com", "Example App", "UTF-8"));
message.setReplyTo(new Address[] {
    new InternetAddress("support@example.com", "Support Team", "UTF-8")
});

message.setRecipients(
    Message.RecipientType.TO,
    InternetAddress.parse("user@example.com", true)
);

message.setSubject("Your application has been approved", "UTF-8");
message.setSentDate(new Date());
message.setHeader("X-Application-Notification-Id", notificationId);
message.setText("Your application has been approved.", "UTF-8");

message.saveChanges();
```

### 18.1 Jangan concatenate header manual

Buruk:

```java
message.setHeader("To", userInput);
```

Lebih baik:

```java
message.setRecipient(Message.RecipientType.TO, new InternetAddress(email, name, "UTF-8"));
```

### 18.2 Jangan lupa charset

Buruk:

```java
message.setSubject("Pendaftaran disetujui");
message.setText("Halo, permohonan Anda disetujui.");
```

Lebih aman:

```java
message.setSubject("Pendaftaran disetujui", "UTF-8");
message.setText("Halo, permohonan Anda disetujui.", "UTF-8");
```

Untuk aplikasi Indonesia/multilingual, eksplisit UTF-8 adalah baseline.

---

## 19. Object Ownership: Siapa Memiliki Apa?

Dalam desain yang sehat, ownership object jelas.

```text
MailConfig owns SMTP properties.
MailSessionFactory owns creation of Session.
MimeMessageComposer owns message construction.
MailGateway owns Transport lifecycle.
MailWorker owns retry and outbox state transition.
Domain service owns business decision, not SMTP details.
```

Contoh struktur package:

```text
com.example.notification
  domain
    NotificationRequest
    NotificationType
    Recipient
    AttachmentRef
  application
    NotificationService
    MailOutboxService
  infrastructure.mail
    JakartaMailGateway
    JakartaMailSessionFactory
    MimeMessageComposer
    SmtpFailureClassifier
    MailProperties
  infrastructure.template
    TemplateRenderer
  infrastructure.persistence
    MailOutboxRepository
```

Pemisahan ini mencegah `MimeMessage` bocor ke domain layer.

Buruk:

```java
public class ApprovalService {
    public void approve(MimeMessage message) { ... }
}
```

Baik:

```java
public class ApprovalService {
    public void approve(ApproveCommand command) { ... }
}
```

Lalu event:

```java
NotificationRequest request = NotificationRequest.caseApproved(caseId, recipient);
outbox.enqueue(request);
```

---

## 20. Thread-Safety dan Concurrency Model

### 20.1 Prinsip umum

Jangan menganggap semua object Jakarta Mail thread-safe.

Prinsip aman:

| Object | Reuse? | Catatan |
|---|---:|---|
| `Properties` | boleh jika immutable setelah init | jangan mutate setelah dipakai |
| `Session` | boleh reuse per config | jangan jadikan global mutable default |
| `MimeMessage` | jangan share antar thread | per message/per send |
| `Transport` | jangan share bebas | resource connection; lifecycle jelas |
| `Store` | hati-hati | connection stateful |
| `Folder` | jangan share bebas | stateful mailbox view |
| `Multipart`/`BodyPart` | jangan share | per message |

### 20.2 Sending parallel

Jika ingin kirim parallel:

```text
worker thread 1 -> create MimeMessage -> get Transport -> send -> close
worker thread 2 -> create MimeMessage -> get Transport -> send -> close
worker thread 3 -> create MimeMessage -> get Transport -> send -> close
```

Jangan:

```text
shared MimeMessage mutated by multiple workers
shared Transport used concurrently without strict control
```

### 20.3 Virtual threads Java 21+

Java 21 virtual threads membuat blocking SMTP lebih murah dari sisi thread cost, tetapi tidak menghapus batas eksternal:

- SMTP provider rate limit;
- network socket limit;
- server connection limit;
- credential throttling;
- DNS/TLS overhead;
- memory untuk MIME/attachment;
- database outbox claim rate.

Dengan kata lain:

```text
virtual threads improve waiting cost, not provider capacity
```

Jadi tetap perlu:

- rate limiter;
- bounded queue;
- timeout;
- retry policy;
- backpressure;
- circuit breaker.

---

## 21. `Session` Factory untuk Java 8 sampai 25

### 21.1 Interface konfigurasi

```java
public record SmtpConfig(
    String host,
    int port,
    boolean auth,
    boolean startTlsEnabled,
    boolean startTlsRequired,
    int connectionTimeoutMillis,
    int readTimeoutMillis,
    int writeTimeoutMillis,
    String username,
    String password
) {}
```

Untuk Java 8, tidak ada `record`, jadi gunakan class biasa:

```java
public final class SmtpConfig {
    private final String host;
    private final int port;
    private final boolean auth;
    private final boolean startTlsEnabled;
    private final boolean startTlsRequired;
    private final int connectionTimeoutMillis;
    private final int readTimeoutMillis;
    private final int writeTimeoutMillis;
    private final String username;
    private final String password;

    // constructor + getters
}
```

### 21.2 Factory modern Jakarta Mail

```java
public final class JakartaMailSessionFactory {

    public Session create(SmtpConfig config) {
        Properties props = new Properties();
        props.put("mail.transport.protocol", "smtp");
        props.put("mail.smtp.host", config.host());
        props.put("mail.smtp.port", Integer.toString(config.port()));
        props.put("mail.smtp.auth", Boolean.toString(config.auth()));
        props.put("mail.smtp.starttls.enable", Boolean.toString(config.startTlsEnabled()));
        props.put("mail.smtp.starttls.required", Boolean.toString(config.startTlsRequired()));
        props.put("mail.smtp.connectiontimeout", Integer.toString(config.connectionTimeoutMillis()));
        props.put("mail.smtp.timeout", Integer.toString(config.readTimeoutMillis()));
        props.put("mail.smtp.writetimeout", Integer.toString(config.writeTimeoutMillis()));

        Authenticator authenticator = null;
        if (config.auth()) {
            authenticator = new Authenticator() {
                @Override
                protected PasswordAuthentication getPasswordAuthentication() {
                    return new PasswordAuthentication(config.username(), config.password());
                }
            };
        }

        return Session.getInstance(props, authenticator);
    }
}
```

### 21.3 Java 8 equivalent

```java
public final class JavaxMailSessionFactory {

    public Session create(SmtpConfig config) {
        Properties props = new Properties();
        props.put("mail.transport.protocol", "smtp");
        props.put("mail.smtp.host", config.getHost());
        props.put("mail.smtp.port", Integer.toString(config.getPort()));
        props.put("mail.smtp.auth", Boolean.toString(config.isAuth()));
        props.put("mail.smtp.starttls.enable", Boolean.toString(config.isStartTlsEnabled()));
        props.put("mail.smtp.starttls.required", Boolean.toString(config.isStartTlsRequired()));
        props.put("mail.smtp.connectiontimeout", Integer.toString(config.getConnectionTimeoutMillis()));
        props.put("mail.smtp.timeout", Integer.toString(config.getReadTimeoutMillis()));
        props.put("mail.smtp.writetimeout", Integer.toString(config.getWriteTimeoutMillis()));

        Authenticator authenticator = null;
        if (config.isAuth()) {
            authenticator = new Authenticator() {
                @Override
                protected PasswordAuthentication getPasswordAuthentication() {
                    return new PasswordAuthentication(config.getUsername(), config.getPassword());
                }
            };
        }

        return Session.getInstance(props, authenticator);
    }
}
```

Perbedaan besar hanya import dan style language.

---

## 22. Clean Mail Gateway: Contoh Desain Minimal

### 22.1 Domain request

```java
public final class MailRequest {
    private final String notificationId;
    private final String fromEmail;
    private final String fromName;
    private final String toEmail;
    private final String toName;
    private final String subject;
    private final String plainTextBody;

    // constructor + getters
}
```

### 22.2 Result model

```java
public final class MailSendResult {
    private final boolean success;
    private final String providerMessageId;
    private final String failureCode;
    private final String failureMessage;
    private final boolean retryable;

    public static MailSendResult accepted(String providerMessageId) {
        return new MailSendResult(true, providerMessageId, null, null, false);
    }

    public static MailSendResult failed(String code, String message, boolean retryable) {
        return new MailSendResult(false, null, code, message, retryable);
    }

    // constructor + getters
}
```

### 22.3 Gateway

```java
public interface MailGateway {
    MailSendResult send(MailRequest request);
}
```

### 22.4 Jakarta Mail implementation

```java
public final class JakartaMailGateway implements MailGateway {

    private final Session session;
    private final SmtpFailureClassifier failureClassifier;

    public JakartaMailGateway(Session session, SmtpFailureClassifier failureClassifier) {
        this.session = session;
        this.failureClassifier = failureClassifier;
    }

    @Override
    public MailSendResult send(MailRequest request) {
        Transport transport = null;
        try {
            MimeMessage message = new MimeMessage(session);
            compose(message, request);
            message.saveChanges();

            transport = session.getTransport("smtp");
            transport.connect();
            transport.sendMessage(message, message.getAllRecipients());

            return MailSendResult.accepted(message.getMessageID());
        } catch (MessagingException ex) {
            return failureClassifier.classify(ex);
        } catch (Exception ex) {
            return MailSendResult.failed("MAIL_INTERNAL_ERROR", ex.getMessage(), false);
        } finally {
            closeQuietly(transport);
        }
    }

    private void compose(MimeMessage message, MailRequest request) throws Exception {
        message.setFrom(new InternetAddress(
            request.getFromEmail(),
            request.getFromName(),
            "UTF-8"
        ));

        message.setRecipient(
            Message.RecipientType.TO,
            new InternetAddress(
                request.getToEmail(),
                request.getToName(),
                "UTF-8"
            )
        );

        message.setSubject(request.getSubject(), "UTF-8");
        message.setSentDate(new Date());
        message.setHeader("X-Notification-Id", sanitizeHeaderValue(request.getNotificationId()));
        message.setText(request.getPlainTextBody(), "UTF-8");
    }

    private String sanitizeHeaderValue(String value) {
        if (value == null) {
            return "";
        }
        if (value.contains("\r") || value.contains("\n")) {
            throw new IllegalArgumentException("Invalid header value");
        }
        return value;
    }

    private void closeQuietly(Transport transport) {
        if (transport == null) {
            return;
        }
        try {
            transport.close();
        } catch (MessagingException ignored) {
            // preserve original outcome
        }
    }
}
```

### 22.5 Mengapa desain ini lebih sehat?

Karena:

- domain tidak tahu `MimeMessage`;
- SMTP exception diklasifikasi;
- `Transport` lifecycle jelas;
- charset eksplisit;
- header custom disanitasi;
- provider message id bisa dicatat;
- result model bisa dipakai outbox worker;
- mudah diganti dengan API provider nanti.

---

## 23. Error Boundary: Jangan Bocorkan `MessagingException` ke Domain

Pada level Jakarta Mail, error bisa berupa:

- `MessagingException`;
- `SendFailedException`;
- nested SMTP-specific exception;
- socket timeout;
- authentication failure;
- TLS handshake failure;
- invalid address;
- provider rejection.

Domain layer tidak perlu tahu semua detail ini.

Buruk:

```java
public void approveCase(Case c) throws MessagingException {
    mailSender.send(...);
}
```

Lebih baik:

```java
MailSendResult result = mailGateway.send(request);

if (!result.isSuccess()) {
    outbox.markFailed(
        request.id(),
        result.failureCode(),
        result.retryable()
    );
}
```

Failure classifier akan dibahas lebih dalam di Part 10, tetapi boundary-nya sudah harus benar dari sekarang.

---

## 24. Common Anti-Patterns

### 24.1 Mengirim email langsung di controller

Buruk:

```java
@PostMapping("/approve")
public ResponseEntity<?> approve(@RequestBody ApproveRequest request) {
    caseService.approve(request);
    mailService.sendApprovalEmail(request.email());
    return ResponseEntity.ok().build();
}
```

Masalah:

- coupling user flow dengan SMTP;
- latency tinggi;
- failure handling buruk;
- duplicate risk;
- transaction consistency sulit.

### 24.2 Tidak set timeout

Buruk:

```java
props.put("mail.smtp.host", host);
```

Tanpa timeout, aplikasi bisa menggantung lama pada network issue.

Baseline:

```java
props.put("mail.smtp.connectiontimeout", "5000");
props.put("mail.smtp.timeout", "10000");
props.put("mail.smtp.writetimeout", "10000");
```

Nilai aktual harus disesuaikan SLO.

### 24.3 Global mutable default session

Buruk:

```java
Session session = Session.getDefaultInstance(props);
```

Dipakai di banyak tempat dengan property yang berubah-ubah.

### 24.4 Reusing `MimeMessage`

Buruk:

```java
MimeMessage message = new MimeMessage(session);

for (Recipient r : recipients) {
    message.setRecipient(Message.RecipientType.TO, r.toAddress());
    message.setText(renderFor(r));
    Transport.send(message);
}
```

Masalah:

- header lama bisa tertinggal;
- message id ambiguity;
- mutation bug;
- concurrency unsafe;
- personalization leak.

Benar:

```java
for (Recipient r : recipients) {
    MimeMessage message = new MimeMessage(session);
    composeFor(message, r);
    Transport.send(message);
}
```

Tetap perlu rate limit untuk batch besar.

### 24.5 Logging raw MIME

Buruk:

```java
message.writeTo(System.out);
```

di production.

Lebih baik log:

```text
notificationId
recipientHash
templateId
templateVersion
attemptNo
smtpHost
resultCode
latencyMs
failureCategory
```

### 24.6 Menganggap `Transport.send` sukses berarti delivered

Ini salah. Sukses hanya berarti handoff berhasil pada boundary transport.

---

## 25. Debugging Core Object Model

### 25.1 Apa yang dicek saat send gagal?

Checklist awal:

```text
[ ] Apakah provider implementation ada di runtime?
[ ] Apakah namespace javax/jakarta bercampur?
[ ] Apakah Session property benar?
[ ] Apakah protocol name benar?
[ ] Apakah host/port benar?
[ ] Apakah STARTTLS/SSL mode benar?
[ ] Apakah auth enabled sesuai provider?
[ ] Apakah username/password benar?
[ ] Apakah timeout diset?
[ ] Apakah Transport ditutup?
[ ] Apakah recipients valid?
[ ] Apakah From domain diperbolehkan relay?
[ ] Apakah exception diklasifikasi?
```

### 25.2 Apa yang dicek saat inbound gagal?

```text
[ ] Apakah Store protocol benar?
[ ] Apakah SSL/TLS config benar?
[ ] Apakah mailbox credential benar?
[ ] Apakah Folder exists?
[ ] Apakah Folder dibuka READ_ONLY/READ_WRITE sesuai kebutuhan?
[ ] Apakah message count besar?
[ ] Apakah getContent memuat attachment besar?
[ ] Apakah parser recursive aman?
[ ] Apakah duplicate processing dicegah?
[ ] Apakah folder ditutup?
[ ] Apakah store ditutup?
```

---

## 26. Mental Model Visual: Sending

```text
+----------------------+       +-------------------------+
| Business Operation   |       | Domain State            |
| approve case         +------>+ case approved           |
+----------+-----------+       +------------+------------+
           |                                |
           | creates notification intent    |
           v                                v
+---------------------------------------------------------+
| Outbox Row                                              |
| id, type, recipient, template, status=PENDING           |
+---------------------------+-----------------------------+
                            |
                            v
+---------------------------------------------------------+
| Mail Worker                                             |
| claim -> compose -> send -> classify -> update status   |
+---------------------------+-----------------------------+
                            |
                            v
+---------------------------------------------------------+
| Jakarta Mail Gateway                                    |
| Session -> MimeMessage -> Transport                     |
+---------------------------+-----------------------------+
                            |
                            v
+---------------------------------------------------------+
| SMTP Relay / Provider                                   |
| accepts or rejects handoff                              |
+---------------------------------------------------------+
```

---

## 27. Mental Model Visual: Receiving

```text
+--------------------+
| Session            |
| IMAP properties    |
+---------+----------+
          |
          v
+--------------------+
| Store              |
| connected mailbox  |
+---------+----------+
          |
          v
+--------------------+
| Folder             |
| INBOX/Bounce/etc.  |
+---------+----------+
          |
          v
+--------------------+
| Message[]          |
| headers/content    |
+---------+----------+
          |
          v
+--------------------+
| MIME Parser        |
| body/attachments   |
+---------+----------+
          |
          v
+--------------------+
| Domain Event       |
| bounce/reply/etc.  |
+--------------------+
```

---

## 28. Java 8–25 Compatibility View

| Concern | Java 8 legacy | Java 11+ | Java 17/21/25 modern |
|---|---|---|---|
| Package | `javax.mail` common | either, depends framework | `jakarta.mail` common |
| Activation | often `javax.activation` | explicit dependency needed | `jakarta.activation` with Jakarta stack |
| Framework | Java EE/Spring old | transitional | Jakarta EE 10/11, Spring Boot 3+ |
| Language feature | no records/var/text blocks | some modern features | records, sealed, virtual threads |
| Mail API mental model | same | same | same |
| Migration risk | dependency/classpath | mixed namespace | provider compatibility |

Important:

> Java language version and Jakarta Mail namespace are related only through ecosystem compatibility, not because Java 21 “requires” Jakarta Mail. A Java 21 app can still use legacy `javax.mail` if dependencies allow it, but modern Jakarta ecosystem generally expects `jakarta.mail`.

---

## 29. Top 1% Engineer Perspective

Top engineer tidak melihat `Session`, `Transport`, dan `MimeMessage` sebagai sekadar class API. Mereka melihatnya sebagai boundary dalam sistem.

### 29.1 Pertanyaan desain yang harus selalu muncul

Saat melihat kode mail, tanyakan:

1. Di mana `Session` dibuat?
2. Apakah property immutable?
3. Apakah timeout diset?
4. Apakah credential aman?
5. Apakah `Transport` lifecycle jelas?
6. Apakah send terjadi di request thread?
7. Apakah send terjadi di dalam DB transaction?
8. Apakah message dibuat per recipient?
9. Apakah charset eksplisit?
10. Apakah header input disanitasi?
11. Apakah raw MIME dilog?
12. Apakah failure diklasifikasi?
13. Apakah retry idempotent?
14. Apakah result “sent” dimaknai sebagai accepted, bukan delivered?
15. Apakah mail API bocor ke domain layer?
16. Apakah inbound parser aman terhadap hostile email?
17. Apakah attachment memory-safe?
18. Apakah system observable?

### 29.2 Invariant arsitektur

Beberapa invariant sehat:

```text
Invariant 1:
  Business layer must not depend directly on MimeMessage.

Invariant 2:
  Transport must be closed after manual connect.

Invariant 3:
  Every SMTP send attempt must have timeout.

Invariant 4:
  Mail send success means transport handoff, not final delivery.

Invariant 5:
  Email retry must be idempotent at business level.

Invariant 6:
  No raw message body or attachment in production logs.

Invariant 7:
  One personalized recipient means one message.

Invariant 8:
  Inbound email parsing must be treated as untrusted input parsing.
```

### 29.3 Design smell

Jika melihat ini:

```java
public void sendEmail(String to, String subject, String body) {
    Properties props = new Properties();
    props.put("mail.smtp.host", "smtp.gmail.com");
    Session session = Session.getDefaultInstance(props);
    MimeMessage message = new MimeMessage(session);
    // ...
    Transport.send(message);
}
```

Jangan hanya bilang “works”. Tanya:

- timeout mana?
- auth mana?
- TLS mana?
- secret dari mana?
- retry bagaimana?
- duplicate bagaimana?
- observability bagaimana?
- HTML/charset bagaimana?
- exception classification bagaimana?
- apakah ini dipanggil dalam transaksi?
- apakah provider rate limit dipatuhi?
- apakah ini testable?

Itulah perbedaan engineer biasa dan engineer yang mengoperasikan production-grade system.

---

## 30. Ringkasan

Object model inti Jakarta Mail:

```text
Session   = configuration + provider lookup context
Transport = outbound sending resource, usually SMTP
Store     = mailbox access resource, usually IMAP/POP3
Folder    = mailbox folder view
Message   = abstract mail message
MimeMessage = concrete internet/MIME message
Address   = address abstraction
InternetAddress = internet email address
Authenticator = credential callback
PasswordAuthentication = username/password holder
```

Prinsip penting:

1. `Session` bukan HTTP session dan bukan koneksi SMTP.
2. `Transport` adalah resource yang harus dikelola lifecycle-nya.
3. `Store` dan `Folder` adalah stateful mailbox access objects.
4. `MimeMessage` harus dibuat per logical email message.
5. Charset harus eksplisit.
6. Header input harus disanitasi.
7. `Transport.send` success bukan bukti final delivery.
8. Jakarta Mail object tidak seharusnya bocor ke domain layer.
9. Sending email production-grade membutuhkan outbox, retry, observability, dan failure classification.
10. Inbound mail processing harus diperlakukan sebagai parsing input tidak terpercaya.

---

## 31. Latihan Pemahaman

### Latihan 1 — Identifikasi object

Untuk flow berikut:

```text
Aplikasi mengirim email reset password melalui SMTP relay.
```

Identifikasi object Jakarta Mail yang terlibat:

- konfigurasi SMTP;
- kredensial;
- pesan reset password;
- alamat penerima;
- koneksi pengiriman.

Jawaban yang diharapkan:

```text
Session -> Authenticator/PasswordAuthentication -> MimeMessage -> InternetAddress -> Transport
```

### Latihan 2 — Refactor smell

Diberikan service:

```java
public void approve(Case c) throws MessagingException {
    caseRepository.save(c.approve());

    MimeMessage msg = new MimeMessage(session);
    msg.setRecipients(Message.RecipientType.TO, c.getApplicantEmail());
    msg.setSubject("Approved");
    msg.setText("Approved");
    Transport.send(msg);
}
```

Tulis ulang desainnya dengan:

- domain event atau outbox;
- `MailRequest`;
- `MailGateway`;
- worker;
- failure classification.

### Latihan 3 — Timeout checklist

Buat daftar property minimal untuk SMTP production:

```text
mail.smtp.host
mail.smtp.port
mail.smtp.auth
mail.smtp.starttls.enable
mail.smtp.starttls.required
mail.smtp.connectiontimeout
mail.smtp.timeout
mail.smtp.writetimeout
```

Lalu jelaskan risiko jika tiap property salah.

### Latihan 4 — Header safety

Buat function:

```java
String sanitizeHeaderValue(String input)
```

yang menolak CR/LF, null, dan panjang berlebih.

### Latihan 5 — Message lifecycle

Jelaskan mengapa `MimeMessage` sebaiknya tidak di-reuse untuk banyak recipient yang berbeda.

---

## 32. Checklist Produksi untuk Core API Usage

```text
[ ] Menggunakan namespace sesuai stack: javax atau jakarta, tidak campur.
[ ] Runtime memiliki provider implementation yang benar.
[ ] Session dibuat via getInstance, bukan default global mutable tanpa alasan.
[ ] Properties immutable setelah init.
[ ] Timeout SMTP/IMAP diset eksplisit.
[ ] Credential tidak hardcode.
[ ] STARTTLS/SSL config sesuai port/protocol.
[ ] MimeMessage dibuat per logical email.
[ ] Charset subject/body eksplisit UTF-8.
[ ] Address dibuat via InternetAddress, bukan string header manual.
[ ] Header custom disanitasi.
[ ] Transport ditutup pada semua path.
[ ] MessagingException diklasifikasi di infrastructure layer.
[ ] Raw MIME tidak dilog di production.
[ ] Mail sending tidak berada langsung dalam DB transaction.
[ ] Domain layer tidak bergantung pada MimeMessage/Transport.
[ ] Success dimaknai sebagai SMTP handoff/accepted, bukan delivered.
[ ] Inbound Store/Folder ditutup dengan benar.
[ ] Inbound parsing idempotent dan memory-safe.
```

---

## 33. Referensi

- Jakarta Mail Specification, Jakarta EE.
- Jakarta Mail 2.1 Specification.
- Eclipse Angus Mail documentation and API docs.
- Jakarta Activation Specification.
- Jakarta Activation API documentation.
- JavaMail/Jakarta Mail historical documentation.

---

## 34. Status Seri

Bagian ini adalah **Part 3** dari total **30 part**.

Progress:

```text
[x] Part 0 — Orientation: Email as a Distributed System
[x] Part 1 — Email Protocol Stack: SMTP, MIME, POP3, IMAP
[x] Part 2 — JavaMail to Jakarta Mail: History, Namespace, Compatibility, Migration
[x] Part 3 — Core API: Session, Store, Folder, Transport, Message
[ ] Part 4 — SMTP Sending: Properties, Transport, Timeout, TLS, Auth
[ ] Part 5 — MIME Message Construction: Text, HTML, Charset, Headers
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

Seri **belum selesai**.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 2 — JavaMail to Jakarta Mail: History, Namespace, Compatibility, and Migration Strategy](./02-javamail-to-jakarta-mail-migration.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 4 — SMTP Sending: Properties, Transport, Timeout, TLS, Auth](./04-smtp-sending-timeout-tls-auth.md)
