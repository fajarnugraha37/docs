# Part 25 — Compliance, Privacy, and Regulatory-Grade Mail Systems

> Series: `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery`  
> File: `25-compliance-privacy-regulatory-mail-systems.md`  
> Scope: Java 8–25, JavaMail/Jakarta Mail, SMTP/API provider, notification subsystem, auditability, privacy, and regulatory defensibility

---

## 0. Why This Part Exists

Di banyak aplikasi enterprise, email terlihat seperti fitur kecil:

```java
mailService.send(to, subject, body);
```

Namun dalam sistem regulatori, pemerintahan, finansial, legal, healthcare, audit, compliance, atau case management, email bukan hanya “pesan keluar”. Email adalah **evidence-bearing communication side effect**.

Artinya:

- email bisa berisi PII;
- email bisa menjadi bukti bahwa sistem memberi notifikasi;
- email bisa memicu deadline hukum;
- email bisa salah kirim ke penerima yang tidak berhak;
- email bisa mengandung attachment sensitif;
- email bisa tertahan spam filter;
- email bisa gagal sebagian;
- email bisa di-forward oleh penerima;
- email bisa disimpan bertahun-tahun di mailbox eksternal;
- email bisa menjadi bagian dari dispute, investigation, audit, atau legal discovery.

Top engineer tidak melihat email sebagai transport sederhana. Top engineer melihat email sebagai kombinasi dari:

```text
communication channel
+ privacy risk
+ security boundary
+ legal evidence artifact
+ operational workflow
+ audit trail
+ retention object
+ failure-prone distributed system
```

Bagian ini membahas cara mendesain mail subsystem yang **regulatory-grade**: bukan berarti “pasti memenuhi semua hukum”, tetapi desainnya memiliki struktur, traceability, minimization, control, auditability, dan failure semantics yang bisa dipertanggungjawabkan.

---

## 1. Core Mental Model: Email Is Not a Private Transport

Email sering diperlakukan seperti pesan private dari aplikasi ke user. Ini framing yang berbahaya.

Email adalah channel yang:

1. melewati banyak sistem;
2. bisa disimpan oleh sender provider;
3. bisa disimpan oleh recipient provider;
4. bisa diforward;
5. bisa dicetak;
6. bisa tersinkronisasi ke banyak device;
7. bisa terbaca di notification preview;
8. bisa masuk ke spam/quarantine;
9. bisa diakses admin mailbox;
10. bisa menjadi bagian dari backup provider;
11. bisa masuk ke discovery/legal hold;
12. tidak bisa ditarik kembali secara reliable.

Jadi prinsip dasar regulatory-grade email adalah:

> Jangan taruh sesuatu di email kecuali kita siap kehilangan kontrol penuh atas informasi tersebut setelah dikirim.

Ini berbeda dari database internal. Database internal bisa:

- diberi RBAC;
- diaudit;
- dienkripsi;
- dihapus sesuai retention;
- dibatasi aksesnya;
- dikoreksi;
- dimigrasi;
- dilacak lineage-nya.

Email, setelah keluar dari boundary organisasi, sering menjadi **externalized data copy**.

### 1.1 Email Send Is Data Disclosure

Dalam privacy engineering, email bukan hanya notification. Email adalah **data disclosure event**.

Contoh:

```text
User submits complaint
System emails case officer with complainant name, phone, address, allegation text, and PDF evidence
```

Secara teknis ini “send notification”. Secara privacy/compliance ini:

```text
PII copied from controlled case system
→ serialized into MIME message
→ transmitted via SMTP/API provider
→ stored by mail provider
→ delivered to recipient mailbox
→ possibly synced to mobile devices
→ possibly retained beyond case retention
```

Artinya setiap email perlu ditanya:

- data apa yang keluar?
- siapa penerimanya?
- apakah penerima authorized?
- apakah informasi itu perlu ada di body email?
- apakah cukup diberi secure link?
- apakah attachment boleh keluar?
- apakah email perlu direkam sebagai evidence?
- apakah ada retention policy?
- apakah ada suppression/redaction?

---

## 2. Regulatory-Grade Does Not Mean “Legal Advice in Code”

Engineer tidak menggantikan legal/compliance team. Namun engineer bertanggung jawab mendesain sistem yang:

1. bisa dikontrol;
2. bisa diaudit;
3. bisa dikonfigurasi;
4. bisa dibatasi;
5. bisa dijelaskan;
6. bisa direkonstruksi;
7. tidak menyebarkan data secara sembarangan.

Regulatory-grade system bukan system yang hardcode semua aturan hukum di service method.

Regulatory-grade system adalah system yang punya **explicit policy boundary**.

```text
Business Event
    ↓
Notification Policy
    ↓
Recipient Authorization
    ↓
Data Minimization
    ↓
Template Rendering
    ↓
Delivery Pipeline
    ↓
Audit Evidence
    ↓
Retention / Suppression / Feedback
```

Jika semua logic tersebar seperti ini:

```java
if (caseStatus.equals("APPROVED")) {
    mailService.send(user.getEmail(), "Approved", "Your case " + case.getFullDetails());
}
```

maka sulit menjawab:

- siapa memutuskan email ini perlu dikirim?
- mengapa penerima ini berhak?
- template versi mana yang dipakai?
- field apa saja yang dikirim?
- apakah ada data sensitif?
- apakah email berhasil?
- apakah email bounce?
- apakah body lama bisa direkonstruksi?
- apakah user sudah unsubscribe untuk kategori ini?
- apakah email seharusnya tidak dikirim karena legal hold/privacy restriction?

---

## 3. Important Distinction: Notification, Communication, Evidence

Sebelum mendesain email, bedakan tiga hal ini.

### 3.1 Notification

Notification berarti sistem memberi tahu bahwa sesuatu terjadi.

Contoh:

```text
Your case status has changed.
Please log in to view details.
```

Biasanya data minimization tinggi. Body email tidak perlu membawa detail sensitif.

### 3.2 Communication

Communication berarti email membawa isi komunikasi substantif.

Contoh:

```text
Your license renewal application is rejected because document X is missing.
Please submit Y before 2026-07-01.
```

Email mulai menjadi bagian dari business record.

### 3.3 Evidence

Evidence berarti email digunakan sebagai bukti bahwa sistem/agency/company telah mengirim pemberitahuan tertentu.

Contoh:

```text
Statutory Notice of Enforcement Action
```

Untuk tipe ini, audit dan retention jauh lebih penting.

### 3.4 Design Consequence

| Type | Body Detail | Attachment | Audit Need | Delivery Feedback | Retention |
|---|---:|---:|---:|---:|---:|
| Notification | Low | Rare | Medium | Medium | Short/medium |
| Communication | Medium | Sometimes | High | High | Medium/long |
| Evidence | High/controlled | Controlled | Very high | Very high | Formal |

Jadi jangan hanya punya satu method:

```java
sendEmail(...)
```

Lebih baik domain model-nya membedakan intent:

```java
enum NotificationCriticality {
    INFORMATIONAL,
    BUSINESS_COMMUNICATION,
    STATUTORY_NOTICE,
    SECURITY_ALERT
}
```

---

## 4. PII and Sensitive Data in Email

PII bukan hanya national ID atau passport number. Dalam konteks email subsystem, PII dapat berupa:

- email address;
- name;
- phone number;
- postal address;
- case ID jika bisa dikaitkan ke individu;
- application ID;
- license number;
- account number;
- IP address;
- device identifier;
- complaint content;
- uploaded document;
- free-text narrative;
- combination of quasi-identifiers.

NIST SP 800-122 menekankan bahwa PII perlu diperlakukan berbeda karena harus dilindungi dan dikumpulkan/dipelihara/disebar sesuai kebutuhan hukum, regulasi, dan kebijakan organisasi. Referensi: NIST SP 800-122, *Guide to Protecting the Confidentiality of Personally Identifiable Information*.

### 4.1 Email Address Itself Is Sensitive Operationally

Banyak engineer menganggap email address aman untuk log karena “hanya email”. Namun email address sering cukup untuk:

- mengidentifikasi individu;
- menghubungkan user dengan case tertentu;
- membuat social engineering;
- mengekspos domain perusahaan;
- menebak role;
- melakukan credential stuffing;
- melakukan targeted phishing.

Logging seperti ini berisiko:

```text
Sending enforcement notice to jane.doe@example.com for case ENF-2026-000123
```

Lebih baik:

```text
mail.send.attempt notificationId=N-123 recipientHash=hmac:91af... category=STATUTORY_NOTICE caseRef=internal:456
```

### 4.2 Data Classification for Email Content

Setiap template sebaiknya memiliki klasifikasi.

```java
enum DataClassification {
    PUBLIC,
    INTERNAL,
    CONFIDENTIAL,
    RESTRICTED,
    HIGHLY_RESTRICTED
}
```

Contoh mapping:

| Content | Classification | Email Body Allowed? | Attachment Allowed? |
|---|---|---:|---:|
| Generic account notification | Internal | Yes | No |
| Case status changed | Confidential | Minimal only | No |
| Enforcement notice | Restricted | Controlled | Maybe, with policy |
| Identity document | Highly restricted | No | Usually no |
| Password reset link | Restricted | Yes, short-lived | No |

### 4.3 Free Text Is Dangerous

Free text adalah sumber risiko terbesar.

Contoh:

```text
Officer remarks
Complaint description
Investigation notes
Appeal reason
Internal assessment
```

Free text bisa mengandung:

- PII tidak terstruktur;
- accusation;
- legal opinion;
- health info;
- financial info;
- offensive content;
- internal-only remarks;
- secrets accidentally pasted by user/staff.

Rule praktis:

> Jangan masukkan free text ke email kecuali field tersebut memang diklasifikasi aman untuk external communication.

Lebih aman:

```text
A new comment has been added. Please log in to view it.
```

Daripada:

```text
Officer comment: suspected fraudulent conduct by Mr. X based on document Y...
```

---

## 5. Data Minimization Pattern

Data minimization berarti email hanya membawa data yang diperlukan untuk tujuan komunikasinya.

### 5.1 Bad Pattern: Full Detail Email

```text
Subject: Case ENF-2026-000123 Updated

Dear Jane,

Your enforcement case ENF-2026-000123 regarding complaint against ABC Pte Ltd has been escalated.
Attached are all submitted documents and officer remarks.
```

Masalah:

- subject membocorkan case type;
- body membocorkan entity;
- attachment menyebarkan dokumen;
- officer remarks mungkin internal;
- email client preview bisa menampilkan informasi sensitif.

### 5.2 Better Pattern: Minimal Notification

```text
Subject: Case update available

Dear Jane,

There is an update to your case.
Please sign in to the official portal to view the details.

Reference: ENF-2026-000123
```

Masih ada reference, tetapi detail substantif tetap di portal.

### 5.3 Even Safer Pattern: Abstract Reference

```text
Subject: Case update available

Dear Jane,

There is an update to your case.
Please sign in to the official portal to view the details.
```

Reference tidak ditampilkan jika tidak dibutuhkan.

### 5.4 Decision Matrix

| Question | If Yes | If No |
|---|---|---|
| Apakah penerima perlu action langsung dari email? | Beri safe call-to-action | Body minimal |
| Apakah detail sensitif diperlukan untuk memahami email? | Pertimbangkan secure portal | Jangan kirim detail |
| Apakah attachment wajib secara hukum/proses? | Gunakan secure attachment policy | Kirim link |
| Apakah subject bisa dibaca orang lain di lock screen? | Jangan taruh detail sensitif | Subject boleh lebih spesifik |
| Apakah email akan menjadi evidence? | Simpan template version + rendered snapshot | Simpan metadata cukup |

---

## 6. Secure Link Instead of Attachment

Attachment sering menggoda karena mudah:

```java
helper.addAttachment("notice.pdf", pdfFile);
```

Namun untuk sensitive document, attachment berarti dokumen keluar dari controlled system.

Alternatif: kirim secure link.

```text
Please sign in to view the document.
This link expires in 24 hours.
```

### 6.1 Secure Link Properties

Secure link harus punya:

1. token random kuat;
2. expiry pendek;
3. single-use jika perlu;
4. binding ke authenticated user jika portal login tersedia;
5. revocation support;
6. audit access;
7. no sensitive data in URL path/query jika URL bisa dilog;
8. rate limit;
9. device/session validation jika perlu.

### 6.2 Bad Secure Link

```text
https://example.com/download?caseId=ENF-2026-000123&user=jane@example.com
```

Masalah:

- case ID di URL;
- email address di URL;
- URL bisa masuk log/proxy/browser history;
- mudah ditebak jika case ID sequential;
- tidak jelas expiry.

### 6.3 Better Secure Link

```text
https://example.com/secure/document-access/t/8Kf...random...
```

Token mapping disimpan server-side:

```text
token_hash
purpose = DOCUMENT_ACCESS
subject_type = CASE_DOCUMENT
subject_id = internal-document-id
recipient_user_id = user-id
expires_at
used_at
revoked_at
created_by_notification_id
```

### 6.4 Link vs Attachment Trade-Off

| Factor | Attachment | Secure Link |
|---|---|---|
| Offline availability | High | Low/medium |
| Control after send | Low | Higher |
| Revocation | Almost impossible | Possible |
| Access audit | Weak | Strong |
| User convenience | High | Medium |
| Sensitive data exposure | Higher | Lower |
| Legal evidence snapshot | Easier | Needs content snapshot/versioning |

---

## 7. Password-Protected Attachment: Useful but Often Misunderstood

Kadang organisasi memakai password-protected PDF/ZIP. Ini bukan silver bullet.

Masalah umum:

1. password dikirim di email yang sama;
2. password mudah ditebak, misalnya birth date;
3. file tetap bisa diforward;
4. password policy tidak dikelola;
5. attachment tetap tersimpan di mailbox;
6. audit akses dokumen setelah terkirim hilang;
7. format ZIP/PDF encryption bisa berbeda kekuatannya;
8. user experience buruk.

### 7.1 When It May Be Acceptable

Password-protected attachment bisa masuk akal jika:

- requirement eksternal mewajibkan attachment;
- secure portal tidak tersedia;
- password disampaikan melalui channel berbeda;
- file encryption kuat;
- attachment size kecil;
- data classification mengizinkan;
- retention/audit sudah dipahami.

### 7.2 Better Pattern

```text
Email: “Your document is ready. Please access it through the portal.”
Portal: authenticated access + audit + expiry + revocation
```

---

## 8. Consent, Preference, and Legitimate Communication

Tidak semua email sama. Ada perbedaan antara:

- mandatory transactional email;
- statutory notice;
- security alert;
- operational update;
- marketing/campaign;
- newsletter;
- optional reminder.

### 8.1 Preference Model

```java
record NotificationPreference(
    String userId,
    NotificationCategory category,
    Channel channel,
    boolean enabled,
    Instant updatedAt,
    String source
) {}
```

Contoh kategori:

```java
enum NotificationCategory {
    SECURITY,
    STATUTORY,
    CASE_STATUS,
    PAYMENT,
    REMINDER,
    MARKETING,
    NEWSLETTER
}
```

### 8.2 Not All Categories Are Opt-Outable

| Category | User Can Opt Out? | Reason |
|---|---:|---|
| Security alert | Usually no/limited | Account protection |
| Statutory notice | Usually no | Legal/process requirement |
| Case status | Maybe | Depends policy |
| Marketing | Yes | Consent required in many regimes |
| Newsletter | Yes | User preference |

### 8.3 Suppression List

Suppression list menyimpan recipient yang tidak boleh dikirimi kategori tertentu.

Alasan suppression:

- hard bounce;
- complaint/spam report;
- unsubscribe;
- manual block;
- legal restriction;
- account closed;
- invalid address;
- privacy request.

Model:

```java
record SuppressionEntry(
    String recipientHash,
    NotificationCategory category,
    SuppressionReason reason,
    Instant suppressedAt,
    String source,
    Instant expiresAt
) {}
```

Untuk privacy, simpan HMAC/hash email address, bukan plain email, jika kebutuhan operasional memungkinkan.

---

## 9. Recipient Authorization

Email subsystem sering hanya mengecek address string. Regulatory-grade system harus mengecek **apakah recipient berhak menerima data**.

### 9.1 Bad Pattern

```java
send(case.getApplicantEmail(), template, caseData);
```

Masalah:

- email address mungkin outdated;
- applicant mungkin tidak lagi authorized;
- case mungkin delegated;
- representative mungkin berubah;
- ada privacy restriction;
- ada deceased/closed account scenario;
- ada conflict-of-interest/agency restriction.

### 9.2 Better Pattern

```text
Business Event
    ↓
Resolve intended recipient role
    ↓
Authorize recipient against current case access rules
    ↓
Resolve current verified delivery address
    ↓
Apply suppression/preference/legal restriction
    ↓
Render minimal data allowed for that recipient role
    ↓
Send
```

### 9.3 Recipient Role Matters

```java
enum RecipientRole {
    APPLICANT,
    LICENSEE,
    COMPANY_REPRESENTATIVE,
    CASE_OFFICER,
    SUPERVISOR,
    EXTERNAL_AGENCY,
    LEGAL_REPRESENTATIVE
}
```

Data allowed differs by role.

| Field | Applicant | Officer | External Agency |
|---|---:|---:|---:|
| Case reference | Yes | Yes | Maybe |
| Internal notes | No | Yes | Usually no |
| Personal ID | Masked | Maybe | Policy-based |
| Enforcement classification | Maybe | Yes | Policy-based |
| Attachments | Limited | Yes | Explicit approval |

---

## 10. Template Data Policy

Jangan biarkan template engine bebas menerima seluruh entity.

### 10.1 Bad Pattern

```java
Map<String, Object> model = Map.of("case", caseEntity);
templateEngine.render("case-update", model);
```

Masalah:

- template bisa mengakses field internal;
- lazy-loaded relation bisa terbuka;
- PII bisa bocor karena template berubah;
- domain entity tidak didesain sebagai external communication DTO.

### 10.2 Better Pattern

Gunakan dedicated DTO per template version.

```java
record CaseUpdateEmailModel(
    String recipientDisplayName,
    String portalUrl,
    String safeReference,
    String updateType,
    String supportContact
) {}
```

Lalu mapping dilakukan oleh policy-aware assembler:

```java
CaseUpdateEmailModel assemble(
    CaseAggregate caseAggregate,
    RecipientContext recipient,
    NotificationPolicy policy
) {
    return new CaseUpdateEmailModel(
        recipient.safeDisplayName(),
        linkFactory.portalUrl(),
        policy.allowReference() ? caseAggregate.publicReference() : null,
        policy.publicUpdateType(caseAggregate.status()),
        supportContactProvider.forTenant(caseAggregate.tenantId())
    );
}
```

### 10.3 Template Variable Schema

Setiap template perlu schema:

```yaml
templateId: CASE_STATUS_CHANGED
version: 3
classification: CONFIDENTIAL
variables:
  recipientDisplayName:
    required: true
    pii: true
    source: recipient_profile
  safeReference:
    required: false
    pii: possible
    source: case_public_reference
  updateType:
    required: true
    pii: false
    source: notification_policy
  portalUrl:
    required: true
    pii: false
    source: link_factory
allowedRecipientRoles:
  - APPLICANT
  - LEGAL_REPRESENTATIVE
channels:
  - EMAIL
retentionClass: BUSINESS_COMMUNICATION
```

Manfaat:

- reviewable;
- auditable;
- testable;
- bisa dicek otomatis;
- membantu approval workflow;
- menghindari template liar.

---

## 11. Subject Line Privacy

Subject sering muncul di:

- lock screen;
- notification center;
- smartwatch;
- email preview pane;
- shared mailbox list;
- logs;
- ticketing system jika user forward;
- screenshots.

Jadi subject harus lebih konservatif daripada body.

### 11.1 Risky Subject

```text
Your enforcement case against ABC Pte Ltd has been escalated
```

### 11.2 Better Subject

```text
Case update available
```

### 11.3 Subject Classification Rule

```text
Subject must not contain information more sensitive than PUBLIC/LOW-CONFIDENTIAL unless explicitly approved by template policy.
```

### 11.4 Subject Anti-Patterns

Avoid:

```text
Password reset for jane.doe@example.com
Medical claim rejected
Investigation notice for case ENF-2026-000123
Complaint against your employer
Payment failed for card ending 1234
```

Prefer:

```text
Account security update
Application update available
Action required
Document available
Payment update
```

---

## 12. Logging and Redaction

OWASP Logging Cheat Sheet emphasizes that application logging should be designed carefully for security purposes, and sensitive data must be handled deliberately. For mail subsystem, logging is especially risky because email metadata often identifies a person and context.

### 12.1 Do Not Log Raw MIME by Default

Raw MIME may include:

- all recipients;
- body;
- attachments encoded as base64;
- links/tokens;
- DKIM signatures;
- internal headers;
- provider IDs;
- authentication transcript if debug is unsafe.

Never do this in production default path:

```java
session.setDebug(true);
```

unless output stream is controlled, redacted, and temporary.

### 12.2 Safe Logging Fields

Prefer:

```text
notificationId
correlationId
businessEventId
templateId
templateVersion
recipientRole
recipientHash
classification
provider
attemptNumber
outcome
failureCategory
smtpCode
latencyMs
queueAgeMs
```

Avoid:

```text
raw email address
full name
subject with sensitive details
body
attachment filename if sensitive
attachment content
secure link token
SMTP password
OAuth access token
raw provider webhook body if it contains PII
```

### 12.3 Recipient Hashing

Use keyed HMAC rather than plain hash.

Bad:

```text
sha256("jane@example.com")
```

Why bad:

- email dictionary attack is easy.

Better:

```text
HMAC-SHA256(secretKey, lowercaseTrimmedEmail)
```

Example:

```java
public final class RecipientPseudonymizer {
    private final Mac mac;

    public RecipientPseudonymizer(SecretKey key) throws NoSuchAlgorithmException, InvalidKeyException {
        this.mac = Mac.getInstance("HmacSHA256");
        this.mac.init(key);
    }

    public synchronized String pseudonymize(String email) {
        String normalized = email.trim().toLowerCase(Locale.ROOT);
        byte[] digest = mac.doFinal(normalized.getBytes(StandardCharsets.UTF_8));
        return Base64.getUrlEncoder().withoutPadding().encodeToString(Arrays.copyOf(digest, 16));
    }
}
```

In production, avoid sharing the same HMAC key across unrelated systems unless correlation is intended.

### 12.4 Log Retention

Mail logs often outlive the business object. Define retention:

| Log Type | Contains PII? | Suggested Retention Logic |
|---|---:|---|
| Operational metrics | No/low | Longer allowed |
| Send audit metadata | Pseudonymized | Business retention |
| Raw SMTP transcript | High risk | Disabled or very short |
| Provider webhook body | Possible | Normalize then purge raw |
| Rendered email snapshot | High | Policy-based, access-controlled |

---

## 13. Audit Trail: What Evidence Should Be Stored?

Regulatory-grade mail system usually needs to answer:

1. Was an email intended?
2. Why was it intended?
3. Who/what triggered it?
4. Who was the intended recipient?
5. What template/version was used?
6. What data was included?
7. Was the email rendered successfully?
8. Was it submitted to SMTP/provider?
9. Was it accepted by SMTP/provider?
10. Did it later bounce?
11. Was there a complaint?
12. Was it suppressed or cancelled?
13. Was it retried?
14. Was it manually resent?
15. Was the recipient authorized at time of send?

### 13.1 Minimum Audit Fields

```java
record MailAuditRecord(
    String notificationId,
    String businessEventId,
    String aggregateType,
    String aggregateId,
    String templateId,
    int templateVersion,
    DataClassification classification,
    NotificationCriticality criticality,
    String recipientRole,
    String recipientHash,
    String channel,
    String provider,
    MailDeliveryState state,
    Instant createdAt,
    Instant renderedAt,
    Instant firstAttemptAt,
    Instant lastAttemptAt,
    Integer attemptCount,
    String lastFailureCategory,
    String providerMessageId,
    String smtpCode,
    String policyDecisionId
) {}
```

### 13.2 Rendered Snapshot vs Template + Data

Ada dua strategi.

#### Strategy A: Store rendered snapshot

```text
notification_id
subject_rendered
text_body_rendered
html_body_rendered
attachment_manifest
created_at
```

Pros:

- evidence exact;
- mudah membuktikan isi email saat itu;
- tidak tergantung template lama.

Cons:

- menyimpan PII besar;
- retention/erasure lebih kompleks;
- security lebih berat;
- storage bisa besar.

#### Strategy B: Store template version + input data

```text
template_id
template_version
model_json
renderer_version
```

Pros:

- lebih kecil;
- bisa re-render;
- controlled.

Cons:

- re-render belum tentu identik jika engine/library berubah;
- external asset bisa berubah;
- localization/config bisa berubah;
- sulit membuktikan exact content.

#### Strategy C: Hybrid

Untuk low-risk notification:

```text
store template_id + version + minimal variables + hash of rendered content
```

Untuk statutory/high-evidence notice:

```text
store rendered snapshot + content hash + template/version + policy decision
```

### 13.3 Content Hash

```java
String contentHash = sha256(canonicalSubject + "\n" + canonicalText + "\n" + canonicalHtml);
```

Hash tidak menggantikan content jika perlu evidence exact, tetapi membantu integrity checking.

---

## 14. “Sent”, “Accepted”, “Delivered”, and “Read” Are Different

Dalam SMTP, aplikasi biasanya tahu bahwa message berhasil diserahkan ke relay/provider. Itu bukan bukti bahwa user membaca email.

RFC 5321 adalah spesifikasi basic protocol untuk internet electronic mail transport. SMTP acceptance berarti server menerima tanggung jawab transport pada titik tertentu, bukan jaminan inbox placement atau user read.

### 14.1 State Semantics

```text
CREATED
RENDERED
QUEUED
SEND_ATTEMPTED
ACCEPTED_BY_PROVIDER
BOUNCED
COMPLAINED
DELIVERED_PROVIDER_EVENT
OPENED_TRACKING_EVENT
CLICKED_TRACKING_EVENT
FAILED_PERMANENT
FAILED_RETRYABLE
SUPPRESSED
CANCELLED
```

### 14.2 Evidence Strength

| State | Evidence Strength | Meaning |
|---|---:|---|
| CREATED | Low | App intended notification |
| RENDERED | Medium | Content generated |
| ACCEPTED_BY_PROVIDER | Medium/high | Provider/SMTP accepted handoff |
| DELIVERED event | Higher but provider-dependent | Provider claims delivered to recipient server/mailbox |
| Open pixel | Weak/privacy-sensitive | Image loaded, not necessarily read |
| Click | Medium | Link clicked, may be scanner/proxy |
| Read receipt | Weak | User/client-dependent |
| Portal acknowledgement | Stronger | Authenticated user action |

### 14.3 Dangerous Statement

Avoid saying:

```text
The user received the email.
```

unless you have clear evidence.

Prefer:

```text
The notification was accepted by the email provider at 2026-06-18T10:05:00Z and no bounce has been recorded as of 2026-06-18T12:00:00Z.
```

For regulatory evidence, be precise.

---

## 15. Retention Policy

Mail subsystem produces several artifact types:

1. notification request;
2. rendered body;
3. attachment manifest;
4. attachment copy;
5. provider response;
6. SMTP transcript;
7. failure event;
8. bounce webhook;
9. complaint webhook;
10. metrics;
11. audit logs.

Each needs retention class.

### 15.1 Retention Classes

```java
enum RetentionClass {
    EPHEMERAL_DEBUG,
    OPERATIONAL_METRIC,
    BUSINESS_NOTIFICATION,
    STATUTORY_NOTICE,
    SECURITY_EVENT,
    LEGAL_HOLD
}
```

### 15.2 Example Policy Matrix

| Artifact | Suggested Retention Class | Notes |
|---|---|---|
| SMTP debug transcript | EPHEMERAL_DEBUG | Usually disabled; short retention |
| Queue status | OPERATIONAL_METRIC | May be aggregated |
| Template/version metadata | BUSINESS_NOTIFICATION | Needed for audit |
| Rendered statutory notice | STATUTORY_NOTICE | Access-controlled |
| Bounce event | BUSINESS_NOTIFICATION | Needed for feedback/suppression |
| Complaint event | SECURITY/COMPLIANCE | Needed for suppression/compliance |
| Secure link token | Short-lived | Remove after expiry |
| Attachment copy | Policy-based | Prefer not to duplicate if source exists |

### 15.3 Retention vs Deletion

Regulatory systems often face conflicting requirements:

- keep records for audit;
- delete data after retention expires;
- honor privacy deletion where applicable;
- preserve records under legal hold;
- maintain operational troubleshooting data.

Do not implement deletion as random cron on mail tables. Build explicit lifecycle:

```text
ACTIVE
→ RETENTION_LOCKED
→ ELIGIBLE_FOR_PURGE
→ PURGED_METADATA_ONLY
→ LEGAL_HOLD_OVERRIDDEN
```

---

## 16. Legal Hold

Legal hold means data that would normally be deleted must be preserved because of investigation, litigation, audit, or regulatory process.

### 16.1 Design Consideration

Mail artifacts need to participate in hold decision.

```java
record LegalHoldMarker(
    String subjectType,
    String subjectId,
    String reasonCode,
    Instant placedAt,
    String placedBy,
    Instant releasedAt
) {}
```

Subject can be:

```text
CASE
NOTIFICATION
RECIPIENT
TEMPLATE_VERSION
DOCUMENT
```

### 16.2 Purge Query Must Respect Hold

Bad:

```sql
DELETE FROM mail_notification WHERE created_at < :cutoff;
```

Better:

```sql
DELETE FROM mail_notification n
WHERE n.created_at < :cutoff
  AND n.retention_state = 'ELIGIBLE_FOR_PURGE'
  AND NOT EXISTS (
      SELECT 1
      FROM legal_hold h
      WHERE h.subject_type = 'NOTIFICATION'
        AND h.subject_id = n.notification_id
        AND h.released_at IS NULL
  );
```

### 16.3 Hold Propagation

If a case is under legal hold, related notifications may need to be held too.

```text
CASE legal hold
    → notification audit records
    → rendered statutory notices
    → bounce/complaint events
    → secure document access logs
```

---

## 17. Data Residency and Provider Boundary

If email is sent through an external provider, data may be processed/stored outside your application boundary.

Questions:

1. Where is provider infrastructure located?
2. Where are logs stored?
3. Are message bodies retained?
4. How long are events retained?
5. Are attachments stored temporarily?
6. Are support staff able to inspect message content?
7. Does provider process data for analytics/training?
8. Are webhooks crossing region boundary?
9. Are backups region-bound?
10. Is there a data processing agreement?

### 17.1 Architecture Boundary Diagram

```text
Application DB
  ├─ business data
  ├─ notification metadata
  └─ rendered content?              
        ↓
Mail Adapter
        ↓
SMTP Relay / Email API Provider
  ├─ provider logs
  ├─ provider queue
  ├─ provider event storage
  └─ provider support/admin access
        ↓
Recipient Mailbox Provider
  ├─ inbox
  ├─ spam/quarantine
  ├─ backup
  └─ user devices
```

Each boundary needs data classification and contract understanding.

---

## 18. Access Control for Mail Logs and Rendered Content

Mail audit records are often more sensitive than normal logs because they combine:

- recipient;
- template type;
- business case;
- delivery status;
- sometimes content snapshot.

### 18.1 Role-Based Access

| Role | Access |
|---|---|
| Developer | Metadata in non-prod; no prod raw body |
| Support L1 | Delivery status only; masked recipient |
| Support L2 | Recipient maybe visible with justification |
| Case officer | Case-related communication history |
| Compliance officer | Audit/evidence access |
| Security officer | Security notification events |
| DBA/SRE | Operational status; no body by default |

### 18.2 Break-Glass Access

For sensitive rendered content, use break-glass:

```text
request reason
approval
time-limited access
audit who viewed what
automatic expiry
manager/compliance notification
```

### 18.3 Do Not Put Rendered Email in Generic Logs

Rendered content belongs in controlled audit store, not application logs.

---

## 19. Environment Separation and Non-Production Safety

One of the most common incidents: test/UAT/staging sends email to real users.

### 19.1 Non-Prod Safety Controls

Implement at least:

1. recipient allowlist;
2. domain allowlist;
3. forced recipient rewrite;
4. subject prefix;
5. disabled external provider by default;
6. separate credentials;
7. template warning banner;
8. environment header;
9. suppression of real attachments;
10. test provider/sandbox.

### 19.2 Recipient Rewrite

```java
if (!environment.isProduction()) {
    originalRecipient = recipient;
    recipient = testInboxResolver.resolve(originalRecipient);
    subject = "[UAT original=" + mask(originalRecipient) + "] " + subject;
}
```

But be careful not to leak original recipient in subject if test inbox is shared.

Safer:

```text
[UAT Notification Test] Case update available
Original recipient hash: hmac:9ad3...
```

### 19.3 Hard Fail Non-Prod External Domains

```java
if (!env.isProduction() && !allowlist.contains(recipient.domain())) {
    throw new PolicyViolationException("External recipient not allowed in non-prod");
}
```

### 19.4 Separate Provider Credentials

Never reuse production SMTP/API credentials in staging.

---

## 20. Manual Resend and Operator Actions

Support teams often need resend functionality. This is high-risk.

### 20.1 Resend Is Not Replay Without Policy

Bad:

```text
Click resend → send same email again
```

Problems:

- recipient authorization may have changed;
- template may be outdated;
- case status may have changed;
- user may be suppressed;
- previous email may have bounced;
- legal hold/privacy restriction may apply.

### 20.2 Resend Modes

There are two modes.

#### A. Re-deliver exact rendered content

Use for evidence/legal notice where exact original matters.

Need:

- stored rendered snapshot;
- explicit operator reason;
- access control;
- audit trail;
- recipient revalidation or documented bypass.

#### B. Re-generate current notification

Use when latest state should be communicated.

Need:

- current template;
- current policy;
- current recipient authorization;
- new notification ID;
- relation to original notification.

### 20.3 Resend Audit

```java
record ResendAudit(
    String originalNotificationId,
    String newNotificationId,
    ResendMode mode,
    String operatorId,
    String reason,
    Instant requestedAt,
    String approvalId
) {}
```

---

## 21. Cancellation and Kill Switch

A regulatory-grade mail system needs cancellation controls.

### 21.1 Cancel Pending Notifications

If a business event is reversed before send:

```text
PENDING → CANCELLED
```

Need reason:

```text
case status reverted
recipient no longer authorized
template withdrawn
system incident
privacy restriction
```

### 21.2 Kill Switch

Global kill switch:

```text
disable all non-critical email sending
```

Category kill switch:

```text
disable MARKETING
disable REMINDER
disable CASE_STATUS
keep SECURITY and STATUTORY
```

Provider kill switch:

```text
stop provider A
route to provider B
```

### 21.3 Kill Switch Must Be Audited

```java
record MailKillSwitchEvent(
    String switchName,
    boolean enabled,
    String changedBy,
    String reason,
    Instant changedAt
) {}
```

---

## 22. Attachment Governance

Attachment policy should be explicit.

### 22.1 Attachment Manifest

Do not only store “email had attachment”. Store manifest.

```java
record AttachmentManifestItem(
    String attachmentId,
    String sourceDocumentId,
    String filenamePolicyName,
    String safeFilename,
    String contentType,
    long sizeBytes,
    String sha256,
    DataClassification classification,
    boolean inline,
    String disposition,
    Instant generatedAt
) {}
```

### 22.2 Filename Privacy

Attachment filename can leak data.

Risky:

```text
Complaint_against_ABC_Pte_Ltd_by_Jane_Doe.pdf
Medical_Report_John_Doe.pdf
EnforcementNotice_ENF-2026-000123.pdf
```

Better:

```text
Notice.pdf
Document.pdf
CaseDocument.pdf
```

### 22.3 Attachment Size Policy

Large attachments cause:

- memory pressure;
- timeout;
- provider rejection;
- mailbox rejection;
- slow mobile download;
- high storage duplication.

Policy:

```yaml
attachmentPolicy:
  maxTotalBytes: 10485760
  maxSingleBytes: 5242880
  allowedContentTypes:
    - application/pdf
  disallowedExtensions:
    - exe
    - js
    - vbs
    - bat
    - cmd
    - scr
  requireVirusScan: true
  requireContentHash: true
```

### 22.4 Do Not Trust Content-Type Alone

`Content-Type` can lie. Validate by:

- extension;
- MIME sniffing;
- magic bytes;
- antivirus scan;
- file parser if needed;
- document generation source.

---

## 23. Audit Defensibility for “Notice Was Sent”

For legal/regulatory notice, the system should not simply record:

```text
status = SENT
```

It should record a chain:

```text
Business event occurred
Policy selected notification
Recipient resolved and authorized
Template version selected
Content rendered
Message queued
SMTP/API attempt made
Provider accepted/rejected
Bounce/complaint/delivery event processed
```

### 23.1 Evidence Chain Example

```text
2026-06-18T09:00:00Z CASE_APPROVED event created
2026-06-18T09:00:01Z Notification policy CASE_APPROVED_NOTICE v4 matched
2026-06-18T09:00:01Z Recipient APPLICANT resolved to recipientHash=hmac:abc
2026-06-18T09:00:01Z Recipient authorization decision AUTHZ-789 allowed
2026-06-18T09:00:02Z Template CASE_APPROVED_NOTICE v7 rendered hash=sha256:def
2026-06-18T09:00:02Z Notification N-123 queued
2026-06-18T09:00:05Z SMTP provider accepted message providerMessageId=P-456
2026-06-18T09:05:10Z No bounce received within initial observation window
```

This is much stronger than:

```text
email sent true
```

### 23.2 Evidence Limitation Statement

A mature system can say:

```text
The system can prove provider acceptance and absence/presence of recorded feedback events. It cannot prove that the recipient personally read the email unless there is an authenticated acknowledgement event.
```

This precision matters.

---

## 24. Read Receipts, Tracking Pixels, and Privacy

Tracking pixels and link tracking can be useful but privacy-sensitive.

### 24.1 Tracking Pixel Limitations

Pixel open event may mean:

- user opened email;
- mailbox proxy fetched image;
- security scanner fetched image;
- image was cached;
- image was blocked;
- Apple/Gmail proxy behavior altered signal;
- forwarded recipient opened it.

So do not treat open pixel as legal proof of read.

### 24.2 Link Click Limitations

Click event may mean:

- user clicked;
- security scanner clicked;
- phishing scanner pre-fetched;
- link preview bot accessed;
- forwarded recipient clicked.

Use authenticated portal action for stronger proof.

### 24.3 Privacy Requirement

If you track opens/clicks, answer:

- is user informed?
- is tracking necessary?
- is tracking category-specific?
- is tracking disabled for sensitive notices?
- are IP/user-agent stored?
- how long retained?
- can it be opted out?

---

## 25. Internationalization and Accessibility as Compliance Concerns

In some systems, language and accessibility are not only UX issues; they can affect fairness and defensibility.

### 25.1 Language Policy

Questions:

- Which language should recipient receive?
- Is preference verified?
- Is fallback acceptable?
- Are legal terms translated consistently?
- Are old translations retained by version?

Model:

```java
record TemplateVariant(
    String templateId,
    int version,
    Locale locale,
    String subjectTemplate,
    String textTemplate,
    String htmlTemplate,
    ApprovalStatus approvalStatus
) {}
```

### 25.2 Accessibility

Email should support:

- plain text alternative;
- meaningful link text;
- alt text for images;
- sufficient contrast;
- no image-only critical information;
- clear action instructions;
- readable layout;
- correct language tag if possible.

Do not put critical regulatory instruction only in an image.

---

## 26. Multi-Tenant and Multi-Agency Mail Governance

If a platform serves multiple agencies/tenants/business units, sender identity matters.

### 26.1 Risks

- wrong sender domain;
- wrong logo/branding;
- wrong support contact;
- wrong legal disclaimer;
- cross-tenant template leakage;
- wrong DKIM/SPF alignment;
- wrong suppression/preference boundary;
- wrong audit access.

### 26.2 Tenant-Aware Mail Policy

```java
record TenantMailPolicy(
    String tenantId,
    String fromAddress,
    String displayName,
    String replyTo,
    String supportContact,
    String portalBaseUrl,
    String providerRoute,
    Set<String> allowedTemplateIds,
    DataResidencyRegion region
) {}
```

### 26.3 Invariants

```text
A tenant may only use sender identities verified for that tenant.
A template may only render with tenant-approved branding and support contact.
A notification audit record must include tenantId.
A provider route must satisfy tenant residency/compliance policy.
```

---

## 27. Threat Model for Regulatory Mail Systems

### 27.1 Threats

| Threat | Example | Control |
|---|---|---|
| Wrong recipient | stale email address | recipient verification + authz check |
| Data leakage | PII in subject/body | minimization + classification |
| Log leakage | raw MIME in logs | redaction + controlled debug |
| Attachment exfiltration | sensitive PDF sent | attachment policy + secure link |
| Unauthorized resend | support sends to wrong person | RBAC + approval + audit |
| Template abuse | template accesses entity fields | DTO schema + review |
| Provider compromise | provider stores body | data minimization + contract |
| Phishing vector | system sends arbitrary links | link allowlist + template governance |
| Header injection | user input in subject/header | validation/sanitization |
| Non-prod leak | UAT emails real users | recipient allowlist/rewrite |
| Tracking privacy | hidden open pixels | policy + opt-out/disclosure |

### 27.2 Abuse Case: Email as Exfiltration Channel

If internal admin can trigger arbitrary email with arbitrary attachment, your mail system becomes an exfiltration channel.

Controls:

- restrict attachment source;
- restrict recipient domain;
- approval for external recipient;
- attachment classification check;
- audit operator;
- rate limit manual sends;
- DLP scan;
- anomaly detection.

---

## 28. Policy Engine Boundary

A mature mail system has a policy decision boundary before rendering/sending.

```java
record MailPolicyDecision(
    boolean allowed,
    String decisionId,
    List<String> reasons,
    DataClassification maxAllowedClassification,
    boolean allowAttachments,
    boolean allowTracking,
    boolean requireSecureLink,
    RetentionClass retentionClass
) {}
```

Example:

```java
MailPolicyDecision decision = policyEngine.evaluate(
    new MailPolicyRequest(
        eventType,
        tenantId,
        recipientRole,
        recipientId,
        templateId,
        requestedDataClassification,
        attachmentManifest
    )
);

if (!decision.allowed()) {
    audit.recordSuppressed(notificationId, decision);
    return;
}
```

### 28.1 Why This Matters

Without policy boundary, control is implicit and scattered.

With policy boundary:

- decisions are logged;
- rules can evolve;
- compliance can review;
- tests can validate;
- audit can explain;
- support can see why something was blocked.

---

## 29. Database Model for Regulatory-Grade Notification

A simplified schema:

```sql
CREATE TABLE mail_notification (
    notification_id        VARCHAR(64) PRIMARY KEY,
    business_event_id      VARCHAR(64) NOT NULL,
    tenant_id              VARCHAR(64) NOT NULL,
    aggregate_type         VARCHAR(64) NOT NULL,
    aggregate_id           VARCHAR(64) NOT NULL,
    category               VARCHAR(64) NOT NULL,
    criticality            VARCHAR(64) NOT NULL,
    classification         VARCHAR(64) NOT NULL,
    template_id            VARCHAR(128) NOT NULL,
    template_version       INTEGER NOT NULL,
    recipient_role         VARCHAR(64) NOT NULL,
    recipient_hash         VARCHAR(128) NOT NULL,
    provider               VARCHAR(64),
    provider_message_id    VARCHAR(256),
    state                  VARCHAR(64) NOT NULL,
    retention_class        VARCHAR(64) NOT NULL,
    policy_decision_id     VARCHAR(64) NOT NULL,
    content_hash           VARCHAR(128),
    created_at             TIMESTAMP NOT NULL,
    rendered_at            TIMESTAMP,
    first_attempt_at       TIMESTAMP,
    last_attempt_at        TIMESTAMP,
    attempt_count          INTEGER NOT NULL DEFAULT 0,
    last_failure_category  VARCHAR(128),
    last_smtp_code         VARCHAR(16)
);
```

Rendered content table separated and access-controlled:

```sql
CREATE TABLE mail_rendered_content (
    notification_id     VARCHAR(64) PRIMARY KEY,
    subject_ciphertext  BLOB,
    text_ciphertext     BLOB,
    html_ciphertext     BLOB,
    encryption_key_ref  VARCHAR(256) NOT NULL,
    content_hash        VARCHAR(128) NOT NULL,
    created_at          TIMESTAMP NOT NULL,
    retention_class     VARCHAR(64) NOT NULL
);
```

Attachment manifest:

```sql
CREATE TABLE mail_attachment_manifest (
    attachment_manifest_id VARCHAR(64) PRIMARY KEY,
    notification_id        VARCHAR(64) NOT NULL,
    source_document_id     VARCHAR(64),
    safe_filename          VARCHAR(255) NOT NULL,
    content_type           VARCHAR(255) NOT NULL,
    size_bytes             BIGINT NOT NULL,
    sha256                 VARCHAR(128) NOT NULL,
    classification         VARCHAR(64) NOT NULL,
    inline                 BOOLEAN NOT NULL,
    created_at             TIMESTAMP NOT NULL
);
```

Policy decision:

```sql
CREATE TABLE mail_policy_decision (
    decision_id         VARCHAR(64) PRIMARY KEY,
    notification_id     VARCHAR(64),
    policy_version      VARCHAR(64) NOT NULL,
    allowed             BOOLEAN NOT NULL,
    reasons_json        CLOB NOT NULL,
    evaluated_at        TIMESTAMP NOT NULL
);
```

---

## 30. Java Boundary Design

### 30.1 Domain Layer

```java
public interface NotificationPolicy {
    MailPolicyDecision evaluate(MailPolicyRequest request);
}
```

```java
public interface RecipientResolver {
    RecipientResolution resolve(BusinessEvent event, RecipientRole role);
}
```

```java
public interface TemplateRenderer {
    RenderedMail render(TemplateRenderRequest request);
}
```

```java
public interface MailGateway {
    MailSendResult send(PreparedMail mail);
}
```

### 30.2 Application Service

```java
public final class NotificationApplicationService {
    private final RecipientResolver recipientResolver;
    private final NotificationPolicy policy;
    private final TemplateRenderer renderer;
    private final MailOutboxRepository outbox;
    private final AuditWriter audit;

    public void createNotification(BusinessEvent event, NotificationIntent intent) {
        RecipientResolution recipient = recipientResolver.resolve(event, intent.recipientRole());

        MailPolicyDecision decision = policy.evaluate(new MailPolicyRequest(
            event,
            intent,
            recipient
        ));

        audit.recordPolicyDecision(event.id(), decision);

        if (!decision.allowed()) {
            audit.recordNotificationSuppressed(event.id(), decision.reasons());
            return;
        }

        RenderedMail rendered = renderer.render(new TemplateRenderRequest(
            intent.templateId(),
            intent.templateVersion(),
            recipient,
            event,
            decision
        ));

        outbox.insert(MailOutboxEntry.from(event, intent, recipient, decision, rendered));
    }
}
```

Notice: it does not send immediately. It creates controlled outbox intent.

### 30.3 Sending Worker

```java
public final class MailOutboxWorker {
    private final MailOutboxRepository repository;
    private final MailGateway gateway;
    private final MailFailureClassifier classifier;
    private final AuditWriter audit;

    public void processOne() {
        Optional<MailOutboxEntry> maybeEntry = repository.claimNext();
        if (maybeEntry.isEmpty()) {
            return;
        }

        MailOutboxEntry entry = maybeEntry.get();

        try {
            MailSendResult result = gateway.send(entry.preparedMail());
            repository.markAccepted(entry.notificationId(), result.providerMessageId(), result.smtpCode());
            audit.recordAccepted(entry.notificationId(), result);
        } catch (Exception ex) {
            ClassifiedMailFailure failure = classifier.classify(ex);
            repository.markFailed(entry.notificationId(), failure);
            audit.recordSendFailure(entry.notificationId(), failure);
        }
    }
}
```

---

## 31. Common Compliance Anti-Patterns

### 31.1 Sending Inside Transaction

```java
@Transactional
public void approveCase(String caseId) {
    case.approve();
    mailService.send(case.getApplicantEmail(), ...);
}
```

Problems:

- email sent but transaction rolls back;
- transaction waits on SMTP;
- retry can duplicate;
- audit may mismatch.

Use outbox.

### 31.2 Full Entity in Template

```java
model.put("case", caseEntity);
```

Use dedicated DTO.

### 31.3 Raw Debug in Production

```java
session.setDebug(true);
```

Use controlled diagnostic mode.

### 31.4 Sensitive Subject

```text
Investigation Notice for Complaint Against Employer
```

Use neutral subject.

### 31.5 Attachment by Default

```java
attach(allDocumentsZip);
```

Use secure portal link unless explicitly approved.

### 31.6 No Suppression

Continuing to email a hard-bounced or complained recipient can damage reputation and create compliance issues.

### 31.7 No Policy Decision Record

If blocked/not sent, audit should record why.

### 31.8 Treating “Sent” as “Read”

Never claim more than evidence supports.

---

## 32. Regulatory-Grade Checklist

### 32.1 Before Rendering

- [ ] Is notification category known?
- [ ] Is criticality known?
- [ ] Is data classification known?
- [ ] Is recipient role known?
- [ ] Is recipient authorization checked?
- [ ] Is preference/suppression checked?
- [ ] Is tenant/sender policy checked?
- [ ] Is template approved?
- [ ] Is variable schema validated?
- [ ] Is subject privacy checked?
- [ ] Is attachment policy checked?

### 32.2 Before Sending

- [ ] Is outbox entry persisted?
- [ ] Is idempotency key assigned?
- [ ] Is rendered content hash stored?
- [ ] Is retention class assigned?
- [ ] Is provider route selected by policy?
- [ ] Are non-prod safeguards active?
- [ ] Are logs redacted?
- [ ] Are timeouts configured?

### 32.3 After Sending

- [ ] Is provider acceptance recorded?
- [ ] Is provider message ID stored?
- [ ] Are failures classified?
- [ ] Are bounce/complaint events handled?
- [ ] Is suppression updated?
- [ ] Are metrics emitted?
- [ ] Is audit trail complete?

### 32.4 Periodic Governance

- [ ] Review templates.
- [ ] Review PII fields.
- [ ] Review suppression policy.
- [ ] Review retention policy.
- [ ] Review provider contracts.
- [ ] Review access logs.
- [ ] Test non-prod email guardrails.
- [ ] Test legal hold purge exclusion.
- [ ] Test resend approval flow.

---

## 33. Practical Design: Policy-First Mail Builder

Instead of this:

```java
mailService.send(to, subject, html);
```

Prefer this:

```java
notificationService.request(new NotificationRequest(
    businessEventId,
    NotificationCategory.CASE_STATUS,
    NotificationCriticality.BUSINESS_COMMUNICATION,
    RecipientRole.APPLICANT,
    TemplateRef.of("CASE_STATUS_CHANGED", 3),
    aggregateRef,
    requestedDataClassification
));
```

Then the system determines:

```text
Should this be sent?
To whom?
Through which channel?
With which template?
With which fields?
With what retention?
With attachment or secure link?
With tracking or without?
With what audit evidence?
```

This is the difference between feature-level email and platform-level notification engineering.

---

## 34. Top 1% Mental Model

A top engineer will not ask only:

```text
How do I send an email in Java?
```

They ask:

```text
What information leaves the system?
Who is authorized to receive it?
What evidence do we need to preserve?
What failure states are possible?
What does “sent” mean legally and operationally?
What data do logs leak?
Can this be replayed safely?
Can it be cancelled?
Can it be suppressed?
Can it be audited without exposing content?
Can it survive legal hold?
Can it be purged correctly?
Can support operate it without becoming a data leak vector?
```

The API call is small. The surrounding governance is the real engineering.

---

## 35. Summary

Regulatory-grade mail systems require more than Jakarta Mail or SMTP knowledge.

Key takeaways:

1. Email is data disclosure, not merely notification.
2. Data minimization should be default.
3. Sensitive details usually belong behind authenticated portal access, not in email body/attachment.
4. Recipient authorization is separate from email address resolution.
5. Template data must be schema-controlled and policy-reviewed.
6. Subject lines need privacy review because they appear in previews and lock screens.
7. Raw MIME and recipient PII should not be logged by default.
8. Audit records should distinguish intended, rendered, queued, accepted, bounced, complained, and acknowledged.
9. “Accepted by provider” is not the same as “read by user”.
10. Retention, legal hold, suppression, resend, and cancellation must be explicit workflows.
11. Non-production email safeguards are mandatory.
12. Support/operator actions must be RBAC-controlled and audited.
13. Attachments require governance: classification, size, content type, hash, scan, and safe filename.
14. Tracking pixels and click tracking are weak evidence and privacy-sensitive.
15. Mature systems put policy evaluation before rendering and sending.

---

## 36. References

- Jakarta Mail 2.1 Specification — https://jakarta.ee/specifications/mail/2.1/jakarta-mail-spec-2.1
- Jakarta Mail 2.1 API: `Message` — https://jakarta.ee/specifications/mail/2.1/apidocs/jakarta.mail/jakarta/mail/message
- RFC 5321: Simple Mail Transfer Protocol — https://datatracker.ietf.org/doc/html/rfc5321
- RFC 3464: An Extensible Message Format for Delivery Status Notifications — https://datatracker.ietf.org/doc/html/rfc3464
- RFC 5965: An Extensible Format for Email Feedback Reports — https://datatracker.ietf.org/doc/html/rfc5965
- NIST SP 800-122: Guide to Protecting the Confidentiality of Personally Identifiable Information — https://nvlpubs.nist.gov/nistpubs/legacy/sp/nistspecialpublication800-122.pdf
- NIST Privacy Framework — https://www.nist.gov/privacy-framework
- OWASP Logging Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- OWASP Secrets Management Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html

---

## 37. Part 25 Completion Marker

You have completed:

```text
[x] Part 25 — Compliance, Privacy, and Regulatory-Grade Mail Systems
```

Next:

```text
[ ] Part 26 — Advanced MIME and Internationalization
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 24 — Template Architecture and Domain Notification Design](./24-template-architecture-domain-notification.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 26 — Advanced MIME and Internationalization](./26-advanced-mime-internationalization.md)
