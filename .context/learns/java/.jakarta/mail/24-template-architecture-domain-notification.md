# Part 24 — Template Architecture and Domain Notification Design

> Seri: `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery`  
> File: `24-template-architecture-domain-notification.md`  
> Target: Java 8 hingga Java 25, JavaMail `javax.mail`, Jakarta Mail `jakarta.mail`, Spring Boot, Jakarta EE, dan enterprise notification architecture.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membahas email dari sisi:

- protokol SMTP, MIME, POP3, IMAP;
- JavaMail/Jakarta Mail API;
- MIME message construction;
- attachment dan Jakarta Activation;
- HTML email;
- addressing/header semantics;
- failure model;
- reliable outbox/retry/idempotency;
- bulk/rate-limited sending;
- security;
- deliverability;
- inbound parsing;
- container integration;
- Spring Boot integration;
- testing;
- observability;
- performance;
- provider integration;
- bounce/complaint/webhook feedback loop.

Part ini naik satu layer lagi.

Kita tidak lagi bertanya:

```text
Bagaimana cara mengirim email?
```

Tetapi:

```text
Bagaimana cara mendesain notification system yang memakai email sebagai salah satu channel, tetap maintainable, testable, auditable, versioned, localized, compliant, dan bisa berubah tanpa merusak domain bisnis?
```

Ini adalah titik di mana engineer biasa dan engineer senior/architect biasanya mulai berbeda.

Engineer biasa sering membuat:

```java
sendEmail(to, subject, body);
```

Engineer yang lebih matang bertanya:

```text
Email ini representasi dari event bisnis apa?
Template versi berapa yang dipakai?
Variabel apa yang wajib ada?
Siapa yang menyetujui copywriting-nya?
Apakah body final disimpan untuk audit?
Apakah recipient boleh menerima email ini?
Apakah email ini transactional atau marketing?
Apakah user preference dihormati?
Apakah channel bisa diganti ke in-app atau SMS?
Apakah template lama masih bisa dibuktikan 2 tahun lagi?
```

Part ini membahas itu.

---

## 1. Problem Besar: Email Template Bukan Sekadar String

Banyak codebase memulai email dengan cara sederhana:

```java
String body = "Hello " + user.getName() + ", your application is approved.";
mailSender.send(user.getEmail(), "Application Approved", body);
```

Awalnya terlihat cukup.

Lalu requirement bertambah:

1. perlu HTML;
2. perlu plain text fallback;
3. perlu attachment;
4. perlu bahasa Inggris dan Indonesia;
5. perlu template berbeda per agency/tenant;
6. perlu approval dari business user;
7. perlu audit copy email yang benar-benar dikirim;
8. perlu unsubscribe untuk non-transactional email;
9. perlu resend;
10. perlu preview di admin UI;
11. perlu test supaya variable tidak missing;
12. perlu tracking template version;
13. perlu channel lain selain email;
14. perlu tidak mengirim email kalau recipient opted out;
15. perlu log tanpa membocorkan PII;
16. perlu debugging saat user bilang “saya tidak terima email”.

Jika architecture-nya masih `sendEmail(to, subject, body)`, sistem akan cepat menjadi fragile.

Masalah utamanya:

```text
Email sering dianggap infrastructure concern, padahal content email merepresentasikan business decision.
```

Contoh:

```text
“Your licence has been suspended.”
```

Kalimat ini bukan sekadar text. Ia membawa konsekuensi domain:

- status entity berubah;
- user diberi tahu;
- mungkin ada SLA response;
- mungkin ada appeal period;
- mungkin harus diaudit;
- mungkin isi email harus sama dengan policy legal tertentu;
- mungkin ada attachment notice resmi;
- mungkin recipient berbeda tergantung role.

Jadi desain yang benar harus memisahkan:

```text
Business notification intent
  ≠ rendered email
  ≠ SMTP delivery attempt
  ≠ inbox delivery result
```

---

## 2. Mental Model: Notification as Domain Intent, Email as Delivery Channel

Model yang lebih matang:

```text
Domain Event / Command
        │
        ▼
Notification Intent
        │
        ▼
Recipient Resolution
        │
        ▼
Preference / Policy Check
        │
        ▼
Template Selection
        │
        ▼
Template Rendering
        │
        ▼
Channel Message
        │
        ▼
Outbox / Queue
        │
        ▼
Provider Delivery
        │
        ▼
Feedback Loop
```

Email hanyalah salah satu channel output.

Channel lain bisa:

- in-app notification;
- SMS;
- push notification;
- WhatsApp/provider chat;
- letter generation;
- case note;
- audit event;
- task assignment.

Karena itu, domain seharusnya tidak langsung tahu detail seperti:

- SMTP host;
- MIME multipart;
- CID image;
- `MimeMessageHelper`;
- DKIM;
- provider webhook;
- attachment encoding.

Domain cukup tahu:

```text
Sebuah notification bisnis perlu dikirim kepada recipient tertentu dengan semantic tertentu.
```

Contoh:

```java
NotificationIntent intent = NotificationIntent.builder()
    .type(NotificationType.APPLICATION_APPROVED)
    .aggregateType("APPLICATION")
    .aggregateId(applicationId)
    .actorId(approvedBy)
    .recipientRole(RecipientRole.APPLICANT)
    .priority(NotificationPriority.NORMAL)
    .data(Map.of(
        "applicationNo", applicationNo,
        "approvedDate", approvedDate,
        "licenceNo", licenceNo
    ))
    .build();
```

Yang belum terlihat di sini:

- subject email;
- HTML body;
- SMTP;
- attachment MIME;
- provider;
- retry.

Itu memang sebaiknya berada di layer notification infrastructure/application service.

---

## 3. Vocabulary Penting

Sebelum desain, kita butuh bahasa yang presisi.

### 3.1 Notification

Notification adalah maksud bisnis untuk memberi tahu pihak tertentu tentang sesuatu.

Contoh:

```text
APPLICATION_SUBMITTED
PAYMENT_RECEIVED
CASE_ESCALATED
LICENCE_SUSPENDED
PASSWORD_RESET_REQUESTED
REPORT_READY
HEARING_SCHEDULE_CHANGED
```

Notification belum tentu email.

### 3.2 Channel

Channel adalah media pengiriman.

Contoh:

```text
EMAIL
IN_APP
SMS
PUSH
WEBHOOK
LETTER
```

### 3.3 Template

Template adalah definisi konten yang akan dirender menjadi pesan final.

Template biasanya punya:

- identifier;
- version;
- channel;
- locale;
- subject template;
- body template;
- text body template;
- HTML body template;
- required variables;
- metadata;
- status;
- approval information.

### 3.4 Rendered Message

Rendered message adalah hasil final setelah template diberi data.

Contoh:

```text
Subject: Application APP-2026-001 has been approved
Body: Dear Fajar, ...
```

Rendered message penting untuk audit karena template bisa berubah di masa depan.

### 3.5 Delivery Attempt

Delivery attempt adalah satu usaha mengirim message ke provider/channel.

Satu notification bisa punya beberapa delivery attempt karena retry.

### 3.6 Delivery Feedback

Feedback adalah informasi pasca-kirim:

- SMTP accepted;
- provider accepted;
- delivered;
- bounced;
- complained;
- opened;
- clicked;
- failed permanently;
- suppressed.

### 3.7 Notification Preference

Preference adalah konfigurasi recipient tentang channel mana yang boleh digunakan.

Contoh:

```text
User A menerima security alert via email.
User A tidak menerima marketing newsletter.
User B menerima case update via in-app only.
```

### 3.8 Policy

Policy adalah aturan organisasi/regulasi yang bisa override preference.

Contoh:

```text
Password reset harus dikirim via email.
Regulatory notice wajib dikirim walau user opt out marketing.
Marketing email wajib menyediakan unsubscribe.
```

---

## 4. Kesalahan Umum Desain Template Email

### 4.1 Template Hardcoded di Service Domain

Anti-pattern:

```java
public void approveApplication(Application app) {
    app.approve();

    String body = "Dear " + app.getApplicantName()
        + ", your application " + app.getApplicationNo()
        + " has been approved.";

    mailService.send(app.getEmail(), "Approved", body);
}
```

Masalah:

- domain logic tercampur presentation;
- sulit localization;
- sulit audit template version;
- sulit test template separately;
- sulit approval copywriting;
- sulit resend dengan content yang sama;
- sulit channel lain;
- sulit mengganti provider.

Lebih baik:

```java
public void approveApplication(Application app, User approver) {
    app.approve(approver);

    notificationPublisher.publish(NotificationIntent.applicationApproved(
        app.getId(),
        app.getApplicationNo(),
        app.getApplicantId(),
        approver.getId()
    ));
}
```

### 4.2 Template Tidak Berversi

Anti-pattern:

```text
template_id = PASSWORD_RESET
```

Lalu content diubah langsung.

Masalah:

- email lama tidak bisa dijelaskan;
- audit tidak tahu kalimat apa yang dikirim;
- resend bisa menghasilkan wording berbeda;
- dispute sulit ditangani;
- approval history hilang.

Lebih baik:

```text
template_key     = PASSWORD_RESET
template_version = 4
locale           = en-SG
channel          = EMAIL
```

### 4.3 Tidak Ada Variable Contract

Anti-pattern:

```html
<p>Dear ${name}, your application ${applicationNo} is approved.</p>
```

Tetapi tidak ada schema yang menyatakan `name` dan `applicationNo` wajib.

Akibat:

- runtime error;
- email terkirim dengan blank variable;
- inconsistent naming;
- template author tidak tahu variable apa tersedia;
- developer tidak tahu impact saat rename field.

Lebih baik template punya contract:

```json
{
  "templateKey": "APPLICATION_APPROVED",
  "version": 3,
  "requiredVariables": {
    "recipientName": "string",
    "applicationNo": "string",
    "approvedDate": "date",
    "licenceNo": "string"
  },
  "optionalVariables": {
    "remarks": "string"
  }
}
```

### 4.4 Menyimpan Hanya Template + Data, Tidak Rendered Output

Untuk beberapa sistem, menyimpan template ID dan data cukup.

Namun untuk sistem regulatori/audit-heavy, sering tidak cukup.

Jika template berubah, render ulang bisa menghasilkan output berbeda.

Untuk notification yang memiliki konsekuensi hukum/proses, simpan:

- template key;
- template version;
- locale;
- data snapshot;
- rendered subject;
- rendered plain body;
- rendered HTML body;
- attachment references;
- recipient snapshot;
- send timestamp;
- provider response.

### 4.5 Menyamakan Notification Status dengan Email Delivery Status

Anti-pattern:

```text
notification.status = SENT
```

Apa arti `SENT`?

- rendered?
- queued?
- accepted by SMTP?
- delivered to mailbox?
- opened?

Lebih baik pisahkan:

```text
notification.intent_status
email_message.render_status
email_delivery_attempt.status
provider_feedback.status
```

---

## 5. Layering Architecture

Desain yang sehat biasanya punya beberapa layer:

```text
┌──────────────────────────────────────────────┐
│ Domain Layer                                  │
│ - domain events                               │
│ - business state transitions                  │
│ - semantic notification intent                │
└──────────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────┐
│ Notification Application Layer                │
│ - recipient resolution                        │
│ - preference/policy check                     │
│ - template selection                          │
│ - rendering orchestration                     │
│ - outbox creation                             │
└──────────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────┐
│ Template Layer                                │
│ - template repository                         │
│ - versioning                                  │
│ - schema validation                           │
│ - rendering engine adapter                    │
│ - preview                                     │
└──────────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────┐
│ Channel Layer                                 │
│ - email composer                              │
│ - in-app composer                             │
│ - SMS composer                                │
│ - channel-specific constraints                │
└──────────────────────────────────────────────┘
                    │
                    ▼
┌──────────────────────────────────────────────┐
│ Delivery Infrastructure Layer                 │
│ - Jakarta Mail/Spring Mail/provider API       │
│ - queue/outbox worker                         │
│ - retry                                       │
│ - webhook/bounce ingestion                    │
│ - metrics/logs/traces                         │
└──────────────────────────────────────────────┘
```

Kunci desain:

```text
Domain tidak membangun HTML.
Template engine tidak mengirim SMTP.
SMTP worker tidak mengambil keputusan bisnis.
Provider webhook tidak mengubah domain secara sembarangan tanpa idempotency/policy.
```

---

## 6. Domain Notification Model

### 6.1 Notification Type

Notification type harus semantic, bukan presentation-oriented.

Buruk:

```text
SEND_APPROVAL_EMAIL
EMAIL_TO_APPLICANT
TEMPLATE_001
```

Lebih baik:

```text
APPLICATION_APPROVED
APPLICATION_REJECTED
CASE_ESCALATED
PAYMENT_RECEIVED
PASSWORD_RESET_REQUESTED
LICENCE_EXPIRY_REMINDER
```

Karena `APPLICATION_APPROVED` bisa dikirim via:

- email;
- in-app;
- SMS;
- webhook;
- letter.

### 6.2 Aggregate Context

Notification harus bisa ditelusuri ke entity bisnis.

Contoh field:

```text
aggregate_type = APPLICATION
aggregate_id   = 12a7...
case_no        = CASE-2026-001
module         = LICENSING
```

Manfaat:

- audit;
- debugging;
- resend;
- filtering;
- SLA monitoring;
- correlation dengan case activity.

### 6.3 Actor Context

Siapa yang menyebabkan notification?

```text
actor_type = USER / SYSTEM / BATCH / INTEGRATION
actor_id   = user-123
actor_role = OFFICER
```

Untuk event otomatis:

```text
actor_type = SYSTEM
actor_id   = nightly-expiry-reminder-job
```

### 6.4 Recipient Intent

Recipient bisa dinyatakan sebagai:

```text
specific user id
specific email address
role on aggregate
organization contact
case assigned officer
applicant
supervisor
```

Contoh:

```java
RecipientSelector applicant = RecipientSelector.roleOnAggregate(
    "APPLICATION",
    applicationId,
    "APPLICANT"
);
```

Kenapa tidak langsung email address?

Karena email address bisa berubah, preference bisa berbeda, dan domain mungkin lebih tahu “kirim ke applicant” daripada alamat email aktual.

Namun untuk audit, resolved recipient harus disimpan sebagai snapshot saat pengiriman.

---

## 7. Template Identity

Template identity minimal:

```text
template_key
template_version
channel
locale
tenant/agency/context
status
```

Contoh:

```text
template_key      = APPLICATION_APPROVED
template_version  = 5
channel           = EMAIL
locale            = en-SG
tenant            = CEA
status            = ACTIVE
```

### 7.1 Template Key

Template key adalah nama semantic stabil.

Contoh:

```text
APPLICATION_APPROVED
PASSWORD_RESET
PAYMENT_RECEIPT
CASE_ESCALATED
LICENCE_EXPIRY_REMINDER
```

Jangan pakai nama teknis seperti:

```text
email_template_14
html_approval_v2
send_mail_app_success
```

### 7.2 Version

Version harus immutable.

Jika content berubah, buat version baru.

```text
APPLICATION_APPROVED v1
APPLICATION_APPROVED v2
APPLICATION_APPROVED v3
```

Jangan update v1 in-place jika butuh audit.

### 7.3 Channel

Satu notification type bisa punya template berbeda per channel.

```text
APPLICATION_APPROVED / EMAIL / en-SG / v3
APPLICATION_APPROVED / IN_APP / en-SG / v1
APPLICATION_APPROVED / SMS / en-SG / v2
```

### 7.4 Locale

Locale jangan hanya `en` jika domain butuh regional variant.

Contoh:

```text
en-SG
id-ID
ms-MY
zh-SG
```

### 7.5 Context/Tenant

Jika multi-agency/multi-tenant:

```text
APPLICATION_APPROVED / EMAIL / en-SG / CEA / v5
APPLICATION_APPROVED / EMAIL / en-SG / CPDS / v2
```

Fallback bisa:

```text
exact tenant + locale
exact tenant + default locale
default tenant + locale
default tenant + default locale
```

Tetapi fallback harus deterministic dan logged.

---

## 8. Template Lifecycle

Template tidak seharusnya langsung aktif setelah diedit.

Lifecycle yang lebih defensible:

```text
DRAFT
  │
  ▼
READY_FOR_REVIEW
  │
  ▼
APPROVED
  │
  ▼
ACTIVE
  │
  ├──► DEPRECATED
  │
  └──► ARCHIVED
```

### 8.1 Draft

Template sedang dibuat/diedit.

Boleh invalid sementara.

### 8.2 Ready for Review

Template sudah lolos basic validation:

- required variables valid;
- syntax template valid;
- subject tidak kosong;
- text fallback tersedia;
- HTML valid minimum;
- no forbidden variable.

### 8.3 Approved

Business/legal/compliance menyetujui content.

Approval metadata:

```text
approved_by
approved_at
approval_comment
approval_ticket/reference
```

### 8.4 Active

Template bisa dipakai runtime.

Biasanya hanya satu active version per:

```text
template_key + channel + locale + tenant/context
```

### 8.5 Deprecated

Template lama tidak dipakai untuk notification baru, tetapi masih boleh dipakai untuk resend historical message jika policy mengizinkan.

### 8.6 Archived

Template tidak dipakai lagi, tetapi tetap disimpan untuk audit.

---

## 9. Template Versioning Strategy

Ada beberapa strategi.

### 9.1 Immutable Version Per Change

Setiap perubahan content menghasilkan version baru.

Kelebihan:

- audit kuat;
- historical rendering stabil;
- rollback mudah;
- approval jelas.

Kekurangan:

- jumlah versi banyak;
- butuh UI/version management.

Cocok untuk:

- regulasi;
- financial notice;
- government system;
- legal notice;
- security notification.

### 9.2 Mutable Draft, Immutable Active

Draft bisa diedit berkali-kali. Saat publish, menjadi immutable version.

Ini biasanya paling praktis.

```text
Draft vNext -> Review -> Approved -> Publish as v6
```

### 9.3 Mutable Template Only

Template selalu diupdate in-place.

Cocok hanya untuk sistem low-risk seperti internal prototype.

Tidak cocok untuk sistem audit-heavy.

---

## 10. Variable Schema / Template Contract

Template harus punya kontrak.

Tanpa kontrak, template menjadi string liar.

### 10.1 Contoh Schema

```json
{
  "templateKey": "APPLICATION_APPROVED",
  "version": 5,
  "channel": "EMAIL",
  "locale": "en-SG",
  "variables": {
    "recipientName": {
      "type": "string",
      "required": true,
      "pii": true,
      "example": "Fajar Abdi"
    },
    "applicationNo": {
      "type": "string",
      "required": true,
      "pii": false,
      "example": "APP-2026-0001"
    },
    "approvedDate": {
      "type": "date",
      "required": true,
      "format": "dd MMM yyyy",
      "example": "18 Jun 2026"
    },
    "licenceNo": {
      "type": "string",
      "required": true,
      "pii": false,
      "example": "LIC-123456"
    },
    "remarks": {
      "type": "string",
      "required": false,
      "pii": false,
      "example": "Please log in to view more details."
    }
  }
}
```

### 10.2 Kenapa Schema Penting

Schema membantu:

- validasi sebelum render;
- preview UI;
- documentation untuk template author;
- test generation;
- backward compatibility check;
- data classification;
- PII redaction;
- migration impact analysis.

### 10.3 Variable Naming Convention

Gunakan nama semantic, bukan nama database.

Buruk:

```text
usr_nm
app_no
lic_id
created_dt
```

Baik:

```text
recipientName
applicationNo
licenceNo
submittedAt
approvedAt
```

### 10.4 Jangan Masukkan Object Besar Sembarangan

Anti-pattern:

```java
model.put("application", applicationEntity);
```

Masalah:

- template bisa mengakses field internal;
- lazy loading risk;
- PII leak;
- fragile terhadap perubahan entity;
- domain entity bocor ke presentation layer.

Lebih baik buat DTO khusus:

```java
record ApplicationApprovedTemplateModel(
    String recipientName,
    String applicationNo,
    LocalDate approvedDate,
    String licenceNo,
    String portalUrl
) {}
```

---

## 11. Template Data Builder

Jangan biarkan setiap caller membuat `Map<String, Object>` manual.

Anti-pattern:

```java
Map<String, Object> data = new HashMap<>();
data.put("name", user.getName());
data.put("appNo", app.getNo());
data.put("date", LocalDate.now());
notificationService.send("APPLICATION_APPROVED", data);
```

Masalah:

- key tidak konsisten;
- type tidak aman;
- missing variable baru ketahuan runtime;
- refactor sulit.

Lebih baik:

```java
public final class ApplicationApprovedNotificationDataBuilder {

    public ApplicationApprovedTemplateModel build(Application app, Applicant applicant, PortalLinks links) {
        return new ApplicationApprovedTemplateModel(
            applicant.displayName(),
            app.applicationNo(),
            app.approvedDate(),
            app.licenceNo(),
            links.applicationDetailUrl(app.id())
        );
    }
}
```

Atau untuk sistem generic:

```java
public interface NotificationDataAssembler<E> {
    NotificationType supports();
    TemplateData assemble(E event);
}
```

---

## 12. Template Engine Choices

Java ecosystem punya beberapa pilihan.

### 12.1 Thymeleaf

Thymeleaf populer untuk HTML template di Spring ecosystem. Thymeleaf bisa digunakan untuk membuat email text dan HTML dengan integrasi Spring email utilities. Dokumentasi resmi Thymeleaf memiliki contoh composing email dengan Spring.  

Karakteristik:

- natural template;
- cocok untuk HTML;
- familiar untuk Spring developer;
- expression language powerful;
- bisa terlalu powerful jika tidak dibatasi;
- perlu escaping policy yang benar.

Contoh konseptual:

```html
<p>Dear <span th:text="${recipientName}">Recipient</span>,</p>
<p>Your application <strong th:text="${applicationNo}">APP-000</strong> has been approved.</p>
```

### 12.2 FreeMarker

FreeMarker adalah Java template engine untuk menghasilkan text output seperti HTML, email, configuration files, source code, dan lain-lain dari template dan data model. Dokumentasi resminya menekankan konsep `template + data-model = output`.

Karakteristik:

- mature;
- powerful;
- cocok untuk text/HTML;
- banyak dipakai di enterprise legacy;
- perlu governance supaya template tidak menjadi logic-heavy.

Contoh:

```ftl
Dear ${recipientName},

Your application ${applicationNo} has been approved on ${approvedDate}.
```

### 12.3 Mustache / Handlebars Style

Karakteristik:

- logic-less atau limited logic;
- bagus untuk governance;
- lebih aman dari template yang terlalu kompleks;
- kadang kurang fleksibel untuk conditional kompleks.

Contoh:

```mustache
Dear {{recipientName}},

Your application {{applicationNo}} has been approved.
```

### 12.4 Plain Java Renderer

Untuk email sangat sederhana, bisa pakai code renderer.

Kelebihan:

- type-safe;
- mudah refactor;
- mudah test;
- tidak perlu template engine.

Kekurangan:

- business user tidak bisa edit;
- HTML panjang sulit dibaca;
- localization berat.

### 12.5 Pilihan Praktis

Untuk enterprise email:

```text
HTML-heavy + Spring app       -> Thymeleaf
Legacy enterprise             -> FreeMarker
Governed business templates   -> Mustache/Handlebars style
High-assurance generated text -> code-based renderer atau restricted template DSL
```

Yang paling penting bukan engine-nya, tetapi governance:

- template versioning;
- variable schema;
- escaping;
- approval;
- preview;
- test;
- audit.

---

## 13. Rendering Pipeline

Rendering sebaiknya bukan satu method besar.

Pipeline ideal:

```text
TemplateRequest
    │
    ▼
Resolve Template Version
    │
    ▼
Validate Data Against Schema
    │
    ▼
Normalize Locale/Timezone/Formatting
    │
    ▼
Render Subject
    │
    ▼
Render Plain Text
    │
    ▼
Render HTML
    │
    ▼
Post-process HTML
    │
    ▼
Build RenderedNotification
    │
    ▼
Persist Render Snapshot
```

### 13.1 Template Request

```java
record TemplateRenderRequest(
    String templateKey,
    Channel channel,
    Locale locale,
    String tenant,
    int version,
    Object model,
    ZoneId recipientZone
) {}
```

### 13.2 Render Result

```java
record RenderedEmail(
    String templateKey,
    int templateVersion,
    Locale locale,
    String subject,
    String plainTextBody,
    String htmlBody,
    List<RenderedAttachment> attachments,
    Map<String, Object> redactedModelSnapshot
) {}
```

### 13.3 Render Error

Jangan lempar raw template exception ke caller.

Normalize:

```text
TEMPLATE_NOT_FOUND
TEMPLATE_NOT_ACTIVE
TEMPLATE_SCHEMA_MISMATCH
TEMPLATE_RENDER_FAILED
TEMPLATE_OUTPUT_INVALID
TEMPLATE_UNAPPROVED
LOCALE_NOT_SUPPORTED
```

---

## 14. Subject, Plain Text, HTML: Tiga Artefact Berbeda

Email template biasanya punya minimal:

```text
subject template
plain text body template
HTML body template
```

Jangan hanya punya HTML.

Plain text tetap penting untuk:

- accessibility;
- client compatibility;
- spam filtering quality;
- fallback;
- security review;
- easier audit reading.

### 14.1 Subject Template

Subject harus:

- pendek;
- tidak mengandung newline;
- tidak mengandung header injection;
- tidak terlalu banyak PII;
- punya correlation business reference jika perlu.

Contoh:

```text
Application {{applicationNo}} has been approved
```

Hindari:

```text
Dear {{fullName}} NRIC {{nationalId}}, your application has been approved
```

### 14.2 Plain Text Body

Plain text bukan hasil strip HTML sembarangan.

Lebih baik punya template sendiri.

Contoh:

```text
Dear {{recipientName}},

Your application {{applicationNo}} has been approved.

You may log in to view the approval details:
{{portalUrl}}

Regards,
{{agencyName}}
```

### 14.3 HTML Body

HTML body harus memperhatikan:

- email client compatibility;
- inline CSS;
- table layout jika perlu;
- alt text image;
- dark mode;
- safe links;
- no script;
- no external CSS dependency critical.

---

## 15. Localization and Formatting

Localization bukan sekadar menerjemahkan text.

Hal yang perlu dilokalkan:

- subject;
- body;
- date format;
- time format;
- number format;
- currency;
- timezone;
- salutation;
- pluralization;
- legal wording;
- support contact;
- portal link/domain;
- attachment language.

### 15.1 Locale Resolution

Urutan umum:

```text
recipient explicit preference
  -> organization preference
  -> tenant default
  -> system default
```

Namun untuk regulatory notice, policy bisa menentukan bahasa resmi.

### 15.2 Timezone

Jangan format tanggal/waktu dengan server timezone.

Buruk:

```java
LocalDateTime.now().toString()
```

Lebih baik:

```java
ZonedDateTime eventTime = event.occurredAt().atZone(recipientZone);
DateTimeFormatter formatter = DateTimeFormatter.ofPattern("dd MMM yyyy, HH:mm", locale);
```

### 15.3 Render Snapshot Harus Menyimpan Locale

Simpan:

```text
locale = en-SG
timezone = Asia/Singapore
template_version = 5
```

Ini penting saat user mempertanyakan email lama.

---

## 16. Recipient Resolution

Domain sering tidak punya email final. Ia punya role.

Contoh:

```text
Send to applicant
Send to assigned officer
Send to company admin
Send to all active directors
Send to supervisor of current handler
```

Recipient resolution adalah layer sendiri.

```text
RecipientSelector -> ResolvedRecipient[]
```

### 16.1 RecipientSelector

```java
sealed interface RecipientSelector permits UserRecipient, RoleRecipient, EmailRecipient {
}

record UserRecipient(String userId) implements RecipientSelector {}
record RoleRecipient(String aggregateType, String aggregateId, String role) implements RecipientSelector {}
record EmailRecipient(String email, String displayName) implements RecipientSelector {}
```

Untuk Java 8, gunakan interface biasa + enum type.

### 16.2 ResolvedRecipient

```java
record ResolvedRecipient(
    String recipientId,
    String email,
    String displayName,
    Locale preferredLocale,
    ZoneId timezone,
    RecipientCategory category
) {}
```

### 16.3 Snapshot

Simpan snapshot recipient saat render/send:

```text
email
masked_email
display_name
recipient_id
recipient_type
locale
timezone
organization
```

Jangan hanya menyimpan user ID, karena data user bisa berubah.

---

## 17. Preference and Policy Check

Tidak semua notification boleh dikirim ke semua channel.

### 17.1 Preference

User preference:

```text
CASE_UPDATE_EMAIL = true
MARKETING_EMAIL = false
SECURITY_EMAIL = true
```

### 17.2 Policy

System policy:

```text
PASSWORD_RESET must be EMAIL
LEGAL_NOTICE must be EMAIL and AUDIT
MARKETING requires consent and unsubscribe
SECURITY_ALERT ignores marketing opt-out
```

### 17.3 Decision Result

Jangan hanya boolean.

Gunakan decision object:

```java
record NotificationPolicyDecision(
    boolean allowed,
    String reasonCode,
    List<Channel> allowedChannels,
    boolean requiresAudit,
    boolean requiresUnsubscribeLink
) {}
```

Reason code contoh:

```text
ALLOWED_TRANSACTIONAL
BLOCKED_USER_OPT_OUT
BLOCKED_NO_VERIFIED_EMAIL
BLOCKED_SUPPRESSED_RECIPIENT
ALLOWED_LEGAL_MANDATORY
BLOCKED_TENANT_POLICY
```

Ini membantu audit dan support.

---

## 18. Notification State Model

Pisahkan state berdasarkan layer.

### 18.1 Notification Intent State

```text
CREATED
RESOLVED
SKIPPED_BY_POLICY
RENDERED
QUEUED
COMPLETED
FAILED
CANCELLED
```

### 18.2 Render State

```text
PENDING
SUCCESS
FAILED_TEMPLATE_NOT_FOUND
FAILED_SCHEMA_MISMATCH
FAILED_RENDER_ERROR
```

### 18.3 Channel Message State

```text
CREATED
QUEUED
SENDING
SENT_TO_PROVIDER
FAILED_RETRYABLE
FAILED_PERMANENT
SUPPRESSED
BOUNCED
COMPLAINED
DELIVERED
```

### 18.4 Attempt State

```text
STARTED
SMTP_ACCEPTED
PROVIDER_ACCEPTED
TIMEOUT
AUTH_FAILED
RECIPIENT_REJECTED
CONTENT_REJECTED
RATE_LIMITED
UNKNOWN_ERROR
```

State separation mencegah ambiguity.

---

## 19. Database Model Reference

Berikut model konseptual. Sesuaikan dengan kebutuhan.

### 19.1 notification_intent

```sql
CREATE TABLE notification_intent (
    id                  VARCHAR(36) PRIMARY KEY,
    notification_type   VARCHAR(100) NOT NULL,
    aggregate_type      VARCHAR(100),
    aggregate_id        VARCHAR(100),
    actor_type          VARCHAR(50),
    actor_id            VARCHAR(100),
    priority            VARCHAR(30) NOT NULL,
    status              VARCHAR(50) NOT NULL,
    idempotency_key     VARCHAR(200) NOT NULL,
    created_at          TIMESTAMP NOT NULL,
    updated_at          TIMESTAMP NOT NULL,
    UNIQUE (idempotency_key)
);
```

### 19.2 notification_recipient

```sql
CREATE TABLE notification_recipient (
    id                  VARCHAR(36) PRIMARY KEY,
    notification_id     VARCHAR(36) NOT NULL,
    recipient_id        VARCHAR(100),
    recipient_type      VARCHAR(50),
    email               VARCHAR(320),
    masked_email        VARCHAR(320),
    display_name        VARCHAR(300),
    locale              VARCHAR(20),
    timezone            VARCHAR(100),
    policy_decision     VARCHAR(100),
    created_at          TIMESTAMP NOT NULL
);
```

### 19.3 notification_template

```sql
CREATE TABLE notification_template (
    id                  VARCHAR(36) PRIMARY KEY,
    template_key        VARCHAR(100) NOT NULL,
    version             INTEGER NOT NULL,
    channel             VARCHAR(30) NOT NULL,
    locale              VARCHAR(20) NOT NULL,
    tenant              VARCHAR(100),
    status              VARCHAR(30) NOT NULL,
    subject_template    CLOB,
    text_template       CLOB,
    html_template       CLOB,
    variable_schema     CLOB,
    created_by          VARCHAR(100),
    created_at          TIMESTAMP NOT NULL,
    approved_by         VARCHAR(100),
    approved_at         TIMESTAMP,
    activated_at        TIMESTAMP,
    UNIQUE (template_key, version, channel, locale, tenant)
);
```

### 19.4 rendered_notification

```sql
CREATE TABLE rendered_notification (
    id                  VARCHAR(36) PRIMARY KEY,
    notification_id     VARCHAR(36) NOT NULL,
    recipient_id        VARCHAR(36) NOT NULL,
    template_key        VARCHAR(100) NOT NULL,
    template_version    INTEGER NOT NULL,
    channel             VARCHAR(30) NOT NULL,
    locale              VARCHAR(20) NOT NULL,
    subject_rendered    CLOB,
    text_rendered       CLOB,
    html_rendered       CLOB,
    model_snapshot      CLOB,
    model_hash          VARCHAR(128),
    rendered_at         TIMESTAMP NOT NULL
);
```

### 19.5 email_delivery_outbox

```sql
CREATE TABLE email_delivery_outbox (
    id                      VARCHAR(36) PRIMARY KEY,
    rendered_notification_id VARCHAR(36) NOT NULL,
    provider                VARCHAR(100),
    from_address            VARCHAR(320) NOT NULL,
    to_address              VARCHAR(320) NOT NULL,
    subject_snapshot        VARCHAR(998),
    status                  VARCHAR(50) NOT NULL,
    attempt_count           INTEGER NOT NULL,
    next_attempt_at         TIMESTAMP,
    last_error_code         VARCHAR(100),
    provider_message_id     VARCHAR(300),
    created_at              TIMESTAMP NOT NULL,
    updated_at              TIMESTAMP NOT NULL
);
```

### 19.6 email_delivery_attempt

```sql
CREATE TABLE email_delivery_attempt (
    id                  VARCHAR(36) PRIMARY KEY,
    outbox_id           VARCHAR(36) NOT NULL,
    attempt_no          INTEGER NOT NULL,
    status              VARCHAR(50) NOT NULL,
    smtp_code           VARCHAR(20),
    provider_response   CLOB,
    error_message       CLOB,
    started_at          TIMESTAMP NOT NULL,
    completed_at        TIMESTAMP
);
```

---

## 20. Store Rendered Output or Not?

Ini keputusan architecture penting.

### 20.1 Option A — Store Only Template ID + Data

Kelebihan:

- storage lebih kecil;
- data normalization lebih baik;
- bisa re-render dengan template terbaru jika memang diinginkan.

Kekurangan:

- audit lemah;
- output lama bisa berubah saat re-render;
- template engine/version behavior bisa berubah;
- data reference mungkin berubah;
- sulit membuktikan isi email asli.

### 20.2 Option B — Store Rendered Subject/Body

Kelebihan:

- audit kuat;
- resend exact content lebih mudah;
- support/debugging lebih mudah;
- dispute handling lebih defensible.

Kekurangan:

- menyimpan PII lebih banyak;
- perlu retention policy;
- perlu encryption/redaction/access control;
- storage lebih besar.

### 20.3 Option C — Store Rendered Hash + Secure Archive

Untuk highly sensitive content:

- database menyimpan hash/metadata;
- rendered content disimpan di secure object storage;
- access controlled;
- encrypted;
- retention managed.

### 20.4 Rekomendasi

Untuk sistem regulatori/enterprise:

```text
Transactional low sensitivity:
  store rendered subject + text/html snapshot with retention.

High sensitivity:
  store metadata + hash + secure encrypted archive or store minimal notice with secure portal link.

Marketing:
  store campaign/template version + recipient status; content snapshot optional depending compliance.
```

---

## 21. Attachment as Template Output

Attachment bisa berasal dari:

1. static template attachment;
2. generated PDF;
3. uploaded document;
4. report export;
5. regulatory notice;
6. receipt/invoice.

Attachment harus dimodelkan, bukan sekadar `File`.

```java
record AttachmentRef(
    String id,
    String filename,
    String contentType,
    long sizeBytes,
    AttachmentSourceType sourceType,
    String storageKey,
    String sha256,
    boolean containsPii,
    boolean requiresEncryption
) {}
```

### 21.1 Attachment Policy

Sebelum dikirim:

- apakah file allowed type?
- ukuran maksimum?
- perlu virus scan?
- perlu password protection?
- boleh dikirim via email atau harus secure link?
- retention berapa lama?
- apakah recipient authorized melihat file?

### 21.2 Secure Link vs Attachment

Untuk dokumen sensitif, lebih baik:

```text
Email contains notification + secure portal link
Attachment remains in authenticated system
```

Daripada:

```text
Email contains sensitive PDF attachment
```

Trade-off:

| Approach | Kelebihan | Risiko |
|---|---|---|
| Attachment | mudah untuk user | data leak, forwarding, mailbox compromise |
| Secure link | access control, revocation, audit | user harus login, UX lebih panjang |

---

## 22. Preview Architecture

Business user sering butuh preview template.

Preview bukan sekadar render dengan dummy data.

Preview harus mencakup:

- sample data valid;
- locale;
- subject;
- text body;
- HTML body;
- attachments placeholder;
- mobile preview;
- dark mode note;
- missing variable warning;
- PII marker;
- approval status;
- diff antar versi.

### 22.1 Sample Data

Schema bisa menyimpan example:

```json
{
  "recipientName": { "type": "string", "example": "Fajar Abdi" },
  "applicationNo": { "type": "string", "example": "APP-2026-0001" }
}
```

Preview engine bisa generate model dari example.

### 22.2 Preview Endpoint

```http
POST /admin/templates/{templateId}/preview
Content-Type: application/json

{
  "locale": "en-SG",
  "model": {
    "recipientName": "Fajar Abdi",
    "applicationNo": "APP-2026-0001"
  }
}
```

Response:

```json
{
  "subject": "Application APP-2026-0001 has been approved",
  "textBody": "Dear Fajar Abdi,...",
  "htmlBody": "<html>...</html>",
  "warnings": []
}
```

### 22.3 Preview Security

Admin preview harus tetap aman:

- jangan allow arbitrary file read;
- jangan render script;
- jangan leak real PII by default;
- restrict template author permissions;
- sanitize preview iframe if exposed in browser.

---

## 23. Approval Workflow

Untuk production enterprise, template change sering perlu approval.

Minimal approval record:

```text
template_id
version
submitted_by
submitted_at
reviewed_by
reviewed_at
decision
comment
```

### 23.1 Approval Policy

Contoh:

```text
Security templates require Security Team approval.
Legal notices require Legal approval.
Marketing templates require Marketing + Compliance approval.
Simple operational notices require Product Owner approval.
```

### 23.2 Separation of Duties

Jangan biarkan orang yang mengedit langsung approve template sensitive.

```text
created_by != approved_by
```

### 23.3 Diff Review

Reviewer harus melihat:

- subject diff;
- HTML diff;
- plain text diff;
- variable schema diff;
- attachment diff;
- unsubscribe/policy change;
- PII classification change.

---

## 24. Template Compatibility and Migration

Template berubah, data model berubah.

### 24.1 Backward-Compatible Change

Contoh:

- typo fix;
- optional variable baru;
- styling minor;
- copy improvement tanpa semantic change.

Tetap sebaiknya buat version baru jika audit penting.

### 24.2 Breaking Change

Contoh:

- rename required variable;
- hapus variable;
- ubah legal wording;
- ubah attachment requirement;
- ubah recipient instruction;
- ubah channel/policy.

Breaking change harus melalui approval dan regression test.

### 24.3 Contract Test

Untuk setiap active template:

```text
Given sample valid model
When template rendered
Then subject non-empty
And text body non-empty
And HTML body valid enough
And no unresolved placeholder remains
And required links exist
And unsubscribe exists if required
```

### 24.4 Template Migration Checklist

```text
[ ] New version created
[ ] Variable schema updated
[ ] Sample data updated
[ ] Preview reviewed
[ ] Plain text reviewed
[ ] HTML reviewed
[ ] Localization reviewed
[ ] Legal/compliance approval done
[ ] Snapshot tests updated
[ ] Rollback plan exists
[ ] Active version switched atomically
```

---

## 25. Multi-Channel Notification Design

Jangan desain semua notification sebagai email.

Buat abstraction:

```java
interface NotificationChannelRenderer {
    Channel channel();
    RenderedChannelMessage render(NotificationIntent intent, ResolvedRecipient recipient);
}
```

Email renderer menghasilkan:

```text
subject
plain text
HTML
attachments
headers metadata
```

SMS renderer menghasilkan:

```text
short text
sender id
unicode flag
segment count
```

In-app renderer menghasilkan:

```text
title
summary
body
link
action buttons
```

### 25.1 Channel Capability Matrix

| Capability | Email | SMS | In-App | Push |
|---|---:|---:|---:|---:|
| Long content | Yes | No | Medium | No |
| Attachment | Yes | No | Link only | No |
| Rich HTML | Yes | No | App-specific | No |
| Delivery feedback | Partial | Provider-specific | Strong | Provider-specific |
| User must be reachable externally | Yes | Yes | No | Yes |
| Best for legal notice | Sometimes | Rare | Sometimes | No |
| Best for quick alert | Maybe | Yes | Yes | Yes |

### 25.2 Channel Selection

Channel selection should consider:

- notification type;
- urgency;
- sensitivity;
- user preference;
- policy;
- verified contact availability;
- fallback strategy.

Example:

```text
PASSWORD_RESET:
  primary = EMAIL
  fallback = none

CASE_ESCALATED:
  primary = IN_APP
  secondary = EMAIL

PAYMENT_RECEIPT:
  primary = EMAIL
  fallback = PORTAL_DOWNLOAD

SECURITY_ALERT:
  primary = EMAIL
  secondary = SMS if enabled
```

---

## 26. Notification Orchestration Flow

End-to-end flow:

```text
1. Domain event occurs
2. Notification intent created idempotently
3. Recipients resolved
4. Policy/preference evaluated
5. Template selected by type/channel/locale/tenant
6. Data model assembled
7. Data validated against schema
8. Template rendered
9. Rendered snapshot persisted
10. Channel outbox created
11. Worker sends via provider
12. Attempts recorded
13. Feedback updates delivery status
14. Notification completes or requires action
```

### 26.1 Pseudocode

```java
public void handle(ApplicationApproved event) {
    NotificationIntent intent = intentService.createIfAbsent(
        NotificationType.APPLICATION_APPROVED,
        event.idempotencyKey(),
        event.aggregateRef(),
        event.actorRef()
    );

    List<ResolvedRecipient> recipients = recipientResolver.resolve(
        RecipientSelector.applicant(event.applicationId())
    );

    for (ResolvedRecipient recipient : recipients) {
        NotificationPolicyDecision decision = policyEngine.evaluate(intent, recipient, Channel.EMAIL);

        if (!decision.allowed()) {
            notificationLog.skipped(intent.id(), recipient, decision.reasonCode());
            continue;
        }

        TemplateVersion template = templateSelector.select(
            intent.type(),
            Channel.EMAIL,
            recipient.preferredLocale(),
            event.tenant()
        );

        ApplicationApprovedTemplateModel model = dataAssembler.applicationApproved(event, recipient);

        RenderedEmail rendered = templateRenderer.renderEmail(template, model, recipient);

        renderedRepository.save(intent, recipient, rendered);

        emailOutbox.enqueue(intent, recipient, rendered);
    }
}
```

---

## 27. Clean Java API Design

### 27.1 Domain API

```java
public interface NotificationPublisher {
    void publish(NotificationIntent intent);
}
```

### 27.2 Template Selection

```java
public interface TemplateSelector {
    TemplateVersion select(
        NotificationType type,
        Channel channel,
        Locale locale,
        String tenant
    );
}
```

### 27.3 Rendering

```java
public interface TemplateRenderer<T> {
    RenderedEmail renderEmail(TemplateVersion template, T model, ResolvedRecipient recipient);
}
```

### 27.4 Delivery

```java
public interface EmailDeliveryGateway {
    EmailProviderResult send(EmailDeliveryMessage message);
}
```

### 27.5 Separation

Jangan jadikan `EmailDeliveryGateway` menerima template key.

Buruk:

```java
emailGateway.sendTemplate("APPLICATION_APPROVED", data);
```

Lebih baik:

```java
RenderedEmail rendered = templateRenderer.render(...);
emailGateway.send(EmailDeliveryMessage.from(rendered));
```

Karena gateway tugasnya delivery, bukan memilih dan merender template.

---

## 28. Java 8 vs Java 21/25 Design Note

### 28.1 Java 8

Gunakan:

- POJO;
- builder manual;
- interface biasa;
- enum;
- `Optional` secukupnya;
- JavaMail `javax.mail` jika legacy;
- FreeMarker/Thymeleaf versi compatible;
- outbox worker dengan executor biasa.

Contoh model Java 8:

```java
public final class RenderedEmail {
    private final String templateKey;
    private final int templateVersion;
    private final Locale locale;
    private final String subject;
    private final String plainTextBody;
    private final String htmlBody;

    public RenderedEmail(
            String templateKey,
            int templateVersion,
            Locale locale,
            String subject,
            String plainTextBody,
            String htmlBody) {
        this.templateKey = templateKey;
        this.templateVersion = templateVersion;
        this.locale = locale;
        this.subject = subject;
        this.plainTextBody = plainTextBody;
        this.htmlBody = htmlBody;
    }

    public String getTemplateKey() { return templateKey; }
    public int getTemplateVersion() { return templateVersion; }
    public Locale getLocale() { return locale; }
    public String getSubject() { return subject; }
    public String getPlainTextBody() { return plainTextBody; }
    public String getHtmlBody() { return htmlBody; }
}
```

### 28.2 Java 17/21/25

Gunakan:

- records untuk immutable DTO;
- sealed interfaces untuk selector/result taxonomy;
- pattern matching jika sesuai;
- virtual threads untuk blocking delivery worker jika cocok;
- Jakarta Mail `jakarta.mail`;
- modern Spring Boot/Jakarta EE.

Contoh:

```java
public record RenderedEmail(
    String templateKey,
    int templateVersion,
    Locale locale,
    String subject,
    String plainTextBody,
    String htmlBody,
    List<RenderedAttachment> attachments
) {}
```

Untuk type-safe error:

```java
sealed interface TemplateRenderResult permits TemplateRenderSuccess, TemplateRenderFailure {
}

record TemplateRenderSuccess(RenderedEmail email) implements TemplateRenderResult {
}

record TemplateRenderFailure(String code, String message) implements TemplateRenderResult {
}
```

---

## 29. Escaping and Injection Risk

Template rendering bisa menjadi security boundary.

### 29.1 HTML Escaping

User-supplied value harus escaped.

Contoh dangerous:

```html
<p>${userComment}</p>
```

Jika engine tidak auto-escape, comment bisa inject HTML.

Walaupun email client biasanya tidak menjalankan script modern, HTML injection tetap bisa:

- merusak layout;
- menyisipkan phishing link;
- menyamarkan instruction;
- membocorkan trust.

### 29.2 URL Injection

Jangan langsung render URL dari user input.

Buruk:

```html
<a href="${redirectUrl}">View details</a>
```

Validasi:

- allowlist domain;
- gunakan server-generated URL;
- sign token jika perlu;
- jangan pakai arbitrary redirect.

### 29.3 Header Injection

Subject, From display name, Reply-To tidak boleh mengandung CRLF.

Validasi:

```java
static String rejectHeaderInjection(String value) {
    if (value == null) return null;
    if (value.contains("\r") || value.contains("\n")) {
        throw new IllegalArgumentException("Header value contains CRLF");
    }
    return value;
}
```

### 29.4 Template Logic Abuse

Jika business user bisa edit template, jangan beri akses ke powerful expression yang bisa:

- memanggil method arbitrary;
- membaca system property;
- melakukan network/file access;
- mengakses object internal.

Gunakan restricted data model.

---

## 30. Template Testing Strategy

Testing template harus otomatis.

### 30.1 Syntax Test

Semua active template harus parseable.

```text
For each active template:
  parse subject
  parse text body
  parse html body
```

### 30.2 Schema Test

```text
Given variable schema
When sample model generated
Then render succeeds
```

### 30.3 Missing Variable Test

```text
Given required variable removed
Then renderer fails with TEMPLATE_SCHEMA_MISMATCH
```

### 30.4 Snapshot Test

Simpan expected output untuk sample model.

```text
APPLICATION_APPROVED_v5_en-SG.subject.snap
APPLICATION_APPROVED_v5_en-SG.text.snap
APPLICATION_APPROVED_v5_en-SG.html.snap
```

### 30.5 Link Test

Pastikan link wajib ada:

```text
portalUrl exists
unsubscribeUrl exists if required
supportUrl exists
```

### 30.6 PII Test

Pastikan subject tidak mengandung forbidden variable.

Contoh rule:

```text
Subject must not contain nationalId
Subject must not contain fullAddress
Subject must not contain dateOfBirth
```

### 30.7 MIME Composition Test

Setelah render, compose email dan assert:

- subject benar;
- plain text body ada;
- HTML body ada;
- multipart/alternative benar;
- attachment sesuai;
- no unresolved placeholder.

---

## 31. Audit Model

Audit untuk notification harus menjawab:

```text
Apa yang dikirim?
Kepada siapa?
Kapan dibuat?
Kapan dikirim?
Template versi berapa?
Data apa yang dipakai?
Siapa/apa yang memicu?
Provider menerima atau menolak?
Apakah ada bounce/complaint?
Apakah user preference dihormati?
```

### 31.1 Audit Fields

Minimal:

```text
notification_id
type
aggregate_ref
actor_ref
recipient_snapshot
template_key
template_version
locale
channel
rendered_hash
rendered_subject
created_at
queued_at
sent_at
provider
provider_message_id
final_delivery_status
```

### 31.2 Rendered Hash

Hash membantu membuktikan content tidak berubah.

```java
String canonical = subject + "\n---TEXT---\n" + textBody + "\n---HTML---\n" + htmlBody;
String sha256 = sha256(canonical);
```

Simpan hash bersama content atau secure archive.

### 31.3 Access Control

Rendered email bisa mengandung PII.

Jangan semua admin bisa melihat full body.

Role contoh:

```text
SUPPORT_LEVEL_1: metadata only
SUPPORT_LEVEL_2: masked content
COMPLIANCE: full content with reason
SYSTEM_ADMIN: no business content by default
```

---

## 32. Resend and Re-render Semantics

Resend adalah sumber bug besar.

Pertanyaan penting:

```text
Saat resend, apakah menggunakan content asli atau render ulang template terbaru?
```

### 32.1 Resend Original

Cocok untuk:

- legal notice;
- receipt;
- approval notice;
- audit-sensitive notification.

Artinya:

```text
same rendered subject/body
same attachment snapshot or archived attachment
new delivery attempt
```

### 32.2 Re-render Latest

Cocok untuk:

- reminder;
- non-legal notification;
- content yang memang harus update.

Risiko:

- wording berubah;
- data berubah;
- attachment berubah;
- dispute.

### 32.3 Recommended API

Jangan punya method ambigu:

```java
resend(notificationId);
```

Lebih baik eksplisit:

```java
resendOriginal(renderedNotificationId, reason);
rerenderAndSend(notificationIntentId, templateVersionPolicy, reason);
```

---

## 33. Template Rollout and Rollback

Template deployment bisa seperti code deployment.

### 33.1 Atomic Activation

Jangan aktifkan template setengah jalan.

Jika satu notification butuh:

- subject;
- text;
- HTML;
- schema;
- locale;

semuanya harus aktif sebagai satu unit.

### 33.2 Canary Template

Untuk volume besar:

```text
10% recipients use v6
90% recipients use v5
```

Hati-hati untuk legal/transactional email; canary wording mungkin tidak diizinkan.

### 33.3 Rollback

Rollback berarti mengubah active version pointer.

```text
APPLICATION_APPROVED active version: 6 -> 5
```

Jangan delete v6; mark as disabled/deprecated.

### 33.4 Activation Audit

Simpan:

```text
activated_by
activated_at
previous_version
new_version
reason
change_ticket
```

---

## 34. Template Governance Model

### 34.1 Ownership

Setiap template harus punya owner.

```text
business_owner
technical_owner
compliance_owner optional
```

### 34.2 Review Cadence

Template tertentu harus direview berkala.

```text
security templates: every 6 months
legal templates: every policy change
marketing templates: every campaign
operational templates: yearly
```

### 34.3 Naming Convention

```text
<DOMAIN>_<EVENT>_<AUDIENCE>
```

Contoh:

```text
APPLICATION_APPROVED_APPLICANT
APPLICATION_APPROVED_OFFICER
CASE_ESCALATED_SUPERVISOR
PAYMENT_RECEIPT_PAYER
PASSWORD_RESET_USER
```

Jika audience berbeda, jangan pakai satu template dengan banyak conditional kompleks.

---

## 35. Conditional Logic: Berapa Banyak Yang Boleh Ada Di Template?

Template boleh punya conditional sederhana:

```text
if remarks exists, show remarks section
if attachment exists, show attachment note
```

Tetapi jangan jadikan template sebagai business rule engine.

Anti-pattern:

```text
if application.type == X and user.role == Y and case.status == Z and tenant == A then show legal clause 1 else if ...
```

Business rule harus berada di data assembly/template selection.

Lebih baik pilih template berbeda:

```text
APPLICATION_APPROVED_INDIVIDUAL
APPLICATION_APPROVED_COMPANY
APPLICATION_APPROVED_RENEWAL
```

Atau assemble explicit variable:

```text
legalClauseText
```

Template hanya render variable tersebut.

---

## 36. Domain Events vs Commands

Notification bisa dibuat dari domain event atau explicit command.

### 36.1 Domain Event

```text
ApplicationApproved occurred -> send notification
```

Kelebihan:

- decoupled;
- natural untuk asynchronous processing;
- mudah extend channel.

Risiko:

- eventual consistency;
- duplicate event;
- ordering.

### 36.2 Command

```text
ApproveApplication command includes send notification step
```

Kelebihan:

- explicit;
- easier transaction orchestration;
- caller tahu outcome intent creation.

Risiko:

- domain service menjadi terlalu tahu notification;
- coupling.

### 36.3 Practical Recommendation

Untuk enterprise:

```text
Domain transaction creates durable notification intent/outbox within same DB transaction.
Worker handles rendering/delivery asynchronously.
```

Ini menghindari:

- lost notification;
- SMTP inside transaction;
- dependency pada broker availability saat domain transaction.

---

## 37. Idempotency in Notification Creation

Notification intent harus idempotent.

Idempotency key contoh:

```text
APPLICATION_APPROVED:{applicationId}:{approvedStatusVersion}:APPLICANT
PASSWORD_RESET:{resetTokenId}:USER
PAYMENT_RECEIPT:{paymentId}:PAYER
```

Jangan gunakan timestamp random sebagai idempotency key.

```java
String key = "APPLICATION_APPROVED:" + applicationId + ":" + decisionVersion + ":APPLICANT";
```

Jika event diproses ulang, sistem tidak membuat notification duplicate.

---

## 38. Template Selection Algorithm

Contoh deterministic algorithm:

```text
Input:
  notificationType
  channel
  recipientLocale
  tenant
  effectiveAt

Steps:
  1. Find active template for exact tenant + exact locale.
  2. Else find active template for exact tenant + default locale.
  3. Else find active template for global tenant + exact locale.
  4. Else find active template for global tenant + default locale.
  5. If none found, fail with TEMPLATE_NOT_FOUND.
```

Pseudo:

```java
TemplateVersion select(NotificationType type, Channel channel, Locale locale, String tenant) {
    List<TemplateCandidateKey> candidates = List.of(
        key(type, channel, locale, tenant),
        key(type, channel, defaultLocaleFor(tenant), tenant),
        key(type, channel, locale, "GLOBAL"),
        key(type, channel, defaultLocale(), "GLOBAL")
    );

    for (TemplateCandidateKey candidate : candidates) {
        Optional<TemplateVersion> found = repository.findActive(candidate);
        if (found.isPresent()) {
            auditFallbackIfNeeded(candidate);
            return found.get();
        }
    }

    throw new TemplateNotFoundException(type, channel, locale, tenant);
}
```

Log jika fallback digunakan:

```text
template fallback: requested id-ID tenant CEA, used en-SG tenant CEA
```

---

## 39. Template Output Validation

Rendering sukses belum cukup.

Validasi output:

- subject not blank;
- subject no CRLF;
- subject length reasonable;
- text body not blank;
- HTML body not blank;
- no unresolved placeholder;
- required links present;
- unsubscribe present if required;
- no forbidden PII in subject;
- max output size;
- attachment count/size within limit.

Example:

```java
public void validate(RenderedEmail email, TemplatePolicy policy) {
    requireNotBlank(email.subject(), "subject");
    rejectCrLf(email.subject());
    requireNotBlank(email.plainTextBody(), "plainTextBody");
    requireNotBlank(email.htmlBody(), "htmlBody");

    if (containsUnresolvedPlaceholder(email.htmlBody())) {
        throw new TemplateOutputInvalidException("UNRESOLVED_PLACEHOLDER");
    }

    if (policy.requiresUnsubscribe() && !email.htmlBody().contains(policy.unsubscribeUrlMarker())) {
        throw new TemplateOutputInvalidException("MISSING_UNSUBSCRIBE");
    }
}
```

---

## 40. Integration With Jakarta Mail / Spring Mail

Template architecture tidak menggantikan Jakarta Mail. Ia memberi input yang bersih ke mail composer.

Flow:

```text
RenderedEmail
    │
    ▼
EmailDeliveryMessage
    │
    ▼
MimeMessage Composer
    │
    ▼
Jakarta Mail / Spring JavaMailSender
```

Spring `JavaMailSender` menambahkan support MIME message dan callback `MimeMessagePreparator`; `MimeMessageHelper` membantu mengisi `MimeMessage`, termasuk encoding dan multipart convenience.

Contoh konseptual Spring:

```java
public void send(EmailDeliveryMessage message) {
    javaMailSender.send(mimeMessage -> {
        MimeMessageHelper helper = new MimeMessageHelper(
            mimeMessage,
            MimeMessageHelper.MULTIPART_MODE_MIXED_RELATED,
            StandardCharsets.UTF_8.name()
        );

        helper.setFrom(message.from());
        helper.setTo(message.to());
        helper.setSubject(message.subject());
        helper.setText(message.textBody(), message.htmlBody());

        for (AttachmentRef attachment : message.attachments()) {
            helper.addAttachment(
                attachment.filename(),
                dataSourceFactory.open(attachment)
            );
        }
    });
}
```

Catatan:

- composer tidak memilih template;
- composer tidak resolve recipient;
- composer tidak cek business policy;
- composer hanya mengubah rendered email menjadi MIME message.

---

## 41. Observability for Template Layer

Metrics penting:

```text
notification_intent_created_total{type}
template_render_success_total{template_key,version,locale,channel}
template_render_failure_total{template_key,error_code}
template_selection_fallback_total{template_key,from_locale,to_locale}
notification_skipped_total{reason_code}
render_latency_seconds{template_key}
outbox_created_total{channel}
```

Log penting:

```text
notification_id
template_key
template_version
locale
channel
recipient_hash
policy_decision
render_result
```

Jangan log full rendered body by default.

---

## 42. Failure Modes

| Failure | Cause | Detection | Mitigation |
|---|---|---|---|
| Template not found | missing active template | render failure metric | fallback/default template or fail fast |
| Schema mismatch | data builder outdated | contract test/runtime validation | versioned schema, CI test |
| Missing locale | untranslated template | fallback log | default locale policy |
| Broken HTML | invalid markup/CSS | snapshot/client preview | review/test pipeline |
| Wrong recipient | bad resolver | audit/support complaint | recipient resolution test |
| Duplicate notification | missing idempotency | duplicate user complaint | unique idempotency key |
| Wrong template version | activation bug | audit diff | atomic active pointer |
| Sensitive data leaked | bad variable in subject/body | PII scan | data classification + validation |
| User opted out but got email | policy bypass | audit complaint | central policy engine |
| Resend changed content | rerender latest accidentally | dispute | explicit resendOriginal API |

---

## 43. Top 1% Heuristics

Seorang engineer yang matang akan menganggap template notification sebagai **regulated content pipeline**, bukan string substitution.

Heuristik desain:

1. **Notification type harus semantic.** Jangan namai berdasarkan channel.
2. **Template harus versioned.** Jangan update active template in-place untuk sistem audit-heavy.
3. **Variable harus punya schema.** Jangan mengandalkan `Map<String,Object>` liar.
4. **Rendered output perlu strategi penyimpanan.** Audit vs privacy harus diputuskan sadar.
5. **Recipient resolution harus snapshot.** Data recipient bisa berubah.
6. **Preference dan policy harus centralized.** Jangan scatter `if (user.isSubscribed())` di banyak service.
7. **Template rendering bukan delivery.** Pisahkan renderer dari gateway.
8. **Resend semantics harus eksplisit.** Original vs rerender latest.
9. **Template change perlu approval.** Terutama legal/security/regulatory content.
10. **Email adalah channel.** Jangan biarkan email mengunci domain notification design.

---

## 44. Reference Architecture

```text
Domain Service
  │ emits durable intent
  ▼
notification_intent table
  │
  ▼
Notification Orchestrator
  ├── RecipientResolver
  ├── PreferencePolicyEngine
  ├── TemplateSelector
  ├── TemplateDataAssembler
  ├── TemplateRenderer
  └── RenderedNotificationRepository
          │
          ▼
email_delivery_outbox
          │
          ▼
Email Worker
  ├── MimeMessageComposer
  ├── EmailDeliveryGateway
  ├── JakartaMail/SpringMail/ProviderAPI
  └── DeliveryAttemptRepository
          │
          ▼
Provider Feedback / Bounce / Webhook Handler
          │
          ▼
Delivery Status Update + Suppression + Audit
```

---

## 45. Practical Checklist

Sebelum mail template system dianggap production-ready:

```text
[ ] Notification type semantic, bukan channel-specific
[ ] Template key/version/channel/locale/tenant jelas
[ ] Active template immutable
[ ] Draft/review/approve/activate lifecycle tersedia
[ ] Variable schema tersedia
[ ] Sample data tersedia
[ ] Preview tersedia
[ ] Plain text dan HTML body tersedia
[ ] Subject validation tersedia
[ ] Header injection prevention tersedia
[ ] HTML escaping policy jelas
[ ] Required links divalidasi
[ ] Recipient resolution centralized
[ ] Preference/policy centralized
[ ] Rendered snapshot strategy diputuskan
[ ] Resend original vs rerender latest eksplisit
[ ] Template tests berjalan di CI
[ ] Template activation audit tersedia
[ ] Delivery outbox terpisah dari render state
[ ] Sensitive body access dikontrol
[ ] Metrics/logs/traces tersedia
[ ] Rollback template bisa dilakukan
```

---

## 46. Ringkasan

Part ini membahas bahwa email template bukan sekadar formatting text, tetapi bagian dari **notification domain architecture**.

Poin utama:

1. Email adalah channel, bukan domain event.
2. Domain harus menerbitkan notification intent yang semantic.
3. Recipient resolution, policy, template selection, rendering, dan delivery harus dipisahkan.
4. Template harus punya identity, version, locale, channel, tenant/context, lifecycle, dan approval.
5. Variable schema penting untuk reliability dan governance.
6. Rendered output perlu strategi audit/privacy yang sadar.
7. Resend harus eksplisit: original atau rerender.
8. Multi-channel design mencegah sistem terkunci pada email.
9. Template testing, preview, diff, dan approval adalah bagian dari engineering quality.
10. Top-tier engineer mendesain notification sebagai pipeline yang reliable, auditable, evolvable, dan compliant.

---

## 47. Latihan

### Latihan 1 — Identifikasi Notification Type

Ambil 10 email dari sistem enterprise yang pernah kamu lihat. Untuk tiap email, tulis:

```text
notification_type
aggregate_type
recipient_role
channel
transactional_or_marketing
audit_required
```

### Latihan 2 — Buat Variable Schema

Untuk notification `APPLICATION_APPROVED`, buat schema lengkap:

- required variables;
- optional variables;
- PII marker;
- example data;
- formatting rules.

### Latihan 3 — Desain State Model

Buat state model untuk:

- notification intent;
- rendered email;
- delivery outbox;
- delivery attempt;
- provider feedback.

Pastikan tidak ada status ambigu seperti `SENT` tanpa definisi.

### Latihan 4 — Resend Policy

Tentukan untuk 5 notification:

```text
resend original atau rerender latest?
```

Jelaskan alasannya.

### Latihan 5 — Template Review Checklist

Buat checklist approval untuk template legal notice yang mengandung attachment PDF.

---

## 48. Referensi

- Jakarta Mail Specification 2.1 — `MimeMessage`, `MimeMultipart`, dan model mail/MIME message.
- Spring Framework Email Integration — `JavaMailSender`, MIME message support, dan `MimeMessagePreparator`.
- Spring Framework `MimeMessageHelper` — helper untuk populasi `MimeMessage` dan encoding.
- Thymeleaf Spring Mail article — contoh penggunaan Thymeleaf untuk composing email text/HTML dengan Spring.
- Apache FreeMarker Manual — konsep template engine untuk menghasilkan text output seperti HTML dan email dari template dan data model.

---

## 49. Status Seri

Seri belum selesai.

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
[x] Part 18 — Jakarta Mail in Spring Boot and Modern Java Applications
[x] Part 19 — Testing Mail Systems
[x] Part 20 — Observability: Logs, Metrics, Tracing, Audit
[x] Part 21 — Performance and Resource Management
[x] Part 22 — Provider Integration Patterns: SMTP Relay vs API-Based Email Provider
[x] Part 23 — Bounce, Complaint, Webhook, and Delivery Feedback Loop
[x] Part 24 — Template Architecture and Domain Notification Design
[ ] Part 25 — Compliance, Privacy, and Regulatory-Grade Mail Systems
[ ] Part 26 — Advanced MIME and Internationalization
[ ] Part 27 — Failure Modelling and Production Incident Playbook
[ ] Part 28 — End-to-End Reference Implementation: Java 8 Legacy and Java 21/25 Modern
[ ] Part 29 — Top 1% Design Review: Evaluating a Mail Subsystem Like an Architect
```


<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 23 — Bounce, Complaint, Webhook, and Delivery Feedback Loop](./23-bounce-complaint-webhook-feedback-loop.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 25 — Compliance, Privacy, and Regulatory-Grade Mail Systems](./25-compliance-privacy-regulatory-mail-systems.md)
