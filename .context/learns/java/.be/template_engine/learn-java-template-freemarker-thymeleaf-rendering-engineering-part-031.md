# learn-java-template-freemarker-thymeleaf-rendering-engineering-part-031

# Part 31 — Real-World Blueprint I: Enterprise Notification and Correspondence Platform

> Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`  
> Bagian: `31 / 34`  
> Fokus: blueprint arsitektur production-grade untuk platform enterprise notification dan correspondence berbasis FreeMarker/Thymeleaf  
> Target Java: Java 8 sampai Java 25  
> Target level: advanced / top 1% software engineering understanding

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas komponen-komponen penting secara terpisah:

- FreeMarker architecture.
- Thymeleaf architecture.
- output format dan escaping.
- error handling.
- performance.
- email rendering.
- document generation.
- i18n/l10n.
- model contract.
- versioning/governance.
- SSTI/security.
- testing.
- production rendering service.
- integration pattern dengan MVC, REST, batch, messaging, BPMN, dan case management.

Bagian ini menyatukan semuanya menjadi satu blueprint nyata:

> **Enterprise Notification and Correspondence Platform**.

Platform ini bukan sekadar service yang mengirim email. Platform ini adalah subsystem yang mengelola komunikasi resmi sistem enterprise kepada user, applicant, officer, agency, tenant, customer, partner, atau external party dalam bentuk:

- email.
- in-app notification.
- PDF letter.
- HTML preview.
- plain-text fallback.
- system-generated correspondence.
- reminder.
- escalation notice.
- approval/rejection notice.
- compliance letter.
- audit-visible communication record.

Mental model utamanya:

```text
Business Event
   -> Communication Intent
      -> Template Selection
         -> Model Assembly
            -> Render
               -> Deliver / Store / Preview
                  -> Audit / Observe / Reconcile
```

Top 1% engineer tidak melihat notification sebagai "send email from controller". Ia melihatnya sebagai lifecycle output yang harus:

1. benar secara business.
2. aman secara security.
3. konsisten secara template contract.
4. deterministik untuk audit.
5. bisa di-preview.
6. bisa di-versioning.
7. bisa di-retry.
8. bisa diobservasi.
9. bisa dipertanggungjawabkan.
10. bisa berubah tanpa menghancurkan proses lama.

---

## 1. Problem Statement

Bayangkan sebuah sistem enterprise/regulatory/case management. Sistem harus mengirim banyak jenis komunikasi:

- applicant submitted application.
- officer requested clarification.
- payment reminder.
- application approved.
- application rejected.
- appeal received.
- compliance case opened.
- enforcement warning issued.
- document expiry reminder.
- hearing schedule notice.
- inspection appointment.
- account invitation.
- password reset.
- SLA breach escalation.
- batch monthly report.

Pada awalnya tim biasanya membuat kode seperti ini:

```java
mailSender.send(
    to,
    "Application Approved",
    "Dear " + user.getName() + ", your application " + app.getRefNo() + " has been approved."
);
```

Ini tampak sederhana, tetapi akan runtuh saat requirement tumbuh:

- harus bilingual.
- harus ada tenant branding.
- subject berbeda per agency.
- footer legal berbeda per jurisdiction.
- email perlu HTML + plain text.
- perlu attach PDF letter.
- perlu audit isi komunikasi yang dikirim.
- perlu preview sebelum publish.
- perlu approval workflow untuk template.
- perlu template effective date.
- perlu rollback template.
- perlu test agar missing variable tidak terjadi di production.
- perlu retry saat SMTP down.
- perlu idempotency agar email tidak terkirim dua kali.
- perlu masking PII di log.
- perlu rate limiting.
- perlu unsubscribe untuk non-transactional email.
- perlu evidence bundle untuk audit/legal.

Jadi problem sebenarnya bukan:

> Bagaimana mengirim email?

Problem sebenarnya:

> Bagaimana mendesain platform komunikasi enterprise yang menghasilkan output resmi, aman, versioned, testable, observable, dan defensible?

---

## 2. Scope Platform

Platform ini dapat diberi nama misalnya:

```text
Correspondence Platform
Notification Platform
Communication Rendering Platform
Enterprise Messaging & Correspondence Service
```

Dalam materi ini kita sebut **Correspondence Platform**.

### 2.1 Yang Termasuk Scope

Platform mengelola:

1. template catalog.
2. template version.
3. template state lifecycle.
4. tenant/agency branding.
5. locale/timezone rendering.
6. model contract.
7. preview sample data.
8. rendering HTML/plain text/PDF.
9. email delivery handoff.
10. notification event creation.
11. correspondence record.
12. audit trail.
13. metrics and tracing.
14. operational dashboard.
15. retry/reconciliation.
16. secure template editing.
17. testing and validation pipeline.

### 2.2 Yang Tidak Harus Termasuk Scope Awal

Tidak semua hal harus berada dalam platform ini:

1. Business decision engine.
2. Workflow engine core.
3. Domain aggregate mutation.
4. User account lifecycle.
5. Full CMS system.
6. SMTP provider implementation.
7. PDF signing authority.
8. Object storage implementation detail.

Namun platform harus menyediakan integration point untuk semua itu.

---

## 3. Core Principles

### 3.1 Communication Is a Business Artifact

Email, PDF letter, dan notice bukan hanya UI text.

Mereka adalah artifact yang bisa berdampak pada:

- customer/user experience.
- SLA.
- compliance.
- legal defensibility.
- audit.
- operational support.
- dispute resolution.

Maka setiap generated communication harus punya minimal metadata:

```text
communication_id
business_reference
communication_type
template_id
template_version
recipient
channel
locale
timezone
rendered_at
triggered_by
trigger_event_id
status
checksum
storage_reference
```

Tanpa metadata ini, sistem akan sulit menjawab pertanyaan:

- Email apa yang dikirim?
- Berdasarkan template versi berapa?
- Data apa yang dipakai?
- Kapan dikirim?
- Kepada siapa?
- Apakah berhasil?
- Apakah isi yang dilihat user sama dengan yang direkam sistem?

### 3.2 Template Is a Versioned Contract

Template bukan file bebas. Template adalah contract antara:

- business process.
- rendering platform.
- data provider.
- template author.
- delivery channel.
- auditor.

Contract minimal:

```text
template_id: APPLICATION_APPROVED_EMAIL
version: 3
channel: EMAIL
output_parts:
  - subject
  - html_body
  - text_body
required_model_fields:
  - applicant.name
  - application.referenceNo
  - approval.approvedAt
  - portal.url
locale: en-SG
status: ACTIVE
effective_from: 2026-07-01T00:00:00+08:00
```

Jika model tidak memenuhi contract, render harus gagal sebelum delivery.

### 3.3 Rendering Must Be Deterministic

Rendering harus dapat direproduksi.

Input rendering:

```text
template version
model snapshot
locale
timezone
rendering engine version
branding version
message bundle version
static asset version
```

Output:

```text
subject
html body
text body
pdf bytes
metadata
checksum
```

Jika input sama, output semestinya sama, kecuali ada dependency eksternal yang tidak dikunci seperti current time, random UUID, atau remote image.

Maka semua nilai volatile harus dipass eksplisit:

```java
record RenderContext(
    Locale locale,
    ZoneId zoneId,
    Instant renderTime,
    String tenantId,
    String templateVersion,
    String correlationId
) {}
```

Template tidak boleh memanggil `now()` secara tersembunyi jika output harus defensible.

### 3.4 Delivery Is Not Rendering

Rendering dan delivery harus dipisahkan.

```text
Rendering: data + template -> output
Delivery: output -> recipient/channel/provider
```

Kenapa?

Karena failure-nya berbeda:

| Tahap | Failure | Solusi |
|---|---|---|
| Template selection | template tidak ditemukan | config/governance fix |
| Model assembly | data tidak lengkap | contract validation |
| Rendering | missing variable / escaping issue | template/model fix |
| Persistence | storage down | retry infrastructure |
| Delivery | SMTP/API down | retry, dead-letter |
| Callback | bounce/complaint | reconciliation |

Jika render dan send dicampur, sulit menentukan apakah email gagal karena template rusak atau SMTP down.

### 3.5 Preview Must Use Same Renderer as Production

Preview tidak boleh punya rendering path berbeda.

Anti-pattern:

```text
Admin Preview Renderer != Production Renderer
```

Akibatnya:

- preview terlihat benar, production rusak.
- security behavior berbeda.
- i18n berbeda.
- escaping berbeda.
- PDF berbeda.

Correct pattern:

```text
Same Template Resolver
Same Engine Configuration
Same Object Wrapper
Same Escaping Policy
Same Model Validator
Different Output Destination
```

Preview hanya beda pada input sample model dan destination, bukan beda engine.

---

## 4. High-Level Architecture

### 4.1 Component Diagram

```text
+-------------------+
| Business Services |
| Case/App/Payment  |
+---------+---------+
          |
          | Domain Event / Command
          v
+------------------------------+
| Communication Orchestrator   |
| - intent mapping             |
| - channel decision           |
| - recipient resolution       |
| - idempotency                |
+---------------+--------------+
                |
                v
+------------------------------+
| Template Selection Service   |
| - template_id                |
| - tenant override            |
| - locale fallback            |
| - effective date             |
| - active version             |
+---------------+--------------+
                |
                v
+------------------------------+
| Model Assembly Service       |
| - fetch domain snapshot      |
| - map to ViewModel           |
| - redact/authorize fields    |
| - validate contract          |
+---------------+--------------+
                |
                v
+------------------------------+
| Rendering Service            |
| - FreeMarker adapter         |
| - Thymeleaf adapter          |
| - HTML/TEXT/PDF              |
| - metrics/tracing            |
+---------------+--------------+
                |
                +-------------------+
                |                   |
                v                   v
+---------------------------+   +----------------------+
| Correspondence Repository |   | Delivery Outbox      |
| - rendered output metadata|   | - email job          |
| - checksum                |   | - push/in-app job    |
| - storage ref             |   | - retry state        |
+-------------+-------------+   +----------+-----------+
              |                            |
              v                            v
+---------------------------+   +----------------------+
| Object Storage            |   | Delivery Workers     |
| PDF/HTML snapshots        |   | SMTP/API/provider    |
+---------------------------+   +----------+-----------+
                                           |
                                           v
                                  +-------------------+
                                  | Provider Callback |
                                  | bounce/delivered  |
                                  +-------------------+
```

### 4.2 Request Path vs Async Path

Ada dua jenis path.

#### Synchronous Preview Path

```text
Admin/User requests preview
  -> validate access
  -> resolve template version
  -> assemble sample/real model
  -> render
  -> return preview output
```

Cocok untuk:

- admin template preview.
- officer preview letter sebelum issue.
- user melihat generated HTML.

#### Asynchronous Production Delivery Path

```text
Business event occurs
  -> outbox event committed
  -> communication worker consumes event
  -> render output
  -> persist correspondence record
  -> enqueue delivery
  -> delivery worker sends
  -> update status
```

Cocok untuk:

- email.
- PDF generation.
- batch reminder.
- escalation notice.
- high-volume notification.

---

## 5. Domain Model

### 5.1 CommunicationIntent

Intent adalah alasan business untuk berkomunikasi.

```java
public record CommunicationIntent(
    String intentId,
    String businessReferenceType,
    String businessReferenceId,
    CommunicationType type,
    String tenantId,
    Locale locale,
    ZoneId zoneId,
    List<RecipientRef> recipients,
    Map<String, Object> attributes,
    Instant triggeredAt,
    String triggeredBy,
    String correlationId
) {}
```

Contoh `CommunicationType`:

```java
public enum CommunicationType {
    APPLICATION_SUBMITTED,
    APPLICATION_APPROVED,
    APPLICATION_REJECTED,
    CLARIFICATION_REQUESTED,
    PAYMENT_REMINDER,
    CASE_ESCALATED,
    WARNING_NOTICE_ISSUED,
    ACCOUNT_INVITATION
}
```

Intent bukan template. Intent adalah business meaning.

Template dipilih berdasarkan intent + channel + tenant + locale + effective date.

### 5.2 TemplateDefinition

```java
public record TemplateDefinition(
    TemplateId templateId,
    int version,
    TemplateEngineType engine,
    CommunicationChannel channel,
    OutputFamily outputFamily,
    TemplateState state,
    Locale locale,
    String tenantId,
    Instant effectiveFrom,
    Optional<Instant> effectiveTo,
    List<TemplatePart> parts,
    TemplateModelContract modelContract,
    TemplateSecurityPolicy securityPolicy,
    String createdBy,
    Instant createdAt,
    Optional<String> approvedBy,
    Optional<Instant> approvedAt
) {}
```

`TemplatePart`:

```java
public record TemplatePart(
    String name,
    String path,
    String outputFormat,
    boolean required
) {}
```

Contoh email template punya beberapa part:

```text
subject.ftlh
body-html.ftlh
body-text.ftl
attachment-letter-html.ftlh
```

Atau Thymeleaf:

```text
subject.txt
body.html
body.txt
letter.html
```

### 5.3 TemplateModelContract

```java
public record TemplateModelContract(
    String schemaVersion,
    List<ModelField> requiredFields,
    List<ModelField> optionalFields,
    List<String> forbiddenFields,
    int maxCollectionSize,
    int maxOutputBytes
) {}
```

`ModelField`:

```java
public record ModelField(
    String path,
    FieldType type,
    boolean nullable,
    Optional<String> description,
    Optional<String> example
) {}
```

Contoh:

```yaml
schemaVersion: application-approved-email-v2
requiredFields:
  - path: applicant.displayName
    type: STRING
    nullable: false
  - path: application.referenceNo
    type: STRING
    nullable: false
  - path: approval.approvedAtText
    type: STRING
    nullable: false
  - path: portal.loginUrl
    type: URL
    nullable: false
forbiddenFields:
  - applicant.passwordHash
  - applicant.nricRaw
  - security.sessionToken
maxCollectionSize: 100
maxOutputBytes: 1048576
```

### 5.4 CorrespondenceRecord

```java
public record CorrespondenceRecord(
    String correspondenceId,
    CommunicationType communicationType,
    String businessReferenceType,
    String businessReferenceId,
    String tenantId,
    List<RecipientSnapshot> recipients,
    TemplateId templateId,
    int templateVersion,
    Locale locale,
    ZoneId zoneId,
    Instant renderedAt,
    RenderStatus renderStatus,
    DeliveryStatus deliveryStatus,
    String subjectSnapshot,
    List<RenderedArtifact> artifacts,
    String modelSnapshotRef,
    String renderedChecksum,
    String triggeredBy,
    String triggerEventId,
    String correlationId
) {}
```

Important distinction:

- `RecipientRef` = pointer to user/customer/entity before rendering.
- `RecipientSnapshot` = actual resolved recipient at send time.

Why snapshot recipient?

Karena email address bisa berubah setelah correspondence dikirim. Audit harus tahu email dikirim ke alamat mana saat itu.

---

## 6. Template Lifecycle

### 6.1 State Machine

Template perlu state machine eksplisit.

```text
DRAFT
  -> READY_FOR_REVIEW
      -> APPROVED
          -> SCHEDULED
              -> ACTIVE
                  -> RETIRED
      -> REJECTED
DRAFT -> CANCELLED
ACTIVE -> SUSPENDED
SUSPENDED -> ACTIVE
```

### 6.2 State Meaning

| State | Meaning |
|---|---|
| DRAFT | sedang diedit, belum boleh dipakai production |
| READY_FOR_REVIEW | dikirim untuk review business/security/legal |
| REJECTED | review gagal, perlu revisi |
| APPROVED | lulus review, belum tentu aktif |
| SCHEDULED | akan aktif pada effective date |
| ACTIVE | boleh dipilih untuk production render |
| SUSPENDED | temporary disabled karena incident/risk |
| RETIRED | tidak dipakai untuk render baru, tetap bisa untuk audit/replay |
| CANCELLED | draft dibatalkan |

### 6.3 Transition Rules

Beberapa invariant:

```text
Only ACTIVE templates can be used for production delivery.
APPROVED templates cannot be edited in-place.
ACTIVE templates cannot be edited in-place.
Any change creates a new version.
RETired templates must remain readable for audit.
Template version used by correspondence record must be immutable.
```

### 6.4 Why No In-Place Edit for Active Template?

Jika active template diedit langsung:

- email kemarin dan email hari ini memakai version id sama tetapi isi beda.
- audit tidak bisa merekonstruksi output.
- rollback sulit.
- golden test tidak stabil.
- user support bisa melihat content berbeda dari yang sebenarnya dikirim.

Correct pattern:

```text
Template v3 ACTIVE
Need change
  -> clone v3 to v4 DRAFT
  -> edit v4
  -> review v4
  -> approve v4
  -> schedule v4
  -> activate v4
  -> retire v3
```

---

## 7. Template Selection

### 7.1 Input Selection

```java
public record TemplateSelectionRequest(
    CommunicationType communicationType,
    CommunicationChannel channel,
    String tenantId,
    Locale locale,
    Instant businessTime,
    Optional<String> explicitTemplateVersion
) {}
```

### 7.2 Selection Algorithm

```text
1. If explicitTemplateVersion exists:
   - load exact template version
   - validate state allows requested mode
   - return

2. Find ACTIVE templates where:
   - communicationType matches
   - channel matches
   - tenant matches or default tenant
   - locale matches or fallback locale
   - effectiveFrom <= businessTime
   - effectiveTo absent or businessTime < effectiveTo

3. Rank candidates:
   - exact tenant > default tenant
   - exact locale > language fallback > default locale
   - newest effectiveFrom
   - highest version if tie

4. If exactly one winner:
   - return

5. If none:
   - fail with TEMPLATE_NOT_FOUND

6. If ambiguous:
   - fail with TEMPLATE_SELECTION_AMBIGUOUS
```

### 7.3 Example Fallback Matrix

Request:

```text
tenant: AGENCY_A
locale: id-ID
channel: EMAIL
communicationType: APPLICATION_APPROVED
```

Candidate rank:

```text
1. AGENCY_A + id-ID
2. AGENCY_A + id
3. AGENCY_A + default locale
4. DEFAULT + id-ID
5. DEFAULT + id
6. DEFAULT + default locale
```

### 7.4 Effective Date Semantics

Use business time carefully.

Potential choices:

| Time | Meaning |
|---|---|
| triggeredAt | event happened time |
| renderedAt | render execution time |
| sentAt | delivery time |
| businessEffectiveAt | domain-specific effective time |

For correspondence/legal output, usually selection should use **businessEffectiveAt** or **triggeredAt**, not worker execution time. Otherwise delayed worker might pick different template version.

Correct:

```text
Case approved at 2026-07-01 10:00
Worker processes at 2026-07-02 02:00
Template selection uses approval event time unless business says otherwise.
```

---

## 8. Model Assembly

### 8.1 Source Data vs Render Model

Source data:

```text
Application aggregate
Applicant profile
Payment status
Officer profile
Tenant config
Portal config
Message bundle
Branding config
```

Render model:

```json
{
  "applicant": {
    "displayName": "Fajar Abdi Nugraha"
  },
  "application": {
    "referenceNo": "APP-2026-000123",
    "typeText": "Estate Agent Licence"
  },
  "approval": {
    "approvedAtText": "1 July 2026, 10:00"
  },
  "portal": {
    "loginUrl": "https://example.gov/portal"
  },
  "branding": {
    "agencyName": "Example Agency",
    "logoUrl": "https://assets.example.gov/logo.png"
  }
}
```

Template should receive render model only.

### 8.2 Model Assembly Pipeline

```text
Intent
  -> load business snapshot
  -> resolve recipients
  -> resolve tenant/branding
  -> resolve locale/timezone
  -> map to view model
  -> redact unauthorized fields
  -> validate contract
  -> freeze snapshot
```

### 8.3 Model Should Be Boring

Good render model:

- mostly strings, numbers, booleans, lists, maps, records.
- no lazy entity proxy.
- no repository/service reference.
- no security principal object.
- no ORM session dependency.
- no hidden DB call from getter.
- no method with side effects.

Bad model:

```java
model.put("application", applicationEntity);
model.put("userService", userService);
model.put("securityContext", SecurityContextHolder.getContext());
```

Good model:

```java
model.put("application", new ApplicationApprovedEmailModel(
    applicantDisplayName,
    applicationReferenceNo,
    applicationTypeText,
    approvedAtText,
    portalLoginUrl,
    branding
));
```

### 8.4 Snapshot Before Render

For audit, store model snapshot or at least a secure reference/checksum.

Options:

| Option | Pro | Con |
|---|---|---|
| store full JSON model | easiest replay | PII storage risk |
| store encrypted JSON model | replayable + safer | key management |
| store source IDs only | smaller | not replayable if source changes |
| store rendered output only | audit output available | cannot debug model issue |
| store model hash only | low risk | cannot replay |

For regulatory correspondence, common robust approach:

```text
store rendered output + metadata + checksum + optionally encrypted model snapshot
```

### 8.5 Redaction and Authorization

Model assembly must be the place where sensitive fields are removed.

Example:

```java
public ApplicationNoticeModel toModel(Application app, ViewerContext viewer) {
    return new ApplicationNoticeModel(
        app.referenceNo(),
        app.applicant().displayName(),
        maskNric(app.applicant().nric()),
        app.status().displayName(),
        allowedToSeePayment(viewer) ? paymentSummary(app) : null
    );
}
```

Do not rely on template author to hide sensitive field.

Wrong:

```html
<#if userHasPermission>
  ${applicant.nricRaw}
</#if>
```

Correct:

```text
Template never receives nricRaw.
```

---

## 9. Rendering Design

### 9.1 Rendering Service Interface

```java
public interface CorrespondenceRenderer {
    RenderedCorrespondence render(RenderRequest request);
}
```

```java
public record RenderRequest(
    String renderRequestId,
    TemplateDefinition template,
    Map<String, Object> model,
    Locale locale,
    ZoneId zoneId,
    Instant renderTime,
    RenderMode mode,
    String correlationId
) {}
```

```java
public record RenderedCorrespondence(
    String subject,
    Optional<String> htmlBody,
    Optional<String> textBody,
    List<RenderedArtifact> artifacts,
    String checksum,
    Map<String, String> diagnostics
) {}
```

### 9.2 RenderMode

```java
public enum RenderMode {
    PREVIEW,
    PRODUCTION,
    TEST,
    REPLAY
}
```

Mode matters because:

- preview may watermark output.
- test may use fake recipient.
- replay must use historical template/model.
- production must persist and deliver.

But mode must not change escaping/security behavior.

### 9.3 Engine Adapter

```java
public interface TemplateEngineAdapter {
    boolean supports(TemplateEngineType type);
    RenderedPart renderPart(TemplatePart part, Map<String, Object> model, RenderContext context);
}
```

FreeMarker adapter:

```text
TemplatePart.path -> Configuration.getTemplate(path, locale)
model + context -> Template.process(...)
```

Thymeleaf adapter:

```text
TemplatePart.path -> TemplateEngine.process(templateName, context)
model variables -> Context variables
```

### 9.4 Multi-Part Rendering

Email example:

```text
APPLICATION_APPROVED_EMAIL v4
  subject        -> subject.ftl / subject.txt
  html_body      -> body.ftlh / body.html
  text_body      -> body-text.ftl / body.txt
  pdf_attachment -> letter.ftlh -> PDF engine
```

Pipeline:

```text
render subject
render html body
render text body
render letter HTML
convert letter HTML to PDF
compute checksums
return RenderedCorrespondence
```

### 9.5 Checksum Strategy

Compute checksums for rendered artifacts:

```text
subject checksum optional
html body checksum
text body checksum
pdf checksum
combined correspondence checksum
```

Example combined checksum input:

```text
template_id
template_version
locale
zone_id
subject
html_body
text_body
artifact hashes
```

Use stable encoding:

```text
UTF-8
canonical JSON for metadata
SHA-256
```

---

## 10. Email + PDF Flow

### 10.1 End-to-End Flow

```text
ApplicationApprovedEvent
  -> Outbox event committed
  -> Communication worker loads event
  -> Create CommunicationIntent
  -> Resolve recipients
  -> Select APPLICATION_APPROVED template
  -> Assemble model
  -> Validate model contract
  -> Render subject/html/text/letter-html
  -> Generate PDF
  -> Store correspondence record + artifacts
  -> Enqueue email delivery job
  -> Email worker sends via provider
  -> Update delivery status
  -> Provider callback updates delivered/bounced
```

### 10.2 Why Use Outbox?

If domain transaction updates application status to APPROVED and sends email inside same request, failures become tricky:

```text
DB commit success, email send fail -> user not notified
email send success, DB commit fail -> user receives false approval
request timeout after send -> retry sends duplicate
```

Outbox pattern:

```text
Transaction:
  update application APPROVED
  insert ApplicationApprovedEvent into outbox
Commit

Async worker:
  process outbox event
  render/send correspondence idempotently
```

This gives better reliability and recoverability.

### 10.3 Idempotency

Idempotency key can be:

```text
communication_type + business_reference_id + event_id + recipient_id + channel
```

Example:

```text
APPLICATION_APPROVED:APP-2026-000123:EVENT-999:USER-123:EMAIL
```

Invariant:

```text
For a given idempotency key, at most one production correspondence should be created.
```

Delivery retry should not create new correspondence each time.

---

## 11. Storage Design

### 11.1 Tables

#### `template_definition`

```sql
CREATE TABLE template_definition (
    id                  VARCHAR(64) PRIMARY KEY,
    template_key         VARCHAR(128) NOT NULL,
    version              INTEGER NOT NULL,
    engine               VARCHAR(32) NOT NULL,
    channel              VARCHAR(32) NOT NULL,
    tenant_id            VARCHAR(64),
    locale_tag           VARCHAR(32) NOT NULL,
    state                VARCHAR(32) NOT NULL,
    effective_from       TIMESTAMP NOT NULL,
    effective_to         TIMESTAMP NULL,
    model_contract_json  CLOB NOT NULL,
    security_policy_json CLOB NOT NULL,
    created_by           VARCHAR(128) NOT NULL,
    created_at           TIMESTAMP NOT NULL,
    approved_by          VARCHAR(128),
    approved_at          TIMESTAMP,
    UNIQUE(template_key, version, tenant_id, locale_tag)
);
```

#### `template_part`

```sql
CREATE TABLE template_part (
    id                  VARCHAR(64) PRIMARY KEY,
    template_def_id      VARCHAR(64) NOT NULL,
    part_name            VARCHAR(64) NOT NULL,
    output_format        VARCHAR(32) NOT NULL,
    content_ref          VARCHAR(512) NOT NULL,
    content_checksum     VARCHAR(128) NOT NULL,
    required             BOOLEAN NOT NULL,
    FOREIGN KEY (template_def_id) REFERENCES template_definition(id)
);
```

`content_ref` can point to:

- database CLOB.
- object storage.
- Git-backed path.
- classpath path for static templates.

#### `correspondence_record`

```sql
CREATE TABLE correspondence_record (
    id                     VARCHAR(64) PRIMARY KEY,
    idempotency_key         VARCHAR(256) NOT NULL UNIQUE,
    communication_type      VARCHAR(128) NOT NULL,
    business_ref_type       VARCHAR(64) NOT NULL,
    business_ref_id         VARCHAR(128) NOT NULL,
    tenant_id               VARCHAR(64),
    template_key            VARCHAR(128) NOT NULL,
    template_version        INTEGER NOT NULL,
    locale_tag              VARCHAR(32) NOT NULL,
    zone_id                 VARCHAR(64) NOT NULL,
    subject_snapshot        VARCHAR(512),
    render_status           VARCHAR(32) NOT NULL,
    delivery_status         VARCHAR(32) NOT NULL,
    model_snapshot_ref      VARCHAR(512),
    rendered_checksum       VARCHAR(128),
    rendered_at             TIMESTAMP,
    triggered_by            VARCHAR(128),
    trigger_event_id        VARCHAR(128),
    correlation_id          VARCHAR(128),
    created_at              TIMESTAMP NOT NULL,
    updated_at              TIMESTAMP NOT NULL
);
```

#### `correspondence_artifact`

```sql
CREATE TABLE correspondence_artifact (
    id                     VARCHAR(64) PRIMARY KEY,
    correspondence_id       VARCHAR(64) NOT NULL,
    artifact_type           VARCHAR(32) NOT NULL,
    mime_type               VARCHAR(128) NOT NULL,
    storage_ref             VARCHAR(512) NOT NULL,
    checksum                VARCHAR(128) NOT NULL,
    size_bytes              BIGINT NOT NULL,
    created_at              TIMESTAMP NOT NULL,
    FOREIGN KEY (correspondence_id) REFERENCES correspondence_record(id)
);
```

#### `delivery_job`

```sql
CREATE TABLE delivery_job (
    id                     VARCHAR(64) PRIMARY KEY,
    correspondence_id       VARCHAR(64) NOT NULL,
    channel                 VARCHAR(32) NOT NULL,
    provider                VARCHAR(64),
    recipient_snapshot_json CLOB NOT NULL,
    status                  VARCHAR(32) NOT NULL,
    attempt_count           INTEGER NOT NULL,
    next_attempt_at         TIMESTAMP,
    last_error_code         VARCHAR(128),
    last_error_message      VARCHAR(1024),
    provider_message_id     VARCHAR(256),
    created_at              TIMESTAMP NOT NULL,
    updated_at              TIMESTAMP NOT NULL,
    FOREIGN KEY (correspondence_id) REFERENCES correspondence_record(id)
);
```

### 11.2 Object Storage Layout

```text
correspondence/
  tenant-id/
    yyyy/MM/dd/
      correspondence-id/
        model.enc.json
        subject.txt
        body.html
        body.txt
        letter.pdf
        metadata.json
```

### 11.3 Immutability Rule

Once artifact is marked production-sent or production-issued:

```text
Do not overwrite.
Do not mutate.
Create new artifact/version/correction record.
```

---

## 12. Preview and Approval Workflow

### 12.1 Preview Types

| Preview Type | Purpose |
|---|---|
| sample preview | template author checks layout using sample data |
| real-data preview | officer checks correspondence before issue |
| locale preview | reviewer checks translation |
| tenant preview | agency checks branding |
| diff preview | compare old vs new version |
| security preview | inspect raw variables/unsafe output |

### 12.2 Sample Data

Every template should have canonical sample data.

```json
{
  "applicant": {
    "displayName": "Sample Applicant"
  },
  "application": {
    "referenceNo": "APP-2026-SAMPLE",
    "typeText": "Sample Licence"
  },
  "approval": {
    "approvedAtText": "1 July 2026, 10:00"
  }
}
```

Sample data should include:

- normal value.
- long value.
- missing optional value.
- special HTML characters.
- unicode.
- empty list.
- max-ish list.

Example dangerous sample:

```json
{
  "applicant": {
    "displayName": "<script>alert('xss')</script>"
  }
}
```

This ensures escaping is visible during preview.

### 12.3 Review Checklist

Before approval, require checks:

```text
[ ] Template compiles.
[ ] Required model fields exist.
[ ] HTML output escapes untrusted values.
[ ] No forbidden directives/functions.
[ ] No service/domain object access.
[ ] Subject renders within length limit.
[ ] Plain text alternative exists for email.
[ ] Locale text reviewed.
[ ] Tenant branding correct.
[ ] Legal footer correct.
[ ] PDF output page breaks acceptable.
[ ] Golden tests pass.
[ ] Security tests pass.
[ ] Accessibility checks pass for HTML page/email where applicable.
```

### 12.4 Approval Separation

For high-risk correspondence:

```text
Template Author != Approver
Business Approver != Security Approver
Legal Approver required for legal templates
```

State transition stores:

```text
who
when
from_state
to_state
comment
checksum_before
checksum_after
```

---

## 13. Security Model

### 13.1 Trust Levels

Classify templates by author trust:

| Level | Author | Capability |
|---|---|---|
| L0 | developer-owned static template | full engine features allowed with review |
| L1 | internal trained admin | restricted macro/directive set |
| L2 | business user editor | placeholder-only / safe DSL |
| L3 | external user | never raw FreeMarker/Thymeleaf execution |

For L2/L3, do not expose full FreeMarker/Thymeleaf power. Use a constrained placeholder system or pre-approved blocks.

### 13.2 Dangerous Patterns

Never allow untrusted template authors to access:

```text
java.lang.Runtime
Class.forName
Spring ApplicationContext
repositories
services
security context
HTTP request/session raw object
filesystem paths
system environment
secret manager
```

### 13.3 Data Leakage Prevention

Rules:

1. Template receives only required view model.
2. Model contract forbids sensitive fields.
3. Logs never include full rendered body by default.
4. Preview access follows same authorization as business object.
5. Stored artifacts use encryption where necessary.
6. Download links expire and require authorization.
7. Email body should avoid unnecessary sensitive data.
8. PII masking is done before template.

### 13.4 HTML Safety

For FreeMarker HTML template:

- use `.ftlh` where possible.
- use HTML output format.
- keep auto-escaping enabled.
- avoid `?no_esc` unless value is sanitized trusted markup.

For Thymeleaf:

- prefer `th:text`.
- avoid `th:utext` for untrusted data.
- avoid injecting raw HTML unless sanitized.

### 13.5 Preview Security

Preview endpoint can leak data if not designed carefully.

Bad:

```text
GET /admin/templates/{id}/preview?businessRef=APP-123
```

without authorization check.

Correct:

```text
check user can view template
check user can view business object
check user can preview this template type
log preview access
watermark preview when needed
```

---

## 14. Operational Dashboard

A production correspondence platform needs dashboard.

### 14.1 Template Health

Metrics:

```text
active templates by type/channel/tenant/locale
template validation failures
template publish count
template rollback count
scheduled template activations
missing fallback template count
```

### 14.2 Rendering Health

Metrics:

```text
render request count
render success count
render failure count
render latency p50/p95/p99
render output size
render failures by template_id/version
model validation failures
cache hit/miss if available
```

### 14.3 Delivery Health

Metrics:

```text
delivery queued count
delivery success count
delivery failed count
delivery retry count
delivery age
provider latency
bounce count
complaint count
dead-letter count
```

### 14.4 Business Health

Metrics:

```text
notifications sent per communication type
letters generated per case state
pending officer preview count
approval workflow aging
failed high-priority correspondence
```

### 14.5 Alerts

Example alert rules:

```text
render_failure_rate > 1% for 10 minutes
TEMPLATE_NOT_FOUND > 0 for production events
email_delivery_failed_rate > 5% for 15 minutes
delivery_queue_age_p95 > 10 minutes
scheduled template activation failed
correspondence dead-letter count increased
PDF generation p99 > 30s
```

---

## 15. Failure Model

### 15.1 Failure Classes

```java
public enum CorrespondenceFailureCode {
    TEMPLATE_NOT_FOUND,
    TEMPLATE_SELECTION_AMBIGUOUS,
    TEMPLATE_NOT_ACTIVE,
    TEMPLATE_PARSE_FAILED,
    MODEL_ASSEMBLY_FAILED,
    MODEL_CONTRACT_FAILED,
    RENDER_FAILED,
    PDF_GENERATION_FAILED,
    ARTIFACT_STORAGE_FAILED,
    DELIVERY_PROVIDER_FAILED,
    DELIVERY_RECIPIENT_INVALID,
    DELIVERY_RATE_LIMITED,
    DELIVERY_BOUNCED,
    SECURITY_POLICY_VIOLATION,
    IDEMPOTENCY_CONFLICT
}
```

### 15.2 Retryability

| Failure | Retry? | Notes |
|---|---|---|
| template not found | no | configuration problem |
| model contract failed | no | data/template mismatch |
| SMTP timeout | yes | transient |
| provider 429 | yes with backoff | rate limit |
| invalid recipient | no | data correction needed |
| object storage timeout | yes | infra transient |
| PDF font missing | no | deployment/config problem |
| deadlock/DB transient | yes | bounded retry |

### 15.3 Dead Letter

Any event that cannot be processed after max retries goes to dead-letter state.

Dead-letter record should include:

```text
event id
communication type
business reference
template info if selected
failure code
sanitized failure message
attempt count
last attempt timestamp
correlation id
operator action required
```

### 15.4 Manual Replay

Replay must be controlled.

Replay modes:

| Mode | Meaning |
|---|---|
| replay-render-only | regenerate output, do not send |
| replay-delivery-same-output | resend previously rendered artifact |
| replay-new-render | render again with current/historical template depending policy |

For legal correspondence, default should be:

```text
resend same rendered output
```

not re-render with changed data.

---

## 16. Example Implementation Structure

### 16.1 Package Layout

```text
com.example.correspondence
  api
    CorrespondenceCommandController.java
    CorrespondencePreviewController.java
  application
    CommunicationOrchestrator.java
    TemplateSelectionService.java
    ModelAssemblyService.java
    CorrespondenceRenderingService.java
    DeliveryScheduler.java
    ReplayService.java
  domain
    CommunicationIntent.java
    TemplateDefinition.java
    TemplatePart.java
    TemplateModelContract.java
    CorrespondenceRecord.java
    DeliveryJob.java
    TemplateState.java
    CommunicationType.java
    CommunicationChannel.java
  engine
    TemplateEngineAdapter.java
    FreemarkerTemplateEngineAdapter.java
    ThymeleafTemplateEngineAdapter.java
    PdfGenerator.java
  infrastructure
    TemplateRepository.java
    CorrespondenceRepository.java
    ArtifactStorage.java
    EmailDeliveryProvider.java
    OutboxRepository.java
  security
    TemplateSecurityPolicy.java
    ModelRedactor.java
    PreviewAuthorizationService.java
  validation
    TemplateContractValidator.java
    TemplateLintService.java
    ModelSchemaValidator.java
  observability
    CorrespondenceMetrics.java
    CorrespondenceAuditLogger.java
```

### 16.2 Core Orchestrator Pseudocode

```java
public CorrespondenceRecord createAndSchedule(CommunicationIntent intent) {
    String idempotencyKey = idempotencyKey(intent);

    Optional<CorrespondenceRecord> existing = correspondenceRepository.findByIdempotencyKey(idempotencyKey);
    if (existing.isPresent()) {
        return existing.get();
    }

    TemplateDefinition template = templateSelectionService.select(
        new TemplateSelectionRequest(
            intent.type(),
            CommunicationChannel.EMAIL,
            intent.tenantId(),
            intent.locale(),
            intent.triggeredAt(),
            Optional.empty()
        )
    );

    Map<String, Object> model = modelAssemblyService.assemble(intent, template.modelContract());

    modelContractValidator.validate(template.modelContract(), model);

    RenderedCorrespondence rendered = renderingService.render(
        new RenderRequest(
            UUID.randomUUID().toString(),
            template,
            model,
            intent.locale(),
            intent.zoneId(),
            intent.triggeredAt(),
            RenderMode.PRODUCTION,
            intent.correlationId()
        )
    );

    ArtifactRefs artifactRefs = artifactStorage.store(rendered);

    CorrespondenceRecord record = CorrespondenceRecordFactory.create(
        idempotencyKey,
        intent,
        template,
        rendered,
        artifactRefs
    );

    correspondenceRepository.save(record);
    deliveryScheduler.enqueueEmail(record, intent.recipients());

    return record;
}
```

Important: in real production code, transaction boundaries need careful design. Often record creation and delivery job enqueue should be in the same DB transaction, while actual email send happens outside.

---

## 17. Template Examples

### 17.1 FreeMarker Subject

`application-approved/subject.ftl`

```ftl
Application ${application.referenceNo} approved
```

### 17.2 FreeMarker HTML Body

`application-approved/body.ftlh`

```ftl
<!doctype html>
<html lang="${locale.language}">
<head>
  <meta charset="UTF-8">
  <title>Application Approved</title>
</head>
<body>
  <p>Dear ${applicant.displayName},</p>

  <p>
    Your application <strong>${application.referenceNo}</strong>
    for ${application.typeText} has been approved.
  </p>

  <p>Approved date: ${approval.approvedAtText}</p>

  <p>
    You may log in to the portal here:
    <a href="${portal.loginUrl}">${portal.loginUrl}</a>
  </p>

  <hr>
  <p>${branding.agencyName}</p>
</body>
</html>
```

### 17.3 FreeMarker Text Body

`application-approved/body-text.ftl`

```ftl
Dear ${applicant.displayName},

Your application ${application.referenceNo} for ${application.typeText} has been approved.

Approved date: ${approval.approvedAtText}

Portal: ${portal.loginUrl}

${branding.agencyName}
```

### 17.4 Thymeleaf HTML Body

`application-approved/body.html`

```html
<!doctype html>
<html lang="en" xmlns:th="http://www.thymeleaf.org">
<head>
  <meta charset="UTF-8">
  <title>Application Approved</title>
</head>
<body>
  <p>Dear <span th:text="${applicant.displayName}">Sample Applicant</span>,</p>

  <p>
    Your application
    <strong th:text="${application.referenceNo}">APP-2026-SAMPLE</strong>
    for <span th:text="${application.typeText}">Sample Licence</span>
    has been approved.
  </p>

  <p>
    Approved date:
    <span th:text="${approval.approvedAtText}">1 July 2026, 10:00</span>
  </p>

  <p>
    You may log in to the portal here:
    <a th:href="${portal.loginUrl}" th:text="${portal.loginUrl}">https://example.gov/portal</a>
  </p>

  <hr>
  <p th:text="${branding.agencyName}">Example Agency</p>
</body>
</html>
```

### 17.5 Why This Is Still Not Enough

Template examples are simple. Production platform complexity is in:

- how template is selected.
- how model is assembled.
- how template is validated.
- how output is stored.
- how delivery is retried.
- how audit is preserved.
- how template lifecycle is controlled.

Syntax is only the visible tip.

---

## 18. Testing Strategy for the Blueprint

### 18.1 Test Pyramid

```text
Unit tests
  - model mapper
  - template selector
  - contract validator
  - renderer adapter

Integration tests
  - render real templates
  - storage integration
  - mail provider fake
  - outbox worker

Approval/golden tests
  - stable output snapshot
  - locale variants
  - PDF artifact checks

Security tests
  - XSS samples
  - forbidden model fields
  - forbidden directives
  - preview authorization

Load tests
  - batch rendering
  - delivery queue
  - PDF generation throughput
```

### 18.2 Golden Output

Golden test structure:

```text
src/test/resources/golden/application-approved/en-SG/
  input-model.json
  expected-subject.txt
  expected-body.html
  expected-body.txt
```

Test:

```text
render input-model.json using template vX
normalize whitespace if policy allows
compare to expected output
```

### 18.3 Contract Test

```text
for every ACTIVE template:
  load model contract
  load sample model
  validate sample model
  render all parts
  assert no forbidden output
  assert output size below limit
```

### 18.4 Escaping Test

Input:

```json
{
  "applicant": {
    "displayName": "<script>alert('xss')</script>"
  }
}
```

Expected HTML:

```html
&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt;
```

Not:

```html
<script>alert('xss')</script>
```

---

## 19. Java 8–25 Considerations

### 19.1 Java 8 Baseline

If supporting Java 8:

- use `java.time` anyway.
- avoid records/sealed classes in shared library.
- use POJO DTOs.
- use CompletableFuture carefully.
- no virtual threads.

### 19.2 Java 11/17 Baseline

For many enterprise systems:

- Java 11 or 17 is common LTS baseline.
- better GC/runtime behavior than Java 8.
- use records only if Java 16+ baseline.
- use text blocks if Java 15+ for tests/sample templates.

### 19.3 Java 21+

Useful for:

- virtual threads for I/O-heavy delivery workers.
- structured concurrency for bounded parallel artifact generation if available in your runtime policy.
- modern GC improvements.
- better observability ecosystem.

Caution:

- rendering itself is CPU/string/allocation heavy, not magically solved by virtual threads.
- PDF generation may be CPU/memory heavy.
- virtual threads help more when blocked on DB/storage/provider I/O.

### 19.4 Java 25

For this series, Java 25 is treated as latest modern Java target for API/runtime awareness. But production adoption depends on organization support policy.

Design recommendation:

```text
Keep rendering platform API Java-version-conscious.
Do not force latest language syntax into shared templates/platform if enterprise baseline is Java 8/11/17.
Use modern Java internally where deployment allows.
```

---

## 20. Operational Runbook

### 20.1 Render Failure Spike

Steps:

```text
1. Check render_failure_rate by template_id/version.
2. Identify failure code.
3. Check recent template activation.
4. If new template caused failure, suspend template version.
5. Roll back to previous active version if safe.
6. Reprocess failed correspondence events.
7. Create incident record.
8. Add regression test.
```

### 20.2 Delivery Failure Spike

```text
1. Check provider status.
2. Check failed status code distribution.
3. If 429, reduce worker rate and apply backoff.
4. If auth error, check credentials/secret rotation.
5. If invalid recipients spike, inspect source data change.
6. Pause non-critical delivery if needed.
7. Keep transactional/legal notices prioritized.
```

### 20.3 Wrong Content Sent

```text
1. Freeze affected template version.
2. Identify correspondence records by template version/time window.
3. Export affected recipients/business refs.
4. Determine whether correction notice is needed.
5. Preserve original artifacts.
6. Publish corrected template as new version.
7. Send correction correspondence with explicit reference.
8. Document incident and add tests.
```

### 20.4 Template Not Found

```text
1. Check communication type/channel mapping.
2. Check tenant override.
3. Check locale fallback.
4. Check effective date.
5. Check template state.
6. Create missing template or fix mapping.
7. Reprocess dead-letter events.
```

---

## 21. Architecture Decision Records

A top-tier implementation should document decisions explicitly.

Example ADRs:

```text
ADR-001: Separate rendering from delivery
ADR-002: Active templates are immutable
ADR-003: Use outbox for production communication events
ADR-004: Store rendered artifacts for legal correspondence
ADR-005: Use FreeMarker for email/text/PDF pre-rendering
ADR-006: Use Thymeleaf for officer-facing preview UI
ADR-007: Do not expose domain entities to templates
ADR-008: Use versioned model contracts
ADR-009: Disable raw template editing for external users
ADR-010: Use tenant-locale-effective-date template selection
```

Each ADR should contain:

```text
Context
Decision
Consequences
Alternatives considered
Operational impact
Security impact
```

---

## 22. Common Anti-Patterns

### 22.1 Sending Email Directly from Controller

Bad:

```text
HTTP request -> update DB -> render -> send SMTP -> return response
```

Problems:

- slow request.
- duplicate send on retry.
- inconsistent transaction semantics.
- no recovery.

Better:

```text
HTTP request -> update DB + outbox event -> return
worker -> render/send
```

### 22.2 Template Owns Business Logic

Bad:

```ftl
<#if application.status == "APPROVED" && application.payment.paid && application.owner.age gt 18>
```

Better:

```java
model.put("showApprovalInstructions", decision.showApprovalInstructions());
```

Template displays decision; business layer makes decision.

### 22.3 Entity as Model

Bad:

```java
model.put("case", caseEntity);
```

Better:

```java
model.put("case", caseNoticeViewModel);
```

### 22.4 Mutable Active Template

Bad:

```text
UPDATE template_content SET body = ... WHERE template_id = active_template
```

Better:

```text
clone -> draft -> approve -> activate new version
```

### 22.5 No Plain Text Email

Bad:

```text
HTML-only transactional email
```

Better:

```text
multipart/alternative: text/plain + text/html
```

### 22.6 Preview Path Different from Production

Bad:

```text
Preview uses simplified renderer
Production uses real renderer
```

Better:

```text
Same renderer, different mode/destination
```

### 22.7 Logging Rendered Body

Bad:

```text
log.info("Rendered email: {}", htmlBody)
```

Better:

```text
log.info("Rendered correspondence template={} version={} checksum={} size={}", ...)
```

---

## 23. Design Review Checklist

Use this checklist when reviewing a correspondence platform design.

### 23.1 Template Governance

```text
[ ] Does every template have version?
[ ] Is active template immutable?
[ ] Is there approval workflow?
[ ] Is there effective date?
[ ] Is fallback deterministic?
[ ] Is rollback possible?
```

### 23.2 Model Contract

```text
[ ] Is template model explicit?
[ ] Are domain entities excluded?
[ ] Are sensitive fields forbidden?
[ ] Is sample data maintained?
[ ] Are model contracts tested?
```

### 23.3 Rendering

```text
[ ] Is rendering separate from delivery?
[ ] Are output formats explicit?
[ ] Is escaping enabled?
[ ] Is locale/timezone explicit?
[ ] Is render deterministic?
[ ] Are artifacts checksummed?
```

### 23.4 Delivery

```text
[ ] Is delivery async for production events?
[ ] Is idempotency enforced?
[ ] Is retry bounded?
[ ] Is dead-letter supported?
[ ] Are provider callbacks reconciled?
```

### 23.5 Audit

```text
[ ] Is rendered output stored or reconstructable?
[ ] Is template version recorded?
[ ] Is recipient snapshotted?
[ ] Is triggered event recorded?
[ ] Is checksum stored?
```

### 23.6 Security

```text
[ ] Is template author trust model defined?
[ ] Is object exposure restricted?
[ ] Is preview authorization enforced?
[ ] Is raw HTML controlled?
[ ] Is PII protected in logs/storage?
```

### 23.7 Operations

```text
[ ] Are render metrics available?
[ ] Are delivery metrics available?
[ ] Are template failures visible by version?
[ ] Is runbook defined?
[ ] Is replay safe?
```

---

## 24. Reference Implementation Flow Summary

```text
1. Business service emits event after domain state change.
2. Outbox stores event atomically with business transaction.
3. Communication worker reads event.
4. Intent mapper converts event to CommunicationIntent.
5. Recipient resolver snapshots recipients.
6. Template selector resolves template by type/channel/tenant/locale/effective time.
7. Model assembler creates safe ViewModel.
8. Contract validator validates model.
9. Renderer renders all template parts.
10. PDF generator creates attachments if needed.
11. Artifact storage stores immutable outputs.
12. Correspondence record stores metadata/checksum/status.
13. Delivery job is enqueued.
14. Delivery worker sends message.
15. Provider callback updates status.
16. Operators monitor failures and replay safely.
```

This is the production mental model.

---

## 25. Key Takeaways

1. Enterprise correspondence is not “email sending”; it is official artifact generation plus delivery lifecycle.
2. Template must be versioned, immutable after approval, and selected deterministically.
3. Data model is the real contract; never expose domain entities or services to templates.
4. Rendering and delivery must be separated to control failure and retry semantics.
5. Preview must use the same renderer as production.
6. Store enough metadata to answer audit questions later.
7. Use idempotency to prevent duplicate communication.
8. Treat template editing as a governed workflow, not a text box.
9. Security must cover XSS, SSTI, PII leakage, object exposure, preview authorization, and resource abuse.
10. Observability must slice metrics by template id/version/channel/tenant/failure code.
11. Legal/regulatory correspondence should preserve immutable rendered output.
12. The hardest part is not FreeMarker/Thymeleaf syntax; it is lifecycle, contract, failure, governance, and audit design.

---

## 26. References

- Apache FreeMarker Manual — https://freemarker.apache.org/docs/index.html
- Apache FreeMarker Auto-Escaping and Output Formats — https://freemarker.apache.org/docs/dgui_misc_autoescaping.html
- Apache FreeMarker Template Loading — https://freemarker.apache.org/docs/pgui_config_templateloading.html
- Apache FreeMarker Multithreading — https://freemarker.apache.org/docs/pgui_misc_multithreading.html
- Thymeleaf Documentation — https://www.thymeleaf.org/documentation.html
- Thymeleaf + Spring Tutorial — https://www.thymeleaf.org/doc/tutorials/3.1/thymeleafspring.html
- Thymeleaf Spring Mail Article — https://www.thymeleaf.org/doc/articles/springmail.html
- Spring Framework Email Integration — https://docs.spring.io/spring-framework/reference/integration/email.html
- Micrometer Timers — https://docs.micrometer.io/micrometer/reference/concepts/timers.html
- Spring Boot Actuator Metrics — https://docs.spring.io/spring-boot/reference/actuator/metrics.html

---

## 27. Status Seri

```text
Part 31 selesai.
Seri belum selesai.
Berikutnya: Part 32 — Real-World Blueprint II: Server-Side Rendered Admin Portal with Thymeleaf.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-030.md">⬅️ Part 30 — Performance Lab: Benchmarking FreeMarker vs Thymeleaf</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-032.md">Part 32 — Real-World Blueprint II: Server-Side Rendered Admin Portal with Thymeleaf ➡️</a>
</div>
