# Part 14 — Deliverability Fundamentals: SPF, DKIM, DMARC, Reputation, Bounce

> Series: `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery`  
> File: `14-deliverability-spf-dkim-dmarc-bounce.md`  
> Scope: Java 8–25, JavaMail/Jakarta Mail, SMTP relay, provider/API integration, enterprise notification system  
> Level: Advanced / production architecture

---

## 0. Tujuan Part Ini

Pada part sebelumnya, kita sudah masuk ke security: TLS, credential, OAuth2, secret management, header injection, dan abuse boundary. Namun ada satu kesalahpahaman yang sangat sering terjadi di production system:

> “Kalau `Transport.send(message)` tidak throw exception, berarti email sudah diterima user.”

Itu salah.

Yang biasanya benar hanya:

> Aplikasi berhasil menyerahkan message ke SMTP server / relay / provider pada saat itu.

Setelah itu masih ada banyak tahap:

```text
Application
  -> SMTP relay / provider
  -> provider outbound MTA
  -> internet routing / recipient MX
  -> recipient MTA
  -> authentication checks
  -> reputation checks
  -> spam/content filtering
  -> mailbox placement
  -> inbox / promotions / spam / quarantine / rejected / bounced
```

Part ini membahas **deliverability**, yaitu kemampuan sebuah email untuk tidak hanya berhasil dikirim secara teknis, tetapi juga memiliki peluang tinggi diterima, dipercaya, dan ditempatkan dengan benar oleh recipient domain/mailbox provider.

Kita tidak akan mengulang API dasar Jakarta Mail. Fokus kita adalah mental model, DNS authentication, domain alignment, reputation, bounce, complaint, suppression, dan bagaimana Java application seharusnya memodelkan status email secara benar.

---

## 1. Core Distinction: Send Success, Delivery, dan Inbox Placement

Dalam mail system, ada beberapa level keberhasilan yang berbeda.

### 1.1 Application send success

Ini terjadi ketika Java application berhasil memanggil SMTP relay/provider.

Contoh:

```java
Transport.send(message);
```

Atau:

```java
transport.sendMessage(message, recipients);
```

Jika tidak exception, artinya pada boundary itu message diterima oleh SMTP server yang kita hubungi.

Namun boundary itu biasanya hanya sampai:

```text
Application -> configured SMTP relay
```

Bukan sampai:

```text
Application -> recipient inbox
```

### 1.2 SMTP accepted

SMTP server bisa memberi response `250 OK` setelah message diterima.

Maknanya:

```text
Server menerima message untuk diproses lebih lanjut.
```

Bukan jaminan:

```text
Message sudah masuk inbox recipient.
```

SMTP memang store-and-forward. Server dapat menerima message lalu kemudian gagal mengirim ke hop berikutnya, menghasilkan bounce belakangan.

### 1.3 Delivered

Delivered biasanya berarti recipient server menerima message.

Namun delivered pun belum tentu inbox.

Kemungkinan placement:

```text
Delivered
  -> Inbox
  -> Promotions / Updates / Other tab
  -> Spam / Junk
  -> Quarantine
  -> Hidden policy folder
```

### 1.4 Inbox placement

Inbox placement adalah hasil paling sulit dikendalikan karena dipengaruhi oleh:

- authentication result,
- domain reputation,
- IP reputation,
- engagement,
- recipient behavior,
- content quality,
- complaint history,
- blocklist,
- sending pattern,
- provider-specific filtering.

Jakarta Mail tidak bisa menjamin inbox placement.

Jakarta Mail hanya membantu membentuk dan mengirim message sesuai protokol.

---

## 2. Deliverability Mental Model

Deliverability adalah hasil interaksi beberapa lapisan.

```text
+---------------------------------------------------------------+
| Business Notification                                          |
| - purpose                                                      |
| - recipient expectation                                        |
| - consent/preference                                          |
+-------------------------------+-------------------------------+
                                |
+-------------------------------v-------------------------------+
| Message Quality                                                |
| - valid headers                                                |
| - MIME correctness                                             |
| - text/html alternative                                        |
| - link quality                                                 |
| - attachment safety                                            |
+-------------------------------+-------------------------------+
                                |
+-------------------------------v-------------------------------+
| Sender Authentication                                          |
| - SPF                                                          |
| - DKIM                                                         |
| - DMARC alignment                                              |
+-------------------------------+-------------------------------+
                                |
+-------------------------------v-------------------------------+
| Sender Reputation                                              |
| - domain reputation                                            |
| - IP reputation                                                |
| - complaint rate                                               |
| - bounce rate                                                  |
| - volume pattern                                               |
+-------------------------------+-------------------------------+
                                |
+-------------------------------v-------------------------------+
| Recipient Filtering                                            |
| - spam classifier                                              |
| - policy engine                                                |
| - user-level filter                                            |
| - enterprise gateway                                           |
+-------------------------------+-------------------------------+
                                |
+-------------------------------v-------------------------------+
| Result                                                         |
| - accepted                                                     |
| - bounced                                                      |
| - spam/junk                                                    |
| - inbox                                                        |
| - quarantined                                                  |
| - silently dropped                                             |
+---------------------------------------------------------------+
```

Aplikasi Java berada terutama di lapisan:

```text
- message construction,
- sender identity,
- SMTP/API integration,
- retry handling,
- bounce handling,
- logging/audit,
- suppression,
- provider telemetry ingestion.
```

Aplikasi Java tidak langsung mengatur:

```text
- DNS policy,
- IP reputation,
- recipient filtering,
- mailbox provider policy,
- user engagement.
```

Namun aplikasi dapat merusak deliverability jika:

- `From` domain salah,
- DKIM tidak align,
- envelope sender tidak align,
- message duplicate dikirim berkali-kali,
- retry storm terjadi,
- hard bounce tetap dikirimi,
- recipient invalid tidak disuppressed,
- attachment mencurigakan,
- HTML broken,
- content terlalu mirip phishing,
- no unsubscribe untuk bulk/marketing,
- link memakai domain yang tidak trusted,
- semua tenant memakai sender yang sama tanpa isolation.

---

## 3. Tiga Authentication Pillars: SPF, DKIM, DMARC

Email authentication modern biasanya berdiri di atas tiga mekanisme utama:

```text
SPF   -> Apakah IP/server ini diizinkan mengirim atas domain envelope sender?
DKIM  -> Apakah message ditandatangani oleh domain tertentu dan tidak berubah?
DMARC -> Apakah SPF/DKIM yang pass selaras dengan Header From domain?
```

Ketiganya tidak menggantikan TLS. TLS melindungi transport antar hop jika digunakan. SPF/DKIM/DMARC membantu penerima menilai identitas sender/domain.

---

## 4. SPF: Sender Policy Framework

### 4.1 Apa itu SPF?

SPF adalah mekanisme DNS yang memungkinkan pemilik domain menyatakan server/IP mana yang boleh mengirim email menggunakan domain tersebut sebagai envelope sender.

Secara konsep:

```text
Domain owner publishes SPF record in DNS.
Receiving server checks whether connecting SMTP IP is authorized.
```

Contoh SPF record:

```dns
example.com. TXT "v=spf1 include:_spf.provider.example -all"
```

Makna sederhana:

```text
Untuk domain example.com, host yang termasuk dalam _spf.provider.example diizinkan mengirim.
Selain itu gagal keras.
```

### 4.2 SPF memeriksa apa?

SPF terutama terkait dengan SMTP envelope identity, bukan display `From` yang dilihat user.

SMTP layer:

```text
MAIL FROM:<bounce@example.com>
RCPT TO:<user@recipient.com>
```

Message header layer:

```text
From: Company <noreply@example.com>
To: User <user@recipient.com>
Subject: ...
```

SPF memeriksa domain dari envelope sender / return-path context.

### 4.3 SPF pass tidak berarti From aman

Misalnya:

```text
MAIL FROM:<bounce@provider-owned-domain.com>
From: Bank Trusted <security@bank.example>
```

SPF bisa pass untuk `provider-owned-domain.com`, tetapi user melihat `bank.example` di header From.

Karena itu SPF saja tidak cukup untuk melindungi visible identity.

DMARC datang untuk menghubungkan authentication result dengan `Header From`.

### 4.4 SPF mechanism umum

Contoh:

```dns
v=spf1 ip4:203.0.113.10 include:_spf.mailprovider.example -all
```

Mechanism umum:

| Mechanism | Makna |
|---|---|
| `ip4` | IPv4 yang diizinkan |
| `ip6` | IPv6 yang diizinkan |
| `include` | include policy domain lain |
| `a` | host dengan A/AAAA domain diizinkan |
| `mx` | MX host domain diizinkan |
| `exists` | advanced DNS existence check |
| `all` | catch-all fallback |

Qualifier umum:

| Qualifier | Meaning |
|---|---|
| `+` | pass |
| `-` | fail |
| `~` | softfail |
| `?` | neutral |

Contoh:

```dns
v=spf1 include:_spf.provider.example ~all
```

Artinya selain provider, hasilnya softfail, bukan hard fail.

### 4.5 SPF operational pitfalls

#### Pitfall 1 — DNS lookup limit

SPF memiliki batas DNS lookup. Terlalu banyak `include`, `a`, `mx`, atau `redirect` dapat membuat SPF permerror.

Pola buruk:

```dns
v=spf1 include:provider1 include:provider2 include:provider3 include:provider4 include:provider5 include:provider6 include:provider7 include:provider8 include:provider9 include:provider10 -all
```

Dampak:

```text
Recipient server may treat SPF as invalid/permerror.
```

#### Pitfall 2 — Banyak provider memakai domain yang sama

Jika domain digunakan oleh:

- app transactional email,
- marketing tool,
- CRM,
- ticketing system,
- survey tool,
- internal SMTP,

maka SPF record sering menjadi panjang dan fragile.

Solusi lebih baik:

```text
transactional.example.com
marketing.example.com
support.example.com
survey.example.com
```

Pisahkan subdomain berdasarkan channel dan risk profile.

#### Pitfall 3 — SPF breaks on forwarding

Forwarding dapat membuat connecting IP berubah.

Contoh:

```text
original sender -> forwarder -> final recipient
```

Final recipient melihat IP forwarder, bukan original sender. SPF bisa fail.

DKIM lebih tahan terhadap forwarding selama message tidak dimodifikasi dengan cara yang merusak signature.

### 4.6 Apa yang Java developer perlu tahu tentang SPF?

Biasanya Java application tidak membuat SPF record. Namun Java engineer tetap perlu tahu karena sender identity yang dipilih di code memengaruhi SPF/DMARC.

Misalnya:

```java
message.setFrom(new InternetAddress("noreply@example.com", "Example"));
```

Tetapi SMTP provider memakai envelope sender:

```text
bounce@provider-domain.com
```

Jika DMARC alignment tidak dikonfigurasi, deliverability bisa buruk.

Pertanyaan yang harus ditanyakan engineer:

```text
1. Domain apa yang muncul di Header From?
2. Domain apa yang dipakai envelope sender / Return-Path?
3. Apakah provider sudah authorized di SPF domain itu?
4. Apakah SPF domain align dengan Header From untuk DMARC?
5. Apakah subdomain dipisahkan untuk use case berbeda?
```

---

## 5. DKIM: DomainKeys Identified Mail

### 5.1 Apa itu DKIM?

DKIM adalah mekanisme tanda tangan kriptografis pada email. Pengirim menandatangani bagian header/body message dengan private key. Public key dipublikasikan di DNS. Penerima mengambil public key dari DNS dan memverifikasi signature.

Secara konsep:

```text
Sender signs message using private key.
Receiver fetches public key from DNS.
Receiver verifies message integrity and signing domain.
```

Header contoh:

```text
DKIM-Signature: v=1; a=rsa-sha256; d=example.com; s=selector1; ...
```

Field penting:

| Field | Makna |
|---|---|
| `d=` | signing domain |
| `s=` | selector untuk DNS key lookup |
| `a=` | algorithm |
| `h=` | signed headers |
| `bh=` | body hash |
| `b=` | signature |

### 5.2 DKIM memvalidasi apa?

DKIM menjawab:

```text
Apakah domain tertentu mengambil tanggung jawab atas message ini?
Apakah bagian message yang ditandatangani berubah setelah signing?
```

DKIM tidak selalu menjawab:

```text
Apakah From address benar-benar milik user yang terlihat?
```

Karena signing domain (`d=`) bisa berbeda dari `Header From` domain.

DMARC yang mengevaluasi alignment.

### 5.3 DKIM selector

Selector memungkinkan domain memiliki beberapa key.

Contoh DNS:

```dns
selector1._domainkey.example.com TXT "v=DKIM1; k=rsa; p=..."
selector2._domainkey.example.com TXT "v=DKIM1; k=rsa; p=..."
```

Manfaat:

- key rotation,
- provider separation,
- environment separation,
- tenant isolation.

### 5.4 DKIM signing: application atau provider?

Ada dua pendekatan.

#### Option A — Provider signs

Aplikasi mengirim ke SMTP/API provider. Provider menambahkan DKIM signature.

```text
Java App -> Provider SMTP/API -> Provider signs DKIM -> Recipient
```

Ini paling umum.

Kelebihan:

- lebih mudah,
- key private disimpan provider,
- provider dashboard membantu setup,
- less code.

Kekurangan:

- vendor dependency,
- perlu DNS setup,
- multi-provider lebih kompleks,
- signing behavior provider-specific.

#### Option B — Application signs

Aplikasi menandatangani sendiri sebelum kirim.

```text
Java App signs DKIM -> SMTP relay -> Recipient
```

Kelebihan:

- kontrol lebih besar,
- cocok untuk custom relay,
- bisa menjaga signing sebelum relay tertentu.

Kekurangan:

- private key management di aplikasi,
- risk besar jika key leak,
- harus hati-hati MIME canonicalization,
- relay yang mengubah message bisa merusak signature,
- lebih sulit dioperasikan.

Untuk kebanyakan enterprise application, provider-managed DKIM lebih disarankan kecuali ada kebutuhan khusus.

### 5.5 DKIM dan MIME mutation

DKIM signature bisa rusak jika message berubah setelah signing.

Contoh perubahan yang berisiko:

- gateway menambahkan footer,
- antivirus mengubah attachment,
- mailing list menambah prefix subject,
- relay mengubah line endings,
- sistem menambahkan tracking wrapper setelah signing,
- encoding body berubah.

Karena itu signing sebaiknya dilakukan pada hop terakhir sebelum keluar ke recipient, atau pastikan tidak ada komponen downstream yang mengubah signed content.

### 5.6 Apa yang Java developer perlu tahu tentang DKIM?

Pertanyaan operasional:

```text
1. Siapa yang melakukan DKIM signing?
2. Domain apa pada `d=`?
3. Apakah `d=` align dengan Header From domain?
4. Selector apa yang digunakan?
5. Bagaimana key rotation dilakukan?
6. Apakah ada gateway yang mengubah MIME setelah signing?
7. Apakah provider signing semua email atau hanya domain verified?
8. Apakah test/staging memakai domain berbeda?
```

Dalam Java code, keputusan yang memengaruhi DKIM:

- message body structure,
- headers,
- attachments,
- line endings secara tidak langsung,
- apakah message dimodifikasi setelah signing,
- apakah relay provider dapat menandatangani domain yang dipakai `From`.

---

## 6. DMARC: Domain-based Message Authentication, Reporting, and Conformance

### 6.1 Apa itu DMARC?

DMARC adalah policy layer di atas SPF dan DKIM.

DMARC bertanya:

```text
Apakah email yang mengklaim Header From domain X berhasil authenticate dengan SPF atau DKIM yang align dengan domain X?
Jika tidak, apa kebijakan domain X?
```

DMARC record contoh:

```dns
_dmarc.example.com TXT "v=DMARC1; p=quarantine; rua=mailto:dmarc-agg@example.com; pct=100"
```

Policy umum:

| Policy | Makna |
|---|---|
| `p=none` | monitor saja, jangan minta enforcement |
| `p=quarantine` | minta receiver quarantine suspicious mail |
| `p=reject` | minta receiver reject suspicious mail |

### 6.2 DMARC alignment

DMARC tidak cukup hanya SPF pass atau DKIM pass. Hasil pass tersebut harus align dengan `Header From` domain.

Header:

```text
From: Example <noreply@example.com>
```

SPF align jika envelope sender domain align:

```text
MAIL FROM:<bounce@example.com>
```

DKIM align jika signing domain align:

```text
DKIM-Signature: d=example.com; ...
```

Simplified DMARC pass:

```text
DMARC pass if:
  (SPF pass AND SPF domain aligns with Header From domain)
  OR
  (DKIM pass AND DKIM d= domain aligns with Header From domain)
```

### 6.3 Relaxed vs strict alignment

DMARC mendukung alignment relaxed dan strict.

Relaxed alignment:

```text
Header From: example.com
DKIM d=: mail.example.com
=> may align organizationally
```

Strict alignment:

```text
Header From: example.com
DKIM d=: mail.example.com
=> not aligned
```

Relevant tags:

```dns
adkim=s
aspf=s
```

`adkim` mengontrol DKIM alignment mode.  
`aspf` mengontrol SPF alignment mode.

### 6.4 DMARC record anatomy

Contoh:

```dns
_dmarc.example.com TXT "v=DMARC1; p=reject; rua=mailto:dmarc-agg@example.com; ruf=mailto:dmarc-forensic@example.com; adkim=s; aspf=s; pct=100"
```

Tag umum:

| Tag | Makna |
|---|---|
| `v` | version |
| `p` | policy untuk domain |
| `sp` | policy untuk subdomain |
| `rua` | aggregate report destination |
| `ruf` | forensic/failure report destination, support bervariasi |
| `pct` | percentage enforcement |
| `adkim` | DKIM alignment mode |
| `aspf` | SPF alignment mode |

### 6.5 DMARC rollout strategy

Jangan langsung `p=reject` tanpa observability.

Strategi umum:

```text
1. p=none; collect reports
2. identify all legitimate senders
3. fix SPF/DKIM/alignment
4. move to p=quarantine with pct small
5. increase pct gradually
6. move to p=reject when confident
```

Contoh staged records:

```dns
_dmarc.example.com TXT "v=DMARC1; p=none; rua=mailto:dmarc@example.com"
```

Lalu:

```dns
_dmarc.example.com TXT "v=DMARC1; p=quarantine; pct=25; rua=mailto:dmarc@example.com"
```

Lalu:

```dns
_dmarc.example.com TXT "v=DMARC1; p=reject; pct=100; rua=mailto:dmarc@example.com"
```

### 6.6 DMARC reporting

DMARC aggregate reports memberi visibility tentang siapa yang mengirim atas nama domain.

Biasanya report berisi:

- source IP,
- SPF result,
- DKIM result,
- alignment result,
- disposition,
- volume,
- policy applied.

Ini penting untuk menemukan:

- shadow sender,
- SaaS tool yang belum dikonfigurasi,
- spoofing attempt,
- subdomain misuse,
- provider migration issue.

### 6.7 Apa yang Java developer perlu tahu tentang DMARC?

DMARC sangat terkait dengan keputusan aplikasi:

```java
message.setFrom("noreply@example.com");
```

Jika provider tidak DKIM-sign `example.com` dan envelope sender tidak align dengan `example.com`, maka DMARC bisa fail.

Checklist developer:

```text
1. Jangan asal mengganti From domain di code.
2. Jangan allow tenant memasukkan arbitrary From domain tanpa verification.
3. Pastikan provider configured untuk DKIM domain tersebut.
4. Pastikan return-path/envelope sender domain compatible.
5. Untuk multi-tenant, buat domain verification workflow.
6. Pisahkan display name dari authenticated domain.
7. Validasi perubahan sender sebagai configuration change, bukan hanya UI value.
```

---

## 7. Relationship SPF, DKIM, DMARC dengan Jakarta Mail

Jakarta Mail tidak otomatis membuat SPF, DKIM, atau DMARC.

```text
Jakarta Mail builds and sends MIME messages.
SPF/DKIM/DMARC are DNS/authentication/policy systems around mail delivery.
```

Namun Jakarta Mail berpengaruh karena ia membentuk:

- Header From,
- Sender,
- Reply-To,
- Message-ID,
- body,
- MIME structure,
- attachment,
- recipient,
- envelope sender jika memakai provider-specific property.

### 7.1 Header From di Jakarta Mail

```java
MimeMessage message = new MimeMessage(session);
message.setFrom(new InternetAddress("noreply@example.com", "Example App"));
```

Ini visible identity.

### 7.2 Envelope sender di Jakarta Mail SMTP provider

Pada JavaMail/Jakarta Mail provider tertentu, envelope sender dapat dikontrol dengan property seperti:

```java
props.put("mail.smtp.from", "bounce@example.com");
```

Ini memengaruhi SMTP `MAIL FROM`, bukan header `From`.

Gunakan dengan hati-hati karena ini berhubungan dengan SPF/DMARC dan bounce routing.

### 7.3 Reply-To

```java
message.setReplyTo(new Address[] {
    new InternetAddress("support@example.com", "Example Support")
});
```

`Reply-To` tidak menggantikan authentication. Ini hanya mengarahkan reply user.

### 7.4 Multi-tenant sender example

Bad design:

```java
message.setFrom(new InternetAddress(tenant.getRequestedFromAddress()));
```

Masalah:

- tenant bisa spoof domain orang lain,
- DMARC fail,
- provider reject,
- reputasi shared domain rusak,
- compliance risk.

Better design:

```text
Tenant sender domain must be verified before use:
  - DNS ownership verified
  - DKIM configured
  - bounce domain configured
  - policy reviewed
  - rate limit assigned
```

Code-level boundary:

```java
VerifiedSenderIdentity sender = senderRegistry.resolve(tenantId, senderId);
message.setFrom(sender.headerFrom());
props.put("mail.smtp.from", sender.envelopeFrom());
```

Domain-level boundary lebih penting daripada sekadar string validation.

---

## 8. Reputation: Domain, IP, Content, Behavior

Authentication menjawab:

```text
Apakah message berasal dari domain yang diklaim?
```

Reputation menjawab:

```text
Apakah domain/IP/pola sender ini layak dipercaya?
```

### 8.1 Domain reputation

Domain reputation melekat pada domain yang dipakai untuk sending.

Dipengaruhi oleh:

- complaint rate,
- bounce rate,
- spam trap hit,
- volume consistency,
- message quality,
- historical engagement,
- authentication health,
- blocklist,
- phishing-like content.

### 8.2 IP reputation

IP reputation melekat pada IP pengirim.

Jika memakai shared SMTP provider, IP reputation bisa shared dengan sender lain. Jika dedicated IP, reputasi lebih controlled tetapi butuh warm-up.

Tradeoff:

| Model | Kelebihan | Risiko |
|---|---|---|
| Shared IP | mudah, tidak perlu warm-up sendiri | reputasi dipengaruhi sender lain |
| Dedicated IP | kontrol lebih tinggi | harus warm-up, volume rendah bisa buruk |
| Provider pool managed | provider mengoptimasi routing | kurang transparan |

### 8.3 Subdomain reputation isolation

Untuk enterprise system, gunakan subdomain berbeda.

Contoh:

```text
app.example.com            -> transactional account notification
notify.example.com         -> system notification
billing.example.com        -> invoice/payment notification
marketing.example.com      -> campaign/bulk
support.example.com        -> ticketing/support
```

Manfaat:

- isolate reputation,
- easier DMARC policy,
- easier provider routing,
- better monitoring,
- easier incident containment.

### 8.4 Behavior reputation

Mailbox provider melihat pola.

Pola buruk:

```text
- sudden burst from cold domain/IP
- high invalid recipient rate
- many recipients mark spam
- repeated resend to bounced address
- duplicate content spammy pattern
- deceptive subject
- links to suspicious domain
- large executable attachments
```

Pola baik:

```text
- consistent volume
- authenticated domain
- low bounce
- low complaint
- expected transactional purpose
- clear sender identity
- clean HTML/text
- functional unsubscribe where required
```

### 8.5 Java application impact

Aplikasi Java dapat menjaga reputation dengan:

- not sending to known invalid recipients,
- respecting unsubscribe/preferences,
- throttling,
- using outbox state machine,
- avoiding duplicate sends,
- template validation,
- suppressing hard bounce,
- separating transactional/bulk streams,
- monitoring bounce/complaint feedback.

---

## 9. Bounce Fundamentals

Bounce adalah sinyal bahwa message tidak dapat dikirim ke recipient, baik sementara maupun permanen.

Ada dua kategori umum:

```text
Hard bounce -> permanent failure
Soft bounce -> temporary failure
```

### 9.1 Hard bounce

Hard bounce biasanya berarti address/domain tidak valid atau tidak dapat menerima secara permanen.

Contoh penyebab:

- mailbox tidak ada,
- domain tidak ada,
- recipient disabled,
- address malformed,
- policy permanent reject,
- blocked sender secara permanen.

Contoh SMTP class:

```text
550 5.1.1 User unknown
550 5.7.1 Message rejected
```

Hard bounce harus masuk suppression list.

Jika tetap dikirimi, dampaknya:

- bounce rate naik,
- reputation turun,
- provider bisa suspend,
- recipient provider makin distrust.

### 9.2 Soft bounce

Soft bounce biasanya temporary.

Contoh penyebab:

- mailbox full,
- temporary server unavailable,
- greylisting,
- rate limit,
- DNS temporary failure,
- network issue,
- provider throttling.

Contoh SMTP class:

```text
421 4.7.0 Temporary rate limit
451 4.3.0 Temporary local problem
452 4.2.2 Mailbox full
```

Soft bounce bisa retry, tetapi harus dibatasi.

### 9.3 Bounce can be asynchronous

SMTP relay bisa menerima message dari app, lalu bounce muncul belakangan.

Timeline:

```text
T0  Java app sends to provider
T1  Provider returns accepted
T2  App marks SENT
T3  Provider attempts final delivery
T4  Recipient rejects
T5  Bounce event generated
T6  App receives webhook/bounce mailbox event
T7  App updates status to BOUNCED
```

Karena itu status `SENT` bukan final delivery state.

Lebih akurat:

```text
ACCEPTED_BY_PROVIDER
DELIVERED
BOUNCED
COMPLAINED
SUPPRESSED
```

### 9.4 DSN: Delivery Status Notification

Bounce sering berbentuk DSN message. Isinya bisa machine-readable tetapi bervariasi.

Hal yang bisa muncul:

- original recipient,
- final recipient,
- action,
- status code,
- diagnostic code,
- reporting MTA.

Namun parsing DSN lintas provider/domain tidak selalu bersih.

Provider webhook biasanya lebih reliable daripada parsing bounce mailbox manual.

---

## 10. SMTP Status Code and Enhanced Status Code

SMTP reply code class penting untuk classification.

Simplified:

| Class | Meaning | Retry? |
|---|---|---|
| 2xx | success | no need |
| 3xx | intermediate | continue protocol |
| 4xx | transient failure | usually retry |
| 5xx | permanent failure | usually do not retry blindly |

Enhanced status code memberi detail seperti:

```text
5.1.1 -> bad destination mailbox address
5.2.2 -> mailbox full
5.7.1 -> delivery not authorized / policy rejection
4.7.0 -> temporary security/rate/policy issue
```

Important nuance:

```text
A 5xx at RCPT TO may affect one recipient only.
A 5xx after DATA may affect the whole message.
A provider API event may classify differently from raw SMTP code.
```

Jangan hanya mengandalkan `String.contains("550")`.

Buat normalizer.

---

## 11. Complaint and Spam Feedback

Complaint terjadi ketika recipient menandai email sebagai spam/junk atau provider mengirim feedback loop event.

Complaint lebih berbahaya daripada bounce.

Bounce mengatakan:

```text
Alamat tidak bisa menerima.
```

Complaint mengatakan:

```text
Recipient tidak menginginkan email ini / menganggap spam.
```

### 11.1 Complaint handling rule

Untuk banyak sistem, complaint harus menyebabkan suppression.

```text
If recipient complains:
  - suppress future bulk email
  - maybe suppress non-critical notification depending on policy
  - keep critical regulatory/security notices carefully governed
```

Untuk regulatory/transactional system, tidak semua email bisa dihentikan total. Namun complaint tetap harus dicatat dan di-review.

### 11.2 Complaint data model

Minimal:

```text
recipient_hash
recipient_domain
template_id
notification_type
provider
complaint_time
source_event_id
raw_reason
suppression_action
```

Jangan simpan raw full email body tanpa alasan compliance yang kuat.

---

## 12. Suppression List

Suppression list adalah daftar recipient yang tidak boleh dikirimi untuk kategori tertentu.

Kategori suppression:

```text
- hard bounce
- complaint
- unsubscribe
- manual block
- invalid address
- legal/privacy request
- provider suppression
```

### 12.1 Global vs scoped suppression

Tidak semua suppression sama.

```text
Global suppression:
  user@example.com tidak boleh dikirimi sama sekali.

Channel suppression:
  user@example.com tidak boleh menerima marketing email.

Template/category suppression:
  user@example.com tidak mau survey email.

Domain suppression:
  semua email ke domain tertentu dihentikan sementara.
```

### 12.2 Transactional vs marketing nuance

Untuk marketing:

```text
unsubscribe => stop sending marketing
```

Untuk transactional/regulatory:

```text
some notices may still be legally required
```

Namun jangan gunakan alasan “transactional” untuk mengirim spam/promosi. Klasifikasi harus jujur.

### 12.3 Suppression check location

Suppression harus dicek sebelum send attempt.

Pipeline:

```text
Business event
  -> notification eligibility
  -> recipient preference
  -> suppression check
  -> template render
  -> outbox enqueue
  -> send worker
  -> provider
```

Jangan baru cek suppression setelah message terkirim.

---

## 13. Designing Delivery State in Java Application

Model buruk:

```text
PENDING -> SENT -> FAILED
```

Terlalu kasar.

Model lebih baik:

```text
DRAFTED
QUEUED
SUPPRESSED
PROCESSING
ACCEPTED_BY_SMTP
ACCEPTED_BY_PROVIDER
DELIVERED
BOUNCED_SOFT
BOUNCED_HARD
COMPLAINED
FAILED_RETRYABLE
FAILED_PERMANENT
DEAD_LETTER
CANCELLED
```

Namun jangan selalu expose semua state ke bisnis. Bisa dibagi:

```text
Internal technical state
External/business-visible state
```

### 13.1 Example internal state machine

```text
REQUESTED
  -> SUPPRESSED
  -> QUEUED
      -> PROCESSING
          -> ACCEPTED_BY_PROVIDER
              -> DELIVERED
              -> BOUNCED_SOFT
              -> BOUNCED_HARD
              -> COMPLAINED
          -> FAILED_RETRYABLE
              -> QUEUED
              -> DEAD_LETTER
          -> FAILED_PERMANENT
```

### 13.2 Important invariant

```text
ACCEPTED_BY_PROVIDER is not DELIVERED.
DELIVERED is not READ.
READ receipt is unreliable and often unavailable.
INBOX placement is usually not observable directly.
```

### 13.3 Java enum example

```java
public enum MailDeliveryState {
    REQUESTED,
    SUPPRESSED,
    QUEUED,
    PROCESSING,
    ACCEPTED_BY_PROVIDER,
    DELIVERED,
    BOUNCED_SOFT,
    BOUNCED_HARD,
    COMPLAINED,
    FAILED_RETRYABLE,
    FAILED_PERMANENT,
    DEAD_LETTER,
    CANCELLED
}
```

### 13.4 Delivery event model

```java
public record MailDeliveryEvent(
        String eventId,
        String notificationId,
        String providerMessageId,
        String recipientHash,
        MailDeliveryEventType type,
        String smtpStatus,
        String enhancedStatus,
        String diagnosticCode,
        Instant occurredAt,
        Instant receivedAt
) {}
```

Event type:

```java
public enum MailDeliveryEventType {
    PROVIDER_ACCEPTED,
    DELIVERED,
    SOFT_BOUNCE,
    HARD_BOUNCE,
    COMPLAINT,
    OPENED,
    CLICKED,
    UNSUBSCRIBED,
    REJECTED,
    DROPPED
}
```

Open/click tracking harus diperlakukan hati-hati karena privacy, bot scanning, proxy image loading, dan compliance.

---

## 14. Provider Webhook Integration

Modern email provider sering memberi webhook untuk:

- delivered,
- bounced,
- dropped,
- deferred,
- complaint,
- unsubscribe,
- open,
- click.

### 14.1 Webhook is at-least-once

Webhook dapat dikirim lebih dari sekali.

Invariant:

```text
Webhook handler must be idempotent.
```

Gunakan unique event id:

```text
provider + event_id
```

Jika provider tidak menyediakan event id, buat fingerprint:

```text
provider_message_id + recipient + event_type + timestamp bucket
```

### 14.2 Webhook can arrive out of order

Contoh:

```text
DELIVERED arrives after BOUNCED
COMPLAINT arrives after DELIVERED
DEFERRED arrives after DELIVERED due to retry telemetry delay
```

Jangan update state secara naive.

Buat precedence.

Contoh precedence:

```text
COMPLAINED > BOUNCED_HARD > DELIVERED > ACCEPTED_BY_PROVIDER > QUEUED
```

Namun soft bounce bisa transient dan tidak final.

### 14.3 Webhook security

Webhook endpoint harus:

- verify signature,
- validate timestamp,
- prevent replay,
- authenticate provider,
- rate limit,
- log safely,
- parse defensively,
- avoid trusting recipient email blindly,
- avoid exposing raw PII in logs.

### 14.4 Webhook processing architecture

```text
Provider webhook HTTP endpoint
  -> verify signature
  -> persist raw event minimally
  -> normalize event
  -> idempotency check
  -> update delivery event table
  -> update notification recipient state
  -> update suppression if needed
  -> emit internal domain event
```

Do not perform heavy analytics directly in webhook request thread.

---

## 15. Bounce Mailbox vs Webhook

### 15.1 Bounce mailbox pattern

Older systems process bounces by reading mailbox.

```text
Return-Path: bounce+notificationId@example.com
```

Then app reads mailbox via IMAP:

```text
Java app -> IMAP Store -> Folder -> DSN messages -> parse -> update status
```

Pros:

- works without provider webhook,
- protocol-based,
- can be vendor neutral.

Cons:

- parsing bounces is messy,
- mailbox can grow,
- duplicate processing,
- latency,
- credentials,
- DSN format variability,
- security risk parsing arbitrary inbound mail.

### 15.2 Webhook pattern

Provider sends structured event.

Pros:

- easier parsing,
- near real-time,
- more event types,
- includes provider message id.

Cons:

- provider-specific,
- requires public endpoint,
- webhook security,
- event schema migration,
- vendor lock-in.

### 15.3 Recommendation

For modern enterprise Java system:

```text
Prefer provider webhook if provider supports it.
Use bounce mailbox only when required or as fallback.
Normalize both into internal DeliveryEvent model.
```

---

## 16. VERP and Bounce Correlation

VERP stands for Variable Envelope Return Path.

Concept:

```text
Each recipient/message gets unique envelope sender.
```

Example:

```text
MAIL FROM:<bounce+notif-12345.user-67890@example.com>
```

If bounce returns to that address, app can correlate without parsing full body deeply.

Benefits:

- easier correlation,
- recipient-specific bounce,
- works with mailbox processing.

Risks:

- address length,
- PII leakage if raw user ID/email included,
- DNS/domain setup,
- provider support,
- abuse if not signed/controlled.

Better:

```text
bounce+opaqueToken@example.com
```

Where opaque token maps to:

```text
notification_id + recipient_id + checksum + expiry/context
```

Do not put raw email or sensitive case ID in return path.

---

## 17. Deliverability-Friendly Message Design

### 17.1 Clear identity

Good:

```text
From: Example Billing <billing@example.com>
Reply-To: Example Support <support@example.com>
```

Bad:

```text
From: Admin <random@gmail.com>
Reply-To: do-not-reply-unmonitored@example.com
```

### 17.2 Plain text alternative

For HTML email, provide text alternative.

```text
multipart/alternative
  text/plain
  text/html
```

Benefits:

- accessibility,
- client compatibility,
- spam filter friendliness,
- fallback.

### 17.3 Consistent link domains

If email says it is from `example.com`, links should not point to strange unrelated domains.

Bad:

```text
From: noreply@example.com
Link: https://random-tracking-provider-long-host.example.net/...
```

Better:

```text
From: noreply@example.com
Link: https://links.example.com/...
```

But link tracking domain must also be secured and reputationally managed.

### 17.4 Attachment caution

Risky attachment types:

- executable,
- macro-enabled office files,
- password-protected archives,
- large compressed files,
- unknown binary,
- mismatched extension/content.

Often better:

```text
Send secure link instead of attachment.
```

Especially for sensitive documents.

### 17.5 Avoid deceptive patterns

Bad:

- fake urgency,
- subject mismatch,
- hidden links,
- image-only email,
- excessive tracking,
- misleading sender,
- too many recipients,
- unpersonalized bulk from transactional domain.

---

## 18. Transactional vs Bulk Deliverability

### 18.1 Transactional email

Examples:

- password reset,
- account verification,
- OTP,
- invoice,
- case status update,
- appointment confirmation,
- security alert.

Characteristics:

- expected by recipient,
- triggered by user/system event,
- lower volume,
- high importance,
- should be isolated from marketing reputation.

### 18.2 Bulk/marketing email

Examples:

- newsletter,
- campaign,
- promotion,
- survey blast,
- announcement to large audience.

Characteristics:

- higher complaint risk,
- needs unsubscribe,
- needs preference handling,
- rate limit critical,
- separate sending domain recommended.

### 18.3 Do not mix channels carelessly

Bad:

```text
password reset and marketing campaign use same sender domain/IP/config
```

Risk:

```text
marketing complaints degrade password reset deliverability
```

Better:

```text
transactional.example.com -> transactional provider stream
marketing.example.com     -> marketing provider stream
```

---

## 19. Domain Strategy for Enterprise Systems

A mature system treats sender domain as architecture, not a string field.

### 19.1 Single domain strategy

```text
noreply@example.com
```

Simple but risky.

Problems:

- reputation coupling,
- difficult routing,
- weak ownership clarity,
- complex SPF include list,
- incident blast radius.

### 19.2 Subdomain strategy

```text
noreply@app.example.com
billing@billing.example.com
support@support.example.com
news@marketing.example.com
```

Better for isolation.

### 19.3 Tenant domain strategy

SaaS/multi-tenant:

```text
tenantA.customer-domain.com
tenantB.customer-domain.com
```

Requires:

- domain verification,
- DKIM setup,
- bounce domain setup,
- DMARC alignment,
- per-tenant rate limit,
- abuse monitoring,
- fallback sender.

### 19.4 Recommended sender identity table

```text
sender_identity
  id
  tenant_id
  header_from_email
  header_from_name
  envelope_from
  reply_to
  dkim_domain
  spf_domain
  dmarc_alignment_mode
  provider
  provider_domain_id
  verification_status
  verified_at
  disabled_at
  risk_tier
```

Do not let arbitrary code construct sender identity freely.

---

## 20. Java Mail Gateway Design for Deliverability

### 20.1 Anti-pattern

```java
public void send(String from, String to, String subject, String html) {
    MimeMessage message = new MimeMessage(session);
    message.setFrom(from);
    message.setRecipients(Message.RecipientType.TO, to);
    message.setSubject(subject);
    message.setContent(html, "text/html");
    Transport.send(message);
}
```

Problems:

- arbitrary from,
- no sender verification,
- no envelope sender,
- no text alternative,
- no suppression,
- no classification,
- no event correlation,
- no idempotency,
- no provider message id,
- no bounce mapping.

### 20.2 Better abstraction

```java
public interface MailGateway {
    MailSubmissionResult submit(PreparedMail mail) throws MailGatewayException;
}
```

Where `PreparedMail` contains verified identity:

```java
public record PreparedMail(
        String notificationId,
        VerifiedSenderIdentity sender,
        List<VerifiedRecipient> recipients,
        RenderedMimeContent content,
        List<AttachmentRef> attachments,
        Map<String, String> metadata
) {}
```

### 20.3 Submission result should not say delivered

```java
public record MailSubmissionResult(
        String providerMessageId,
        SubmissionStatus status,
        Instant acceptedAt,
        String rawProviderResponse
) {}
```

Enum:

```java
public enum SubmissionStatus {
    ACCEPTED_BY_PROVIDER,
    REJECTED_BY_PROVIDER,
    PARTIALLY_ACCEPTED,
    TEMPORARY_FAILURE
}
```

Do not return `DELIVERED` from SMTP send unless provider actually confirms final delivery, which SMTP normally does not.

---

## 21. Deliverability Checklist Before Production

### 21.1 DNS/authentication checklist

```text
[ ] SPF record exists for sending domain.
[ ] SPF includes all legitimate senders.
[ ] SPF does not exceed DNS lookup limit.
[ ] DKIM enabled for sending domain.
[ ] DKIM selector documented.
[ ] DKIM key rotation process exists.
[ ] DMARC record exists.
[ ] DMARC aggregate report address monitored.
[ ] DMARC alignment verified.
[ ] Subdomains have policy strategy.
```

### 21.2 Application checklist

```text
[ ] Header From uses verified domain only.
[ ] Envelope sender configured intentionally.
[ ] Reply-To controlled and valid.
[ ] Message-ID/correlation strategy exists.
[ ] Text alternative exists for HTML mail.
[ ] Attachments scanned/controlled.
[ ] Suppression list checked before send.
[ ] Hard bounce creates suppression.
[ ] Complaint creates suppression/review.
[ ] Duplicate send guarded by idempotency key.
[ ] Retry policy bounded.
[ ] Provider accepted is not treated as delivered.
```

### 21.3 Observability checklist

```text
[ ] send_attempt_total
[ ] accepted_by_provider_total
[ ] rejected_by_provider_total
[ ] delivered_total
[ ] hard_bounce_total
[ ] soft_bounce_total
[ ] complaint_total
[ ] suppressed_total
[ ] queue_age_seconds
[ ] delivery_event_lag_seconds
[ ] domain-level bounce rate
[ ] template-level complaint rate
```

### 21.4 Operational checklist

```text
[ ] provider dashboard access assigned
[ ] DNS owner identified
[ ] incident runbook exists
[ ] suppression override process exists
[ ] sending domain warm-up plan exists if needed
[ ] unsubscribe/preference policy exists for bulk
[ ] postmaster/support mailbox monitored
[ ] bounce/webhook credentials rotated
```

---

## 22. Common Production Incidents and Root Causes

### Incident 1 — “Email sent but user says not received”

Possible causes:

```text
- provider accepted but recipient bounced later
- delivered to spam
- quarantine by enterprise gateway
- wrong recipient address
- BCC/CC mistake
- DMARC fail
- DKIM fail due to gateway mutation
- link/content classified suspicious
- recipient mailbox rule moved it
- provider suppressed recipient
```

Diagnostic flow:

```text
1. Find notification ID.
2. Find provider message ID.
3. Check application accepted state.
4. Check provider event timeline.
5. Check bounce/complaint/suppression.
6. Check recipient domain result.
7. Check authentication results if available.
8. Ask recipient to check spam/quarantine only after evidence.
```

### Incident 2 — sudden spike in bounces

Possible causes:

```text
- bad import list
- domain typo in bulk recipient data
- stale user database
- provider blocked domain
- DNS issue
- recipient domain outage
- template/content rejection
```

Immediate action:

```text
- pause campaign/batch if bulk
- isolate affected domain/template
- prevent retry storm
- classify hard vs soft
- update suppression where appropriate
```

### Incident 3 — DMARC failure after sender change

Possible causes:

```text
- From domain changed without DKIM setup
- provider not authorized in SPF
- envelope sender still provider domain
- strict alignment misconfigured
- subdomain policy inherited unexpectedly
```

Fix:

```text
- verify domain
- configure DKIM
- configure custom return-path/bounce domain
- test authentication-result header
- gradually rollout
```

### Incident 4 — password reset going to spam after newsletter blast

Root cause:

```text
Transactional and marketing streams share reputation.
```

Fix:

```text
- isolate domain/provider stream
- suppress complainers
- reduce bulk volume
- warm up separate sending identity
- enforce channel policy
```

---

## 23. Testing Deliverability Configuration

### 23.1 What can be tested locally?

Locally:

- MIME validity,
- header correctness,
- envelope sender property usage,
- text/html alternative,
- attachment safety,
- no header injection,
- suppression logic,
- webhook idempotency,
- event state transitions.

### 23.2 What cannot be fully tested locally?

Not fully:

- inbox placement,
- domain reputation,
- provider-specific spam filtering,
- recipient enterprise gateway policy,
- real DMARC enforcement behavior across providers.

### 23.3 Staging domain

Use staging domain/subdomain:

```text
staging-mail.example.com
```

But do not assume staging reputation equals production.

### 23.4 Authentication result inspection

When testing real delivery, inspect received message headers:

```text
Authentication-Results:
  spf=pass
  dkim=pass
  dmarc=pass
```

But header format differs by provider.

### 23.5 Test matrix

```text
[ ] Gmail personal mailbox
[ ] Microsoft/Outlook mailbox
[ ] enterprise mailbox with gateway
[ ] invalid recipient
[ ] mailbox full simulation if possible
[ ] hard bounce domain
[ ] soft bounce provider simulation
[ ] attachment email
[ ] HTML + text alternative
[ ] different sender domains
```

---

## 24. Regulatory and Audit Interpretation

For regulated systems, be precise about evidence.

### 24.1 Evidence levels

| Evidence | Meaning | Strength |
|---|---|---|
| Notification requested | business event created notification | low |
| Queued | app planned to send | low |
| SMTP accepted | relay accepted message | medium |
| Provider delivered | provider reports recipient accepted | higher |
| Read/open event | weak evidence, often unreliable | low/medium |
| User acknowledged in portal | strong if authenticated | high |

### 24.2 Do not overclaim

Bad audit statement:

```text
Email was delivered to user's inbox.
```

Unless you actually have such evidence.

Better:

```text
Email was accepted by configured SMTP provider at 2026-06-18T10:15:30Z with provider message ID X. No bounce event was received as of Y.
```

Or:

```text
Provider reported delivered to recipient domain at timestamp X.
```

### 24.3 For critical notices

For critical/regulatory notices, email alone may not be sufficient.

Consider:

- in-app notification,
- portal inbox,
- SMS fallback,
- registered mail/legal delivery,
- user acknowledgement,
- escalation workflow.

Email is useful but not always reliable proof of actual user awareness.

---

## 25. Top 1% Mental Model

A top-tier engineer does not think:

```text
Email = SMTP send call.
```

They think:

```text
Email = externally mediated asynchronous delivery pipeline with identity, policy, reputation, feedback, compliance, and uncertain final state.
```

They design around these truths:

1. **SMTP accepted is not inbox.**
2. **Delivery is observable only through imperfect signals.**
3. **Authentication is domain-level, not just credential-level.**
4. **SPF/DKIM/DMARC alignment matters more than passing individually.**
5. **Reputation is accumulated and can be destroyed by poor application behavior.**
6. **Hard bounces and complaints must feed suppression.**
7. **Retries must be bounded and reputation-aware.**
8. **Transactional and bulk streams should be isolated.**
9. **Sender identity must be verified configuration, not user input.**
10. **Audit language must match evidence level.**

---

## 26. Practical Architecture Summary

A mature Java mail system should look like this:

```text
Business Event
  -> Notification Policy
  -> Recipient Preference / Suppression Check
  -> Verified Sender Identity Resolution
  -> Template Render
  -> MIME Build
  -> Outbox Persist
  -> Worker Dispatch
  -> SMTP/API Provider
  -> Provider Accepted Event
  -> Webhook/Bounce Processor
  -> Delivery State Update
  -> Suppression/Reputation Metrics
  -> Audit/Reporting
```

Key tables/services:

```text
notification_request
notification_recipient
mail_outbox
mail_attempt
mail_delivery_event
sender_identity
suppression_entry
template_version
provider_message_mapping
```

Key invariants:

```text
- No arbitrary From domain.
- No send without suppression check.
- No unbounded retry.
- No treating provider accepted as delivered.
- No hard-bounced recipient reuse without override.
- No bulk mail on critical transactional identity.
- No raw PII in provider/debug logs.
- Every external event idempotently processed.
```

---

## 27. What This Part Does Not Cover Deeply Yet

Part ini memberi foundation deliverability. Detail tertentu akan muncul lagi di part berikutnya:

- Part 15/16: inbound/bounce mailbox parsing.
- Part 20: observability metrics/dashboard.
- Part 22: provider integration SMTP vs API.
- Part 23: bounce, complaint, webhook feedback loop secara lebih dalam.
- Part 25: compliance/privacy.
- Part 27: production incident playbook.
- Part 29: architecture review.

---

## 28. Summary

Deliverability adalah layer yang berada di luar sekadar Jakarta Mail API.

Jakarta Mail membantu kita membentuk dan menyerahkan message. Tetapi apakah message dipercaya, diterima, diproses, ditempatkan di inbox, atau dibuang oleh recipient ecosystem bergantung pada banyak faktor:

- SPF,
- DKIM,
- DMARC,
- sender identity,
- domain/IP reputation,
- content quality,
- recipient behavior,
- bounce/complaint handling,
- suppression,
- provider policy,
- operational discipline.

Untuk Java engineer, bagian paling penting bukan menghafal DNS syntax, tetapi memahami dampak architectural decision terhadap deliverability:

```text
From domain, envelope sender, provider, template, retry, suppression, and telemetry are all part of the mail system design.
```

Email system yang matang tidak berhenti di `Transport.send()`.

Ia memodelkan lifecycle lengkap:

```text
requested -> queued -> accepted -> delivered/bounced/complained/suppressed
```

dan tidak pernah mengklaim lebih dari bukti yang tersedia.

---

## 29. Practical Exercise

Desain mini mail delivery model untuk sistem enterprise.

### Requirement

Sistem harus mengirim:

1. password reset,
2. invoice,
3. survey bulanan,
4. case status update,
5. security alert.

### Tugas

Tentukan:

1. sender domain/subdomain untuk masing-masing kategori,
2. mana transactional dan mana bulk,
3. suppression rule,
4. retry policy,
5. evidence/audit statement,
6. delivery state machine,
7. DMARC/SPF/DKIM responsibility,
8. webhook event yang wajib diproses,
9. incident metric paling penting.

### Expected thinking

Jawaban matang biasanya memisahkan minimal:

```text
security.example.com       -> security alert/password reset
billing.example.com        -> invoice
notify.example.com         -> case status update
survey.example.com         -> survey bulk
```

Dan tidak mencampur survey bulk dengan password reset.

---

## 30. Checklist for Mastery

Kamu dianggap menguasai part ini jika bisa menjelaskan tanpa melihat catatan:

```text
[ ] Perbedaan SMTP accepted, delivered, inbox placement.
[ ] SPF mengecek apa dan kenapa forwarding bisa membuat SPF fail.
[ ] DKIM mengecek apa dan kenapa MIME mutation bisa merusak signature.
[ ] DMARC alignment dan hubungannya dengan Header From.
[ ] Kenapa From domain tidak boleh user-controlled sembarangan.
[ ] Kenapa transactional dan bulk harus dipisah.
[ ] Kenapa hard bounce harus masuk suppression.
[ ] Kenapa complaint lebih berbahaya daripada bounce.
[ ] Kenapa provider accepted tidak boleh disebut delivered.
[ ] Bagaimana webhook event diproses idempotently.
[ ] Bagaimana membuat audit statement yang defensible.
```

Jika semua poin ini bisa dijawab, kamu sudah jauh di atas engineer yang hanya tahu `Transport.send()`.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./13-security-tls-oauth-secret-header-injection.md">⬅️ Part 13 — Security Deep Dive: TLS, Credential, OAuth2, Secret Management</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./15-inbound-mail-imap-pop3-store-folder.md">Part 15 — Inbound Mail: IMAP/POP3, Store, Folder, Message Reading ➡️</a>
</div>
