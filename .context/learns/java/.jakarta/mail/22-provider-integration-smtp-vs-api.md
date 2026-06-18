# Part 22 — Provider Integration Patterns: SMTP Relay vs API-Based Email Provider

> Series: `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery`  
> File: `22-provider-integration-smtp-vs-api.md`  
> Scope: Java 8 sampai Java 25, JavaMail/Jakarta Mail, SMTP relay, provider HTTP API, adapter architecture, routing, failover, compliance, dan operational design.

---

## 0. Posisi Part Ini Dalam Seri

Sampai Part 21, kita sudah membangun fondasi berikut:

1. email adalah distributed system, bukan sekadar helper utility;
2. SMTP, MIME, POP3, IMAP, envelope, header, body, dan multipart sudah dipahami;
3. JavaMail/Jakarta Mail sudah diposisikan sebagai abstraction untuk message construction, SMTP sending, dan mailbox access;
4. kita sudah membahas reliability dengan outbox, retry, idempotency, state machine, observability, dan performance;
5. kita sudah memahami bahwa `SMTP accepted` bukan berarti `delivered to inbox`;
6. kita juga sudah membahas deliverability, security, testing, dan resource management.

Part ini membahas pertanyaan arsitektural yang sering muncul setelah engineer sudah bisa mengirim email secara teknis:

> Haruskah aplikasi enterprise memakai SMTP relay via Jakarta Mail, atau memakai HTTP API provider seperti SES/SendGrid/Mailgun/Postmark-style provider?

Jawaban pendeknya: **jangan mulai dari library; mulai dari boundary, telemetry, compliance, failure model, dan operability.**

Jakarta Mail tetap sangat penting karena:

- ia adalah standard abstraction untuk membangun internet mail message di Java;
- ia portable terhadap SMTP provider;
- ia sangat berguna untuk MIME, attachment, multipart, charset, dan header control;
- ia cocok untuk enterprise system yang memiliki SMTP relay internal.

Tetapi API provider juga penting karena banyak production-grade capability tidak selalu tersedia secara baik melalui SMTP:

- delivery event webhook;
- bounce/complaint classification;
- suppression list;
- analytics;
- template provider-side;
- domain management;
- reputation tooling;
- quota dashboard;
- event stream;
- structured error response.

Part ini bukan “SMTP buruk, API bagus” atau “API vendor lock-in, SMTP selalu benar”. Part ini membangun mental model untuk memilih, menggabungkan, dan mengabstraksikan keduanya secara dewasa.

---

## 1. Core Mental Model: Mail Provider Bukan Sekadar Transport

Dalam desain pemula, mail provider dianggap seperti ini:

```text
Application -> SMTP/API -> Recipient
```

Model ini terlalu miskin.

Dalam production, mail provider lebih tepat dilihat sebagai kombinasi dari beberapa capability:

```text
Application
  -> Message construction
  -> Authentication boundary
  -> Transport endpoint
  -> Queueing / acceptance
  -> Provider policy engine
  -> Reputation / deliverability infrastructure
  -> Recipient domain negotiation
  -> Bounce / complaint feedback
  -> Analytics / event reporting
  -> Suppression / compliance controls
```

SMTP relay dan API provider sama-sama bisa mengirim email, tetapi mereka berbeda dalam **control plane** dan **feedback plane**.

### 1.1 Data Plane vs Control Plane vs Feedback Plane

Untuk mail subsystem, pisahkan menjadi tiga plane:

| Plane | Pertanyaan | Contoh |
|---|---|---|
| Data plane | Bagaimana message dikirim? | SMTP `DATA`, HTTP `/send`, raw MIME upload |
| Control plane | Bagaimana konfigurasi, quota, domain, credential, policy dikelola? | verified domain, sender identity, API key, rate limit, suppression |
| Feedback plane | Bagaimana aplikasi tahu apa yang terjadi setelah send accepted? | bounce webhook, delivery event, complaint, reject, open/click event |

SMTP terutama kuat di **data plane**. API provider biasanya lebih kuat di **control plane** dan **feedback plane**.

Top engineer tidak hanya bertanya:

> “Bisa kirim email atau tidak?”

Tetapi bertanya:

> “Setelah aplikasi menyerahkan email, bagaimana sistem mengetahui statusnya, mengendalikan risiko, mengaudit event, menghindari retry storm, dan menjaga reputasi domain?”

---

## 2. SMTP Relay Pattern

SMTP relay pattern adalah pola di mana aplikasi mengirim email ke server SMTP, kemudian SMTP server/provider melanjutkan pengiriman ke recipient domain.

```text
+-------------+       SMTP        +--------------+       SMTP        +------------------+
| Java App    | ----------------> | SMTP Relay   | ----------------> | Recipient MX     |
| JakartaMail |                   | Provider/MTA |                   | Gmail/Outlook/etc|
+-------------+                   +--------------+                   +------------------+
```

Dalam Java, ini biasanya memakai:

- `javax.mail` untuk Java 8 legacy;
- `jakarta.mail` untuk Jakarta EE / Spring Boot 3+ / Java 11+ modern;
- SMTP provider implementation seperti Eclipse Angus Mail;
- `Session`, `Transport`, `MimeMessage`, `MimeMultipart`, `DataHandler`.

### 2.1 Bentuk Integrasi SMTP

Ada beberapa varian SMTP relay:

#### A. Internal corporate SMTP relay

```text
Java App -> internal SMTP relay -> external recipient
```

Biasanya dipakai di enterprise/government/corporate network.

Karakteristik:

- credential kadang tidak langsung berada di aplikasi;
- allowlist IP/subnet bisa dipakai;
- routing dikendalikan tim infra/security;
- audit bisa dilakukan di relay internal;
- aplikasi tidak langsung expose ke provider publik.

Cocok untuk:

- enterprise dengan policy ketat;
- on-premise/hybrid network;
- sistem yang harus memakai mail gateway resmi organisasi;
- aplikasi internal.

Risiko:

- observability dari aplikasi terbatas;
- bounce feedback sering tidak otomatis kembali ke aplikasi;
- troubleshooting melibatkan tim infra;
- quota/rate limit kadang tidak terlihat jelas;
- change management lebih lambat.

#### B. Cloud SMTP endpoint

```text
Java App -> smtp.provider.com:587 -> provider -> recipient
```

Contoh pola: SES SMTP endpoint, SendGrid SMTP relay, Mailgun SMTP endpoint, corporate managed relay.

Karakteristik:

- portable dengan Jakarta Mail;
- provider public memegang reputation/deliverability infrastructure;
- credentials biasanya SMTP username/password atau generated credential;
- bisa dipakai tanpa vendor SDK.

Cocok untuk:

- transactional email sederhana;
- aplikasi yang ingin standard protocol;
- migrasi cepat dari legacy JavaMail;
- vendor portability.

Risiko:

- structured response terbatas;
- provider event feedback perlu mekanisme terpisah;
- partial failure handling tetap tricky;
- debugging bergantung pada SMTP transcript dan dashboard provider.

#### C. Direct-to-MX SMTP

```text
Java App -> recipient MX directly
```

Ini jarang cocok untuk enterprise application.

Masalah:

- harus mengelola DNS, reputation, DKIM, bounce, retry, queue, greylisting;
- IP reputation sulit;
- recipient server policy bervariasi;
- anti-spam filtering sangat kompleks;
- operability berat.

Untuk aplikasi enterprise normal, direct-to-MX sebaiknya dihindari kecuali memang sedang membangun MTA/mail infrastructure.

---

## 3. API-Based Email Provider Pattern

API provider pattern adalah pola di mana aplikasi memanggil HTTP API provider untuk mengirim email.

```text
+-------------+       HTTPS       +-------------------+      Mail Network      +-------------+
| Java App    | ----------------> | Email Provider API| --------------------> | Recipient   |
| HTTP Client |                   | SES/SendGrid/etc  |                       | Mailbox     |
+-------------+                   +-------------------+                       +-------------+
```

Provider API biasanya menerima salah satu bentuk input:

1. structured JSON:
   - from,
   - to,
   - subject,
   - text,
   - html,
   - attachments,
   - template id,
   - custom args;
2. raw MIME message:
   - aplikasi membangun MIME sendiri lalu upload;
3. hybrid:
   - template provider-side + dynamic variables.

### 3.1 Apa yang API Provider Berikan Selain Send?

API provider sering memberikan capability berikut:

- request id / message id provider;
- structured error response;
- quota/rate limit headers;
- delivery webhooks;
- bounce webhooks;
- complaint webhooks;
- suppression list;
- unsubscribe management;
- domain verification;
- DKIM setup;
- IP pool;
- analytics;
- template management;
- event search;
- test mode / sandbox;
- inbound parse webhook.

Ini bukan hanya “cara lain untuk mengirim email”, tetapi **platform capability**.

### 3.2 API Provider Bukan Selalu Lebih Baik

API provider juga memiliki trade-off:

- vendor lock-in;
- SDK churn;
- provider-specific event format;
- data residency concern;
- compliance review lebih berat;
- API schema berbeda antar vendor;
- template provider-side bisa membuat audit/re-rendering lebih rumit;
- retry semantics perlu hati-hati karena HTTP timeout bisa berarti unknown outcome.

Salah satu kesalahan desain adalah mengganti SMTP dengan API, lalu menganggap reliability otomatis selesai. Tidak. API juga bisa timeout, rate-limited, partially fail, menerima request tetapi deliverability gagal, atau mengirim duplicate jika retry tidak idempotent.

---

## 4. Comparison: SMTP Relay vs Provider API

### 4.1 High-Level Comparison

| Dimension | SMTP Relay | Provider HTTP API |
|---|---|---|
| Standardization | Sangat standard | Vendor-specific |
| Java integration | Native dengan Jakarta Mail | HTTP client/SDK/custom adapter |
| MIME control | Sangat tinggi | Bervariasi; raw MIME kadang tersedia |
| Structured error | Terbatas | Biasanya lebih baik |
| Delivery event | Tidak inherent | Biasanya tersedia via webhook/event API |
| Bounce management | Perlu mailbox/webhook terpisah | Biasanya built-in |
| Portability | Lebih tinggi | Lebih rendah |
| Provider features | Terbatas pada SMTP | Banyak fitur tambahan |
| Observability | Perlu dibangun sendiri | Biasanya lebih kaya |
| Compliance review | Tergantung relay | Tergantung provider/data transfer |
| Rate limit visibility | Kadang kurang eksplisit | Umumnya eksplisit |
| Authentication | SMTP auth/TLS/OAuth2 | API key/OAuth/signature |
| Failure semantics | SMTP reply code | HTTP status + provider error code |
| Test mode | Perlu fake SMTP | Sering ada sandbox/test mode |

### 4.2 Keputusan Arsitektur yang Lebih Presisi

Jangan bertanya:

> “Mana yang lebih bagus?”

Tanya:

1. Apakah kita butuh provider delivery event?
2. Apakah bounce/complaint harus masuk ke state bisnis?
3. Apakah domain reputation dikelola oleh tim aplikasi, tim infra, atau provider?
4. Apakah kita punya corporate SMTP relay yang wajib dipakai?
5. Apakah data boleh keluar ke provider tertentu?
6. Apakah email berisi PII/sensitive attachment?
7. Apakah traffic transactional atau bulk?
8. Apakah perlu tenant-specific sender domain?
9. Apakah perlu failover provider?
10. Apakah audit memerlukan raw MIME snapshot?
11. Apakah provider-side template boleh dipakai?
12. Apakah sistem harus portable antar vendor?

---

## 5. Decision Matrix

### 5.1 Pilih SMTP Relay Jika...

SMTP relay lebih cocok jika:

1. organisasi sudah memiliki SMTP gateway resmi;
2. compliance mewajibkan semua email keluar lewat gateway internal;
3. aplikasi butuh MIME control penuh;
4. volume rendah sampai sedang;
5. feedback delivery tidak terlalu detail;
6. mail status cukup sampai `ACCEPTED_BY_RELAY`;
7. integrasi legacy JavaMail sudah stabil;
8. vendor lock-in harus minimal;
9. aplikasi berjalan di Jakarta EE container dengan managed mail session;
10. email bersifat internal/corporate notification.

Contoh use case:

- notifikasi internal approval;
- system alert ke distribution list;
- government/corporate application yang harus route lewat mail gateway;
- aplikasi legacy Java 8 yang stabil dengan `javax.mail`.

### 5.2 Pilih Provider API Jika...

Provider API lebih cocok jika:

1. delivery feedback penting;
2. bounce/complaint harus masuk ke suppression list;
3. volume tinggi;
4. traffic bulk/campaign-like;
5. perlu analytics dan dashboard;
6. perlu template provider-side;
7. perlu webhook event stream;
8. perlu provider-managed DKIM/domain tooling;
9. perlu inbound parse webhook;
10. perlu structured error dan provider message id;
11. perlu multi-region/provider routing;
12. engineering team siap mengelola vendor adapter.

Contoh use case:

- customer transactional email berskala besar;
- onboarding/verification/OTP-like email;
- billing invoice notification;
- multi-tenant SaaS email;
- product lifecycle email;
- workflow notification yang memerlukan delivery/bounce tracking.

### 5.3 Pilih Hybrid Jika...

Hybrid berarti sistem mendukung lebih dari satu transport:

```text
MailGateway
  ├── SmtpMailGateway
  ├── SesApiMailGateway
  ├── SendGridApiMailGateway
  └── Null/TestMailGateway
```

Hybrid cocok jika:

- ada lingkungan berbeda: DEV pakai fake SMTP, UAT pakai SMTP relay, PROD pakai provider API;
- ada tenant/domain berbeda;
- ada fallback provider;
- ada migration path dari SMTP ke API;
- beberapa email internal harus lewat SMTP, customer email lewat API;
- regulatory routing berbeda per data class.

Hybrid bukan berarti aplikasi bebas memilih provider secara random. Hybrid harus dikontrol oleh routing policy yang jelas.

---

## 6. The Right Abstraction: Do Not Leak Provider Into Domain

Domain layer tidak seharusnya tahu apakah email dikirim via SMTP, SES, SendGrid, Mailgun, atau internal gateway.

Domain layer biasanya hanya tahu:

```text
A business event requires a notification.
```

Contoh:

```text
CaseApproved
  -> NotificationRequested
  -> EmailSendRequested
  -> MailGateway sends
```

### 6.1 Bad Design

```java
public class CaseService {
    private final SendGrid sendGrid;

    public void approveCase(CaseId id) {
        // update case
        // build sendgrid request
        // call sendgrid directly
    }
}
```

Masalah:

- domain service tergantung vendor;
- sulit testing;
- sulit migrasi provider;
- retry/outbox sulit;
- audit tersebar;
- provider exception bocor ke business layer;
- sending bisa terjadi di dalam transaction boundary.

### 6.2 Better Design

```java
public interface NotificationCommandPort {
    void requestEmail(EmailNotificationCommand command);
}
```

Domain hanya membuat intent:

```java
public final class EmailNotificationCommand {
    private final String businessEventId;
    private final String templateCode;
    private final List<Recipient> recipients;
    private final Map<String, Object> variables;
    private final NotificationPriority priority;
    private final String idempotencyKey;
}
```

Infrastructure kemudian menyimpan outbox:

```text
email_outbox
  id
  idempotency_key
  template_code
  recipient_snapshot
  variable_snapshot
  status
  attempt_count
  next_attempt_at
  provider_route
  provider_message_id
  last_error_code
  created_at
  updated_at
```

Worker memanggil abstraction:

```java
public interface MailGateway {
    SendResult send(PreparedEmail email) throws MailGatewayException;
}
```

Adapter provider berada di boundary:

```text
Application/Worker
  -> MailGateway interface
      -> SmtpMailGateway
      -> ProviderApiMailGateway
```

---

## 7. Canonical Domain Model for Provider-Neutral Email

Agar provider bisa diganti, sistem perlu canonical model. Tetapi canonical model juga tidak boleh terlalu miskin.

### 7.1 Core Model

```java
public final class PreparedEmail {
    private final EmailIdentity from;
    private final List<EmailRecipient> to;
    private final List<EmailRecipient> cc;
    private final List<EmailRecipient> bcc;
    private final EmailAddress replyTo;
    private final String subject;
    private final EmailBody body;
    private final List<EmailAttachment> attachments;
    private final Map<String, String> headers;
    private final Map<String, String> metadata;
    private final String idempotencyKey;
    private final String tenantId;
    private final EmailSensitivity sensitivity;
}
```

### 7.2 Body Model

```java
public final class EmailBody {
    private final String text;
    private final String html;
    private final List<InlineResource> inlineResources;
}
```

### 7.3 Attachment Model

```java
public final class EmailAttachment {
    private final String filename;
    private final String contentType;
    private final long sizeBytes;
    private final AttachmentContentRef contentRef;
    private final AttachmentDisposition disposition;
}
```

### 7.4 Send Result Model

```java
public sealed interface SendResult permits Accepted, Rejected, Unknown {
}

public final class Accepted implements SendResult {
    private final String provider;
    private final String providerMessageId;
    private final Instant acceptedAt;
    private final Map<String, String> providerAttributes;
}

public final class Rejected implements SendResult {
    private final String provider;
    private final MailFailureCategory category;
    private final boolean retryable;
    private final String providerCode;
    private final String providerMessage;
}

public final class Unknown implements SendResult {
    private final String provider;
    private final String reason;
    private final boolean safeToRetry;
}
```

Untuk Java 8, sealed interface diganti interface biasa + class hierarchy.

### 7.5 Failure Category

```java
public enum MailFailureCategory {
    AUTHENTICATION_FAILED,
    AUTHORIZATION_FAILED,
    RATE_LIMITED,
    PROVIDER_UNAVAILABLE,
    NETWORK_TIMEOUT,
    INVALID_RECIPIENT,
    CONTENT_REJECTED,
    ATTACHMENT_TOO_LARGE,
    POLICY_REJECTED,
    DOMAIN_NOT_VERIFIED,
    TEMPORARY_RECIPIENT_FAILURE,
    PERMANENT_RECIPIENT_FAILURE,
    UNKNOWN_OUTCOME
}
```

Canonical failure model membuat worker tidak tergantung apakah failure berasal dari:

- SMTP code `421`, `450`, `550`, `552`, `554`;
- HTTP `400`, `401`, `403`, `413`, `429`, `500`, `503`;
- provider-specific error code;
- socket timeout;
- TLS handshake error.

---

## 8. SMTP Adapter Design

SMTP adapter menggunakan Jakarta Mail untuk mengirim `PreparedEmail`.

```text
PreparedEmail
  -> MimeMessageFactory
  -> MimeMessage
  -> SmtpMailGateway
  -> Transport
  -> SendResult
```

### 8.1 Responsibility Split

Jangan campur semua logic di satu class.

```text
SmtpMailGateway
  - obtains Transport
  - sends message
  - maps exceptions

MimeMessageFactory
  - builds MimeMessage
  - sets headers
  - builds multipart
  - attaches files

SmtpFailureMapper
  - maps MessagingException to canonical failure

MailConfig
  - host, port, tls, auth, timeouts
```

### 8.2 Example Interface

```java
public final class SmtpMailGateway implements MailGateway {
    private final Session session;
    private final MimeMessageFactory messageFactory;
    private final SmtpFailureMapper failureMapper;

    @Override
    public SendResult send(PreparedEmail email) {
        try {
            MimeMessage message = messageFactory.create(session, email);
            Transport.send(message);
            return new Accepted(
                "smtp",
                extractMessageId(message),
                Instant.now(),
                Map.of("protocol", "smtp")
            );
        } catch (MessagingException ex) {
            return failureMapper.map(ex);
        }
    }
}
```

Catatan:

- Untuk Java 8, ganti `Map.of` dengan `Collections.singletonMap` atau builder.
- Untuk high throughput, manual `Transport` lifecycle bisa dipakai agar connection reuse lebih eksplisit.
- Jangan menyimpan raw recipient PII dalam `providerAttributes` tanpa redaction policy.

### 8.3 SMTP Adapter Strength

SMTP adapter kuat ketika:

- butuh MIME control penuh;
- ingin portability;
- relay internal sudah disediakan;
- provider API tidak boleh dipakai;
- aplikasi harus tetap simple.

### 8.4 SMTP Adapter Weakness

SMTP adapter lemah ketika:

- perlu delivery event detail;
- perlu suppression list integrated;
- perlu analytics;
- perlu provider-specific feature;
- perlu structured event webhook;
- perlu template provider-side;
- perlu strong idempotency dari provider.

---

## 9. HTTP API Adapter Design

API adapter memakai HTTP client/SDK untuk mengirim email.

```text
PreparedEmail
  -> ProviderRequestMapper
  -> HTTP request / SDK request
  -> Provider response
  -> SendResult
```

### 9.1 Responsibility Split

```text
ProviderApiMailGateway
  - calls HTTP/SDK
  - handles timeout/retry boundary
  - maps response

ProviderRequestMapper
  - maps PreparedEmail to provider-specific request

ProviderFailureMapper
  - maps HTTP/provider errors to canonical failure

ProviderWebhookHandler
  - handles async delivery events
```

### 9.2 Example Skeleton

```java
public final class ProviderApiMailGateway implements MailGateway {
    private final EmailProviderClient client;
    private final ProviderRequestMapper requestMapper;
    private final ProviderFailureMapper failureMapper;

    @Override
    public SendResult send(PreparedEmail email) {
        ProviderSendRequest request = requestMapper.toRequest(email);

        try {
            ProviderSendResponse response = client.send(request);
            return new Accepted(
                response.providerName(),
                response.messageId(),
                Instant.now(),
                response.attributes()
            );
        } catch (ProviderHttpException ex) {
            return failureMapper.mapHttpError(ex);
        } catch (SocketTimeoutException ex) {
            return new Unknown(
                "provider-api",
                "HTTP timeout before response was received",
                true
            );
        }
    }
}
```

### 9.3 Important: HTTP Timeout Can Mean Unknown Outcome

Jika aplikasi memanggil provider API lalu timeout sebelum menerima response, kemungkinan yang terjadi:

1. request tidak sampai provider;
2. request sampai provider tapi belum diproses;
3. request diproses dan email accepted, tetapi response hilang;
4. provider accepted lalu webhook akan datang kemudian.

Karena itu HTTP timeout tidak selalu aman diklasifikasikan sebagai “failed”. Lebih tepat:

```text
UNKNOWN_OUTCOME
```

Strategi:

- gunakan idempotency key jika provider mendukung;
- simpan provider request id jika tersedia;
- cek event API/provider logs jika memungkinkan;
- retry dengan dedupe guard;
- jangan langsung mengirim ulang tanpa idempotency jika risiko duplicate mahal.

---

## 10. Raw MIME via API: Best of Both Worlds?

Beberapa provider API mendukung pengiriman raw MIME. Polanya:

```text
PreparedEmail
  -> Jakarta Mail MimeMessage
  -> writeTo(OutputStream)
  -> provider API raw MIME send
```

Ini menarik karena:

- aplikasi tetap memakai Jakarta Mail untuk MIME construction;
- provider API tetap memberi event/webhook/analytics;
- MIME fidelity lebih terkontrol;
- attachment/inline/headers bisa dibangun standard.

### 10.1 Raw MIME Adapter

```java
public final class RawMimeApiMailGateway implements MailGateway {
    private final Session session;
    private final MimeMessageFactory messageFactory;
    private final RawMimeProviderClient client;

    @Override
    public SendResult send(PreparedEmail email) {
        try {
            MimeMessage message = messageFactory.create(session, email);

            ByteArrayOutputStream out = new ByteArrayOutputStream();
            message.writeTo(out);

            RawMimeSendResponse response = client.sendRawMime(
                email.getIdempotencyKey(),
                out.toByteArray()
            );

            return new Accepted(
                response.provider(),
                response.messageId(),
                Instant.now(),
                response.attributes()
            );
        } catch (Exception ex) {
            // map carefully
        }
    }
}
```

### 10.2 Memory Warning

`ByteArrayOutputStream` membuat seluruh MIME message berada di heap. Untuk email dengan attachment besar, ini berbahaya.

Alternatif:

- stream to temporary file;
- use provider SDK streaming upload jika tersedia;
- enforce max raw MIME size;
- store attachments externally and use secure links instead of large attachments.

### 10.3 When Raw MIME API Is Good

Raw MIME API bagus jika:

- aplikasi butuh MIME control penuh;
- provider API memiliki raw MIME endpoint;
- attachment size terkendali;
- sistem butuh provider event feedback;
- template rendering tetap di aplikasi untuk audit.

---

## 11. Template Placement: Application-Side vs Provider-Side

Salah satu keputusan terbesar dalam provider integration adalah: template disimpan di aplikasi atau provider?

### 11.1 Application-Side Template

```text
Application renders HTML/text
  -> sends final content to SMTP/API
```

Kelebihan:

- audit lebih mudah;
- versioning bisa ikut release aplikasi;
- test bisa dijalankan di CI;
- provider-neutral;
- sensitive logic tidak tersebar;
- re-rendering old email lebih terkendali jika snapshot disimpan.

Kekurangan:

- marketing/non-engineer sulit mengubah template;
- preview tooling harus dibangun sendiri;
- personalization analytics terbatas;
- multi-language template management perlu dirancang.

### 11.2 Provider-Side Template

```text
Application sends template id + variables
  -> provider renders
```

Kelebihan:

- provider dashboard/preview;
- non-engineer bisa manage template;
- provider analytics bisa lebih kaya;
- A/B testing mungkin tersedia;
- payload lebih kecil.

Kekurangan:

- vendor lock-in;
- audit lebih rumit;
- template state berada di luar application release;
- variable schema drift;
- sulit memastikan template versi yang dipakai jika tidak disimpan;
- compliance review bisa lebih kompleks;
- rollback bisa tidak sinkron dengan application logic.

### 11.3 Recommended Rule

Untuk enterprise/regulatory transactional email:

```text
Default: render template in application, store template version + variable snapshot + rendered snapshot if required.
```

Provider-side template bisa dipakai untuk:

- marketing/campaign;
- low-risk notification;
- team yang memang punya governance template di provider;
- provider features yang memang dibutuhkan.

Untuk regulatory-grade system, provider-side template hanya aman jika ada:

- template version pinning;
- approval workflow;
- immutable audit record;
- export/backup;
- environment separation;
- access control;
- change log.

---

## 12. Provider Routing Architecture

Jika sistem mendukung lebih dari satu provider, perlu routing policy.

### 12.1 Routing Dimensions

Provider bisa dipilih berdasarkan:

| Dimension | Example |
|---|---|
| Environment | DEV fake SMTP, UAT internal relay, PROD provider API |
| Tenant | Tenant A via domain A/provider A, tenant B via provider B |
| Email type | OTP via provider fast lane, report email via SMTP relay |
| Sensitivity | PII email via internal relay only |
| Region | SG recipient via APAC provider route |
| Volume | Bulk via provider API, low-volume internal via SMTP |
| Compliance | Government domain via approved relay |
| Failover state | primary provider down -> secondary provider |

### 12.2 Routing Policy Interface

```java
public interface MailRouteResolver {
    MailRoute resolve(PreparedEmail email);
}

public final class MailRoute {
    private final String routeId;
    private final String gatewayName;
    private final String providerAccountId;
    private final String senderDomain;
    private final boolean allowFailover;
}
```

### 12.3 Example Routing Table

```text
mail_route_policy
  id
  tenant_id
  email_category
  sensitivity
  sender_domain
  primary_gateway
  secondary_gateway
  max_rate_per_minute
  allowed_regions
  enabled
```

### 12.4 Route Resolution Order

Suggested precedence:

```text
1. explicit business override
2. sensitivity/compliance constraint
3. tenant policy
4. email category policy
5. region/data residency policy
6. provider health state
7. default route
```

Important invariant:

> Failover must never violate compliance routing.

Jika email sensitive hanya boleh lewat internal relay, jangan failover ke provider publik hanya karena internal relay down.

---

## 13. Multi-Tenant Sender Architecture

Dalam SaaS atau multi-agency system, sender identity bisa berbeda per tenant.

```text
Tenant A -> noreply@agency-a.example
Tenant B -> noreply@agency-b.example
Tenant C -> noreply@platform.example
```

### 13.1 Problems

Multi-tenant sender menimbulkan isu:

- domain verification;
- DKIM key per domain;
- SPF alignment;
- DMARC alignment;
- sender authorization;
- tenant spoofing prevention;
- reply routing;
- bounce routing;
- quota per tenant;
- reputation isolation;
- template branding;
- data residency.

### 13.2 Sender Authorization Invariant

Jangan biarkan caller menentukan raw `From` sembarangan.

Bad:

```java
email.setFrom(request.getFrom());
```

Better:

```java
EmailIdentity from = senderPolicy.resolveSender(
    tenantId,
    emailCategory,
    requestedSenderAlias
);
```

Policy harus memastikan:

```text
tenant_id + category + sender_alias -> verified sender identity
```

### 13.3 Sender Registry

```text
sender_identity
  id
  tenant_id
  domain
  email_address
  display_name
  provider
  provider_identity_id
  dkim_status
  spf_status
  dmarc_policy
  enabled
  created_at
  updated_at
```

### 13.4 Cross-Tenant Safety

Invariants:

1. Tenant A tidak boleh mengirim dari domain Tenant B.
2. Tenant tidak boleh override Return-Path tanpa policy.
3. Display name harus disanitasi dari CRLF/header injection.
4. Reply-To harus masuk allowlist.
5. Domain belum verified tidak boleh dipakai.
6. Provider route harus match sender domain.

---

## 14. Failover Provider: Powerful but Dangerous

Failover terdengar menarik:

```text
Primary provider down -> use secondary provider
```

Tetapi mail failover sulit karena risiko duplicate, domain alignment, reputation, template mismatch, dan compliance.

### 14.1 Failure Cases

| Scenario | Failover Safe? | Notes |
|---|---:|---|
| Provider returns 401 auth failed | No | likely config/secret issue; failover may hide incident |
| Provider returns 403 domain not verified | No | secondary may also violate policy |
| Provider timeout before response | Dangerous | outcome unknown; duplicate risk |
| Provider 429 rate limit | Maybe | if secondary route approved and dedupe safe |
| Provider 503 unavailable before accept | Maybe | if no acceptance occurred |
| SMTP accepted but later bounce | No immediate failover | bounce is delivery feedback, not send failure |
| Content rejected | Usually no | provider/content policy issue |

### 14.2 Failover Requires State

A robust outbox needs fields like:

```text
attempt_id
route_id
provider
provider_request_id
provider_message_id
attempt_started_at
attempt_completed_at
outcome
unknown_outcome
failover_eligible
```

Without attempt-level state, failover can create duplicate email without traceability.

### 14.3 Failover Policy

```java
public interface FailoverPolicy {
    FailoverDecision decide(
        PreparedEmail email,
        MailRoute currentRoute,
        SendResult result,
        AttemptHistory history
    );
}
```

Decision values:

```text
NO_FAILOVER
FAILOVER_NOW
RETRY_PRIMARY_LATER
WAIT_FOR_OUTCOME_RECONCILIATION
MARK_PERMANENT_FAILURE
ESCALATE_MANUAL_REVIEW
```

### 14.4 Practical Recommendation

For most enterprise systems:

1. Start with no automatic cross-provider failover.
2. Implement clear route health and alerting.
3. Implement manual route switch for approved categories.
4. Add automatic failover only for categories where duplicates are tolerable or idempotency is strong.
5. Never failover sensitive/regulatory email unless explicitly approved.

---

## 15. Idempotency Across Providers

Idempotency is harder with external providers.

### 15.1 Application-Level Idempotency

Use idempotency key based on business intent:

```text
case-approved:{caseId}:{recipientId}:{templateVersion}
```

Store it in outbox unique constraint:

```sql
CREATE UNIQUE INDEX uk_email_outbox_idempotency
ON email_outbox(idempotency_key);
```

This prevents duplicate intent creation.

### 15.2 Provider-Level Idempotency

Some providers support idempotency key or custom args; some do not.

If provider supports idempotency header/key:

```text
Idempotency-Key: <application idempotency key>
```

If not, use:

- custom header: `X-App-Notification-Id`;
- custom metadata/args;
- provider message id mapping;
- webhook correlation.

### 15.3 Unknown Outcome Problem

If send attempt outcome is unknown:

```text
APPLICATION -> Provider API
APPLICATION times out
Provider may or may not have accepted
```

Do not immediately mark as failed. Better:

```text
UNKNOWN_OUTCOME
  -> wait/reconcile if possible
  -> retry only if duplicate acceptable or idempotency supported
```

### 15.4 Email-Level Duplicate Prevention

Even with app idempotency, duplicates can occur if:

- first send accepted but response lost;
- retry uses different provider;
- provider does not dedupe;
- worker crashes after send before DB update;
- manual replay is done incorrectly.

Mitigations:

- outbox attempt state;
- provider idempotency if available;
- unique business notification id in header;
- short reconciliation delay for unknown outcome;
- manual review for high-impact email;
- suppress duplicate within business window.

---

## 16. Webhook Integration Pattern

Provider API becomes truly useful when delivery events are integrated.

```text
Provider -> Webhook Endpoint -> Verify Signature -> Normalize Event -> Update Notification State
```

### 16.1 Webhook Event Types

Common events:

- accepted;
- delivered;
- deferred;
- bounced;
- complained;
- dropped;
- rejected;
- opened;
- clicked;
- unsubscribed;
- suppressed.

Not all systems need open/click events. For privacy-sensitive/regulatory systems, tracking opens/clicks may be disabled or avoided.

### 16.2 Webhook Handler Pipeline

```text
HTTP receive
  -> authenticate/verify signature
  -> parse event
  -> validate provider account/tenant
  -> normalize event
  -> deduplicate event
  -> persist raw event safely
  -> update delivery state
  -> trigger downstream action if needed
```

### 16.3 Normalized Event Model

```java
public final class MailProviderEvent {
    private final String provider;
    private final String providerEventId;
    private final String providerMessageId;
    private final String applicationNotificationId;
    private final MailEventType type;
    private final Instant occurredAt;
    private final String recipientHash;
    private final Map<String, String> attributes;
}
```

### 16.4 Event Deduplication

Provider webhooks are often at-least-once.

Use unique key:

```text
provider + provider_event_id
```

If provider event id is not available:

```text
provider + provider_message_id + event_type + recipient + occurred_at_bucket
```

### 16.5 State Transition Example

```text
PENDING
  -> ACCEPTED_BY_PROVIDER
  -> DELIVERED
```

or:

```text
PENDING
  -> ACCEPTED_BY_PROVIDER
  -> DEFERRED
  -> DELIVERED
```

or:

```text
PENDING
  -> ACCEPTED_BY_PROVIDER
  -> BOUNCED_HARD
  -> SUPPRESSED
```

### 16.6 Do Not Trust Webhook Blindly

Security checklist:

- verify signature;
- validate timestamp/replay window;
- validate provider account/domain;
- store raw payload with redaction/encryption policy;
- never expose webhook endpoint without auth/signature check;
- reject oversized payload;
- handle duplicate event idempotently;
- avoid logging full email addresses if policy forbids.

---

## 17. Suppression List Integration

A suppression list prevents sending to recipients that should no longer receive mail.

Reasons:

- hard bounce;
- spam complaint;
- unsubscribe;
- admin block;
- legal request;
- invalid address;
- user preference.

### 17.1 Application vs Provider Suppression

| Location | Strength | Weakness |
|---|---|---|
| Provider suppression | prevents provider send | vendor-specific; may not cover all providers |
| Application suppression | provider-neutral; business-aware | must be enforced before every route |
| Both | strongest | sync complexity |

### 17.2 Application Suppression Table

```text
mail_suppression
  id
  recipient_hash
  normalized_email_encrypted
  reason
  scope
  tenant_id
  source
  effective_from
  expires_at
  created_at
```

Scope examples:

```text
GLOBAL
TENANT
CATEGORY
PROVIDER
DOMAIN
```

### 17.3 Enforcement Point

Suppression must run before provider send:

```text
Outbox Worker
  -> load email
  -> evaluate suppression
  -> if suppressed, mark SUPPRESSED_NOT_SENT
  -> else send
```

Do not rely only on provider suppression if system supports multiple providers.

---

## 18. Rate Limit and Quota Across Providers

Provider limits can exist at many levels:

- account daily quota;
- per-second send rate;
- API request rate;
- recipient/domain throttling;
- SMTP connection limit;
- concurrent connection limit;
- attachment size limit;
- message size limit;
- sandbox limit;
- tenant-level quota.

AWS SES, for example, documents sending quotas and sandbox limits; sandbox accounts have strict limits like 200 messages per 24 hours and one message per second until production access is granted. Provider quotas differ and can change, so always verify official docs for the selected provider.

### 18.1 Central Rate Limiter

If system supports multiple providers, rate limiting should not be buried inside each adapter only.

```text
Worker
  -> RouteResolver
  -> RateLimiter(route/provider/tenant/category)
  -> MailGateway
```

### 18.2 Rate Limit Keys

Suggested keys:

```text
provider:{providerName}
providerAccount:{accountId}
senderDomain:{domain}
tenant:{tenantId}
category:{category}
recipientDomain:{gmail.com}
```

### 18.3 Why Recipient Domain Throttling Matters

Even if provider quota allows 100 emails/second, blasting thousands of emails to the same recipient domain may trigger throttling or reputation problems.

Better:

```text
global provider rate <= provider quota
recipient domain rate <= safe threshold
category priority controls scheduling
```

### 18.4 Priority Scheduling

Transactional email should usually outrank bulk mail:

```text
HIGH: password reset, verification, regulatory deadline
MEDIUM: workflow notification
LOW: digest, report, campaign-like notification
```

Avoid letting low-priority batch consume all provider quota.

---

## 19. Data Residency and Compliance

Provider choice is often not purely technical.

Questions:

1. Where is email content processed?
2. Where are provider logs stored?
3. Are attachments stored temporarily by provider?
4. Are event logs retained by provider?
5. Does provider process open/click tracking?
6. Is message content encrypted at rest?
7. Who can access message content in provider dashboard?
8. Are templates stored outside application environment?
9. Are webhooks crossing region boundary?
10. Is provider approved for the data classification?

### 19.1 Sensitivity-Based Routing

Example:

```text
PUBLIC_NOTIFICATION -> provider API allowed
INTERNAL_NOTIFICATION -> corporate SMTP relay
PII_NOTIFICATION -> approved regional provider only
HIGHLY_SENSITIVE_ATTACHMENT -> do not attach; use secure portal link
```

### 19.2 Secure Link Instead of Attachment

For sensitive documents:

```text
Email contains notification + secure link
Document remains in controlled system
Access requires authentication/authorization
Link expires
Access is audited
```

This is usually better than sending sensitive PDF attachments through external mail provider.

---

## 20. Vendor Lock-In Management

Vendor lock-in is not binary. It exists at several layers.

### 20.1 Lock-In Layers

| Layer | Example | Mitigation |
|---|---|---|
| Transport | provider-specific API | `MailGateway` abstraction |
| Template | provider template id | app-side rendering or template export/versioning |
| Event | provider webhook schema | normalized event model |
| Metadata | custom args format | canonical metadata mapping |
| Suppression | provider suppression list | app suppression mirror |
| Analytics | provider dashboard only | internal metrics/event store |
| Domain | provider-managed DKIM only | document DNS ownership and export |

### 20.2 Anti-Corruption Layer

Provider adapter should act as anti-corruption layer:

```text
Domain Model <-> Provider Adapter <-> Provider Schema
```

Never let provider schema spread across application.

Bad:

```java
public class NotificationService {
    public void send(SendGridMail mail) { ... }
}
```

Better:

```java
public class NotificationService {
    public void requestEmail(EmailNotificationCommand command) { ... }
}
```

### 20.3 Vendor Capability Registry

Not all providers support same features.

```java
public final class MailProviderCapabilities {
    private final boolean supportsRawMime;
    private final boolean supportsTemplates;
    private final boolean supportsIdempotencyKey;
    private final boolean supportsWebhooks;
    private final boolean supportsSuppressionApi;
    private final long maxMessageSizeBytes;
    private final long maxAttachmentSizeBytes;
}
```

Route resolver can reject unsupported combinations before sending.

---

## 21. Provider Configuration Model

Avoid hardcoding provider configuration inside code.

### 21.1 SMTP Config

```yaml
mail:
  gateways:
    corporate-smtp:
      type: smtp
      host: smtp.internal.example
      port: 587
      startTls: true
      startTlsRequired: true
      auth: true
      connectionTimeoutMs: 5000
      readTimeoutMs: 10000
      writeTimeoutMs: 10000
      maxMessageSizeBytes: 10485760
```

### 21.2 API Config

```yaml
mail:
  gateways:
    provider-api-primary:
      type: provider-api
      baseUrl: https://api.email-provider.example
      connectTimeoutMs: 3000
      readTimeoutMs: 10000
      maxRetriesAtHttpClient: 0
      maxMessageSizeBytes: 10485760
      webhookEnabled: true
```

### 21.3 Why HTTP Client Auto-Retry Can Be Dangerous

Many HTTP clients can automatically retry failed requests. For email send, this can duplicate emails if:

- retry occurs after request body was sent;
- provider accepted but response failed;
- request is not idempotent.

Recommended:

```text
Disable generic HTTP auto-retry for send operations.
Use application-level retry through outbox and idempotency rules.
```

---

## 22. Provider Health and Circuit Breaker

A mail provider can fail partially:

- auth fails;
- API returns 500;
- SMTP connection timeout;
- rate limit spikes;
- webhook delayed;
- specific region degraded;
- only certain sender domain rejected;
- only attachments rejected.

### 22.1 Health Dimensions

```text
provider availability
provider latency
provider rejection rate
rate limit rate
auth failure rate
unknown outcome rate
webhook delay
queue backlog per route
```

### 22.2 Circuit Breaker Decision

Circuit breaker should distinguish:

```text
AUTH_FAILURE -> open circuit and alert immediately
RATE_LIMIT -> throttle, not necessarily open
PROVIDER_5XX -> open if sustained
CONTENT_REJECTED -> no circuit; fix content/policy
INVALID_RECIPIENT -> no circuit; recipient issue
```

### 22.3 Route Health Table

```text
mail_route_health
  route_id
  provider
  status
  failure_rate_5m
  p95_latency_ms
  rate_limited_until
  circuit_open_until
  last_auth_failure_at
  last_checked_at
```

---

## 23. Cost Model

Cost can influence architecture.

Cost dimensions:

- per email;
- per attachment/storage;
- dedicated IP;
- analytics retention;
- validation service;
- inbound parse;
- premium support;
- cross-region data transfer;
- engineering cost of maintaining adapter;
- incident cost.

### 23.1 Cost Anti-Pattern

Choosing provider purely by cheapest per-email cost can backfire if:

- deliverability is worse;
- support is slow;
- event feedback is poor;
- compliance review fails;
- engineering time increases;
- migration is difficult.

### 23.2 Cost-Aware Routing

For multi-provider systems:

```text
critical transactional -> highest reliability provider
bulk low-risk -> lower cost provider
internal -> corporate relay
sensitive -> approved provider only
```

But cost routing must never override compliance and deliverability constraints.

---

## 24. Provider Adapter Testing

Provider integration needs more than unit tests.

### 24.1 Test Layers

| Layer | Test |
|---|---|
| Mapper unit test | canonical email -> provider request |
| MIME test | generated raw MIME structure |
| Failure mapper test | HTTP/SMTP/provider error -> canonical category |
| Contract test | provider sandbox/test mode |
| Webhook test | payload signature + event normalization |
| Replay test | duplicate webhook and duplicate send attempt |
| Rate limit test | 429/throttle simulation |
| Unknown outcome test | timeout after request sent |

### 24.2 Golden Files

For provider request mapping:

```text
fixtures/
  sendgrid-request-basic.json
  sendgrid-request-with-attachment.json
  mailgun-request-basic.multipart
  raw-mime-with-inline-image.eml
```

### 24.3 Do Not Test Against Real Recipients in CI

CI should use:

- fake SMTP;
- provider sandbox/test mode;
- mocked HTTP server;
- local Mailpit/GreenMail;
- contract environment with safe recipient domain.

---

## 25. Migration Patterns

### 25.1 SMTP to API Migration

```text
Current: Java App -> SMTP Relay
Target: Java App -> MailGateway -> Provider API
```

Recommended steps:

1. Introduce `MailGateway` interface while keeping SMTP implementation.
2. Move message construction into `PreparedEmail`/`MimeMessageFactory`.
3. Add canonical `SendResult` and `MailFailureCategory`.
4. Add outbox attempt state if not already present.
5. Add route resolver.
6. Implement provider API adapter in shadow mode.
7. Send selected low-risk category through API.
8. Compare observability and event feedback.
9. Enable webhook ingestion.
10. Migrate category by category.
11. Keep rollback route.
12. Remove direct provider leakage.

### 25.2 API to SMTP Fallback

Sometimes provider API is too hard for compliance or outages.

Steps:

1. Ensure app can build full MIME.
2. Add SMTP adapter.
3. Define route policy.
4. Ensure sender domain alignment works through SMTP route.
5. Revalidate DKIM/SPF/DMARC.
6. Rework event expectations because SMTP may not provide same feedback.
7. Adjust state machine: `ACCEPTED_BY_RELAY` may replace provider-specific accepted.

### 25.3 Legacy Java 8 to Modern Java 21/25

For Java 8:

- `javax.mail` likely used;
- `javax.activation` may be used;
- old classpath style;
- Spring Boot 2.x likely uses `javax.mail`.

For Java 17/21/25 modern stacks:

- `jakarta.mail`;
- `jakarta.activation`;
- Spring Boot 3+ uses Jakarta namespace;
- Eclipse Angus Mail implementation;
- virtual threads may help blocking SMTP/API workers.

Migration should avoid mixing `javax.mail.Message` with `jakarta.mail.Message` in same module.

---

## 26. Reference Architecture

### 26.1 Logical Architecture

```text
Business Module
  -> Notification Application Service
      -> Notification Outbox Writer
          -> email_outbox table

Email Worker
  -> Outbox Poller
  -> Suppression Checker
  -> Template Renderer
  -> Route Resolver
  -> Rate Limiter
  -> MailGateway
       -> SmtpMailGateway
       -> RawMimeApiMailGateway
       -> StructuredApiMailGateway
  -> Attempt Recorder

Provider Webhook Endpoint
  -> Signature Verifier
  -> Event Normalizer
  -> Event Deduper
  -> Delivery State Updater
  -> Suppression Updater
```

### 26.2 State Model

```text
REQUESTED
  -> READY_TO_SEND
  -> SENDING
  -> ACCEPTED_BY_PROVIDER
  -> DELIVERED
```

Failure paths:

```text
SENDING
  -> FAILED_RETRYABLE
  -> READY_TO_SEND
```

```text
SENDING
  -> FAILED_PERMANENT
```

```text
SENDING
  -> UNKNOWN_OUTCOME
  -> RECONCILING
  -> ACCEPTED_BY_PROVIDER | READY_TO_SEND | MANUAL_REVIEW
```

Provider feedback paths:

```text
ACCEPTED_BY_PROVIDER
  -> DEFERRED
  -> DELIVERED
```

```text
ACCEPTED_BY_PROVIDER
  -> BOUNCED_HARD
  -> SUPPRESSED
```

```text
ACCEPTED_BY_PROVIDER
  -> COMPLAINED
  -> SUPPRESSED
```

### 26.3 Critical Invariants

1. Business transaction must not depend on synchronous external email send.
2. Provider-specific schema must not leak into domain model.
3. Every send attempt must be recorded.
4. Every provider message id must be correlated to app notification id.
5. Unknown outcome must be represented explicitly.
6. Webhook must be idempotent.
7. Suppression must be checked before sending.
8. Failover must not violate compliance.
9. Secrets must never appear in logs.
10. Sender identity must be policy-resolved, not request-controlled.
11. Rate limit must be route-aware.
12. Attachment size must be enforced before provider call.
13. Template version must be auditable.

---

## 27. Implementation Example: Provider-Neutral Port

### 27.1 Java 17+ Version

```java
public interface MailGateway {
    SendResult send(PreparedEmail email);
}

public record PreparedEmail(
    EmailIdentity from,
    List<EmailRecipient> to,
    List<EmailRecipient> cc,
    List<EmailRecipient> bcc,
    EmailAddress replyTo,
    String subject,
    EmailBody body,
    List<EmailAttachment> attachments,
    Map<String, String> headers,
    Map<String, String> metadata,
    String idempotencyKey,
    String tenantId,
    EmailSensitivity sensitivity
) {}

public sealed interface SendResult permits SendAccepted, SendRejected, SendUnknown {}

public record SendAccepted(
    String provider,
    String providerMessageId,
    Instant acceptedAt,
    Map<String, String> attributes
) implements SendResult {}

public record SendRejected(
    String provider,
    MailFailureCategory category,
    boolean retryable,
    String providerCode,
    String providerMessage
) implements SendResult {}

public record SendUnknown(
    String provider,
    String reason,
    boolean safeToRetry
) implements SendResult {}
```

### 27.2 Java 8 Compatible Version

```java
public interface MailGateway {
    SendResult send(PreparedEmail email);
}

public interface SendResult {
    String provider();
}

public final class SendAccepted implements SendResult {
    private final String provider;
    private final String providerMessageId;
    private final Instant acceptedAt;
    private final Map<String, String> attributes;

    public SendAccepted(
            String provider,
            String providerMessageId,
            Instant acceptedAt,
            Map<String, String> attributes) {
        this.provider = provider;
        this.providerMessageId = providerMessageId;
        this.acceptedAt = acceptedAt;
        this.attributes = attributes;
    }

    @Override
    public String provider() {
        return provider;
    }

    public String providerMessageId() {
        return providerMessageId;
    }

    public Instant acceptedAt() {
        return acceptedAt;
    }

    public Map<String, String> attributes() {
        return attributes;
    }
}
```

### 27.3 Route-Aware Worker Sketch

```java
public final class EmailOutboxWorker {
    private final EmailOutboxRepository outbox;
    private final SuppressionService suppressionService;
    private final MailRouteResolver routeResolver;
    private final MailGatewayRegistry gatewayRegistry;
    private final MailRateLimiter rateLimiter;

    public void processOne() {
        EmailOutboxItem item = outbox.lockNextReadyItem();
        if (item == null) {
            return;
        }

        try {
            PreparedEmail email = item.toPreparedEmail();

            SuppressionDecision suppression = suppressionService.evaluate(email);
            if (suppression.isSuppressed()) {
                outbox.markSuppressed(item.id(), suppression.reason());
                return;
            }

            MailRoute route = routeResolver.resolve(email);
            rateLimiter.acquire(route);

            MailGateway gateway = gatewayRegistry.get(route.gatewayName());
            outbox.recordAttemptStarted(item.id(), route);

            SendResult result = gateway.send(email);
            outbox.recordAttemptResult(item.id(), route, result);

        } catch (Exception ex) {
            outbox.recordWorkerFailure(item.id(), ex);
        }
    }
}
```

---

## 28. Anti-Patterns

### 28.1 Direct Vendor Call From Business Service

```text
CaseService -> SendGridClient
```

Why bad:

- tight coupling;
- no outbox;
- no clean retry;
- no provider-neutral model;
- difficult testing;
- business transaction may depend on external provider.

### 28.2 Treating HTTP 202/SMTP 250 as Delivered

Provider acceptance is not inbox delivery.

Correct state:

```text
ACCEPTED_BY_PROVIDER
```

Not:

```text
DELIVERED
```

### 28.3 Generic HTTP Retry for Send

HTTP auto-retry may duplicate email.

Prefer:

```text
outbox retry + idempotency + attempt state
```

### 28.4 Provider Webhook Without Signature Verification

Webhook endpoint is an externally exposed mutation interface. Treat it as security-sensitive.

### 28.5 No Suppression List

If hard-bounced or complained recipients keep receiving mail, deliverability and compliance degrade.

### 28.6 Letting Caller Choose From Address

This enables spoofing and cross-tenant abuse.

### 28.7 Storing Provider Payload as the Only Audit Record

Provider payload may not be enough for long-term audit. Store canonical notification intent, template version, recipient snapshot, route, and send attempt result.

### 28.8 Failover Without Unknown Outcome Handling

If first provider accepted but response timed out, failover can send duplicate.

### 28.9 Provider-Side Template Without Version Governance

For regulatory systems, template drift can destroy audit defensibility.

### 28.10 One Adapter To Rule Everything

A single huge `EmailService` that handles template, route, SMTP, API, retry, webhook, suppression, and audit becomes untestable.

---

## 29. Design Review Checklist

Use this checklist before approving a provider integration.

### 29.1 Boundary

- [ ] Is there a provider-neutral `MailGateway`?
- [ ] Are provider schemas isolated in adapters?
- [ ] Does domain layer avoid SMTP/API details?
- [ ] Is outbox used for external send side effect?

### 29.2 Reliability

- [ ] Is every send attempt recorded?
- [ ] Is unknown outcome represented?
- [ ] Is retry policy category-aware?
- [ ] Is idempotency key generated from business intent?
- [ ] Is duplicate suppression considered?

### 29.3 Routing

- [ ] Is route resolution explicit?
- [ ] Does failover respect compliance?
- [ ] Are tenant sender identities verified?
- [ ] Are category/sensitivity rules enforced?

### 29.4 Provider Capability

- [ ] Does provider support required message size?
- [ ] Does provider support required attachments?
- [ ] Does provider support raw MIME if needed?
- [ ] Does provider support webhook events if required?
- [ ] Does provider expose quota/rate visibility?

### 29.5 Security

- [ ] Are API keys/secrets managed securely?
- [ ] Are webhook signatures verified?
- [ ] Are logs redacted?
- [ ] Are sender addresses policy-resolved?
- [ ] Are templates sanitized/escaped?

### 29.6 Compliance

- [ ] Is provider approved for data classification?
- [ ] Is data residency known?
- [ ] Are provider logs/retention understood?
- [ ] Is sensitive attachment policy defined?
- [ ] Is audit record sufficient?

### 29.7 Observability

- [ ] Are provider message IDs stored?
- [ ] Are queue metrics available?
- [ ] Are send latency/failure metrics available?
- [ ] Are webhook delays monitored?
- [ ] Are route health and rate limit visible?

### 29.8 Testing

- [ ] Are provider mappers unit-tested?
- [ ] Are failure mappers tested?
- [ ] Is fake SMTP/sandbox used?
- [ ] Are webhook duplicate/replay tests present?
- [ ] Are unknown outcome tests present?

---

## 30. Practical Recommendation by System Type

### 30.1 Internal Enterprise Workflow System

Recommended:

```text
Jakarta Mail + corporate SMTP relay + outbox + audit + safe debug
```

Add API provider only if delivery feedback is required.

### 30.2 Customer-Facing Transactional Platform

Recommended:

```text
Provider API + webhook feedback + suppression + outbox + route-aware rate limiter
```

Keep raw MIME/Jakarta Mail if MIME control is important.

### 30.3 Regulatory Case Management System

Recommended:

```text
Outbox-first architecture
Policy-resolved sender
Application-side template rendering
Audit snapshot
Approved route resolver
No auto failover across compliance boundary
Secure link instead of sensitive attachment
```

SMTP relay may be preferred if mandated by agency/corporate policy. API provider can be used if approved and event feedback is important.

### 30.4 High-Volume Notification Platform

Recommended:

```text
Provider API
Dedicated routing policy
Webhook event ingestion
Suppression list
Recipient-domain throttling
Priority scheduler
Provider health/circuit breaker
```

SMTP alone may be insufficient for feedback and scale management.

### 30.5 Legacy Java 8 Application

Recommended migration path:

```text
Keep javax.mail initially
Introduce MailGateway abstraction
Introduce outbox if missing
Normalize SendResult
Then decide SMTP/API migration
```

Do not perform package migration and provider architecture rewrite in one uncontrolled step.

---

## 31. Summary Mental Model

SMTP relay and provider API are not merely two syntaxes for sending email. They represent different operational contracts.

SMTP gives:

- standard protocol;
- Jakarta Mail integration;
- MIME control;
- portability;
- good fit for corporate relay and legacy systems.

Provider API gives:

- structured response;
- event feedback;
- suppression tooling;
- analytics;
- provider-specific deliverability platform;
- better control/feedback plane.

A top-tier design does not hardcode either choice into business logic. It builds a provider-neutral mail subsystem:

```text
Business intent
  -> Notification request
  -> Outbox
  -> Template/rendering
  -> Policy/routing
  -> MailGateway adapter
  -> Provider feedback loop
  -> Audit/observability
```

The final architecture should make these statements true:

1. Changing provider does not rewrite business logic.
2. SMTP success is not confused with delivery success.
3. HTTP timeout is not falsely treated as permanent failure.
4. Bounce/complaint feedback can update application state.
5. Sensitive email cannot accidentally route through unapproved provider.
6. Duplicate prevention is handled at business intent and attempt level.
7. Provider-specific detail is isolated.
8. Audit can explain what was attempted, through which route, with which template version, and what outcome was observed.

That is the difference between “an app that sends email” and “an enterprise-grade mail delivery subsystem”.

---

## 32. References

- Jakarta Mail project: https://jakarta.ee/specifications/mail/
- Jakarta Mail 2.1 specification: https://jakarta.ee/specifications/mail/2.1/
- Eclipse Angus Mail documentation: https://eclipse-ee4j.github.io/angus-mail/
- AWS SES service quotas: https://docs.aws.amazon.com/ses/latest/dg/quotas.html
- AWS SES sending quotas: https://docs.aws.amazon.com/ses/latest/dg/manage-sending-quotas.html
- Twilio SendGrid v3 API reference: https://www.twilio.com/docs/sendgrid/api-reference
- Twilio SendGrid Mail Send API: https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send
- Mailgun documentation: https://documentation.mailgun.com/
- Mailgun Messages API: https://mailgun-docs.redoc.ly/docs/mailgun/api-reference/openapi-final/tag/Messages/

---

## 33. What Comes Next

Part berikutnya:

```text
Part 23 — Bounce, Complaint, Webhook, and Delivery Feedback Loop
```

Part 23 akan memperdalam feedback loop setelah provider menerima email:

- hard bounce vs soft bounce;
- complaint;
- unsubscribe;
- provider webhook;
- event deduplication;
- idempotent webhook processing;
- suppression list;
- delayed event;
- state transition dari `ACCEPTED_BY_PROVIDER` ke `DELIVERED`, `BOUNCED`, `COMPLAINED`, atau `SUPPRESSED`.



<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 21 — Performance and Resource Management](./21-performance-resource-management.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 23 — Bounce, Complaint, Webhook, and Delivery Feedback Loop](./23-bounce-complaint-webhook-feedback-loop.md)
