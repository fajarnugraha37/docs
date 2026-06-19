# learn-java-template-freemarker-thymeleaf-rendering-engineering-part-019

# Part 19 — Email Template Engineering with FreeMarker and Thymeleaf

> Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`  
> Bagian: `019 / 034`  
> Topik: Email Template Engineering dengan FreeMarker dan Thymeleaf  
> Scope Java: Java 8 hingga Java 25  
> Fokus engine: FreeMarker, Thymeleaf, Jakarta Mail, Spring Mail, MIME, HTML email, text email, template versioning, localization, branding, auditability, and failure model

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita sudah membahas Thymeleaf performance, caching, dan production tuning untuk server-side page rendering. Sekarang kita bergeser ke domain yang terlihat sederhana tetapi sering menjadi sumber bug production, incident security, dan pengalaman pengguna yang buruk: **email templating**.

Email template engineering bukan sekadar:

```text
render template -> kirim email
```

Model yang benar adalah:

```text
business event
  -> communication intent
  -> recipient resolution
  -> template selection
  -> data snapshot
  -> locale + timezone + tenant branding
  -> render subject
  -> render plain text body
  -> render HTML body
  -> attach generated artifacts
  -> assemble MIME message
  -> persist audit record
  -> send via provider
  -> observe delivery result
  -> handle retry / bounce / suppression / failure
```

Template engine hanya satu bagian kecil dari pipeline. Engineer level atas tidak hanya bertanya:

> Bagaimana cara memasukkan variable ke HTML email?

Tetapi bertanya:

> Bagaimana memastikan komunikasi yang dikirim sistem benar secara isi, aman, dapat diaudit, dapat direproduksi, tidak bocor data, stabil terhadap perubahan template, dan tetap dapat dikirim dalam skala besar?

Bagian ini membangun mental model dan arsitektur untuk menjawab pertanyaan tersebut.

---

## 1. Email Rendering Tidak Sama dengan Web Rendering

Kesalahan awal yang paling umum adalah memperlakukan email HTML seperti halaman web.

Halaman web modern memiliki asumsi:

1. Browser cukup konsisten dibanding email client.
2. CSS eksternal umum digunakan.
3. JavaScript dapat dipakai.
4. Layout fleksibel dengan flex/grid.
5. Resource bisa dimuat dari origin yang sama.
6. User aktif berinteraksi dengan halaman.
7. Rendering terjadi saat user membuka URL.
8. Versi UI terbaru selalu bisa dipakai.

Email memiliki realitas berbeda:

1. Email client sangat beragam: Gmail, Outlook desktop, Outlook web, Apple Mail, mobile clients, enterprise clients.
2. Banyak CSS modern tidak konsisten.
3. JavaScript umumnya tidak boleh diasumsikan dan biasanya diblokir.
4. Inline CSS sering diperlukan.
5. Image sering diblokir sampai user mengizinkan.
6. Email bisa diteruskan, diprint, disimpan, atau dibuka lama setelah dikirim.
7. Email harus tetap bermakna tanpa image.
8. Email perlu plain-text alternative.
9. Email harus valid MIME message.
10. Email bisa menjadi bukti komunikasi dalam konteks legal/regulatory.

Jadi email adalah **durable communication artifact**, bukan transient web page.

Mental model penting:

```text
Web page rendering:
  output = current UI representation
  lifecycle = request-time / session-time
  tolerance = can refresh, can fix on next deploy

Email rendering:
  output = immutable communication artifact
  lifecycle = long-lived, forwarded, archived, audited
  tolerance = must be correct at send time
```

Implikasinya besar:

- Jangan bergantung pada JavaScript.
- Jangan bergantung pada resource yang belum tentu tersedia.
- Jangan menyimpan hanya template name dan berharap bisa reproduce nanti.
- Jangan mengirim HTML tanpa plain-text fallback untuk komunikasi penting.
- Jangan mengambil data live saat preview lalu data berbeda saat send tanpa snapshot policy.
- Jangan menganggap template email aman hanya karena template web aman.

---

## 2. Tiga Output Utama Email: Subject, Plain Text, HTML

Satu email production yang serius biasanya minimal punya tiga template output:

```text
1. Subject
2. Plain text body
3. HTML body
```

Contoh struktur:

```text
templates/email/case-approved/
  subject.en.ftl
  body.en.txt.ftl
  body.en.html.ftlh
  subject.id.ftl
  body.id.txt.ftl
  body.id.html.ftlh
```

Atau untuk Thymeleaf:

```text
templates/email/case-approved/
  subject-en.txt
  body-en.txt
  body-en.html
  subject-id.txt
  body-id.txt
  body-id.html
```

Subject bukan sekadar string sederhana. Ia punya aturan sendiri:

- harus pendek;
- harus jelas;
- tidak boleh mengandung data terlalu sensitif;
- harus menghindari newline/header injection;
- harus locale-aware;
- sering perlu reference number;
- harus tetap meaningful saat inbox preview hanya menampilkan sebagian subject.

Plain text body bukan fallback murahan. Untuk sistem enterprise, text body penting karena:

- beberapa client/security gateway lebih menyukai text part;
- accessibility;
- audit readability;
- automated parsing;
- low-bandwidth clients;
- legal archiving;
- email forwarding behavior.

HTML body digunakan untuk:

- layout yang lebih rapi;
- branding;
- call-to-action;
- table data;
- visual hierarchy;
- document-like correspondence.

Rule yang sehat:

```text
Subject = concise routing and recognition
Plain text = complete semantic message
HTML = enhanced presentation of the same semantic message
```

Jangan membuat HTML body mengandung informasi yang tidak ada di plain text body untuk komunikasi kritikal, kecuali memang informasi itu murni dekoratif.

---

## 3. MIME Mental Model

Email modern bukan hanya satu string. Ia adalah struktur MIME.

Konseptualnya:

```text
MimeMessage
  headers
    From
    To
    Cc
    Bcc
    Subject
    Message-ID
    Date
    Content-Type
  body
    text/plain
    text/html
    attachments
    inline resources
```

Untuk email multipart umum:

```text
multipart/mixed
  multipart/alternative
    text/plain
    text/html
  application/pdf attachment
```

Jika HTML memakai inline image:

```text
multipart/mixed
  multipart/related
    multipart/alternative
      text/plain
      text/html
    image/png inline cid:logo
  application/pdf attachment
```

Tujuan struktur ini:

- `multipart/alternative` menyatakan beberapa representasi dari pesan yang sama.
- `multipart/mixed` menyatakan pesan plus attachment.
- `multipart/related` menyatakan HTML body dan resource terkait seperti inline image.

Dalam Java/Spring, detail ini sering disembunyikan oleh `MimeMessageHelper`, tetapi engineer tetap harus memahami struktur dasarnya karena banyak bug email terjadi di level MIME:

- HTML muncul sebagai attachment.
- Plain text tidak terbaca.
- Inline image tidak tampil.
- Attachment corrupt.
- Encoding subject rusak.
- Non-ASCII name rusak.
- Email client memilih part yang salah.

---

## 4. Jakarta Mail, Spring Mail, dan Posisi Template Engine

Template engine tidak mengirim email. Template engine hanya menghasilkan string/output.

Layer umum:

```text
Application / domain service
  -> EmailApplicationService
      -> TemplateRenderingService
          -> FreeMarkerRenderer / ThymeleafRenderer
      -> MimeMessageAssembler
          -> Jakarta Mail / Spring Mail
      -> MailSender / SMTP / provider API
```

Spring Mail memberi interface `JavaMailSender` untuk membuat dan mengirim `MimeMessage`, sedangkan Jakarta Mail menyediakan model standar seperti `MimeMessage`, `MimeMultipart`, dan `MimeBodyPart`.

Separation yang sehat:

```java
public interface EmailTemplateRenderer {
    RenderedEmail render(EmailTemplateId templateId, EmailRenderRequest request);
}

public record RenderedEmail(
        String subject,
        String plainTextBody,
        String htmlBody,
        List<RenderedAttachment> attachments,
        RenderMetadata metadata
) {}
```

Kemudian assembler:

```java
public interface EmailMessageAssembler {
    MimeMessage assemble(RenderedEmail email, EmailEnvelope envelope);
}
```

Sender:

```java
public interface EmailSender {
    SendResult send(EmailEnvelope envelope, RenderedEmail renderedEmail);
}
```

Kenapa dipisah?

Karena rendering dan sending punya failure model berbeda.

```text
render fail:
  template invalid
  missing variable
  formatting error
  unsafe content
  incompatible model

send fail:
  SMTP unavailable
  rejected recipient
  timeout
  provider throttling
  authentication issue
  bounce later
```

Jika kedua hal ini dicampur dalam satu method `sendEmail(...)`, observability dan retry policy akan kacau.

---

## 5. FreeMarker untuk Email

FreeMarker sangat cocok untuk email ketika:

- output adalah text/HTML yang cukup deterministik;
- template perlu macro/library reusable;
- template perlu inheritance sederhana melalui include/import;
- ingin memisahkan HTML dan text body;
- ingin kuat di batch rendering;
- ingin output format `.ftlh` untuk HTML auto-escaping;
- ingin engine generic yang tidak terlalu DOM-oriented.

Contoh struktur FreeMarker:

```text
src/main/resources/templates/email/
  _shared/
    layout.ftlh
    buttons.ftlh
    footer.ftlh
    text-common.ftl
  case-approved/
    subject.ftl
    body.txt.ftl
    body.html.ftlh
```

Contoh subject:

```ftl
[${systemName}] Case ${caseReference} has been approved
```

Contoh text body:

```ftl
Dear ${recipientName},

Your case ${caseReference} has been approved.

Decision date: ${decisionDate}

Please login to ${portalName} to view the details:
${portalUrl}

Regards,
${organizationName}
```

Contoh HTML body:

```ftl
<#import "/email/_shared/layout.ftlh" as layout>
<#import "/email/_shared/buttons.ftlh" as buttons>

<@layout.email title="Case approved">
  <p>Dear ${recipientName},</p>

  <p>
    Your case <strong>${caseReference}</strong> has been approved.
  </p>

  <p>
    Decision date: ${decisionDate}
  </p>

  <@buttons.primary href=portalUrl label="View case" />

  <p>Regards,<br>${organizationName}</p>
</@layout.email>
```

Important rule:

```text
Use .ftlh for HTML email templates.
Use .ftl or .txt.ftl for plain text templates.
Do not use ?no_esc unless content is proven-safe markup output.
```

FreeMarker `.ftlh` helps activate HTML output format and auto-escaping under recommended configuration. That means `${recipientName}` is escaped as HTML text by default.

But remember: HTML escaping is not the same as URL validation, CSS safety, JavaScript safety, or sanitizer policy.

---

## 6. Thymeleaf untuk Email

Thymeleaf cocok untuk email ketika:

- tim ingin natural HTML yang bisa dipreview oleh designer;
- sudah memakai Thymeleaf untuk MVC;
- ingin fragment/layout HTML yang familiar;
- email HTML lebih DOM-centric;
- Spring integration kuat;
- ingin menggunakan template mode HTML/TEXT secara konsisten.

Contoh struktur:

```text
src/main/resources/templates/email/
  fragments/
    layout.html
    footer.html
    buttons.html
  case-approved/
    subject.txt
    body.txt
    body.html
```

Contoh HTML body:

```html
<!DOCTYPE html>
<html xmlns:th="http://www.thymeleaf.org">
<body>
  <div th:replace="~{email/fragments/layout :: shell(~{::content})}">
    <div th:fragment="content">
      <p>Dear <span th:text="${recipientName}">Recipient</span>,</p>

      <p>
        Your case
        <strong th:text="${caseReference}">CASE-0001</strong>
        has been approved.
      </p>

      <p>
        Decision date:
        <span th:text="${decisionDate}">1 Jan 2026</span>
      </p>

      <a th:href="${portalUrl}" class="button">View case</a>

      <p>
        Regards,<br>
        <span th:text="${organizationName}">Organization</span>
      </p>
    </div>
  </div>
</body>
</html>
```

Contoh text body dengan Thymeleaf TEXT mode:

```text
Dear [(${recipientName})],

Your case [(${caseReference})] has been approved.

Decision date: [(${decisionDate})]

Please login to [(${portalName})] to view the details:
[(${portalUrl})]

Regards,
[(${organizationName})]
```

Thymeleaf bagus untuk natural template. Namun untuk email HTML, natural preview tidak menjamin email-client compatibility. Template bisa terlihat bagus di browser tetapi hancur di Outlook.

Jadi natural template hanya membantu authoring, bukan sertifikasi rendering email.

---

## 7. FreeMarker vs Thymeleaf untuk Email

Tidak ada jawaban mutlak. Gunakan decision framework.

| Pertanyaan | Condong FreeMarker | Condong Thymeleaf |
|---|---:|---:|
| Output banyak format text-like? | Ya | Bisa, tapi bukan kekuatan utama |
| Butuh natural HTML preview? | Tidak utama | Ya |
| Banyak macro textual? | Ya | Bisa dengan fragments |
| Sudah kuat di Spring MVC Thymeleaf? | Bisa | Ya |
| Batch rendering sangat besar? | Sering lebih sederhana | Bisa, tapi perlu tuning |
| Designer non-Java ingin edit HTML? | Cukup | Lebih nyaman |
| Template bukan hanya HTML email? | Sangat cocok | Cukup cocok |
| Ingin output format `.ftlh` auto-escaping? | Ya | Thymeleaf default escaping via `th:text` |
| Banyak reusable DOM fragment? | Bisa | Ya |

Rule praktis:

```text
FreeMarker:
  lebih cocok untuk generic communication/document/text rendering platform.

Thymeleaf:
  lebih cocok untuk HTML-centric email yang ingin natural template dan sudah berada di ekosistem Spring MVC/Thymeleaf.
```

Untuk enterprise besar, bukan hal aneh memakai dua engine:

```text
Thymeleaf -> SSR web pages
FreeMarker -> email/document/text/code/config rendering
```

Tetapi ini harus disadari sebagai keputusan arsitektur, bukan kebetulan dependency.

---

## 8. Email Template Data Model

Data model email harus menjadi kontrak eksplisit.

Jangan memberikan entity langsung:

```java
model.put("case", caseEntity);          // buruk
model.put("user", userEntity);          // buruk
model.put("application", application);  // buruk
```

Kenapa buruk?

1. Template bisa mengakses field yang tidak dimaksudkan.
2. Lazy loading bisa terjadi saat render.
3. Security boundary kabur.
4. Perubahan entity bisa merusak template.
5. Data sensitif bisa bocor.
6. Model tidak stabil untuk audit/re-render.

Gunakan view model:

```java
public record CaseApprovedEmailModel(
        String recipientName,
        String caseReference,
        String decisionDate,
        String portalName,
        String portalUrl,
        String organizationName,
        String supportEmail,
        String footerText
) {}
```

Atau lebih struktural:

```java
public record EmailRenderModel(
        RecipientView recipient,
        CaseView caseInfo,
        OrganizationView organization,
        ActionView primaryAction,
        RenderLocale locale,
        RenderBranding branding
) {}
```

Model email harus menjawab:

- field mana wajib?
- field mana optional?
- field mana boleh kosong?
- field mana preformatted?
- field mana raw value?
- field mana sensitive?
- field mana localized?
- field mana tenant-specific?
- field mana berasal dari snapshot?

Contoh invariant:

```text
caseReference must be non-empty.
recipientName must be display-safe string.
portalUrl must be absolute HTTPS URL from allowlisted host.
decisionDate must already be formatted for recipient locale/timezone.
organizationName must come from approved tenant profile.
```

Model validation sebaiknya terjadi sebelum render.

```java
public interface TemplateModelValidator<T> {
    ValidationResult validate(T model);
}
```

Jangan menunggu template error untuk menemukan bahwa `portalUrl` null.

---

## 9. Locale, Timezone, dan Bahasa Email

Email sering menjadi komunikasi formal. Format tanggal, angka, mata uang, dan bahasa harus benar.

Input render minimal:

```java
public record EmailRenderRequest<T>(
        TemplateId templateId,
        TemplateVersion version,
        Locale locale,
        ZoneId zoneId,
        TenantId tenantId,
        T model,
        Instant renderTime
) {}
```

Jangan gunakan default JVM locale/timezone secara implisit untuk email production.

Buruk:

```java
LocalDate.now().format(DateTimeFormatter.ofPattern("dd MMM yyyy"));
```

Lebih baik:

```java
DateTimeFormatter formatter = DateTimeFormatter
        .ofLocalizedDate(FormatStyle.MEDIUM)
        .withLocale(locale);

String decisionDate = formatter.format(decisionDateValue.atZone(zoneId));
```

Ada dua strategi:

### Strategi A — Template per bahasa

```text
body.en.html.ftlh
body.id.html.ftlh
body.zh.html.ftlh
```

Kelebihan:

- translator punya kontrol penuh;
- struktur kalimat natural;
- cocok untuk komunikasi formal/legal.

Kekurangan:

- duplikasi layout;
- perlu governance kuat;
- perubahan content harus sinkron lintas bahasa.

### Strategi B — Template tunggal + message bundle

```html
<p th:text="#{email.caseApproved.greeting(${recipientName})}">Dear Recipient</p>
```

Kelebihan:

- struktur template satu;
- cocok untuk UI-like email.

Kekurangan:

- sulit untuk bahasa dengan struktur kalimat berbeda;
- risk translation menjadi unnatural;
- fragment panjang di message bundle sulit dikelola.

### Strategi C — Hybrid

```text
layout shared
fragment shared
body per locale
message bundle untuk label kecil
```

Untuk enterprise/regulatory communication, hybrid sering paling realistis.

---

## 10. Tenant, Agency, dan Branding

Email enterprise jarang satu brand.

Branding bisa mencakup:

- organization name;
- logo;
- support email;
- footer;
- color token;
- portal URL;
- legal disclaimer;
- unsubscribe or notification preference link;
- sender name;
- reply-to address.

Jangan hardcode branding di template domain-specific.

Buruk:

```html
<img src="https://example.com/logo.png">
<p>Regards, ACEAS Team</p>
```

Lebih baik:

```html
<img src="${branding.logoUrl}" alt="${branding.logoAltText}">
<p>Regards,<br>${branding.senderDisplayName}</p>
```

Tetapi branding juga harus divalidasi:

```text
logoUrl must be HTTPS.
logo host must be allowlisted.
sender address must be verified.
reply-to must be verified.
footer must not contain arbitrary unsafe HTML unless sanitized.
```

Untuk multi-tenant system, template selection bisa seperti:

```text
templateKey: case-approved
tenant: cea
locale: en-SG
channel: email
version selection:
  1. exact tenant + locale + active version
  2. tenant default locale
  3. global locale
  4. global default
```

Namun fallback harus hati-hati. Untuk legal/regulatory email, fallback bahasa/tenant yang salah bisa lebih berbahaya daripada gagal kirim.

Rule:

```text
For critical correspondence, wrong template is worse than no email.
Fail closed for template mismatch.
```

---

## 11. HTML Email Layout: Practical Constraints

HTML email memerlukan disiplin berbeda dari web.

Prinsip umum:

1. Gunakan layout sederhana.
2. Hindari JavaScript.
3. Hindari form interaktif.
4. Inline CSS untuk style penting.
5. Gunakan table layout jika target client lama/Outlook penting.
6. Jangan bergantung penuh pada background image.
7. Pastikan CTA tetap terlihat sebagai URL di text body.
8. Gunakan absolute URLs.
9. Gunakan alt text untuk images.
10. Batasi ukuran HTML.
11. Pastikan mobile readable.

Contoh struktur aman:

```html
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
  <tr>
    <td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding: 24px; font-family: Arial, sans-serif;">
            <!-- content -->
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
```

Walaupun developer modern tidak suka table layout, email client compatibility sering memaksanya.

Rule mental:

```text
In web UI, semantic clean HTML + CSS is ideal.
In email, predictable rendering across hostile clients is often more important.
```

Namun jangan mengorbankan accessibility sepenuhnya. Tetap gunakan:

- readable text;
- meaningful link text;
- alt text;
- sufficient contrast;
- heading hierarchy jika memungkinkan;
- plain-text alternative.

---

## 12. Inline CSS Pipeline

Banyak tim menulis template HTML dengan `<style>` lalu mengirim langsung. Ini sering gagal di beberapa client.

Pipeline yang lebih baik:

```text
source template with maintainable CSS
  -> render dynamic content
  -> inline CSS transform
  -> sanitize/validate output
  -> send
```

Atau:

```text
source design system tokens
  -> compile email-safe CSS
  -> inline CSS at build/publish time
  -> template render at runtime
```

Pilihan waktu inlining:

### Runtime inlining

Kelebihan:

- fleksibel;
- bisa dynamic style;
- mudah untuk template dynamic.

Kekurangan:

- cost runtime;
- failure saat send;
- perlu dependency tambahan di path pengiriman.

### Publish-time/build-time inlining

Kelebihan:

- runtime lebih cepat;
- template published sudah email-ready;
- error ditemukan lebih awal.

Kekurangan:

- pipeline lebih kompleks;
- dynamic styling terbatas.

Untuk sistem besar, publish-time lebih disukai untuk template approved.

---

## 13. Link Engineering dalam Email

Link dalam email harus diperlakukan sebagai security-sensitive.

Jenis link:

- portal link;
- action link;
- verification link;
- reset password link;
- unsubscribe link;
- attachment download link;
- document view link.

Masalah umum:

1. Link relatif dikirim ke email.
2. Link memakai environment salah.
3. Link HTTP bukan HTTPS.
4. Link mengandung token terlalu panjang atau bocor di forward.
5. Link tidak expire.
6. Link tidak bound ke recipient.
7. Link bisa digunakan ulang tanpa kontrol.
8. Link tidak audit-friendly.

Rule:

```text
Email links must be absolute, environment-correct, HTTPS, allowlisted, and generated by application code, not manually constructed inside template.
```

Buruk:

```html
<a href="${baseUrl}/cases/${caseId}">View</a>
```

Lebih baik:

```java
String caseUrl = linkFactory.caseDetailUrl(caseId, recipientId, locale);
model.put("caseUrl", caseUrl);
```

Template:

```html
<a href="${caseUrl}">View case</a>
```

Template tidak perlu tahu route construction detail.

---

## 14. Attachments dan Generated Documents

Email sering membawa attachment:

- PDF letter;
- invoice;
- receipt;
- report;
- CSV;
- generated form;
- evidence bundle.

Attachment engineering harus jelas:

```text
attachment source:
  pre-existing file?
  generated on demand?
  generated earlier and stored?

attachment identity:
  file name
  media type
  size
  checksum
  document version
  classification

attachment policy:
  allowed recipient?
  encryption required?
  password required?
  retention period?
```

Jangan generate attachment diam-diam di template. Template boleh menampilkan link/metadata, tetapi document generation harus terjadi di service layer.

Contoh:

```java
public record RenderedAttachment(
        String fileName,
        String contentType,
        byte[] bytes,
        String checksumSha256,
        AttachmentClassification classification
) {}
```

Untuk attachment besar, jangan simpan semua byte di memory jika batch besar. Gunakan stream/file/object storage reference.

```java
public sealed interface AttachmentContent permits InMemoryAttachment, StoredAttachment {
}

public record InMemoryAttachment(byte[] bytes) implements AttachmentContent {}

public record StoredAttachment(
        URI storageUri,
        long size,
        String checksumSha256
) implements AttachmentContent {}
```

---

## 15. Preview Tooling

Email template platform tanpa preview akan memproduksi banyak bug.

Preview harus mendukung:

1. Pilih template.
2. Pilih version.
3. Pilih locale.
4. Pilih tenant/branding.
5. Pilih sample data.
6. Render subject.
7. Render text body.
8. Render HTML body.
9. Preview attachment metadata.
10. Kirim test email ke allowlisted recipient.
11. Lihat warnings.
12. Lihat missing/unused variables.
13. Lihat security warnings.

Preview request:

```json
{
  "templateKey": "case-approved",
  "version": "3.2.0",
  "tenant": "cea",
  "locale": "en-SG",
  "sampleDataId": "approved-case-basic",
  "renderMode": "PREVIEW"
}
```

Preview response:

```json
{
  "subject": "[ACEAS] Case CASE-2026-000123 has been approved",
  "plainTextBody": "Dear ...",
  "htmlBody": "<!DOCTYPE html>...",
  "warnings": [
    "HTML body contains external image from approved host",
    "Plain text body does not include support email"
  ],
  "metadata": {
    "templateVersion": "3.2.0",
    "renderedAt": "2026-06-19T04:10:00Z",
    "locale": "en-SG"
  }
}
```

Preview harus diberi watermark atau banner jika ada risiko screenshot/forward:

```text
PREVIEW ONLY — NOT SENT TO RECIPIENT
```

Test email harus jelas:

```text
[TEST] [ACEAS] Case CASE-2026-000123 has been approved
```

Jangan biarkan test email terkirim ke recipient real karena sample data salah.

---

## 16. Test Recipient Safety

Sistem email sering punya bug fatal saat DEV/UAT mengirim ke user asli.

Safety mechanism:

1. Environment-level mail interceptor.
2. Recipient allowlist di non-production.
3. Subject prefix `[DEV]`, `[UAT]`, `[TEST]`.
4. Override recipient di non-production.
5. Disable external sending by default.
6. Log intended recipients separately.
7. Redact sensitive payload in logs.

Contoh policy:

```java
public final class NonProductionRecipientPolicy implements RecipientPolicy {
    private final Set<String> allowedDomains;
    private final String sinkAddress;

    @Override
    public ResolvedRecipients apply(ResolvedRecipients original) {
        if (allRecipientsAllowed(original)) {
            return original.withSubjectPrefix("[UAT]");
        }
        return ResolvedRecipients.single(
                sinkAddress,
                "[UAT REDIRECTED] " + original.subject(),
                original.summaryForAudit()
        );
    }
}
```

Audit harus tetap menyimpan intended recipient dan actual recipient secara aman:

```text
intended_to_hash
actual_to
environment
redirected=true
```

Jangan log seluruh email body berisi PII di non-production hanya karena “untuk debug”.

---

## 17. Email Template Versioning

Email yang sudah dikirim tidak berubah. Template yang dipakai saat render harus diketahui.

Minimum metadata:

```text
template_key
subject_template_version
text_template_version
html_template_version
layout_version
macro_library_version
branding_version
model_schema_version
locale
timezone
rendered_at
render_engine
engine_version
application_version
```

Template versioning bisa berupa:

```text
case-approved:3.2.0
```

Atau effective-date:

```text
case-approved@2026-06-01T00:00:00+08:00
```

Untuk komunikasi legal/regulatory, effective-date sering penting:

```text
Use template active at event decision time?
Use template active at send time?
Use template specified by case state transition?
```

Ini harus menjadi business rule, bukan default teknis.

Contoh:

```text
Approval notice uses template effective at approval decision timestamp.
Reminder email uses template effective at send timestamp.
Correction notice uses explicitly selected template version.
```

Template dependency juga harus versioned:

```text
case-approved/body.html.ftlh v3.2.0
  imports layout/email-shell.ftlh v2.1.0
  imports components/button.ftlh v1.4.0
  uses branding cea v5
```

Kalau hanya menyimpan `case-approved`, re-render nanti bisa berbeda karena layout berubah.

---

## 18. Immutable Render Snapshot

Untuk sistem biasa, menyimpan provider message id mungkin cukup. Untuk sistem regulatory/enterprise, sering perlu menyimpan render snapshot.

Level penyimpanan:

### Level 1 — Metadata only

```text
template key/version
recipient
send status
provider message id
```

Murah, tetapi tidak bisa membuktikan isi persis.

### Level 2 — Rendered output snapshot

```text
subject
plain text body
html body
attachment checksum
```

Lebih audit-friendly.

### Level 3 — Full communication package

```text
subject
plain text body
html body
attachments bytes or immutable object storage reference
headers
recipient envelope
render metadata
send metadata
checksum/signature
```

Cocok untuk komunikasi legal/regulatory.

Rule:

```text
If the email can become evidence, store what was sent or store enough to prove exactly what was sent.
```

Hashing:

```text
sha256(subject + plainText + html + attachment checksums + metadata canonical form)
```

Ini membantu membuktikan bahwa artifact tidak berubah.

---

## 19. Audit Trail untuk Email

Email audit bukan hanya “sent=true”.

Audit event yang sehat:

```json
{
  "eventType": "EMAIL_RENDERED",
  "communicationId": "COM-2026-000123",
  "templateKey": "case-approved",
  "templateVersion": "3.2.0",
  "modelSchemaVersion": "1.1.0",
  "recipientType": "CASE_APPLICANT",
  "recipientHash": "...",
  "locale": "en-SG",
  "timezone": "Asia/Singapore",
  "renderedAt": "2026-06-19T04:10:00Z",
  "renderStatus": "SUCCESS",
  "renderChecksum": "sha256:..."
}
```

Send event:

```json
{
  "eventType": "EMAIL_SEND_ATTEMPTED",
  "communicationId": "COM-2026-000123",
  "provider": "SMTP",
  "attempt": 1,
  "sentAt": "2026-06-19T04:10:02Z",
  "status": "ACCEPTED_BY_PROVIDER",
  "providerMessageId": "..."
}
```

Failure event:

```json
{
  "eventType": "EMAIL_SEND_FAILED",
  "communicationId": "COM-2026-000123",
  "attempt": 2,
  "failureClass": "TRANSIENT_PROVIDER_TIMEOUT",
  "retryable": true
}
```

Bounce event later:

```json
{
  "eventType": "EMAIL_BOUNCED",
  "communicationId": "COM-2026-000123",
  "providerMessageId": "...",
  "bounceType": "HARD_BOUNCE",
  "receivedAt": "2026-06-19T04:15:00Z"
}
```

Audit harus membedakan:

```text
rendered != sent
sent/accepted by provider != delivered to inbox
delivered != opened
opened != read/understood
```

---

## 20. Failure Model: Render, Assemble, Send, Delivery

Email pipeline punya beberapa titik failure.

```text
1. Template selection failure
2. Model validation failure
3. Render failure
4. MIME assembly failure
5. Attachment generation failure
6. Send submission failure
7. Provider acceptance failure
8. Delivery failure / bounce
9. User action failure
```

Jangan retry semua dengan cara yang sama.

| Failure | Retry? | Catatan |
|---|---:|---|
| Template not found | Tidak otomatis | Configuration/publishing issue |
| Missing variable | Tidak otomatis | Model contract issue |
| Invalid recipient | Tidak, kecuali data diperbaiki | Data quality issue |
| SMTP timeout | Ya | Transient infra/provider issue |
| Provider throttling | Ya dengan backoff | Respect rate limit |
| Attachment too large | Tidak otomatis | Policy/content issue |
| Hard bounce | Tidak | Suppression/update contact |
| Soft bounce | Mungkin | Provider policy |

Retry policy harus idempotent.

Problem:

```text
If retry re-renders template, content may change.
```

Solusi:

```text
Render once -> persist rendered snapshot -> retry sending same snapshot.
```

Untuk komunikasi penting:

```text
Do not re-render on send retry unless explicitly intended.
```

---

## 21. Outbox Pattern untuk Email

Jangan kirim email langsung di tengah transaksi domain.

Buruk:

```java
@Transactional
public void approveCase(CaseId id) {
    Case c = repository.get(id);
    c.approve();
    repository.save(c);

    emailService.renderAndSend(...); // buruk dalam transaksi domain
}
```

Risiko:

- transaksi DB rollback tetapi email sudah terkirim;
- email send lambat menahan DB transaction;
- provider error membuat business transaction gagal;
- retry manual kacau.

Lebih baik dengan outbox:

```java
@Transactional
public void approveCase(CaseId id) {
    Case c = repository.get(id);
    c.approve();
    repository.save(c);

    outbox.add(new CaseApprovedCommunicationRequested(
            c.id(),
            c.version(),
            c.approvedAt()
    ));
}
```

Worker:

```text
read outbox event
  -> build communication intent
  -> snapshot data
  -> render
  -> persist communication record
  -> send
  -> update status
```

Ini memberi:

- transactional consistency;
- retry control;
- observability;
- async scaling;
- separation domain vs communication.

---

## 22. Render Before Send vs Render At Send

Ada dua strategi:

### Render before send and persist snapshot

```text
event -> render -> persist rendered email -> send snapshot
```

Kelebihan:

- retry send tidak mengubah isi;
- audit kuat;
- failure render terpisah;
- bisa review before send.

Kekurangan:

- storage lebih besar;
- sensitive data tersimpan;
- perlu retention/encryption.

### Render at send time

```text
event -> persist intent -> send worker renders just before send
```

Kelebihan:

- storage lebih kecil;
- data paling baru;
- template update bisa langsung berlaku.

Kekurangan:

- retry bisa menghasilkan isi berbeda;
- audit lemah jika tidak snapshot;
- data bisa berubah antara event dan send.

Rule:

```text
For regulatory/case/correspondence email, prefer render snapshot.
For marketing/low-risk notification, render-at-send can be acceptable.
```

---

## 23. Sensitive Data and PII

Email adalah channel yang mudah bocor:

- salah recipient;
- forwarding;
- shared mailbox;
- compromised inbox;
- printed email;
- logs;
- provider storage;
- bounce content;
- notification preview on lock screen.

Template rule:

```text
Do not put sensitive data in subject.
Minimize sensitive data in body.
Prefer portal link for detailed sensitive content.
```

Buruk:

```text
Subject: Your enforcement penalty of $12,000 for Case CASE-2026-000123 is overdue
```

Lebih aman:

```text
Subject: Action required for case CASE-2026-000123
```

Body bisa tetap hati-hati:

```text
Please log in to the portal to view full details.
```

PII handling:

- mask identifiers where possible;
- avoid full NRIC/passport in email;
- avoid full address unless necessary;
- avoid secrets/tokens in plain text;
- use expiring links;
- apply recipient verification;
- encrypt attachments if required;
- redact logs.

Template author harus tahu field sensitivity. Model bisa membawa metadata:

```java
public record TemplateField(
        String name,
        Object value,
        Sensitivity sensitivity
) {}
```

Atau enforce di model construction.

---

## 24. Header Injection and Subject Safety

Subject dan recipient header harus aman dari CRLF injection.

Jangan pernah membangun raw header string dari input user.

Buruk:

```java
message.setHeader("Subject", renderedSubject);
```

Lebih baik gunakan API tingkat tinggi:

```java
message.setSubject(renderedSubject, StandardCharsets.UTF_8.name());
```

Validasi subject:

```java
public static String validateSubject(String subject) {
    if (subject == null || subject.isBlank()) {
        throw new InvalidEmailSubjectException("Subject is blank");
    }
    if (subject.indexOf('\r') >= 0 || subject.indexOf('\n') >= 0) {
        throw new InvalidEmailSubjectException("Subject contains newline");
    }
    if (subject.length() > 200) {
        return subject.substring(0, 197) + "...";
    }
    return subject;
}
```

Recipient addresses juga harus memakai parser/validator yang benar, bukan regex asal.

---

## 25. Template Injection in Email Systems

Risiko besar muncul saat template dapat diedit oleh admin/business user.

Threat model:

```text
trusted developer-owned template:
  lower risk, still needs review

semi-trusted admin-owned template:
  high risk, needs sandbox and allowlist

external user-owned template:
  extremely high risk, avoid powerful engines unless sandboxed very strictly
```

Bahaya:

- FreeMarker object access;
- Thymeleaf expression injection;
- accessing Java methods;
- reading secrets exposed in context;
- huge loops/resource exhaustion;
- malicious links;
- phishing-like template;
- exfiltration through rendered content.

Rule:

```text
If non-developers can edit templates, treat templates as code.
```

Minimum governance:

1. Draft/review/publish workflow.
2. Role-based template editing.
3. Static linting.
4. Forbidden constructs.
5. Preview only with synthetic data.
6. Publish approval by owner.
7. Sandboxed model only.
8. No service object in context.
9. No arbitrary method calls where possible.
10. Rate limit preview/render.
11. Audit all edits.
12. Version immutable after publish.

---

## 26. Batch Email Rendering

Batch email tidak sama dengan loop sederhana.

Naive:

```java
for (Recipient r : recipients) {
    renderAndSend(r);
}
```

Masalah:

- provider throttling;
- memory pressure;
- DB N+1;
- template cache misuse;
- no backpressure;
- retry duplicate;
- partial failure unclear;
- slow recipient blocks entire batch;
- no idempotency.

Better pipeline:

```text
campaign/job created
  -> recipient query snapshot
  -> chunk recipients
  -> build per-recipient render command
  -> render with bounded concurrency
  -> persist communication record
  -> send with provider rate limit
  -> track per-recipient status
```

Concurrency rule:

```text
Rendering can be CPU/allocation heavy.
Sending is I/O/provider-limited.
Use separate pools/backpressure for render and send.
```

Java 21+ virtual threads can help send I/O workloads, but do not remove provider rate limits and do not fix template CPU/memory cost.

Batch metrics:

```text
emails_rendered_total
audio? no -> emails_render_failed_total
email_send_attempt_total
email_send_success_total
email_send_failure_total
email_render_latency
email_send_latency
provider_throttle_count
batch_remaining_count
```

Idempotency:

```text
idempotency_key = event_id + recipient_id + template_key + template_version
```

If retry sees same idempotency key already sent, do not send duplicate unless explicitly allowed.

---

## 27. Sample Production Architecture

```text
+------------------------+
| Domain Event            |
| CaseApproved            |
+-----------+------------+
            |
            v
+------------------------+
| Communication Planner   |
| - choose channel         |
| - choose recipient       |
| - choose template key    |
+-----------+------------+
            |
            v
+------------------------+
| Outbox                  |
| CommunicationRequested  |
+-----------+------------+
            |
            v
+------------------------+
| Communication Worker    |
+-----------+------------+
            |
            +----------------------------+
            |                            |
            v                            v
+------------------------+     +------------------------+
| Data Snapshot Builder  |     | Template Catalog        |
| - case data             |     | - version               |
| - recipient data        |     | - locale                |
| - branding              |     | - tenant                |
+-----------+------------+     +-----------+------------+
            |                              |
            +--------------+---------------+
                           v
+------------------------+
| Rendering Service       |
| - subject               |
| - text                  |
| - html                  |
| - metadata              |
+-----------+------------+
            |
            v
+------------------------+
| Communication Store     |
| - snapshot              |
| - checksum              |
| - audit                 |
+-----------+------------+
            |
            v
+------------------------+
| MIME Assembler          |
| - multipart/alternative |
| - attachments           |
| - headers               |
+-----------+------------+
            |
            v
+------------------------+
| Sender                  |
| SMTP / Provider API     |
+-----------+------------+
            |
            v
+------------------------+
| Delivery Events         |
| accepted/bounced/etc    |
+------------------------+
```

Key separation:

```text
Planner decides why and to whom.
Catalog decides what template.
Snapshot builder decides what data.
Renderer decides output.
Assembler decides MIME.
Sender decides delivery submission.
Audit decides proof.
```

---

## 28. Example Java Design

### 28.1 Template identity

```java
public record EmailTemplateId(String value) {
    public EmailTemplateId {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("template id is blank");
        }
    }
}

public record TemplateVersion(String value) {}
```

### 28.2 Render request

```java
public record EmailRenderCommand<T>(
        EmailTemplateId templateId,
        TemplateVersion version,
        Locale locale,
        ZoneId zoneId,
        String tenantCode,
        T model,
        Instant renderTime,
        RenderMode mode
) {}

public enum RenderMode {
    PREVIEW,
    TEST_SEND,
    PRODUCTION_SEND
}
```

### 28.3 Render result

```java
public record RenderedEmail(
        String subject,
        String plainTextBody,
        String htmlBody,
        List<RenderedAttachment> attachments,
        EmailRenderMetadata metadata
) {}

public record EmailRenderMetadata(
        String templateId,
        String templateVersion,
        Locale locale,
        ZoneId zoneId,
        String tenantCode,
        Instant renderedAt,
        String rendererName,
        String checksumSha256
) {}
```

### 28.4 Renderer interface

```java
public interface EmailRenderer {
    <T> RenderedEmail render(EmailRenderCommand<T> command);
}
```

### 28.5 FreeMarker renderer sketch

```java
public final class FreeMarkerEmailRenderer implements EmailRenderer {
    private final Configuration configuration;
    private final TemplateModelMapper modelMapper;
    private final TemplateCatalog catalog;

    public FreeMarkerEmailRenderer(
            Configuration configuration,
            TemplateModelMapper modelMapper,
            TemplateCatalog catalog
    ) {
        this.configuration = configuration;
        this.modelMapper = modelMapper;
        this.catalog = catalog;
    }

    @Override
    public <T> RenderedEmail render(EmailRenderCommand<T> command) {
        EmailTemplateDefinition definition = catalog.resolve(
                command.templateId(),
                command.version(),
                command.locale(),
                command.tenantCode()
        );

        Map<String, Object> model = modelMapper.toSafeMap(command.model(), command);

        String subject = renderTemplate(definition.subjectPath(), model);
        String text = renderTemplate(definition.textPath(), model);
        String html = renderTemplate(definition.htmlPath(), model);

        subject = EmailSubjectPolicy.validate(subject);

        EmailRenderMetadata metadata = EmailRenderMetadataFactory.create(
                command,
                definition,
                subject,
                text,
                html
        );

        return new RenderedEmail(subject, text, html, List.of(), metadata);
    }

    private String renderTemplate(String path, Map<String, Object> model) {
        try (StringWriter writer = new StringWriter(4096)) {
            Template template = configuration.getTemplate(path);
            template.process(model, writer);
            return writer.toString();
        } catch (IOException | TemplateException e) {
            throw new EmailRenderException("Failed to render template: " + path, e);
        }
    }
}
```

### 28.6 Thymeleaf renderer sketch

```java
public final class ThymeleafEmailRenderer implements EmailRenderer {
    private final TemplateEngine templateEngine;
    private final TemplateCatalog catalog;

    public ThymeleafEmailRenderer(TemplateEngine templateEngine, TemplateCatalog catalog) {
        this.templateEngine = templateEngine;
        this.catalog = catalog;
    }

    @Override
    public <T> RenderedEmail render(EmailRenderCommand<T> command) {
        EmailTemplateDefinition definition = catalog.resolve(
                command.templateId(),
                command.version(),
                command.locale(),
                command.tenantCode()
        );

        Context context = new Context(command.locale());
        context.setVariable("model", command.model());
        context.setVariable("tenant", command.tenantCode());
        context.setVariable("renderTime", command.renderTime());

        String subject = templateEngine.process(definition.subjectPath(), context);
        String text = templateEngine.process(definition.textPath(), context);
        String html = templateEngine.process(definition.htmlPath(), context);

        subject = EmailSubjectPolicy.validate(subject);

        EmailRenderMetadata metadata = EmailRenderMetadataFactory.create(
                command,
                definition,
                subject,
                text,
                html
        );

        return new RenderedEmail(subject, text, html, List.of(), metadata);
    }
}
```

Note:

- Real implementation perlu resolver berbeda untuk TEXT/HTML mode.
- Jangan expose raw entity sebagai `model` jika template author tidak sepenuhnya trusted.
- Validasi field tetap wajib sebelum render.

---

## 29. MIME Assembly dengan Spring Mail

Sketch:

```java
public final class SpringMimeEmailSender {
    private final JavaMailSender mailSender;

    public SpringMimeEmailSender(JavaMailSender mailSender) {
        this.mailSender = mailSender;
    }

    public void send(EmailEnvelope envelope, RenderedEmail renderedEmail) {
        MimeMessage message = mailSender.createMimeMessage();

        try {
            MimeMessageHelper helper = new MimeMessageHelper(
                    message,
                    MimeMessageHelper.MULTIPART_MODE_MIXED_RELATED,
                    StandardCharsets.UTF_8.name()
            );

            helper.setFrom(envelope.from());
            helper.setTo(envelope.to().toArray(String[]::new));
            helper.setSubject(renderedEmail.subject());
            helper.setText(renderedEmail.plainTextBody(), renderedEmail.htmlBody());

            for (RenderedAttachment attachment : renderedEmail.attachments()) {
                helper.addAttachment(
                        attachment.fileName(),
                        new ByteArrayResource(attachment.bytes()),
                        attachment.contentType()
                );
            }

            mailSender.send(message);
        } catch (MessagingException | MailException e) {
            throw new EmailSendException("Failed to send email", e);
        }
    }
}
```

Important:

```java
helper.setText(plainText, htmlText);
```

Ini membuat body alternative text + HTML. Jangan hanya set HTML jika email penting.

Untuk inline image:

```java
helper.addInline("logo", logoResource, "image/png");
```

HTML:

```html
<img src="cid:logo" alt="Organization logo">
```

Namun inline image juga punya trade-off:

- ukuran email lebih besar;
- client compatibility bervariasi;
- beberapa gateway memperlakukan attachment/inline berbeda.

---

## 30. Observability

Metrics yang berguna:

```text
email_render_total{template,version,locale,tenant,status}
email_render_duration_seconds{template,version,locale,tenant}
email_render_model_validation_failed_total{template,reason}
email_mime_assembly_failed_total{reason}
email_send_attempt_total{provider,template,tenant}
email_send_success_total{provider,template,tenant}
email_send_failed_total{provider,failure_class,retryable}
email_bounce_total{provider,bounce_type}
email_suppressed_total{reason}
```

Logs harus structured:

```json
{
  "message": "email render failed",
  "communicationId": "COM-2026-000123",
  "templateKey": "case-approved",
  "templateVersion": "3.2.0",
  "locale": "en-SG",
  "tenant": "cea",
  "failureClass": "MISSING_TEMPLATE_VARIABLE",
  "field": "decisionDate"
}
```

Jangan log:

- full body berisi PII;
- full recipient email jika tidak perlu;
- tokenized links;
- attachment content;
- raw template with secret sample data.

Tracing:

```text
domain event -> outbox -> render -> assemble -> send -> provider response
```

Correlation ID harus terbawa sepanjang pipeline.

---

## 31. Testing Strategy

Email template tests harus berlapis.

### 31.1 Model contract test

```text
Given CaseApprovedEmailModel
When validate
Then all required fields exist and safe
```

### 31.2 Render smoke test

```text
For each active template version + locale + tenant sample
Render subject/text/html successfully
```

### 31.3 Golden output test

Simpan expected output untuk sample stabil.

```text
case-approved/en-SG/basic.subject.expected.txt
case-approved/en-SG/basic.body.txt.expected.txt
case-approved/en-SG/basic.body.html.expected.html
```

Golden test bukan untuk semua whitespace kecil, tetapi untuk mendeteksi perubahan komunikasi yang tidak disengaja.

### 31.4 Escaping test

Input:

```text
recipientName = <script>alert(1)</script>
caseReference = CASE-" onclick="alert(1)
```

Assert:

- HTML output escaped;
- subject no CRLF;
- URL not constructed from unsafe raw input;
- `th:utext`/`?no_esc` tidak dipakai sembarangan.

### 31.5 MIME structure test

Parse generated `MimeMessage`:

- has subject;
- has text/plain;
- has text/html;
- attachments correct media type;
- UTF-8 subject/body works;
- inline resources resolvable.

### 31.6 Locale matrix test

```text
en-SG
id-ID
zh-SG
fallback locale
unsupported locale
```

### 31.7 Preview/send safety test

- DEV/UAT recipient rewritten;
- subject prefix added;
- allowlist enforced;
- intended recipient audited but not leaked.

---

## 32. Common Anti-Patterns

### Anti-pattern 1 — One HTML template only

```text
No subject template.
No text alternative.
No audit metadata.
```

Fix:

```text
subject + text + html + metadata as first-class outputs.
```

### Anti-pattern 2 — Entity passed into template

```java
model.put("case", caseEntity);
```

Fix:

```java
model.put("case", caseEmailView);
```

### Anti-pattern 3 — Sending inside domain transaction

Fix with outbox.

### Anti-pattern 4 — Retry by re-rendering

Fix by persisting rendered snapshot before send retry.

### Anti-pattern 5 — Sensitive subject

Fix by keeping subject minimal and using portal for details.

### Anti-pattern 6 — Template builds links manually

Fix with application-level link factory.

### Anti-pattern 7 — No non-production recipient guard

Fix with environment recipient policy.

### Anti-pattern 8 — Template version not stored

Fix with immutable render metadata.

### Anti-pattern 9 — Plain text is auto-generated badly from HTML

Auto-generation can be acceptable as fallback, but for critical correspondence write deliberate text template.

### Anti-pattern 10 — Preview uses production data freely

Fix with synthetic sample data and access control.

---

## 33. Design Checklist

Before shipping email template system, answer these:

### Template identity

- What is the template key?
- What version is active?
- Is version immutable after publish?
- Are layout/macro dependencies versioned?

### Model contract

- Is the model explicit?
- Are required fields validated?
- Are sensitive fields controlled?
- Are links generated by application code?

### Rendering

- Are subject, text, and HTML rendered separately?
- Is locale explicit?
- Is timezone explicit?
- Is escaping correct for output context?
- Are raw HTML paths reviewed?

### MIME

- Is text/plain included?
- Is text/html included?
- Are attachments correct?
- Are inline resources tested?
- Is UTF-8 enforced?

### Security

- Is subject protected from CRLF?
- Are recipients validated?
- Are non-prod recipients guarded?
- Are templates trusted or sandboxed?
- Are logs redacted?

### Audit

- Is rendered content snapshotted if needed?
- Is checksum stored?
- Is template version stored?
- Is provider message id stored?
- Are send attempts tracked?

### Failure

- Is render failure separate from send failure?
- Is retry idempotent?
- Is bounce handled?
- Is suppression handled?

### Operations

- Are metrics available?
- Are dashboards available?
- Are stuck outbox records visible?
- Are provider throttles tracked?
- Is there a kill switch?

---

## 34. Mental Model Summary

Email template engineering is not about making a pretty HTML string.

It is about designing a controlled communication pipeline:

```text
intent -> template -> model -> render -> MIME -> send -> audit -> observe
```

Top-level invariants:

1. Email output is durable.
2. Email content must be reproducible or snapshotted when legally important.
3. Template data model is an API contract.
4. Subject, text, and HTML are separate first-class artifacts.
5. Rendering failure and sending failure are different classes.
6. Retry should not accidentally change content.
7. Non-production must not email real recipients by accident.
8. Template version must be auditable.
9. HTML email compatibility is not browser compatibility.
10. Security includes XSS, SSTI, header injection, PII leakage, phishing-like content, and wrong recipient risks.

FreeMarker and Thymeleaf are both capable. The engineering quality comes from the surrounding architecture.

---

## 35. Practical Recommendation

For a serious Java enterprise system:

```text
Use a dedicated EmailRenderingService.
Render subject + plain text + HTML.
Use explicit template model DTOs.
Use FreeMarker for generic correspondence/document/email platforms.
Use Thymeleaf for HTML-centric email where natural templates are valuable.
Store template version and render metadata.
Use outbox for domain-triggered email.
Persist rendered snapshot for regulatory/case/legal communication.
Guard non-production recipients.
Test escaping, MIME structure, locale matrix, and golden outputs.
```

Recommended package structure:

```text
com.example.communication
  application
    CommunicationPlanner
    CommunicationWorker
  template
    EmailRenderer
    TemplateCatalog
    TemplateModelValidator
    FreeMarkerEmailRenderer
    ThymeleafEmailRenderer
  mail
    EmailEnvelope
    MimeMessageAssembler
    EmailSender
    SpringMailEmailSender
  audit
    CommunicationAuditService
    CommunicationRecord
  outbox
    CommunicationOutbox
    CommunicationOutboxWorker
```

This structure keeps responsibilities clear and prevents template rendering from becoming hidden business logic.

---

## 36. Referensi Utama

- Apache FreeMarker Manual — Template Author's Guide, output formats, auto-escaping, object wrapping, and template processing.
- Thymeleaf 3.1 Documentation — Template modes, Spring integration, text/HTML template processing, natural templates.
- Thymeleaf article: Sending email in Spring with Thymeleaf.
- Spring Framework Reference — Email support, `JavaMailSender`, MIME support, `MimeMessagePreparator`.
- Jakarta Mail API — `MimeMessage`, `MimeMultipart`, `MimeBodyPart`, MIME message construction.
- OWASP XSS Prevention Cheat Sheet — context-aware output encoding principles.

---

## 37. Status Seri

```text
Part 19 selesai.
Seri belum selesai.
Berikutnya: Part 20 — Document Generation: HTML-to-PDF, DOCX, XML, CSV, and Text Outputs.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-018.md">⬅️ Part 18 — Thymeleaf Performance, Caching, and Production Tuning</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-020.md">Part 20 — Document Generation: HTML-to-PDF, DOCX, XML, CSV, and Text Outputs ➡️</a>
</div>
