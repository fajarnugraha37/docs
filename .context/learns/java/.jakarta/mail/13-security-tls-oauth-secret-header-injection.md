# Part 13 — Security Deep Dive: TLS, Credential, OAuth2, Secret Management

> Seri: `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery`  
> File: `13-security-tls-oauth-secret-header-injection.md`  
> Scope: Java 8 sampai Java 25, JavaMail `javax.mail`, Jakarta Mail `jakarta.mail`, SMTP security, credential, OAuth2, TLS, header injection, attachment risk, multi-tenant sender governance.

---

## 0. Tujuan Pembelajaran

Pada bagian sebelumnya kita sudah membahas bulk, batch, throttling, rate limit, worker sizing, dan backpressure. Itu semua menjawab pertanyaan: **bagaimana mengirim email dalam volume tertentu tanpa menghancurkan sistem sendiri atau provider**.

Bagian ini menjawab pertanyaan yang lebih keras:

> Bagaimana memastikan mail subsystem tidak menjadi jalur kebocoran credential, kebocoran PII, impersonation, phishing, downgrade TLS, abuse multi-tenant, atau source of regulatory incident?

Setelah part ini, targetnya kamu bisa:

1. Memahami security boundary email secara realistis.
2. Membedakan transport security, authentication security, content security, dan operational security.
3. Mengonfigurasi SMTP TLS dengan benar.
4. Memahami STARTTLS vs implicit TLS.
5. Mengerti kenapa `starttls.enable=true` belum tentu cukup.
6. Mengerti risiko `ssl.trust=*` dan custom trust yang asal-asalan.
7. Menggunakan SMTP password, app password, atau OAuth2 secara tepat.
8. Mendesain secret management dan credential rotation untuk Java 8–25.
9. Mencegah header injection.
10. Mengurangi risiko attachment abuse.
11. Menyusun policy multi-tenant sender agar aplikasi tidak bisa dipakai untuk spoofing.
12. Membuat checklist production security untuk mail subsystem.

---

## 1. Mental Model: Email Security Bukan Satu Layer

Kesalahan umum: menganggap email aman hanya karena SMTP memakai TLS.

Itu salah.

Email security terdiri dari banyak layer:

```text
+---------------------------------------------------------------+
| Business / Domain Security                                    |
| - siapa boleh mengirim apa                                    |
| - template apa yang boleh dipakai                             |
| - recipient mana yang legal                                   |
| - consent/preference                                          |
+---------------------------------------------------------------+
| Application Security                                          |
| - header injection defense                                    |
| - input validation                                            |
| - template escaping                                           |
| - attachment validation                                       |
| - log redaction                                               |
+---------------------------------------------------------------+
| Credential Security                                           |
| - SMTP password / app password / OAuth2 token                 |
| - secret storage                                              |
| - rotation                                                    |
| - least privilege                                             |
+---------------------------------------------------------------+
| Transport Security                                            |
| - TLS / STARTTLS / implicit TLS                               |
| - certificate validation                                      |
| - hostname validation                                         |
| - downgrade protection                                        |
+---------------------------------------------------------------+
| Mail Ecosystem Security                                       |
| - SPF / DKIM / DMARC                                          |
| - bounce handling                                             |
| - suppression list                                            |
| - phishing reputation                                         |
+---------------------------------------------------------------+
```

Jakarta Mail hanya membantu sebagian dari layer di tengah: koneksi, protokol, message construction, authentication mechanism. Ia tidak otomatis membuat sistem secure secara keseluruhan.

Top engineer melihat email bukan sebagai utility function, tetapi sebagai **externally visible trust boundary**.

---

## 2. Threat Model Mail Subsystem

Sebelum konfigurasi TLS/OAuth2, kita perlu tahu ancamannya.

### 2.1 Asset yang perlu dilindungi

Dalam mail subsystem, asset utama biasanya:

1. SMTP credential.
2. OAuth2 access token / refresh token.
3. Recipient email address.
4. Email body yang mungkin berisi PII.
5. Attachment.
6. Template variable.
7. Sender identity.
8. Audit record.
9. Provider quota/reputation.
10. Application availability.

### 2.2 Attacker model

Ancaman bisa datang dari:

1. External attacker yang mencoba mengeksploitasi input.
2. Compromised user account yang bisa trigger email.
3. Internal user yang punya role terlalu luas.
4. Developer/operator yang tidak sengaja melihat secret/log.
5. Misconfigured environment.
6. Malicious tenant dalam sistem multi-tenant.
7. Man-in-the-middle antara app dan SMTP relay.
8. Compromised SMTP credential.
9. Abuse melalui attachment/template/link.

### 2.3 Attack surface

```text
User Input
   |
   v
Template Renderer -----> HTML escaping risk
   |
   v
Message Builder -------> header injection risk
   |
   v
Attachment Resolver ---> malware / file traversal / oversized payload
   |
   v
SMTP Client -----------> TLS/auth/timeout risk
   |
   v
SMTP Relay -----------> credential abuse / quota / reputation
   |
   v
Recipient ------------> phishing / privacy / compliance risk
```

### 2.4 Top 1% framing

Pertanyaan yang harus selalu ditanyakan:

1. Siapa yang bisa menyebabkan email dikirim?
2. Siapa yang bisa menentukan recipient?
3. Siapa yang bisa menentukan sender?
4. Siapa yang bisa mengubah subject/body?
5. Apakah user input masuk ke header?
6. Apakah user input masuk ke HTML?
7. Apakah attachment berasal dari storage tepercaya?
8. Apakah credential bisa bocor lewat log?
9. Apakah debug SMTP aktif di production?
10. Apakah retry bisa memperbanyak email berbahaya?
11. Apakah sistem bisa digunakan untuk spam/phishing?
12. Apakah audit cukup untuk investigasi?

---

## 3. Transport Security: SMTP, STARTTLS, Implicit TLS

SMTP awalnya tidak dirancang sebagai protokol secure modern. TLS ditambahkan kemudian melalui dua pola umum:

1. **STARTTLS**: koneksi awal plain TCP, lalu upgrade ke TLS.
2. **Implicit TLS**: koneksi TLS sejak awal.

### 3.1 Port umum

```text
Port 25   -> SMTP relay / server-to-server SMTP, sering diblokir untuk client app
Port 465  -> SMTPS / implicit TLS
Port 587  -> message submission, biasanya STARTTLS
```

Aplikasi enterprise umumnya memakai 587 dengan STARTTLS atau 465 dengan implicit TLS, tergantung provider.

### 3.2 STARTTLS flow

```text
Client                         Server
  |                              |
  | TCP connect                  |
  |----------------------------->|
  | 220 greeting                 |
  |<-----------------------------|
  | EHLO app.example             |
  |----------------------------->|
  | 250-STARTTLS                 |
  |<-----------------------------|
  | STARTTLS                     |
  |----------------------------->|
  | 220 Ready to start TLS       |
  |<-----------------------------|
  | TLS handshake                |
  |<============================>|
  | EHLO again                   |
  |----------------------------->|
  | AUTH                         |
  |----------------------------->|
```

STARTTLS penting, tapi punya satu risiko besar: **downgrade**.

Jika aplikasi hanya berkata “gunakan STARTTLS kalau tersedia”, maka attacker atau middlebox yang menghapus capability `STARTTLS` bisa membuat client lanjut tanpa TLS, kecuali konfigurasi mewajibkan TLS.

### 3.3 Konfigurasi Jakarta Mail untuk STARTTLS

Untuk Jakarta Mail / JavaMail SMTP provider:

```properties
mail.smtp.host=smtp.example.com
mail.smtp.port=587
mail.smtp.auth=true
mail.smtp.starttls.enable=true
mail.smtp.starttls.required=true
mail.smtp.connectiontimeout=5000
mail.smtp.timeout=10000
mail.smtp.writetimeout=10000
```

Makna penting:

```text
mail.smtp.starttls.enable=true
```

Artinya client akan mencoba memakai STARTTLS jika server mendukung.

```text
mail.smtp.starttls.required=true
```

Artinya pengiriman gagal jika STARTTLS tidak bisa dinegosiasikan.

Untuk production, `starttls.required=true` biasanya lebih defensible daripada hanya `starttls.enable=true`.

### 3.4 Konfigurasi implicit TLS

Untuk port 465:

```properties
mail.smtp.host=smtp.example.com
mail.smtp.port=465
mail.smtp.auth=true
mail.smtp.ssl.enable=true
mail.smtp.connectiontimeout=5000
mail.smtp.timeout=10000
mail.smtp.writetimeout=10000
```

Jangan mencampur mental model:

```text
Port 587 + STARTTLS       -> mail.smtp.starttls.enable=true
Port 465 + implicit TLS   -> mail.smtp.ssl.enable=true
```

Keduanya sama-sama memakai TLS, tetapi negotiation-nya berbeda.

---

## 4. TLS Validation: Certificate, Hostname, Truststore

TLS bukan hanya encryption. TLS juga authentication terhadap server.

Artinya client harus memverifikasi:

1. Certificate chain valid.
2. Certificate belum expired.
3. Certificate dipercaya oleh truststore.
4. Hostname cocok dengan certificate.

Jika salah satu dimatikan, TLS bisa berubah menjadi “encrypted to attacker”.

### 4.1 Anti-pattern: trust all

Contoh buruk:

```properties
mail.smtp.ssl.trust=*
```

Atau custom `SSLSocketFactory` yang menerima semua certificate.

Ini sering muncul di DEV/UAT karena SMTP relay memakai self-signed certificate. Masalahnya, konfigurasi seperti ini sering terbawa ke production.

Risikonya:

1. MITM lebih mudah.
2. Credential SMTP bisa dicuri.
3. Email content bisa disadap.
4. Audit security menjadi lemah.
5. Compliance finding.

### 4.2 Kapan `mail.smtp.ssl.trust` dipakai?

Ada properti provider yang bisa dipakai untuk mempercayai host tertentu:

```properties
mail.smtp.ssl.trust=smtp.example.com
```

Ini lebih baik daripada `*`, tetapi tetap harus dipahami sebagai exception, bukan default.

Lebih baik gunakan certificate valid yang dipercaya JVM truststore, atau masukkan CA internal ke truststore dengan proses resmi.

### 4.3 Truststore explicit

Dalam enterprise environment, kadang SMTP relay memakai private CA.

Pilihan yang lebih benar:

```bash
-Djavax.net.ssl.trustStore=/etc/app/truststore/mail-truststore.p12
-Djavax.net.ssl.trustStorePassword=${TRUSTSTORE_PASSWORD}
-Djavax.net.ssl.trustStoreType=PKCS12
```

Namun jangan hardcode password di command line jika environment memungkinkan orang lain melihat process args. Gunakan secret injection yang sesuai platform.

### 4.4 Hostname verification

Jangan hanya percaya chain. Hostname juga harus cocok.

Misalnya aplikasi connect ke:

```text
smtp.prod.company.gov
```

Certificate harus valid untuk hostname tersebut, bukan hanya certificate valid untuk host lain.

### 4.5 Java version consideration

Pada Java modern, TLS default dan disabled algorithm terus berubah. Java 8 lama mungkin masih punya konfigurasi TLS yang lebih permissive atau CA bundle lebih tua. Java 17/21/25 biasanya lebih strict terhadap algoritma lama.

Implikasi migration:

1. SMTP yang dulu bisa di Java 8 mungkin gagal di Java 21 karena TLS/cipher/cert chain lama.
2. Jangan “memperbaiki” dengan disable validation.
3. Perbaiki certificate/cipher/provider config.
4. Catat dependency antara JVM version dan SMTP relay capability.

---

## 5. SMTP Authentication: Password, App Password, OAuth2

SMTP authentication membuktikan bahwa aplikasi berhak menggunakan relay/account tertentu.

Ada beberapa model:

1. Basic username/password.
2. App password.
3. OAuth2 access token.
4. Provider-specific API key sebagai password.
5. Network/IP allowlist tanpa auth, biasanya untuk internal relay.

### 5.1 Username/password

Contoh:

```java
Properties props = new Properties();
props.put("mail.smtp.host", "smtp.example.com");
props.put("mail.smtp.port", "587");
props.put("mail.smtp.auth", "true");
props.put("mail.smtp.starttls.enable", "true");
props.put("mail.smtp.starttls.required", "true");

Session session = Session.getInstance(props);
Transport transport = session.getTransport("smtp");
transport.connect("smtp.example.com", "app-user", smtpPassword);
```

Untuk service app, lebih baik explicit `transport.connect(host, username, password)` daripada menyebarkan credential di banyak tempat.

### 5.2 App password

Banyak provider tidak lagi menerima password utama account, tetapi memakai app password.

Kelebihan:

1. Bisa dicabut tanpa mengganti password utama.
2. Scope lebih terbatas dibanding account credential utama.
3. Lebih cocok untuk aplikasi legacy.

Kekurangan:

1. Tetap secret statis.
2. Harus dirotasi.
3. Jika bocor, bisa dipakai sampai dicabut.
4. Kurang granular dibanding OAuth2.

### 5.3 API key sebagai SMTP password

Beberapa provider memakai username khusus dan API key sebagai SMTP password.

Contoh pola umum:

```text
username = "apikey"
password = "SG.xxxxx" atau provider-specific token
```

Secara security, perlakukan API key sama seperti password.

### 5.4 OAuth2 / XOAUTH2

OAuth2 untuk email biasanya memakai access token sebagai credential untuk mechanism `XOAUTH2`.

Mental model:

```text
Application -> Identity Provider -> access token
Application -> SMTP AUTH XOAUTH2 -> SMTP server
```

Token biasanya short-lived. Aplikasi harus punya mekanisme refresh.

Contoh property:

```properties
mail.smtp.auth=true
mail.smtp.auth.mechanisms=XOAUTH2
mail.smtp.starttls.enable=true
mail.smtp.starttls.required=true
```

Lalu token dipakai sebagai password:

```java
transport.connect("smtp.example.com", userEmail, oauth2AccessToken);
```

### 5.5 OAuth2 bukan otomatis lebih sederhana

OAuth2 lebih kuat secara security jika dikelola benar, tetapi lebih kompleks:

1. Perlu token acquisition.
2. Perlu refresh token/client credential flow tergantung provider.
3. Perlu scope yang benar.
4. Perlu clock skew handling.
5. Perlu caching token.
6. Perlu retry jika token expired.
7. Perlu observability untuk auth failure.
8. Perlu consent/admin approval di beberapa provider.

### 5.6 Failure mode OAuth2

Common failure:

```text
535 5.7.3 Authentication unsuccessful
535 5.7.8 Username and Password not accepted
534 Authentication mechanism too weak
invalid_grant
invalid_scope
token expired
tenant policy blocks SMTP AUTH
SMTP AUTH disabled at mailbox/tenant level
```

Engineer matang tidak langsung menyalahkan Jakarta Mail. Ia cek:

1. Apakah SMTP AUTH enabled di provider?
2. Apakah user/account memang boleh SMTP AUTH?
3. Apakah token scope benar?
4. Apakah token audience benar?
5. Apakah tenant policy mengizinkan basic/OAuth SMTP?
6. Apakah mechanism `XOAUTH2` dipaksa?
7. Apakah TLS required?
8. Apakah server menerima OAuth2 untuk SMTP atau hanya Graph/API?

---

## 6. Secret Management

SMTP credential sering terlihat “kecil”, padahal dampaknya besar.

Jika SMTP credential bocor, attacker bisa:

1. Mengirim phishing dari domain resmi.
2. Menghabiskan quota.
3. Merusak reputasi domain/IP.
4. Memicu spam complaint.
5. Mengirim email yang terlihat legitimate ke user internal/external.
6. Membuat incident compliance.

### 6.1 Anti-pattern secret

Jangan:

```java
private static final String SMTP_PASSWORD = "P@ssw0rd";
```

Jangan:

```properties
mail.smtp.password=P@ssw0rd
```

di file yang masuk Git.

Jangan:

```yaml
env:
  SMTP_PASSWORD: hardcoded-secret
```

Jangan log:

```text
Connecting smtp.example.com with user app-smtp password P@ssw0rd
```

### 6.2 Secret source yang umum

Pilihan yang lebih baik:

1. Environment variable dari secret manager.
2. Kubernetes Secret, dengan encryption at rest dan RBAC benar.
3. AWS Secrets Manager.
4. AWS SSM Parameter Store SecureString.
5. HashiCorp Vault.
6. Azure Key Vault.
7. GCP Secret Manager.
8. Container platform secret injection.

### 6.3 Secret access pattern

Ideal:

```text
Application startup
   -> read secret from approved source
   -> store in memory only
   -> never log raw value
   -> use for SMTP connect
   -> support refresh/reload if rotated
```

Untuk Java service:

```java
public interface SecretProvider {
    String getSecret(String name);
}
```

Lalu mail config tidak tahu detail AWS/Vault/K8s:

```java
public final class SmtpCredentialProvider {
    private final SecretProvider secretProvider;

    public SmtpCredentialProvider(SecretProvider secretProvider) {
        this.secretProvider = secretProvider;
    }

    public SmtpCredential current() {
        return new SmtpCredential(
            secretProvider.getSecret("smtp.username"),
            secretProvider.getSecret("smtp.password")
        );
    }
}
```

### 6.4 Rotation model

Secret harus bisa dirotasi tanpa redeploy besar jika memungkinkan.

Ada beberapa level:

#### Level 0 — Manual restart

```text
Rotate secret -> restart app
```

Sederhana, tapi downtime/coordination lebih besar.

#### Level 1 — Rolling restart

```text
Rotate secret -> rolling restart pods
```

Cukup umum di Kubernetes.

#### Level 2 — Periodic reload

```text
App refresh secret every N minutes
```

Lebih dinamis, tapi perlu hati-hati caching dan race condition.

#### Level 3 — Dual credential window

```text
Old credential and new credential valid temporarily
Worker can retry auth with refreshed credential
```

Paling aman untuk production dengan high availability.

### 6.5 Credential rotation failure mode

Scenario:

```text
T0: credential lama aktif
T1: provider diganti ke credential baru
T2: sebagian app instance masih pakai credential lama
T3: SMTP auth failure spike
T4: queue email menumpuk
T5: retry storm memperparah provider rate limit
```

Mitigasi:

1. Dual credential overlap.
2. Rolling restart with health check.
3. Alert untuk auth failure spike.
4. Circuit breaker jika auth failure global.
5. Pause queue daripada retry aggressive.
6. Runbook rollback.

---

## 7. Log Redaction dan Debug SMTP

Jakarta Mail punya debug mode:

```java
session.setDebug(true);
```

Ini berguna di local/dev, tetapi berbahaya di production.

### 7.1 Risiko debug SMTP

Debug dapat mengandung:

1. Host/port internal.
2. SMTP response.
3. AUTH negotiation detail.
4. Recipient address.
5. Header.
6. Subject.
7. Bahkan potensi credential/token tergantung flow/mechanism/logging.

### 7.2 Rule production

Default:

```text
session.setDebug(false)
```

Jika perlu debug production:

1. Aktifkan sementara.
2. Scope ke satu correlation ID / environment terbatas jika bisa.
3. Redact recipient.
4. Redact token/password.
5. Jangan dump body/attachment.
6. Pastikan log retention pendek.
7. Dokumentasikan approval.

### 7.3 Structured logging yang aman

Log yang aman:

```json
{
  "event": "MAIL_SEND_FAILED",
  "notificationId": "ntf_123",
  "tenantId": "agency-a",
  "templateCode": "CASE_SUBMITTED",
  "smtpHost": "smtp-relay.internal",
  "smtpPort": 587,
  "failureCategory": "AUTH_FAILED",
  "smtpCode": 535,
  "attempt": 3,
  "correlationId": "c-abc"
}
```

Log yang tidak aman:

```json
{
  "to": "john.doe@example.com",
  "body": "Dear John, your NRIC is...",
  "password": "secret",
  "accessToken": "eyJ..."
}
```

### 7.4 Recipient redaction

Pilihan:

```text
john.doe@example.com -> j***@example.com
```

Atau hash stabil:

```text
sha256(lowercase(email) + pepper)
```

Hash stabil berguna untuk agregasi tanpa expose email raw.

---

## 8. Header Injection

Header injection adalah salah satu risiko paling praktis dalam email generation.

Masalah muncul jika user input dimasukkan ke header tanpa validasi.

Contoh buruk:

```java
message.setSubject(userProvidedSubject);
message.setHeader("Reply-To", userProvidedReplyTo);
```

Jika input mengandung CRLF:

```text
Hello
Bcc: attacker@example.com
```

Maka attacker mencoba menyisipkan header baru.

### 8.1 Header vs body

Header email dipisahkan oleh line. Karena itu CRLF punya makna struktural.

```text
Subject: Hello
From: app@example.com
To: user@example.com

Body starts here
```

Jika attacker bisa menyisipkan newline di header, ia bisa mencoba membuat header tambahan.

### 8.2 Field berisiko tinggi

1. Subject.
2. From display name.
3. Reply-To.
4. To/Cc/Bcc jika berasal dari input bebas.
5. Custom headers.
6. Attachment filename.
7. Content-ID.

### 8.3 Rule defensif

Untuk header value dari input:

1. Tolak `\r` dan `\n`.
2. Batasi panjang.
3. Gunakan API typed seperti `InternetAddress`, bukan string concatenation.
4. Validasi address.
5. Jangan izinkan arbitrary custom header dari user.
6. Encode melalui API resmi.

Contoh sanitizer sederhana:

```java
public final class MailHeaderSafety {
    private MailHeaderSafety() {}

    public static String requireSingleLine(String value, String fieldName) {
        if (value == null) {
            throw new IllegalArgumentException(fieldName + " must not be null");
        }
        if (value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0) {
            throw new IllegalArgumentException(fieldName + " must not contain CR/LF");
        }
        return value;
    }
}
```

Pemakaian:

```java
String safeSubject = MailHeaderSafety.requireSingleLine(subject, "subject");
message.setSubject(safeSubject, StandardCharsets.UTF_8.name());
```

### 8.4 InternetAddress validation

```java
InternetAddress address = new InternetAddress(email, displayName, StandardCharsets.UTF_8.name());
address.validate();
```

Tetap validasi newline untuk display name jika berasal dari input.

### 8.5 Jangan build header manual

Buruk:

```java
message.addHeader("To", userName + " <" + email + ">");
```

Lebih baik:

```java
message.setRecipient(Message.RecipientType.TO, new InternetAddress(email, displayName, "UTF-8"));
```

---

## 9. Template Injection dan HTML Safety

Email body bukan header, jadi CRLF tidak punya efek header yang sama setelah body dimulai. Tetapi body punya risiko lain:

1. Phishing link injection.
2. HTML injection.
3. Broken layout.
4. PII leak.
5. Tracking abuse.
6. Malicious URL.

### 9.1 Escaping

Jika template engine memproses HTML:

```html
<p>Hello, [[${name}]]</p>
```

Pastikan default escaping aktif.

Jangan gunakan unescaped insertion untuk user content:

```html
<p th:utext="${userComment}"></p>
```

kecuali sudah disanitasi dengan benar.

### 9.2 URL validation

Jika email berisi link yang berasal dari input atau data bisnis:

1. Allowlist domain.
2. Gunakan HTTPS.
3. Hindari open redirect.
4. Jangan masukkan raw URL dari user.
5. Gunakan signed link dengan expiry untuk sensitive action.

### 9.3 Template variable classification

Buat klasifikasi variable:

```text
SAFE_TEXT        -> escaped text
SAFE_URL         -> generated by system, allowlisted
SAFE_HTML        -> only from trusted template fragment
SENSITIVE_TEXT   -> must not be logged
ATTACHMENT_REF   -> must resolve from trusted storage
```

Jangan perlakukan semua variable sebagai string biasa.

---

## 10. Attachment Security

Attachment sering menjadi jalur paling berisiko.

Risiko:

1. Malware distribution.
2. Sensitive data leak.
3. Wrong recipient receives attachment.
4. Oversized attachment causes memory issue.
5. Filename injection.
6. Content-Type spoofing.
7. Zip bomb.
8. Path traversal jika attachment dari user upload.

### 10.1 Attachment source

Attachment harus punya trust model.

```text
Generated by system       -> lower risk, still validate size/type
Uploaded by user          -> high risk, scan/quarantine
Fetched from external URL -> very high risk, avoid or isolate
```

### 10.2 Never attach arbitrary local path

Buruk:

```java
bodyPart.attachFile(userProvidedPath);
```

Risiko:

```text
../../etc/passwd
C:\secrets\prod.key
```

Lebih baik gunakan attachment reference:

```java
public record AttachmentRef(
    String storageBucket,
    String objectKey,
    String fileName,
    String expectedContentType,
    long expectedSize
) {}
```

Aplikasi hanya boleh mengambil file dari storage/path yang dikontrol.

### 10.3 Filename safety

Filename masuk ke MIME header, jadi perlakukan sebagai header-adjacent value.

Rule:

1. Tidak boleh mengandung CR/LF.
2. Tidak boleh path separator.
3. Batasi panjang.
4. Normalize unicode jika perlu.
5. Gunakan filename display, bukan path asli.

Contoh:

```java
public static String safeAttachmentFileName(String fileName) {
    if (fileName == null || fileName.isBlank()) {
        throw new IllegalArgumentException("filename is required");
    }
    if (fileName.indexOf('\r') >= 0 || fileName.indexOf('\n') >= 0) {
        throw new IllegalArgumentException("filename must not contain CR/LF");
    }
    if (fileName.contains("/") || fileName.contains("\\")) {
        throw new IllegalArgumentException("filename must not contain path separators");
    }
    if (fileName.length() > 180) {
        throw new IllegalArgumentException("filename is too long");
    }
    return fileName;
}
```

### 10.4 Content-Type is not security

`Content-Type: application/pdf` tidak membuktikan isi file benar PDF.

Validasi minimal:

1. Extension.
2. MIME detection.
3. Magic number/signature.
4. Size.
5. Antivirus scan untuk user-uploaded content.
6. Business rule: jenis file apa yang boleh dikirim.

### 10.5 Secure link vs attachment

Untuk dokumen sensitif, sering lebih aman mengirim link:

```text
Email: "Dokumen Anda tersedia di portal. Silakan login."
```

Dibanding attach PDF berisi data sensitif.

Kelebihan secure link:

1. Access control tetap berlaku.
2. Bisa expire.
3. Bisa revoke.
4. Bisa audit download.
5. Mengurangi data leak ke mailbox yang salah.

Kekurangan:

1. User perlu login.
2. UX lebih panjang.
3. Portal harus reliable.

---

## 11. Sender Identity Governance

Jika sistem multi-tenant atau multi-agency, sender identity harus dikontrol ketat.

Jangan biarkan tenant bebas menentukan:

```text
From: ceo@other-agency.gov
```

atau:

```text
From: security@bank.com
```

### 11.1 Sender allowlist

Model:

```text
Tenant A -> allowed sender domains: agency-a.gov.example
Tenant B -> allowed sender domains: agency-b.gov.example
System   -> no-reply@platform.example
```

### 11.2 Sender policy object

```java
public final class SenderPolicy {
    private final Map<String, Set<String>> allowedDomainsByTenant;

    public void assertAllowed(String tenantId, InternetAddress from) {
        String domain = domainOf(from.getAddress());
        Set<String> allowed = allowedDomainsByTenant.getOrDefault(tenantId, Set.of());
        if (!allowed.contains(domain.toLowerCase(Locale.ROOT))) {
            throw new SecurityException("Sender domain is not allowed for tenant");
        }
    }

    private String domainOf(String address) {
        int at = address.lastIndexOf('@');
        if (at < 0 || at == address.length() - 1) {
            throw new IllegalArgumentException("Invalid email address");
        }
        return address.substring(at + 1);
    }
}
```

### 11.3 Reply-To policy

Kadang `From` harus fixed, tetapi `Reply-To` boleh tenant-specific.

Contoh:

```text
From: no-reply@platform.example
Reply-To: support@agency-a.gov.example
```

Tetap validasi `Reply-To` dengan allowlist.

### 11.4 Display name policy

Display name juga bisa disalahgunakan:

```text
From: "Bank Security" <no-reply@platform.example>
```

Untuk platform multi-tenant, display name harus dikontrol:

```text
Allowed:
- "Agency A Notification"
- "Agency B Service Portal"

Not allowed:
- arbitrary user input
- brand impersonation
- misleading urgency text
```

---

## 12. Authorization: Siapa Boleh Mengirim Apa?

Mail subsystem seharusnya tidak menerima perintah mentah:

```json
{
  "to": "anyone@example.com",
  "subject": "anything",
  "html": "anything",
  "from": "anything"
}
```

Itu lebih mirip open mail relay internal.

Lebih aman:

```json
{
  "notificationType": "CASE_SUBMITTED",
  "businessObjectId": "CASE-123",
  "recipientRole": "APPLICANT"
}
```

Lalu sistem menentukan:

1. Template.
2. Recipient dari domain data.
3. Sender dari policy.
4. Subject dari template.
5. Attachment dari authorized document.

### 12.1 Bad design: generic send endpoint

```http
POST /mail/send
{
  "from": "...",
  "to": "...",
  "subject": "...",
  "body": "..."
}
```

Ini berisiko menjadi abuse endpoint.

### 12.2 Better design: domain notification endpoint

```http
POST /cases/{caseId}/notifications/submission-confirmation
```

Atau event-driven:

```text
CASE_SUBMITTED event
  -> notification policy
  -> render template
  -> enqueue email
```

### 12.3 Authorization matrix

```text
Notification Type      Triggered By        Recipient Source       Attachment Allowed
CASE_SUBMITTED         system/user action   applicant email        generated receipt only
PAYMENT_RECEIVED       system event         payer email            receipt PDF
PASSWORD_RESET         anonymous flow       verified account email no attachment
ADMIN_BROADCAST        admin role only      selected group         no sensitive attachment
```

---

## 13. Multi-Tenant and Cross-Entity Impact

Dalam sistem enterprise/regulatory, kesalahan email bisa memiliki efek lintas entitas.

Contoh incident:

1. Tenant A mengirim email dengan sender Tenant B.
2. Attachment case A terkirim ke applicant case B.
3. Template lama tenant A dipakai tenant B.
4. Bounce suppression tenant A memblokir recipient tenant B.
5. Provider credential shared membuat audit tidak bisa membedakan tenant.

### 13.1 Isolasi tenant

Minimal isolasi:

```text
tenant_id present in:
- notification request
- outbox row
- template version
- sender policy
- recipient resolution
- attachment resolution
- audit log
- metrics labels with cardinality control
```

### 13.2 Credential per tenant vs shared credential

#### Shared SMTP credential

Kelebihan:

1. Simple.
2. Cost rendah.
3. Operational easier.

Kekurangan:

1. Blast radius besar.
2. Reputation shared.
3. Audit kurang granular.
4. Harder sender/domain isolation.

#### Per-tenant credential

Kelebihan:

1. Blast radius kecil.
2. Sender identity lebih jelas.
3. Rate limit bisa dipisah.
4. Audit lebih kuat.

Kekurangan:

1. Secret management lebih kompleks.
2. Rotation lebih banyak.
3. Provider setup lebih berat.
4. Failover lebih rumit.

### 13.3 Decision rule

Gunakan shared credential jika:

1. Semua email berasal dari domain platform yang sama.
2. Tenant bukan security boundary kuat.
3. Volume kecil/medium.
4. Compliance tidak menuntut sender isolation.

Gunakan per-tenant credential jika:

1. Sender domain berbeda per tenant.
2. Tenant adalah security boundary.
3. Ada compliance/audit requirement.
4. Abuse satu tenant tidak boleh mempengaruhi tenant lain.
5. Volume dan reputation perlu dipisah.

---

## 14. Preventing Mail Relay Abuse

Aplikasi internal bisa tanpa sengaja menjadi open relay versi application-level.

### 14.1 Abuse pattern

Jika ada endpoint:

```http
POST /send-email
```

lalu siapa pun yang punya akses internal bisa mengirim email ke external recipients, maka sistem bisa dipakai untuk spam/phishing.

### 14.2 Controls

1. Authentication wajib.
2. Authorization per notification type.
3. Recipient allowlist untuk environment non-prod.
4. Domain allowlist untuk system tertentu.
5. Rate limit per user/tenant/use-case.
6. Template allowlist.
7. No arbitrary HTML from caller.
8. Audit all requests.
9. Manual approval untuk bulk/broadcast.
10. Kill switch.

### 14.3 Non-production guardrail

DEV/UAT tidak boleh mengirim ke user external tanpa kontrol.

Pola umum:

```text
DEV/UAT mode:
- redirect all outbound email to test mailbox
- prefix subject with [DEV]/[UAT]
- suppress real BCC/CC
- block external domain except allowlist
```

Contoh subject:

```text
[UAT][original-to: user@example.com] Case Submitted Successfully
```

Tapi hati-hati: original recipient di subject bisa PII. Untuk stricter environment, simpan original recipient hanya di secure audit log, bukan subject.

---

## 15. Secure Configuration Baseline

### 15.1 Java 8 legacy JavaMail baseline

```java
Properties props = new Properties();
props.put("mail.smtp.host", smtpHost);
props.put("mail.smtp.port", "587");
props.put("mail.smtp.auth", "true");
props.put("mail.smtp.starttls.enable", "true");
props.put("mail.smtp.starttls.required", "true");
props.put("mail.smtp.connectiontimeout", "5000");
props.put("mail.smtp.timeout", "10000");
props.put("mail.smtp.writetimeout", "10000");
props.put("mail.smtp.ssl.protocols", "TLSv1.2");

Session session = Session.getInstance(props);
session.setDebug(false);

Transport transport = null;
try {
    transport = session.getTransport("smtp");
    transport.connect(smtpHost, username, password);
    transport.sendMessage(message, message.getAllRecipients());
} finally {
    if (transport != null) {
        try {
            transport.close();
        } catch (MessagingException ignored) {
            // log at debug if needed, do not fail business flow here
        }
    }
}
```

### 15.2 Java 17/21/25 Jakarta Mail baseline

```java
Properties props = new Properties();
props.put("mail.smtp.host", smtpHost);
props.put("mail.smtp.port", "587");
props.put("mail.smtp.auth", "true");
props.put("mail.smtp.starttls.enable", "true");
props.put("mail.smtp.starttls.required", "true");
props.put("mail.smtp.connectiontimeout", "5000");
props.put("mail.smtp.timeout", "10000");
props.put("mail.smtp.writetimeout", "10000");

jakarta.mail.Session session = jakarta.mail.Session.getInstance(props);
session.setDebug(false);

try (jakarta.mail.Transport transport = session.getTransport("smtp")) {
    transport.connect(smtpHost, username, password);
    transport.sendMessage(message, message.getAllRecipients());
}
```

Note: `Transport` implements `AutoCloseable` in modern Jakarta Mail implementations/spec API patterns depending on version; if your exact dependency does not support try-with-resources, use explicit finally close.

### 15.3 OAuth2 baseline

```java
Properties props = new Properties();
props.put("mail.smtp.host", smtpHost);
props.put("mail.smtp.port", "587");
props.put("mail.smtp.auth", "true");
props.put("mail.smtp.auth.mechanisms", "XOAUTH2");
props.put("mail.smtp.starttls.enable", "true");
props.put("mail.smtp.starttls.required", "true");
props.put("mail.smtp.connectiontimeout", "5000");
props.put("mail.smtp.timeout", "10000");
props.put("mail.smtp.writetimeout", "10000");

Session session = Session.getInstance(props);
session.setDebug(false);

String accessToken = tokenProvider.getAccessToken();

try (Transport transport = session.getTransport("smtp")) {
    transport.connect(smtpHost, userEmail, accessToken);
    transport.sendMessage(message, message.getAllRecipients());
}
```

Security note:

```text
Access token is a secret. Do not log it. Do not store it in audit records.
```

---

## 16. Secret Rotation-Aware Sender

A secure sender should be able to handle credential rotation.

Example conceptual design:

```java
public final class SecureSmtpMailSender {
    private final SmtpSessionFactory sessionFactory;
    private final SmtpCredentialProvider credentialProvider;
    private final MailFailureClassifier failureClassifier;

    public SendResult send(MimeMessage message) {
        SmtpCredential credential = credentialProvider.current();

        try {
            return sendWithCredential(message, credential);
        } catch (MessagingException ex) {
            FailureCategory category = failureClassifier.classify(ex);

            if (category == FailureCategory.AUTH_FAILED) {
                credentialProvider.invalidateCache();
                SmtpCredential refreshed = credentialProvider.current();
                return sendWithCredential(message, refreshed);
            }

            throw new MailSendRuntimeException(category, ex);
        }
    }

    private SendResult sendWithCredential(MimeMessage message, SmtpCredential credential)
            throws MessagingException {
        Session session = sessionFactory.create();
        try (Transport transport = session.getTransport("smtp")) {
            transport.connect(credential.host(), credential.username(), credential.passwordOrToken());
            transport.sendMessage(message, message.getAllRecipients());
            return SendResult.accepted();
        }
    }
}
```

Namun hati-hati: retry karena auth failed hanya masuk akal jika credential cache bisa refresh. Jangan retry auth failed ribuan kali dengan credential yang sama.

---

## 17. Circuit Breaker untuk Security Failure

Tidak semua failure layak retry.

Auth failure global biasanya bukan transient recipient issue. Itu mungkin:

1. Password rotated.
2. Account disabled.
3. Tenant policy berubah.
4. SMTP AUTH disabled.
5. Token provider rusak.
6. Secret manager salah value.

Jika worker terus retry, sistem hanya membuat noise.

### 17.1 Circuit breaker policy

```text
If AUTH_FAILED count > threshold within 5 minutes:
  - pause sending for provider/tenant
  - mark queue as blocked, not failed permanent
  - alert operator
  - stop aggressive retry
```

### 17.2 Difference between retry and pause

```text
Retry:
  We believe next attempt may succeed automatically.

Pause:
  We believe human/config intervention is needed.
```

Auth failure massal biasanya butuh pause.

---

## 18. Environment Separation

Production and non-production must not share the same mail behavior.

### 18.1 DEV/UAT risks

1. Test data accidentally emails real user.
2. Old production dump contains real email addresses.
3. Developer tests broadcast feature.
4. Load test sends thousands of emails.
5. UAT credential uses production sender domain.

### 18.2 Safe non-prod controls

```text
DEV:
- SMTP disabled by default
- fake SMTP server
- all recipients redirected
- subject prefix [DEV]

UAT:
- allowlist domains/users
- prevent bulk external send
- separate SMTP credential
- visible subject prefix [UAT]

PROD:
- no redirect
- strict sender policy
- real provider
- alerting enabled
```

### 18.3 Recipient rewrite example

```java
public final class NonProdRecipientPolicy {
    private final boolean production;
    private final String sinkMailbox;
    private final Set<String> allowedDomains;

    public List<InternetAddress> resolve(List<InternetAddress> originalRecipients) {
        if (production) {
            return originalRecipients;
        }

        boolean allAllowed = originalRecipients.stream()
                .map(InternetAddress::getAddress)
                .map(this::domainOf)
                .allMatch(allowedDomains::contains);

        if (allAllowed) {
            return originalRecipients;
        }

        return List.of(new InternetAddress(sinkMailbox));
    }
}
```

Still audit original recipient securely, but do not leak it into body/subject unless policy allows.

---

## 19. JavaMail/Jakarta Mail Property Security Reference

Common SMTP security-related properties:

```text
mail.smtp.auth
mail.smtp.auth.mechanisms
mail.smtp.starttls.enable
mail.smtp.starttls.required
mail.smtp.ssl.enable
mail.smtp.ssl.trust
mail.smtp.ssl.protocols
mail.smtp.ssl.ciphersuites
mail.smtp.connectiontimeout
mail.smtp.timeout
mail.smtp.writetimeout
mail.smtp.localhost
mail.smtp.from
```

### 19.1 `mail.smtp.from`

This property can set the envelope sender used in SMTP `MAIL FROM`.

This is security-sensitive because envelope sender affects bounce path and deliverability alignment.

Do not let user input directly control it.

### 19.2 `mail.smtp.localhost`

Used in EHLO/HELO identity.

Usually not security-critical, but in strict enterprise relays it can matter for policy/audit.

### 19.3 `mail.smtp.auth.mechanisms`

You can restrict mechanism:

```properties
mail.smtp.auth.mechanisms=XOAUTH2
```

or:

```properties
mail.smtp.auth.mechanisms=LOGIN PLAIN
```

Avoid weak mechanisms if provider supports stronger ones and your environment requires it.

### 19.4 `mail.smtp.ssl.protocols`

Can restrict TLS versions:

```properties
mail.smtp.ssl.protocols=TLSv1.2 TLSv1.3
```

Java 8 may not support TLSv1.3 depending on update level/provider. Java 11+ generally supports TLSv1.3. Validate against actual runtime and SMTP server.

---

## 20. Secure Mail Gateway Abstraction

A clean design avoids scattering Jakarta Mail security config across codebase.

### 20.1 Domain interface

```java
public interface MailGateway {
    SendResult send(RenderedMail mail);
}
```

### 20.2 Secure rendered mail

```java
public record RenderedMail(
    String tenantId,
    InternetAddress from,
    List<InternetAddress> to,
    List<InternetAddress> cc,
    List<InternetAddress> bcc,
    String subject,
    MimeContent content,
    List<AttachmentRef> attachments,
    String templateCode,
    String templateVersion,
    String correlationId
) {}
```

### 20.3 Policy pipeline

```text
Domain Event
   -> Authorization Check
   -> Recipient Resolution
   -> Sender Policy
   -> Template Rendering
   -> Header Safety Check
   -> Attachment Policy
   -> Outbox Persist
   -> Worker Send
   -> Secure SMTP Gateway
   -> Audit + Metrics
```

### 20.4 Security invariant

```text
Only Secure SMTP Gateway may call Jakarta Mail Transport.
```

Kenapa?

Agar:

1. TLS config konsisten.
2. Timeout konsisten.
3. Credential tidak tersebar.
4. Log redaction konsisten.
5. Failure classification konsisten.
6. Audit lengkap.
7. Header/attachment policy tidak dilewati.

---

## 21. Security Checklist untuk Code Review

Gunakan checklist ini saat review PR mail-related.

### 21.1 SMTP config

```text
[ ] Timeout configured: connection/read/write.
[ ] STARTTLS required or implicit TLS used.
[ ] No trust-all certificate config.
[ ] SMTP debug disabled by default.
[ ] Auth mechanism intentional.
[ ] Java 8/17/21 TLS compatibility validated.
```

### 21.2 Credential

```text
[ ] No secret in source code.
[ ] No secret in config repo.
[ ] Secret from approved manager.
[ ] Rotation plan exists.
[ ] Auth failure alert exists.
[ ] Token/password never logged.
```

### 21.3 Header safety

```text
[ ] Subject rejects CR/LF.
[ ] Display name rejects CR/LF.
[ ] Reply-To validated.
[ ] From controlled by policy.
[ ] No arbitrary custom header from user.
[ ] InternetAddress used instead of manual string header.
```

### 21.4 Recipient safety

```text
[ ] Recipient resolved from trusted domain data where possible.
[ ] Non-prod recipient redirect/allowlist exists.
[ ] BCC privacy respected.
[ ] Bulk recipient model avoids leaking other recipients.
[ ] Suppression/preference considered if applicable.
```

### 21.5 Template safety

```text
[ ] User text escaped.
[ ] No untrusted raw HTML.
[ ] Links are generated/allowlisted.
[ ] No open redirect.
[ ] Sensitive data minimized.
[ ] Template version audited.
```

### 21.6 Attachment safety

```text
[ ] Attachment source is trusted.
[ ] No arbitrary local file path.
[ ] Size limit enforced.
[ ] Filename sanitized.
[ ] Content type validated.
[ ] User uploads scanned/quarantined.
[ ] Sensitive document sent as secure link if possible.
```

### 21.7 Operational security

```text
[ ] Metrics do not expose PII.
[ ] Logs redact recipient/body/token.
[ ] Audit records sufficient but not excessive.
[ ] Kill switch exists for bulk/broadcast.
[ ] Circuit breaker for global auth/provider failure.
[ ] Alert for spike in failures.
```

---

## 22. Common Security Anti-Patterns

### 22.1 Utility method yang terlalu powerful

```java
sendEmail(String from, String to, String subject, String html)
```

Masalah:

1. Caller bisa set anything.
2. No policy.
3. No audit context.
4. No template version.
5. No recipient governance.

### 22.2 Sending synchronously in sensitive flow

```text
User submits case
  -> DB transaction
  -> send email
  -> SMTP timeout
  -> transaction hangs/fails
```

Security impact:

1. Timeout bisa jadi availability issue.
2. Retry dari user bisa duplicate.
3. Error detail bisa bocor ke UI.

### 22.3 Debug SMTP in production

```java
session.setDebug(true);
```

Masalah:

1. Recipient leak.
2. Header leak.
3. Token/credential risk.
4. Log retention expands blast radius.

### 22.4 Trust all cert

```properties
mail.smtp.ssl.trust=*
```

Masalah:

1. MITM.
2. Credential capture.
3. Compliance failure.

### 22.5 Reusing production SMTP in UAT

Masalah:

1. Test email ke real user.
2. Reputation impact.
3. Audit confusion.
4. PII leak.

### 22.6 Arbitrary attachment path

```java
attachFile(request.getPath())
```

Masalah:

1. Local file disclosure.
2. Path traversal.
3. Sensitive server file leak.

---

## 23. Incident Scenarios and Response

### 23.1 Scenario A: SMTP credential leaked

Symptoms:

1. Provider shows unusual volume.
2. Spam complaints increase.
3. Emails sent outside app audit records.
4. Quota exhausted.

Immediate action:

1. Revoke credential.
2. Rotate credential.
3. Disable sending temporarily.
4. Check provider logs.
5. Compare app audit vs provider send logs.
6. Identify source of leak.
7. Review logs/config/CI secrets.
8. Notify security/compliance if required.

Prevention:

1. Secret manager.
2. Least privilege.
3. Per-environment credential.
4. No debug logs.
5. Rotation.
6. Provider anomaly alert.

### 23.2 Scenario B: User receives someone else's attachment

Symptoms:

1. Recipient report.
2. Attachment content mismatch.
3. Audit shows template correct but attachment wrong.

Immediate action:

1. Stop affected notification type.
2. Identify scope.
3. Preserve audit logs.
4. Check attachment resolution query.
5. Check concurrency/cache bug.
6. Notify data protection process.

Likely root cause:

1. AttachmentRef not tied to tenant/case.
2. Cache key missing business ID.
3. Race in temp file reuse.
4. Reused `MimeMessage`/`MimeBodyPart` across sends.
5. Batch personalization bug.

Prevention:

1. Immutable per-recipient message.
2. Attachment authorization check.
3. No shared mutable MIME objects.
4. Strong test for personalization.
5. Audit attachment IDs.

### 23.3 Scenario C: STARTTLS silently not used

Symptoms:

1. Security scan flags plaintext auth.
2. SMTP relay logs show non-TLS session.
3. Network capture confirms clear connection.

Root cause:

```properties
mail.smtp.starttls.enable=true
mail.smtp.starttls.required=false
```

Server did not advertise STARTTLS, but client continued.

Fix:

```properties
mail.smtp.starttls.required=true
```

Also validate relay config.

### 23.4 Scenario D: Auth failure after rotation

Symptoms:

1. 535 errors spike.
2. Queue backlog increases.
3. All tenants/provider fail.

Response:

1. Pause sending.
2. Verify secret value.
3. Verify app instances reloaded secret.
4. Verify provider account status.
5. Resume gradually.
6. Avoid retry storm.

---

## 24. Top 1% Mental Model

Engineer biasa bertanya:

> Bagaimana cara kirim email pakai SMTP?

Engineer kuat bertanya:

> Siapa yang boleh menyebabkan email dikirim, dengan identitas apa, ke siapa, berisi data apa, lewat credential apa, dalam kondisi transport apa, tercatat di audit mana, dan apa yang terjadi jika credential bocor atau provider gagal?

Inilah perbedaannya.

Email adalah external side effect yang visible, persistent, forwardable, dan sulit ditarik kembali. Setelah email keluar, kamu tidak bisa benar-benar “rollback”. Karena itu desainnya harus lebih mirip financial transaction side-effect daripada `System.out.println`.

Core invariants:

```text
1. No raw SMTP credential in source code.
2. No SMTP send without timeout.
3. No plaintext SMTP auth.
4. No trust-all certificate in production.
5. No arbitrary From/Reply-To from caller.
6. No user input in header without CR/LF rejection.
7. No arbitrary HTML from untrusted input.
8. No arbitrary local attachment path.
9. No production email from non-prod environment.
10. No PII/token/body dump in logs.
11. No global retry storm for auth failure.
12. No mail send path outside audited gateway.
```

---

## 25. Ringkasan

Di part ini kita membahas security secara menyeluruh:

1. Email security adalah multi-layer problem.
2. TLS harus divalidasi, bukan hanya diaktifkan.
3. STARTTLS harus `required` untuk production submission jika memakai port 587.
4. Implicit TLS cocok untuk port 465 jika provider mengharuskan.
5. SMTP credential harus dianggap high-impact secret.
6. OAuth2/XOAUTH2 mengurangi static password risk tetapi menambah complexity.
7. Debug SMTP production sangat berbahaya.
8. Header injection dicegah dengan CR/LF rejection dan typed API.
9. Template harus escape untrusted content.
10. Attachment perlu trust model, size limit, filename safety, dan scanning jika berasal dari upload.
11. Sender identity harus governed, terutama multi-tenant.
12. Non-prod harus punya recipient guardrail.
13. Circuit breaker diperlukan untuk auth/provider failure massal.
14. Mail gateway harus menjadi satu-satunya boundary yang boleh bicara ke Jakarta Mail `Transport`.

---

## 26. Checklist Praktis Sebelum Production

```text
SMTP/TLS
[ ] Port/protocol sesuai provider: 587 STARTTLS atau 465 SSL.
[ ] STARTTLS required jika memakai STARTTLS.
[ ] Certificate validation tidak dimatikan.
[ ] Timeout connect/read/write ada.

Credential
[ ] Secret dari secret manager.
[ ] Rotation SOP ada.
[ ] Auth failure alert ada.
[ ] Token/password tidak pernah dilog.

Message Safety
[ ] Header input menolak CR/LF.
[ ] Sender/Reply-To allowlisted.
[ ] Template escaping aktif.
[ ] Link allowlisted/signed jika sensitive.

Attachment
[ ] Tidak menerima arbitrary path.
[ ] Size limit.
[ ] Filename sanitized.
[ ] Sensitive document pakai secure link jika memungkinkan.

Environment
[ ] DEV/UAT redirect atau allowlist recipient.
[ ] PROD credential berbeda dari non-prod.
[ ] Subject/body tidak bocor original recipient di non-prod jika dianggap PII.

Operation
[ ] Audit per notification.
[ ] Metrics aman dari PII.
[ ] Kill switch.
[ ] Circuit breaker.
[ ] Runbook incident.
```

---

## 27. Hubungan dengan Part Berikutnya

Part ini fokus pada security dari sisi application dan SMTP client.

Part berikutnya akan membahas:

# Part 14 — Deliverability Fundamentals: SPF, DKIM, DMARC, Reputation, Bounce

Di sana kita akan bergeser dari pertanyaan:

```text
Apakah koneksi SMTP aman?
```

menjadi:

```text
Apakah email dipercaya oleh receiving domain dan punya peluang masuk inbox?
```

Itu mencakup SPF, DKIM, DMARC, alignment, reputation, hard bounce, soft bounce, complaint, suppression list, dan kenapa `SMTP accepted` bukan berarti `delivered to inbox`.

---

## Referensi

- Jakarta Mail / SMTP provider documentation: SMTP provider supports authentication and exposes SMTP properties such as auth, STARTTLS, SSL, timeout, and related controls.
- Eclipse Angus Mail documentation: Angus Mail is the modern Jakarta Mail implementation and documents SMTP provider behavior and OAuth2 support.
- RFC 5321: Simple Mail Transfer Protocol, including SMTP reply code classes and envelope semantics.
- Jakarta Activation specification: relevant for attachment/data handling security because mail content often crosses MIME/data source boundaries.


<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 12 — Bulk, Batch, and Rate-Limited Sending](./12-bulk-batch-rate-limited-sending.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 14 — Deliverability Fundamentals: SPF, DKIM, DMARC, Reputation, Bounce](./14-deliverability-spf-dkim-dmarc-bounce.md)
