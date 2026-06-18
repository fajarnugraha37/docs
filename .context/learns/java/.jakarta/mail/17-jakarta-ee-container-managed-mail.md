# Part 17 — Jakarta Mail in Jakarta EE Containers

> Series: `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery`  
> File: `17-jakarta-ee-container-managed-mail.md`  
> Scope: Java 8–25, JavaMail/Jakarta Mail, Jakarta EE containers, JNDI mail sessions, container-managed configuration, operational boundary, portability, and production-grade design.

---

## 0. Posisi Part Ini Dalam Seri

Sampai Part 16, kita sudah membangun fondasi besar:

1. email sebagai distributed system;
2. SMTP/MIME/IMAP/POP3;
3. JavaMail ke Jakarta Mail;
4. `Session`, `Transport`, `Store`, `Folder`, `Message`;
5. SMTP timeout/TLS/auth;
6. MIME text/HTML/header;
7. multipart;
8. attachment dan Jakarta Activation;
9. HTML email;
10. addressing/header semantics;
11. error model;
12. reliable outbound delivery;
13. bulk/rate limit;
14. security;
15. deliverability;
16. inbound parsing.

Part ini membahas satu mode deployment yang berbeda dari standalone application:

> **Bagaimana memakai Jakarta Mail ketika aplikasi berjalan di Jakarta EE container / application server.**

Di standalone Java/Spring Boot, biasanya aplikasi membuat `Session` sendiri dari `Properties`:

```java
Properties props = new Properties();
props.put("mail.smtp.host", "smtp.example.com");
props.put("mail.smtp.port", "587");
props.put("mail.smtp.auth", "true");
props.put("mail.smtp.starttls.enable", "true");

Session session = Session.getInstance(props, authenticator);
```

Di Jakarta EE container, pendekatannya sering berbeda:

```java
@Resource(lookup = "java:comp/env/mail/NotificationSession")
private Session mailSession;
```

Perbedaannya bukan kosmetik. Itu mengubah **ownership configuration**, **secret management**, **deployment portability**, **operational control**, dan **testing strategy**.

---

## 1. Mental Model: Container-Managed Mail Session

### 1.1 Apa Itu Container-Managed Mail?

Container-managed mail berarti:

> Aplikasi tidak membuat `jakarta.mail.Session` sepenuhnya sendiri. Container menyediakan `Session` sebagai managed resource yang bisa di-lookup melalui JNDI atau di-inject menggunakan annotation.

Secara konsep:

```text
Application Code
   |
   | @Resource / JNDI lookup
   v
Container-managed jakarta.mail.Session
   |
   | properties, host, auth, TLS, provider config
   v
SMTP/IMAP/POP3 Provider
   |
   v
External Mail Infrastructure
```

Aplikasi tetap bertanggung jawab membangun `MimeMessage`, menentukan recipient, subject, body, attachment, dan handling failure. Tetapi detail seperti SMTP host, port, credential, TLS policy, dan server-specific configuration bisa dikelola di luar kode aplikasi.

### 1.2 Kenapa Ini Ada?

Application server dibuat untuk enterprise environment yang memiliki banyak resource eksternal:

- database connection pool;
- JMS connection factory;
- mail session;
- transaction manager;
- security realm;
- naming/directory service;
- connector resources.

Mail session adalah salah satu resource yang cocok dikelola container karena:

1. konfigurasi SMTP bisa berbeda per environment;
2. credential sebaiknya tidak hardcoded di aplikasi;
3. operation team sering punya ownership terhadap relay, secret, dan server policy;
4. aplikasi bisa lebih portable antar environment;
5. deployment descriptor/server config bisa mengubah resource tanpa rebuild aplikasi.

### 1.3 Apa yang Sebenarnya Di-Manage?

Yang di-manage biasanya adalah **`Session` configuration**, bukan seluruh delivery pipeline.

Container dapat menyediakan:

- SMTP host;
- SMTP port;
- default transport protocol;
- authentication username/password;
- TLS properties;
- debug flag;
- JNDI name;
- optional custom properties;
- provider implementation availability.

Container biasanya **tidak otomatis menyediakan**:

- transactional outbox;
- retry policy;
- idempotency;
- template rendering;
- bounce processing;
- deliverability monitoring;
- queue worker;
- suppression list;
- domain-level audit.

Jadi jangan salah kaprah:

> Container-managed `Session` bukan reliable email subsystem. Ia hanya managed configuration entry point ke Jakarta Mail.

---

## 2. Jakarta Mail Object Model Tetap Sama

Walaupun `Session` berasal dari container, API mail tetap sama:

```text
Session
  -> MimeMessage
      -> headers
      -> recipients
      -> content / multipart
  -> Transport
      -> SMTP send
```

Contoh dasar:

```java
import jakarta.annotation.Resource;
import jakarta.mail.Message;
import jakarta.mail.Session;
import jakarta.mail.Transport;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
import jakarta.ejb.Stateless;

@Stateless
public class MailService {

    @Resource(lookup = "java:comp/env/mail/NotificationSession")
    private Session mailSession;

    public void sendPlainText(String to, String subject, String body) throws Exception {
        MimeMessage message = new MimeMessage(mailSession);
        message.setFrom(new InternetAddress("no-reply@example.com", "Example System"));
        message.setRecipients(Message.RecipientType.TO, InternetAddress.parse(to, false));
        message.setSubject(subject, "UTF-8");
        message.setText(body, "UTF-8");

        Transport.send(message);
    }
}
```

Yang berubah:

- `Session` tidak dibuat manual;
- properties tidak ditulis di kode;
- credential tidak langsung terlihat di aplikasi;
- deployment/server config menjadi sumber kebenaran konfigurasi mail.

---

## 3. Java EE / Jakarta EE Namespace: `javax` vs `jakarta`

### 3.1 Legacy Java EE / JavaMail

Di aplikasi lama Java EE 7/8:

```java
import javax.annotation.Resource;
import javax.mail.Session;
import javax.mail.Message;
import javax.mail.Transport;
import javax.mail.internet.MimeMessage;
```

### 3.2 Modern Jakarta EE

Di Jakarta EE 9+:

```java
import jakarta.annotation.Resource;
import jakarta.mail.Session;
import jakarta.mail.Message;
import jakarta.mail.Transport;
import jakarta.mail.internet.MimeMessage;
```

### 3.3 Invariant Penting

Jangan mencampur namespace:

```text
BAD:
- jakarta.annotation.Resource
- javax.mail.Session

BAD:
- javax.annotation.Resource
- jakarta.mail.Session

BAD:
- dependency jakarta.mail-api
- application server menyediakan javax.mail provider
```

Saat migrasi dari Java EE 8 ke Jakarta EE 10/11/12-style runtime, pastikan namespace mail, activation, annotation, servlet, CDI, EJB, dan JAX-RS konsisten.

---

## 4. JNDI Naming Mental Model

### 4.1 Apa Itu JNDI Dalam Konteks Ini?

JNDI adalah naming/directory abstraction. Dalam Jakarta EE, resource eksternal sering diregister dengan nama tertentu, lalu aplikasi melakukan lookup.

Untuk mail session, nama umum:

```text
mail/NotificationSession
java:comp/env/mail/NotificationSession
java:global/mail/NotificationSession
java:app/mail/NotificationSession
java:module/mail/NotificationSession
```

Makna praktis:

- `mail/NotificationSession` sering nama logical/resource name;
- `java:comp/env/...` sering environment naming context milik component;
- server tertentu punya variasi dan convention masing-masing.

### 4.2 Recommended Naming Convention

Gunakan nama yang eksplisit terhadap purpose, bukan vendor/provider.

```text
Good:
mail/TransactionalNotificationSession
mail/CaseManagementNotificationSession
mail/OutboundAlertSession
mail/InboundSupportMailboxSession

Bad:
mail/Gmail
mail/SMTP
mail/587
mail/prod-mail
```

Kenapa?

Karena resource name adalah contract aplikasi. SMTP provider bisa berubah dari Gmail ke SES atau corporate relay tanpa mengubah kode.

### 4.3 Resource Name Sebagai Architectural Boundary

Nama JNDI sebaiknya merepresentasikan **capability**, bukan implementation.

```text
Capability:
- send transactional notification
- read support mailbox
- send regulatory notice

Implementation:
- smtp.gmail.com
- email-smtp.ap-southeast-1.amazonaws.com
- smtp.office365.com
- relay.internal.local
```

Top 1% engineer akan menjaga boundary ini karena ia mempengaruhi migrasi, testing, audit, dan operasi.

---

## 5. Injection Pattern Dengan `@Resource`

### 5.1 Field Injection

```java
@Resource(lookup = "java:comp/env/mail/NotificationSession")
private Session mailSession;
```

Sederhana, sering ditemukan di contoh Jakarta EE.

Kelebihan:

- ringkas;
- mudah dipahami;
- container inject otomatis.

Kekurangan:

- sulit dites tanpa container;
- dependency tersembunyi;
- tidak cocok untuk strict constructor-based design.

### 5.2 Setter Injection

```java
private Session mailSession;

@Resource(lookup = "java:comp/env/mail/NotificationSession")
public void setMailSession(Session mailSession) {
    this.mailSession = mailSession;
}
```

Lebih mudah disubstitusi dalam test manual, tetapi masih container-specific.

### 5.3 JNDI Lookup Manual

```java
import jakarta.naming.InitialContext;
import jakarta.mail.Session;

public final class MailSessionLookup {

    public Session lookup() {
        try {
            InitialContext ctx = new InitialContext();
            return (Session) ctx.lookup("java:comp/env/mail/NotificationSession");
        } catch (Exception e) {
            throw new IllegalStateException("Failed to lookup mail session", e);
        }
    }
}
```

Kelebihan:

- eksplisit;
- bisa dilakukan lazily;
- bisa dipusatkan dalam adapter.

Kekurangan:

- kode lebih coupled ke JNDI;
- error muncul runtime;
- raw string lookup menyebar jika tidak dikontrol.

### 5.4 Recommended Pattern

Untuk enterprise architecture, jangan biarkan JNDI tersebar di business service.

Gunakan adapter kecil:

```text
Business Service
   -> NotificationService interface
      -> MailNotificationAdapter
         -> MailSessionProvider
            -> JNDI / @Resource / container
```

Contoh:

```java
public interface MailGateway {
    void send(MailCommand command);
}
```

```java
public class JakartaEeMailGateway implements MailGateway {

    private final Session session;
    private final MimeMessageFactory messageFactory;
    private final MailFailureClassifier failureClassifier;

    public JakartaEeMailGateway(
            Session session,
            MimeMessageFactory messageFactory,
            MailFailureClassifier failureClassifier
    ) {
        this.session = session;
        this.messageFactory = messageFactory;
        this.failureClassifier = failureClassifier;
    }

    @Override
    public void send(MailCommand command) {
        try {
            MimeMessage message = messageFactory.create(session, command);
            Transport.send(message);
        } catch (Exception e) {
            throw failureClassifier.toDomainException(e);
        }
    }
}
```

Lalu wiring container-specific hanya di boundary.

---

## 6. Deployment Descriptor vs Annotation vs Server Config

### 6.1 Tiga Layer Konfigurasi

Biasanya ada tiga layer:

```text
Application code
  - @Resource lookup name
  - business purpose

Deployment descriptor
  - resource-ref
  - mapping logical name to environment name

Application server config
  - real SMTP host/port/auth/TLS properties
  - credential
  - provider implementation
```

### 6.2 `web.xml` Resource Reference Example

Legacy/portable style:

```xml
<resource-ref>
    <description>Transactional notification mail session</description>
    <res-ref-name>mail/NotificationSession</res-ref-name>
    <res-type>jakarta.mail.Session</res-type>
    <res-auth>Container</res-auth>
</resource-ref>
```

Untuk Java EE 8 legacy:

```xml
<resource-ref>
    <description>Transactional notification mail session</description>
    <res-ref-name>mail/NotificationSession</res-ref-name>
    <res-type>javax.mail.Session</res-type>
    <res-auth>Container</res-auth>
</resource-ref>
```

### 6.3 `@Resource(name=...)` vs `@Resource(lookup=...)`

Ada perbedaan:

```java
@Resource(name = "mail/NotificationSession")
private Session session;
```

Biasanya `name` adalah nama resource reference dalam component environment.

```java
@Resource(lookup = "java:comp/env/mail/NotificationSession")
private Session session;
```

`lookup` menunjuk langsung ke JNDI name.

Trade-off:

| Approach | Kelebihan | Kekurangan |
|---|---|---|
| `name` | lebih portable melalui descriptor mapping | perlu mapping server/deployment |
| `lookup` | eksplisit, cepat dipahami | lebih mudah hardcode nama server-specific |
| manual JNDI lookup | bisa dikontrol di adapter | lebih verbose dan runtime error-prone |

### 6.4 Prinsip Portability

Untuk aplikasi enterprise yang harus portable antar server, gunakan resource reference logical name.

Untuk aplikasi yang sangat tied ke satu runtime, `lookup` langsung sering cukup.

Tetapi jangan menyebarkan string JNDI di banyak class.

---

## 7. Server-Specific Configuration Examples

Bagian ini bukan manual lengkap tiap server, tetapi mental modelnya.

### 7.1 Payara / GlassFish Style

Konsep umum:

```text
Mail Resource
  JNDI Name: mail/NotificationSession
  Host: smtp.example.com
  User: smtp-user
  From: no-reply@example.com
  Store Protocol: imap / pop3 optional
  Transport Protocol: smtp
  Custom properties:
    mail.smtp.port=587
    mail.smtp.auth=true
    mail.smtp.starttls.enable=true
    mail.smtp.connectiontimeout=5000
    mail.smtp.timeout=10000
    mail.smtp.writetimeout=10000
```

Aplikasi:

```java
@Resource(lookup = "mail/NotificationSession")
private Session session;
```

atau:

```java
@Resource(name = "mail/NotificationSession")
private Session session;
```

### 7.2 WildFly / JBoss EAP Style

Konsep umum:

```text
mail-session
  jndi-name: java:/mail/NotificationSession
  smtp-server:
    outbound-socket-binding-ref: mail-smtp
    username: smtp-user
    password: ******
    tls: true
```

Aplikasi:

```java
@Resource(lookup = "java:/mail/NotificationSession")
private Session session;
```

Perhatikan bahwa `java:/...` sering server-specific.

### 7.3 Open Liberty Style

Konsep umum:

```xml
<mailSession id="notificationMail"
             jndiName="mail/NotificationSession"
             from="no-reply@example.com">
    <smtp host="smtp.example.com"
          port="587"
          user="smtp-user"
          password="${smtp.password}"
          startTLS="true" />
</mailSession>
```

Aplikasi:

```java
@Resource(lookup = "mail/NotificationSession")
private Session session;
```

### 7.4 Tomcat Style

Tomcat bukan full Jakarta EE application server, tetapi dapat membuat mail `Session` sebagai JNDI resource.

Konsep umum:

```xml
<Resource name="mail/NotificationSession"
          auth="Container"
          type="jakarta.mail.Session"
          mail.smtp.host="smtp.example.com"
          mail.smtp.port="587"
          mail.smtp.auth="true"
          mail.smtp.starttls.enable="true"
          mail.smtp.connectiontimeout="5000"
          mail.smtp.timeout="10000"
          mail.smtp.writetimeout="10000"
          mail.smtp.user="smtp-user"
          password="secret" />
```

Aplikasi web dapat lookup:

```java
InitialContext ctx = new InitialContext();
Session session = (Session) ctx.lookup("java:comp/env/mail/NotificationSession");
```

Catatan penting:

> Syntax property dan capability bisa berbeda antar server. Treat server config as server-specific artifact; jangan copy-paste tanpa memvalidasi dokumentasi runtime yang dipakai.

---

## 8. Container-Managed Tidak Berarti Transactional Mail

Ini salah satu miskonsepsi terbesar.

### 8.1 SMTP Send Tidak Ikut Database Transaction

Misalnya:

```java
@Transactional
public void approveCase(String caseId) {
    caseRepository.approve(caseId);
    mailService.sendApprovalEmail(caseId);
}
```

Walaupun `mailService` memakai container-managed `Session`, SMTP send tetap side effect eksternal.

Jika email terkirim lalu transaksi database rollback:

```text
Email says approved
DB says not approved
```

Jika database commit lalu SMTP timeout:

```text
DB says approved
Email may or may not have been sent
```

Container-managed mail session tidak menyelesaikan problem ini.

### 8.2 Proper Solution: Outbox Tetap Relevan

Pattern yang benar tetap:

```text
Business transaction:
  update business state
  insert email_outbox row
  commit

Async worker:
  read pending outbox
  build MimeMessage using container Session
  send
  update status
```

Container-managed `Session` membantu konfigurasi SMTP, bukan atomicity.

### 8.3 Jakarta EE Async Boundary

Dalam Jakarta EE, async worker bisa memakai:

- EJB `@Schedule`;
- EJB asynchronous method;
- ManagedExecutorService;
- Jakarta Batch;
- JMS/MDB;
- external scheduler;
- external queue consumer.

Tetapi invariant tetap:

> Email sending harus dikelola sebagai side effect yang recoverable, observable, dan idempotent-aware.

---

## 9. CDI/EJB Integration Patterns

### 9.1 Stateless EJB Service

```java
import jakarta.annotation.Resource;
import jakarta.ejb.Stateless;
import jakarta.mail.Session;

@Stateless
public class NotificationMailBean {

    @Resource(lookup = "java:comp/env/mail/NotificationSession")
    private Session session;

    public void send(MailCommand command) {
        // build and send MimeMessage
    }
}
```

Kelebihan:

- managed lifecycle;
- container injection;
- transaction boundary available;
- security context available.

Risiko:

- jangan blocking terlalu lama di request path;
- jangan kirim email dalam transaction critical path;
- jangan simpan state mutable di bean.

### 9.2 CDI Producer for Session Wrapper

Kadang kita ingin CDI-friendly adapter.

```java
import jakarta.annotation.Resource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;
import jakarta.inject.Named;
import jakarta.mail.Session;

@ApplicationScoped
public class MailSessionProducer {

    @Resource(lookup = "java:comp/env/mail/NotificationSession")
    private Session notificationSession;

    @Produces
    @Named("notificationMailSession")
    public Session notificationMailSession() {
        return notificationSession;
    }
}
```

Consumer:

```java
import jakarta.inject.Inject;
import jakarta.inject.Named;
import jakarta.mail.Session;

public class MailGatewayBean {

    private final Session session;

    @Inject
    public MailGatewayBean(@Named("notificationMailSession") Session session) {
        this.session = session;
    }
}
```

Caveat:

- constructor injection CDI dengan `Session` resource bergantung pada producer;
- jangan expose terlalu banyak raw `Session` ke domain layer.

### 9.3 Better: Produce a Gateway, Not Raw Session

```java
@ApplicationScoped
public class MailGatewayProducer {

    @Resource(lookup = "java:comp/env/mail/NotificationSession")
    private Session session;

    @Produces
    @ApplicationScoped
    public MailGateway mailGateway() {
        return new JakartaEeMailGateway(
                session,
                new MimeMessageFactory(),
                new MailFailureClassifier()
        );
    }
}
```

Dengan ini business layer hanya tahu `MailGateway`.

---

## 10. Threading and Lifecycle in Container

### 10.1 Jangan Membuat Thread Sendiri Sembarangan

Di Jakarta EE, application code tidak seharusnya membuat unmanaged thread sendiri:

```java
new Thread(() -> sendEmail()).start(); // avoid in Jakarta EE container
```

Kenapa?

- container tidak mengelola lifecycle thread itu;
- security context bisa hilang;
- classloader issue saat redeploy;
- resource leak;
- shutdown tidak graceful;
- observability lemah.

Gunakan managed concurrency:

```java
@Resource
private ManagedExecutorService executor;
```

Lalu:

```java
executor.submit(() -> mailGateway.send(command));
```

Tetapi tetap perhatikan outbox/retry. Managed executor bukan pengganti durable queue.

### 10.2 Session Lifecycle

`Session` merepresentasikan configuration context. Ia bukan SMTP connection aktif yang harus ditutup.

Yang perlu ditutup adalah `Transport` jika digunakan manual:

```java
Transport transport = session.getTransport("smtp");
try {
    transport.connect();
    transport.sendMessage(message, message.getAllRecipients());
} finally {
    transport.close();
}
```

Kalau memakai:

```java
Transport.send(message);
```

Jakarta Mail akan melakukan connect/send/close internally.

### 10.3 Connection Reuse Dalam Container

Container-managed `Session` tidak otomatis berarti SMTP connection pooling.

Jika butuh throughput tinggi:

- jangan berasumsi ada pooling;
- ukur latency;
- pertimbangkan manual `Transport` reuse dalam worker boundary;
- batasi lifecycle connection;
- handle server disconnect;
- jangan share `Transport` across unrelated threads tanpa desain eksplisit.

---

## 11. Configuration Ownership Model

### 11.1 Siapa Mengontrol Apa?

Dalam setup container-managed mail:

| Area | Owner utama | Catatan |
|---|---|---|
| JNDI name contract | app + platform team | harus stabil |
| SMTP host/port | platform/ops | environment-specific |
| Credential | platform/security/ops | jangan di source code |
| TLS policy | security/platform | should be required in production |
| Timeout | app + platform | harus sesuai SLA aplikasi |
| From address policy | app + domain owner | harus align SPF/DKIM/DMARC |
| Message content | app | template, MIME, data |
| Retry/outbox | app | container tidak otomatis handle |
| Bounce processing | app/provider/platform | tergantung architecture |
| Observability | shared | app emits domain metrics, ops monitors infra |

### 11.2 Contract Yang Harus Ditulis

Untuk production, jangan hanya bilang “pakai mail session dari server”. Tulis contract:

```text
Mail resource contract:
- logical name: mail/TransactionalNotificationSession
- protocol: SMTP submission
- required TLS: yes
- auth: container-managed
- allowed sender domains: example.com
- max single message size: 10 MB
- provider rate limit: 50 msg/sec
- timeout budget: connect 5s, read 10s, write 10s
- retry handled by: application outbox worker
- debug logging: disabled in production
- credential rotation owner: platform team
- bounce feedback owner: notification subsystem
```

Ini membedakan engineering biasa dari engineering yang defensible.

---

## 12. Timeout Configuration Tetap Wajib

Walaupun session dikelola container, timeout tetap harus dipastikan.

Minimum properties yang biasanya dibutuhkan:

```properties
mail.smtp.connectiontimeout=5000
mail.smtp.timeout=10000
mail.smtp.writetimeout=10000
```

Tanpa timeout, thread bisa menggantung terlalu lama saat network/SMPP/SMTP provider bermasalah.

Untuk IMAP/POP3 inbound:

```properties
mail.imap.connectiontimeout=5000
mail.imap.timeout=10000
mail.imap.writetimeout=10000

mail.pop3.connectiontimeout=5000
mail.pop3.timeout=10000
mail.pop3.writetimeout=10000
```

Catatan:

- properti spesifik provider bisa berbeda;
- validasi pada runtime yang dipakai;
- jangan mengandalkan default;
- timeout harus masuk checklist deployment.

---

## 13. Security in Container-Managed Mail

### 13.1 Secret Handling

Keuntungan utama container-managed resource: credential tidak harus masuk aplikasi.

Tetapi hati-hati:

- credential bisa tetap ada di XML/server config;
- file config perlu permission ketat;
- secret harus bisa dirotasi;
- log server tidak boleh mencetak credential;
- deployment pipeline tidak boleh menyimpan secret plain text.

### 13.2 STARTTLS Required

Untuk SMTP submission, production umumnya harus mewajibkan TLS.

Properties yang relevan:

```properties
mail.smtp.starttls.enable=true
mail.smtp.starttls.required=true
```

Jika memakai implicit SSL:

```properties
mail.smtp.ssl.enable=true
```

Gunakan mode sesuai provider.

### 13.3 Jangan Disable Certificate Validation

Anti-pattern:

```properties
mail.smtp.ssl.trust=*
```

Atau custom trust manager yang menerima semua certificate.

Ini membuka risiko MITM. Untuk production, trust harus jelas:

- CA trusted;
- corporate CA di truststore;
- certificate rotation SOP;
- hostname verification sesuai kebutuhan runtime.

### 13.4 Debug Logging

`Session.setDebug(true)` atau `mail.debug=true` berguna di DEV, tetapi berbahaya di production.

Debug SMTP dapat menampilkan:

- recipient;
- server response;
- auth flow metadata;
- message headers;
- kadang content/context sensitif tergantung logging.

Production rule:

```text
mail.debug=false
```

Jika butuh incident debug:

- aktifkan temporer;
- scope kecil;
- redaction;
- akses log terbatas;
- disable lagi setelah selesai.

---

## 14. Multiple Mail Sessions

Enterprise app sering punya lebih dari satu mail use case.

Contoh:

```text
mail/TransactionalNotificationSession
mail/SecurityAlertSession
mail/RegulatoryNoticeSession
mail/InboundSupportMailboxSession
mail/BulkAnnouncementSession
```

Kenapa dipisah?

- sender domain berbeda;
- rate limit berbeda;
- credential berbeda;
- audit policy berbeda;
- deliverability risk berbeda;
- failure isolation;
- compliance berbeda.

### 14.1 Jangan Semua Pakai Satu SMTP Identity

Anti-pattern:

```text
Semua email sistem memakai no-reply@example.com dan satu credential SMTP.
```

Masalah:

- sulit audit;
- sulit revoke sebagian;
- reputasi domain tercampur;
- bulk traffic bisa merusak transactional email;
- incident blast radius besar.

### 14.2 Gateway per Purpose

```java
public interface TransactionalMailGateway {
    void sendTransactional(MailCommand command);
}

public interface SecurityAlertMailGateway {
    void sendSecurityAlert(MailCommand command);
}
```

Atau satu `MailGateway` dengan `MailChannel`:

```java
public enum MailChannel {
    TRANSACTIONAL,
    SECURITY_ALERT,
    REGULATORY_NOTICE,
    BULK_ANNOUNCEMENT
}
```

Jangan hanya expose raw `Session` lalu berharap caller memilih benar.

---

## 15. Inbound Mail in Containers

Container-managed `Session` juga bisa untuk IMAP/POP3.

Contoh:

```java
@Resource(lookup = "java:comp/env/mail/InboundSupportMailboxSession")
private Session inboundSession;

public void pollInbox() throws Exception {
    Store store = inboundSession.getStore("imap");
    try {
        store.connect();
        Folder inbox = store.getFolder("INBOX");
        inbox.open(Folder.READ_WRITE);
        // search/process messages
    } finally {
        store.close();
    }
}
```

Catatan penting:

- `Store` harus ditutup;
- `Folder` harus ditutup;
- polling harus managed scheduler/worker;
- parsing inbound email harus defensif;
- checkpoint/dedup tetap tanggung jawab aplikasi;
- container session hanya menyediakan konfigurasi.

---

## 16. Testing Strategy

### 16.1 Jangan Biarkan Test Bergantung Pada Real JNDI

Business logic tidak boleh langsung require application server.

Bad:

```java
public class CaseApprovalService {
    @Resource(lookup = "java:comp/env/mail/NotificationSession")
    private Session session;

    public void approve(...) {
        // business + MimeMessage + Transport all mixed
    }
}
```

Good:

```java
public class CaseApprovalService {
    private final MailGateway mailGateway;

    public CaseApprovalService(MailGateway mailGateway) {
        this.mailGateway = mailGateway;
    }
}
```

Unit test:

```java
class FakeMailGateway implements MailGateway {
    final List<MailCommand> sent = new ArrayList<>();

    @Override
    public void send(MailCommand command) {
        sent.add(command);
    }
}
```

### 16.2 Integration Test Dengan Fake SMTP

Untuk adapter Jakarta Mail:

```text
Test application / component
  -> Session configured to localhost SMTP
  -> GreenMail/MailHog/Mailpit/Testcontainers
  -> Assert received MIME
```

Walaupun production memakai JNDI, test bisa membuat `Session` manual untuk adapter test.

Yang penting adapter menerima `Session` sebagai dependency.

### 16.3 Container Integration Test

Untuk memvalidasi JNDI injection dan server config:

- gunakan embedded/managed container jika tersedia;
- Arquillian-style test untuk Jakarta EE klasik;
- server-specific integration test;
- smoke test saat deployment.

Smoke test harus menjawab:

```text
- JNDI mail session bisa di-lookup?
- SMTP host reachable?
- TLS negotiation berhasil?
- auth berhasil?
- timeout configured?
- test recipient menerima email di test mailbox?
```

Jangan menjalankan smoke test production sembarangan ke user nyata.

---

## 17. Observability Dalam Container Context

### 17.1 Log Yang Perlu

Log application-level:

```text
mail.notificationId
mail.outboxId
mail.channel
mail.templateCode
mail.templateVersion
mail.recipientCount
mail.recipientDomainHash / category
mail.messageId
mail.smtpStatusCategory
mail.failureCategory
mail.attempt
mail.latencyMs
```

Jangan log:

```text
SMTP password
OAuth token
full recipient list jika sensitif
full email body
attachment content
PII-heavy template data
```

### 17.2 Container Logs vs Application Logs

Container logs mungkin mencatat:

- JNDI resource lookup failure;
- provider classloading error;
- SMTP connection error;
- security/auth issue;
- deployment descriptor mismatch.

Application logs harus mencatat:

- business command;
- outbox state;
- retry decision;
- failure classification;
- correlation ID.

Keduanya harus bisa dikorelasikan.

### 17.3 Metrics

Minimum metrics:

```text
mail_send_attempt_total{channel, result}
mail_send_duration_seconds{channel}
mail_outbox_queue_depth{channel}
mail_outbox_oldest_pending_age_seconds{channel}
mail_send_failure_total{channel, failure_category}
mail_smtp_auth_failure_total{session}
mail_smtp_timeout_total{session}
```

Untuk container-managed resource, tambahkan label logical session:

```text
session="mail/TransactionalNotificationSession"
```

Tetapi jangan label high-cardinality seperti recipient email.

---

## 18. Common Failure Modes

### 18.1 JNDI Name Tidak Ketemu

Symptom:

```text
NameNotFoundException
Resource lookup failed
Injection target null
```

Possible causes:

- resource belum dibuat di server;
- JNDI name salah;
- `java:comp/env` mapping salah;
- descriptor pakai `javax.mail.Session`, aplikasi pakai `jakarta.mail.Session`;
- deployment ke server berbeda dengan naming convention berbeda.

Diagnostic:

```text
1. cek resource server config
2. cek deployment descriptor
3. cek namespace javax/jakarta
4. cek server log saat deployment
5. cek exact JNDI name yang runtime expose
```

### 18.2 ClassCastException `javax.mail.Session` vs `jakarta.mail.Session`

Symptom:

```text
ClassCastException: javax.mail.Session cannot be cast to jakarta.mail.Session
```

Cause:

- mixed Java EE/Jakarta EE dependencies;
- server menyediakan legacy JavaMail;
- aplikasi dikompilasi Jakarta Mail;
- dependency bundled conflict.

Fix:

- align application server version;
- align namespace;
- remove duplicate bundled mail jars;
- use `provided` scope untuk API jika server menyediakan;
- use correct runtime implementation jika standalone.

### 18.3 Missing Provider

Symptom:

```text
NoSuchProviderException: smtp
```

Cause:

- hanya `jakarta.mail-api` ada, implementation tidak ada;
- server tidak menyediakan provider;
- classloader isolation;
- dependency excluded.

Fix:

- pastikan server/mail subsystem menyediakan SMTP provider;
- jika standalone/Tomcat, tambahkan Angus Mail implementation;
- cek module/classloader visibility.

### 18.4 SMTP Auth Failure

Symptom:

```text
535 Authentication failed
AuthenticationFailedException
```

Cause:

- credential salah;
- secret expired/rotated;
- provider require app password/OAuth2;
- account locked;
- wrong auth mechanism;
- TLS required before auth.

Fix:

- validate credential source;
- test SMTP login separately;
- confirm provider auth policy;
- ensure STARTTLS before auth.

### 18.5 Timeout / Thread Exhaustion

Symptom:

```text
request thread stuck
worker pool exhausted
mail send hangs
queue backlog grows
```

Cause:

- missing timeout;
- provider slow;
- network issue;
- sending synchronous in request path;
- no backpressure.

Fix:

- set connect/read/write timeout;
- use outbox worker;
- cap concurrency;
- add circuit breaker;
- alert on queue age.

### 18.6 Duplicate Email After Retry

Cause:

- SMTP accepted message but client timed out before response;
- worker retries because state unknown;
- no idempotency key;
- no dedup strategy.

Fix:

- model `UNKNOWN_AFTER_SEND_ATTEMPT`;
- use stable notification id/message id;
- make retry policy conservative;
- design business tolerance;
- expose audit trail.

---

## 19. Deployment Checklist

### 19.1 Pre-Deployment

```text
[ ] JNDI resource name agreed and documented
[ ] correct namespace: javax or jakarta
[ ] application server supports chosen Jakarta Mail version
[ ] SMTP host/port configured
[ ] TLS policy configured
[ ] auth credential configured via secure mechanism
[ ] timeout properties configured
[ ] debug disabled by default
[ ] sender/from policy aligned with domain authentication
[ ] test recipient configured for smoke test
[ ] outbox/retry strategy exists
[ ] monitoring dashboard updated
[ ] alert thresholds defined
```

### 19.2 Deployment Validation

```text
[ ] app deploys without resource injection error
[ ] server logs show mail resource available
[ ] smoke send succeeds in target environment
[ ] failure logs redact sensitive data
[ ] metrics emitted
[ ] queue worker processes pending message
[ ] retry path tested with fake failure
[ ] rollback plan exists
```

### 19.3 Production Readiness

```text
[ ] credential rotation SOP exists
[ ] provider quota known
[ ] incident owner known
[ ] bounce/complaint handling owner known
[ ] retention policy defined
[ ] PII logging reviewed
[ ] attachment size policy enforced
[ ] support playbook available
```

---

## 20. Recommended Architecture for Jakarta EE Application

### 20.1 High-Level Architecture

```text
Business Use Case
  |
  | emits notification intent
  v
Notification Application Service
  |
  | inserts outbox row in same DB transaction
  v
Notification Outbox Table
  |
  | polled by managed worker / batch / scheduler / MDB
  v
Mail Delivery Worker
  |
  | uses MailGateway
  v
JakartaEeMailGateway
  |
  | uses container-managed Session
  v
Jakarta Mail / Angus Provider / Server Provider
  |
  v
SMTP Relay / Mail Provider
```

### 20.2 Class Boundary

```text
Domain Layer
  - NotificationRequested
  - MailIntent
  - Recipient
  - TemplateCode

Application Layer
  - NotificationService
  - OutboxWriter
  - OutboxProcessor

Infrastructure Layer
  - JakartaEeMailGateway
  - JndiMailSessionProvider
  - MimeMessageFactory
  - SmtpFailureClassifier
  - TemplateRendererAdapter
```

### 20.3 Invariants

```text
1. Business use case never calls Transport.send directly.
2. SMTP config is not hardcoded in domain/application logic.
3. JNDI lookup does not leak across codebase.
4. Every email intent has stable business id.
5. Every send attempt is audited.
6. Timeout is mandatory.
7. Debug logging is disabled in production.
8. Failure is classified before retry.
9. Container-managed Session is treated as configuration, not reliability guarantee.
10. javax/jakarta namespace is consistent per deployment unit.
```

---

## 21. Java 8–25 Practical Guidance

### 21.1 Java 8 + Java EE 7/8

Common stack:

```text
Java 8
Java EE 7/8 server
javax.mail.Session
javax.annotation.Resource
javax.ejb / javax.enterprise
```

Guidance:

- use `javax.mail` consistently;
- avoid bundling incompatible Jakarta dependencies;
- use server-provided JavaMail if full EE server provides it;
- validate TLS support and provider version;
- set timeout properties explicitly.

### 21.2 Java 11/17 with Legacy Java EE Server

Risk:

- Java runtime modern;
- application server may still expose `javax` APIs;
- Java EE modules no longer part of JDK;
- dependencies must be explicit or server-provided.

Guidance:

- do not assume JDK includes mail/activation;
- align app server support matrix;
- keep namespace consistent;
- avoid mixing `jakarta.mail-api` with legacy server-provided `javax.mail`.

### 21.3 Java 17/21/25 + Jakarta EE 10/11-style Runtime

Common stack:

```text
Java 17/21/25
Jakarta EE server
jakarta.mail.Session
jakarta.annotation.Resource
jakarta.enterprise / jakarta.ejb
```

Guidance:

- use `jakarta.*` namespace consistently;
- prefer Angus Mail or server-provided compatible implementation;
- treat `jakarta.mail-api` as API, implementation as runtime/server concern;
- validate module/classpath packaging;
- use modern observability and managed concurrency.

### 21.4 Migration Rule

Migrate by boundary, not by random imports.

Bad migration:

```text
Replace imports until compile passes.
```

Good migration:

```text
1. identify runtime target
2. align server Jakarta EE version
3. align mail/activation dependencies
4. update namespace consistently
5. remove duplicate mail jars
6. validate JNDI resource type
7. run smoke test
8. run MIME/message tests
9. run failure-path tests
```

---

## 22. Anti-Patterns

### 22.1 Business Code Directly Depends on JNDI

```java
InitialContext ctx = new InitialContext();
Session session = (Session) ctx.lookup("java:comp/env/mail/NotificationSession");
Transport.send(message);
```

in every service.

Problem:

- hard to test;
- hard to migrate;
- string duplication;
- weak failure handling.

### 22.2 Sending Email Inside Transaction

Problem:

- inconsistent state;
- duplicate risk;
- slow transaction;
- rollback mismatch.

### 22.3 Assuming Container Session Handles Retry

Problem:

- retry is application concern;
- SMTP send can fail after partial success;
- provider accepted does not mean delivered.

### 22.4 Putting Credentials in WAR/EAR

Problem:

- secret rotation requires rebuild;
- source leak;
- environment coupling.

### 22.5 One Mail Session for Everything

Problem:

- blast radius;
- deliverability risk;
- audit ambiguity;
- rate limit conflict.

### 22.6 Ignoring `javax`/`jakarta` Boundary

Problem:

- classloading error;
- injection failure;
- ClassCastException;
- subtle runtime conflict.

---

## 23. Deep Design Exercise

Bayangkan aplikasi regulatory case management:

Use cases:

1. send case assignment email;
2. send enforcement notice;
3. send public applicant notification;
4. send security alert to admins;
5. read inbound appeal mailbox.

Naive design:

```text
One mail session: mail/AppMail
One sender: no-reply@example.com
Direct Transport.send from each service
No outbox
No retry classification
No audit
```

Production-grade design:

```text
mail/TransactionalNotificationSession
  - case assignment
  - applicant notification

mail/RegulatoryNoticeSession
  - enforcement notice
  - stricter audit
  - controlled sender identity

mail/SecurityAlertSession
  - admin alert
  - separate credential
  - separate rate limit

mail/InboundAppealMailboxSession
  - IMAP only
  - read mailbox
  - isolated credential
```

Architecture:

```text
CaseApprovedEvent
  -> NotificationIntent(type=CASE_APPROVED)
  -> outbox insert
  -> worker
  -> choose channel/session based on policy
  -> render template version
  -> send using gateway
  -> classify result
  -> update audit status
```

This is not overengineering. It is matching system design to risk.

---

## 24. Practical Code: Container Session Adapter

### 24.1 Domain Command

```java
public final class MailCommand {
    private final String notificationId;
    private final String from;
    private final String to;
    private final String subject;
    private final String plainText;
    private final String html;

    public MailCommand(
            String notificationId,
            String from,
            String to,
            String subject,
            String plainText,
            String html
    ) {
        this.notificationId = notificationId;
        this.from = from;
        this.to = to;
        this.subject = subject;
        this.plainText = plainText;
        this.html = html;
    }

    public String notificationId() { return notificationId; }
    public String from() { return from; }
    public String to() { return to; }
    public String subject() { return subject; }
    public String plainText() { return plainText; }
    public String html() { return html; }
}
```

### 24.2 Gateway Interface

```java
public interface MailGateway {
    void send(MailCommand command);
}
```

### 24.3 MIME Factory

```java
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.Session;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeBodyPart;
import jakarta.mail.internet.MimeMessage;
import jakarta.mail.internet.MimeMultipart;

import java.io.UnsupportedEncodingException;

public final class MimeMessageFactory {

    public MimeMessage create(Session session, MailCommand command)
            throws MessagingException, UnsupportedEncodingException {

        MimeMessage message = new MimeMessage(session);
        message.setHeader("X-Notification-Id", command.notificationId());
        message.setFrom(new InternetAddress(command.from(), "Notification System", "UTF-8"));
        message.setRecipients(Message.RecipientType.TO, InternetAddress.parse(command.to(), false));
        message.setSubject(command.subject(), "UTF-8");

        MimeBodyPart plain = new MimeBodyPart();
        plain.setText(command.plainText(), "UTF-8");

        MimeBodyPart html = new MimeBodyPart();
        html.setContent(command.html(), "text/html; charset=UTF-8");

        MimeMultipart alternative = new MimeMultipart("alternative");
        alternative.addBodyPart(plain);
        alternative.addBodyPart(html);

        message.setContent(alternative);
        message.saveChanges();

        return message;
    }
}
```

### 24.4 Jakarta EE Gateway

```java
import jakarta.mail.Session;
import jakarta.mail.Transport;
import jakarta.mail.internet.MimeMessage;

public final class JakartaEeMailGateway implements MailGateway {

    private final Session session;
    private final MimeMessageFactory factory;
    private final MailFailureClassifier classifier;

    public JakartaEeMailGateway(
            Session session,
            MimeMessageFactory factory,
            MailFailureClassifier classifier
    ) {
        this.session = session;
        this.factory = factory;
        this.classifier = classifier;
    }

    @Override
    public void send(MailCommand command) {
        try {
            MimeMessage message = factory.create(session, command);
            Transport.send(message);
        } catch (Exception e) {
            throw classifier.classify(e);
        }
    }
}
```

### 24.5 CDI Producer

```java
import jakarta.annotation.Resource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;
import jakarta.mail.Session;

@ApplicationScoped
public class MailGatewayConfiguration {

    @Resource(lookup = "java:comp/env/mail/NotificationSession")
    private Session session;

    @Produces
    @ApplicationScoped
    public MailGateway mailGateway() {
        return new JakartaEeMailGateway(
                session,
                new MimeMessageFactory(),
                new MailFailureClassifier()
        );
    }
}
```

### 24.6 Business Service

```java
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

@ApplicationScoped
public class CaseNotificationService {

    private final MailGateway mailGateway;

    @Inject
    public CaseNotificationService(MailGateway mailGateway) {
        this.mailGateway = mailGateway;
    }

    public void notifyCaseAssigned(String caseId, String officerEmail) {
        MailCommand command = new MailCommand(
                "case-assigned-" + caseId,
                "no-reply@example.com",
                officerEmail,
                "Case assigned: " + caseId,
                "A case has been assigned to you: " + caseId,
                "<p>A case has been assigned to you: <strong>" + escapeHtml(caseId) + "</strong></p>"
        );

        mailGateway.send(command);
    }

    private static String escapeHtml(String value) {
        return value
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;");
    }
}
```

Catatan:

- contoh ini masih synchronous;
- dalam production sebaiknya service menulis outbox, bukan langsung send;
- kode ini menunjukkan boundary container-managed `Session`.

---

## 25. What Top 1% Engineers Notice

Engineer biasa melihat:

```text
Container bisa inject Session. Selesai.
```

Engineer kuat melihat:

```text
Who owns SMTP config?
Who owns credentials?
What happens during rollback?
What happens if SMTP accepts but client times out?
Are javax/jakarta dependencies aligned?
Can we test without container?
Can we rotate secrets without rebuild?
Can we separate regulatory notices from bulk announcements?
Are timeout properties set?
Can ops correlate server resource logs with business notification ID?
Is recipient PII redacted?
Is mail debug disabled?
Is the JNDI name a stable capability boundary?
```

Top-level lesson:

> Jakarta EE container-managed mail is valuable not because it makes sending email easier, but because it can move configuration, credential, and environment binding out of application code. But reliability, idempotency, observability, compliance, and domain semantics still belong to your architecture.

---

## 26. Summary

Dalam Jakarta EE container:

1. `Session` bisa disediakan sebagai managed resource.
2. Aplikasi bisa inject `Session` via `@Resource` atau lookup via JNDI.
3. JNDI name harus diperlakukan sebagai capability contract.
4. Namespace `javax.mail` vs `jakarta.mail` harus konsisten.
5. Container-managed `Session` tidak otomatis memberi retry, queue, idempotency, atau transactional guarantee.
6. Email send tetap side effect eksternal.
7. Outbox pattern tetap relevan.
8. Timeout, TLS, auth, debug logging, dan secret management tetap harus dikontrol.
9. Jangan menyebar JNDI lookup di business code.
10. Gunakan gateway/adapter boundary.
11. Pisahkan mail session berdasarkan purpose jika risk, audit, rate limit, atau sender identity berbeda.
12. Observability harus menghubungkan application-level notification ID dengan infrastructure-level mail session.
13. Testing harus memisahkan domain logic dari container.
14. Production readiness membutuhkan contract antara application, platform, security, dan operations.

---

## 27. References

- Jakarta Mail 2.1 Specification and API Documentation — `Session`, `Message`, `Transport`, `Store`, `Folder` concepts.  
  `https://jakarta.ee/specifications/mail/2.1/`

- Jakarta Mail `Session` API documentation.  
  `https://jakarta.ee/specifications/mail/2.1/apidocs/jakarta.mail/jakarta/mail/session`

- Eclipse Angus Mail — compatible implementation of Jakarta Mail 2.1+.  
  `https://eclipse-ee4j.github.io/angus-mail/`

- Tomcat 10.1 JNDI Resources How-To — includes `jakarta.mail.Session` JNDI resource support.  
  `https://tomcat.apache.org/tomcat-10.1-doc/jndi-resources-howto.html`

- Payara documentation — Jakarta Mail usage and mail service administration.  
  `https://docs.payara.fish/`

- Open Liberty Jakarta Mail feature documentation.  
  `https://openliberty.io/docs/latest/reference/feature/mail-2.1.html`

---

## 28. Status Seri

Part 17 selesai.

Progress:

```text
[x] Part 0  — Orientation: Email as a Distributed System
[x] Part 1  — Email Protocol Stack: SMTP, MIME, POP3, IMAP
[x] Part 2  — JavaMail to Jakarta Mail: History, Namespace, Compatibility, Migration
[x] Part 3  — Core API: Session, Store, Folder, Transport, Message
[x] Part 4  — SMTP Sending: Properties, Transport, Timeout, TLS, Auth
[x] Part 5  — MIME Message Construction: Text, HTML, Charset, Headers
[x] Part 6  — Multipart Email: Alternative, Mixed, Related, Nested Structure
[x] Part 7  — Attachment Handling and Jakarta Activation
[x] Part 8  — HTML Email Engineering: Templates, CSS, Images, Client Compatibility
[x] Part 9  — Mail Addressing, Identity, and Header Semantics
[x] Part 10 — Error Model: MessagingException, SendFailedException, SMTPAddressFailedException
[x] Part 11 — Reliable Email Delivery Architecture: Queue, Outbox, Retry, Idempotency
[x] Part 12 — Bulk, Batch, and Rate-Limited Sending
[x] Part 13 — Security Deep Dive: TLS, Credential, OAuth2, Secret Management
[x] Part 14 — Deliverability Fundamentals: SPF, DKIM, DMARC, Reputation, Bounce
[x] Part 15 — Inbound Mail: IMAP/POP3, Store, Folder, Message Reading
[x] Part 16 — MIME Parsing: Reading Complex Messages Safely
[x] Part 17 — Jakarta Mail in Jakarta EE Containers
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

Seri belum selesai. Part berikutnya: **Part 18 — Jakarta Mail in Spring Boot and Modern Java Applications**.


<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 16 — MIME Parsing: Reading Complex Messages Safely](./16-mime-parsing-safe-message-ingestion.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 18 — Jakarta Mail in Spring Boot and Modern Java Applications](./18-spring-boot-modern-java-mail-integration.md)
