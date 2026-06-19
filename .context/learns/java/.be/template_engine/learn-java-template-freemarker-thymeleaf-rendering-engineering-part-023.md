# learn-java-template-freemarker-thymeleaf-rendering-engineering-part-023

# Part 23 — Template Versioning, Governance, CMS-like Editing, and Multi-Tenant Templates

> Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`  
> Level: Advanced / Production Engineering  
> Fokus: template lifecycle, versioning, governance, approval workflow, multi-tenancy, CMS-like editing, compatibility, rollback, auditability, and security boundary.  
> Target Java: Java 8 sampai Java 25  
> Engine utama: Apache FreeMarker dan Thymeleaf

---

## 0. Posisi Part Ini Dalam Series

Pada part sebelumnya kita sudah membangun fondasi penting:

- FreeMarker architecture, FTL, macro, custom directive, object wrapping, escaping, error handling, performance, dan Spring/Jakarta integration.
- Thymeleaf architecture, expression, DOM transformation, forms, fragments/layout, security, performance.
- Email rendering, document generation, i18n/l10n, dan desain data model rendering.

Part ini naik satu level: bukan lagi hanya **cara merender satu template**, tetapi bagaimana mengelola **template sebagai aset enterprise**.

Di aplikasi kecil, template biasanya hanya file `.ftlh`, `.html`, atau `.txt` di classpath.

Di aplikasi enterprise, terutama sistem regulatori, case management, correspondence, notification, dan multi-tenant platform, template bisa menjadi:

- objek yang punya lifecycle;
- objek yang harus direview;
- objek yang punya effective date;
- objek yang berbeda per tenant/agency;
- objek yang harus bisa dirollback;
- objek yang dipakai untuk menghasilkan dokumen legal;
- objek yang harus bisa diaudit;
- objek yang tidak boleh diedit sembarangan karena bisa menjadi celah injection atau data leakage.

Mental model utama part ini:

> Template production bukan hanya file rendering. Template production adalah controlled content supply chain.

---

## 1. Masalah Yang Sering Diremehkan

Banyak sistem memulai dengan template sederhana:

```text
src/main/resources/templates/email/approval.ftlh
src/main/resources/templates/email/rejection.ftlh
src/main/resources/templates/document/notice.ftlh
```

Lalu kebutuhan berkembang:

1. Business user ingin mengubah wording tanpa deploy.
2. Legal team ingin review sebelum template aktif.
3. Agency A dan Agency B butuh wording berbeda.
4. Template baru berlaku mulai tanggal tertentu.
5. Template lama tetap harus bisa dipakai untuk regenerate dokumen lama.
6. Ada bug di template yang sudah dipublish.
7. Ada variable baru yang belum tersedia di data model.
8. Ada template yang membocorkan data sensitif.
9. Ada user memasukkan ekspresi template berbahaya.
10. Ada audit yang meminta: “versi template mana yang menghasilkan surat ini?”

Jika arsitektur template hanya “ambil file terbaru lalu render”, sistem akan rapuh.

Masalahnya bukan di FreeMarker atau Thymeleaf. Masalahnya adalah **governance model**.

---

## 2. Static Template vs Dynamic Template

Ada dua mode besar pengelolaan template.

### 2.1 Static Developer-Owned Template

Template disimpan bersama codebase.

Contoh:

```text
src/main/resources/templates/mail/case-assigned.ftlh
src/main/resources/templates/pages/dashboard.html
```

Cocok untuk:

- page layout aplikasi;
- reusable UI fragments;
- template yang sangat terikat dengan controller/model;
- template yang hanya developer boleh ubah;
- template yang change lifecycle-nya mengikuti deployment aplikasi.

Kelebihan:

- mudah dites di CI;
- versioning ikut Git;
- code review jelas;
- rollback ikut rollback aplikasi;
- attack surface lebih kecil.

Kekurangan:

- setiap wording change perlu deploy;
- sulit untuk tenant-specific variation;
- business/legal tidak bisa mengedit langsung;
- effective date harus dikodekan atau dikonfigurasi.

### 2.2 Dynamic Business-Owned Template

Template disimpan di database, object storage, config service, atau CMS internal.

Contoh table:

```text
template_definition
- id
- template_key
- tenant_id
- locale
- channel
- output_format
- version
- status
- body
- created_by
- reviewed_by
- approved_by
- effective_from
- effective_to
```

Cocok untuk:

- email notification;
- correspondence letter;
- legal notice;
- tenant-specific message;
- campaign-like content;
- CMS-like admin template editor;
- document wording yang sering berubah.

Kelebihan:

- update tanpa redeploy;
- bisa punya draft/review/published;
- bisa multi-tenant;
- bisa effective date;
- bisa preview;
- bisa rollback per template.

Kekurangan:

- security risk lebih besar;
- perlu sandboxing;
- perlu approval workflow;
- perlu compatibility validation;
- perlu audit trail;
- perlu template cache invalidation;
- debugging lebih kompleks.

### 2.3 Hybrid Model

Dalam sistem production besar, biasanya model terbaik adalah hybrid:

```text
Developer-owned:
- layout shell
- macro library
- UI components
- security-sensitive fragments
- rendering adapters
- data model schema

Business-owned:
- wording
- tenant branding content
- email body
- letter clauses
- notification copy
- locale-specific copy
```

Contoh:

```ftl
<#-- developer-owned macro library -->
<#import "/lib/letter-layout.ftlh" as layout>

<@layout.officialLetter title=letterTitle>
  ${businessContent?no_esc}
</@layout.officialLetter>
```

Tetapi pola seperti ini harus hati-hati. Jika `businessContent` adalah HTML dari admin editor, harus ada sanitization dan allowlist HTML, bukan langsung raw.

Rule praktis:

> Semakin besar kebebasan business editor, semakin kecil akses template expression yang boleh diberikan.

---

## 3. Template Ownership Model

Sebelum membuat fitur template editor, tentukan ownership.

### 3.1 Developer-Owned

Developer bertanggung jawab atas:

- template syntax;
- data model contract;
- escaping policy;
- macro libraries;
- integration with renderer;
- tests;
- security boundaries.

Template developer-owned sebaiknya diperlakukan seperti code.

Perubahan harus melalui:

- pull request;
- code review;
- automated test;
- static analysis;
- deployment pipeline.

### 3.2 Business-Owned

Business/legal/content owner bertanggung jawab atas:

- wording;
- tone;
- legal clause;
- agency-specific text;
- translation;
- effective date;
- approval decision.

Namun mereka tidak seharusnya diberi full engine power.

Jika mereka diberi FreeMarker full syntax atau Thymeleaf full expression access, maka mereka bukan sekadar editor konten. Mereka menjadi template programmer.

Itu berarti perlu:

- training;
- validation;
- approval;
- restricted functions;
- safe preview;
- sandbox;
- audit.

### 3.3 Platform-Owned

Platform/team engineering bertanggung jawab atas:

- template registry;
- versioning policy;
- resolver;
- cache;
- audit trail;
- permission model;
- validation pipeline;
- compatibility checker;
- rollback mechanism;
- observability.

Top 1% mental model:

> Jangan mencampur ownership. Template syntax, wording, rendering runtime, and legal approval are different concerns.

---

## 4. Template Identity

Template butuh identitas stabil.

Buruk:

```text
approval-email-v2-final-new.html
```

Lebih baik:

```text
template_key: case.approval.email
channel: EMAIL
output_format: HTML
locale: en-SG
tenant_id: CEA
version: 3
```

Template identity sebaiknya terdiri dari:

| Field | Makna |
|---|---|
| `template_key` | nama logical stabil |
| `channel` | EMAIL, WEB, PDF, SMS, TEXT, XML, CSV |
| `output_format` | HTML, TEXT, XML, PDF_PRE_HTML, etc. |
| `locale` | bahasa/region |
| `tenant_id` | tenant/agency/customer |
| `version` | versi immutable |
| `status` | draft/review/approved/published/retired |
| `effective_from` | kapan mulai berlaku |
| `effective_to` | kapan berhenti berlaku |

Contoh key:

```text
case.notice.warning.email.html.en-SG.CEA.v4
```

Namun jangan jadikan string key terlalu kompleks di semua layer. Lebih baik punya object:

```java
public final class TemplateSelector {
    private final String templateKey;
    private final Channel channel;
    private final OutputKind outputKind;
    private final Locale locale;
    private final String tenantId;
    private final Instant renderTime;
}
```

Resolver lalu memilih versi yang benar.

---

## 5. Template Lifecycle

Lifecycle minimal:

```text
DRAFT -> IN_REVIEW -> APPROVED -> PUBLISHED -> RETIRED
```

Untuk enterprise yang lebih ketat:

```text
DRAFT
  -> SUBMITTED_FOR_REVIEW
  -> LEGAL_REVIEW
  -> SECURITY_REVIEW
  -> APPROVED
  -> SCHEDULED
  -> PUBLISHED
  -> SUSPENDED
  -> RETIRED
```

### 5.1 Draft

Template sedang dibuat.

Karakteristik:

- belum bisa dipakai production;
- boleh invalid sementara;
- boleh diedit berkali-kali;
- preview boleh dilakukan dengan sample data;
- tidak boleh dipakai oleh business event real.

### 5.2 Submitted for Review

Template dianggap siap direview.

Sistem harus menjalankan:

- syntax validation;
- forbidden construct scan;
- required variable check;
- sample rendering;
- escaping/security check;
- output preview generation.

### 5.3 Approved

Template sudah disetujui tetapi belum aktif.

Karakteristik:

- immutable;
- tidak boleh diedit langsung;
- jika berubah, buat draft baru;
- bisa diberi effective date.

### 5.4 Scheduled

Template sudah approved dan punya tanggal aktif di masa depan.

Resolver harus memperhitungkan waktu:

```text
select template where effective_from <= render_time
  and (effective_to is null or render_time < effective_to)
```

### 5.5 Published

Template aktif untuk rendering production.

Rule:

- immutable;
- cached;
- auditable;
- observable;
- rollbackable.

### 5.6 Suspended

Template dinonaktifkan karena masalah.

Contoh:

- typo legal fatal;
- variable missing;
- security risk;
- wrong tenant content;
- broken rendering.

Resolver tidak boleh memilih template suspended.

### 5.7 Retired

Template tidak dipakai untuk event baru, tetapi tetap disimpan untuk audit/regeneration.

Rule penting:

> Retired bukan deleted.

Untuk dokumen legal, menghapus versi lama bisa menghancurkan reproducibility.

---

## 6. Immutable Versioning

Salah satu prinsip paling penting:

> Published template versions must be immutable.

Jangan pernah update body template versi yang sudah published.

Buruk:

```sql
UPDATE template_definition
SET body = :newBody
WHERE template_key = 'case.approval.email'
  AND version = 3;
```

Baik:

```text
v3 -> retired / superseded
v4 -> new approved/published version
```

Mengapa immutable penting?

1. Audit bisa menjawab versi mana yang dipakai.
2. Rendering lama bisa direproduksi.
3. Rollback jelas.
4. Cache tidak ambigu.
5. Incident analysis lebih mudah.
6. Legal defensibility lebih kuat.

### 6.1 Version Number Strategy

Untuk template, semantic versioning bisa dipakai tetapi sering terlalu rumit.

Pilihan umum:

#### Sequential integer

```text
version: 1, 2, 3, 4
```

Cocok untuk kebanyakan enterprise template.

#### Semantic version

```text
1.0.0
1.1.0
2.0.0
```

Cocok jika template punya API contract yang kompleks.

#### Timestamp version

```text
2026-06-19T09:00:00Z
```

Cocok untuk append-only event sourcing.

Rekomendasi praktis:

```text
Use sequential integer for human governance.
Use internal immutable ID/UUID for database identity.
Record content hash for integrity.
```

---

## 7. Template Content Hash

Simpan hash dari template content saat publish.

Contoh:

```text
sha256: 6f1c2e...
```

Manfaat:

- mendeteksi perubahan ilegal;
- memastikan cache sesuai versi;
- audit integrity;
- forensic analysis;
- artifact reproducibility.

Contoh Java:

```java
public final class TemplateHashing {
    public static String sha256Hex(String content) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(content.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(bytes.length * 2);
            for (byte b : bytes) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 not available", e);
        }
    }
}
```

Untuk Java 17+, bisa memakai `HexFormat`:

```java
public static String sha256Hex(String content) {
    try {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        return HexFormat.of().formatHex(digest.digest(content.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException e) {
        throw new IllegalStateException("SHA-256 not available", e);
    }
}
```

Karena seri mencakup Java 8–25, jika library harus Java 8-compatible, jangan gunakan `HexFormat` di core module.

---

## 8. Effective Date and Temporal Selection

Banyak template bukan hanya “current version”.

Contoh:

- template notice baru berlaku mulai 1 Juli 2026;
- template lama tetap berlaku untuk kasus yang dibuat sebelum tanggal itu;
- email renewal berbeda setelah perubahan policy;
- tenant melakukan rebranding mulai tanggal tertentu.

Resolver harus menerima waktu eksplisit.

Buruk:

```java
Template template = repository.findLatest(templateKey);
```

Baik:

```java
Template template = repository.resolve(
    templateKey,
    tenantId,
    locale,
    channel,
    outputKind,
    renderTime
);
```

### 8.1 Render Time vs Event Time

Ada perbedaan besar:

```text
Event time  = kapan business event terjadi.
Render time = kapan output dirender.
```

Contoh:

- Case approved tanggal 30 Juni.
- Email baru dirender tanggal 1 Juli karena retry.
- Template baru efektif tanggal 1 Juli.

Pakai template mana?

Tidak ada jawaban universal. Harus ditentukan policy.

Pilihan:

| Policy | Makna |
|---|---|
| Event-time template selection | versi template berdasarkan waktu event |
| Render-time template selection | versi template berdasarkan waktu render |
| Case-open-time selection | versi berdasarkan waktu case dibuat |
| Explicit captured template version | event sudah menyimpan versi template yang harus dipakai |

Untuk dokumen legal/regulatory, biasanya lebih aman:

> Select template version explicitly at business decision time, then persist selected version into rendering request.

Sehingga retry tidak mengubah wording.

### 8.2 Temporal Overlap Rule

Jangan biarkan dua published template aktif untuk selector yang sama dan waktu yang sama.

Invariant:

```text
For one template_key + tenant + locale + channel + output_kind,
there must be at most one active template at any render timestamp.
```

Database constraint tidak selalu mudah untuk interval overlap, tetapi validasi aplikasi wajib ada.

Pseudo-check:

```java
boolean overlaps(Instant aFrom, Instant aTo, Instant bFrom, Instant bTo) {
    Instant maxFrom = aFrom.isAfter(bFrom) ? aFrom : bFrom;
    Instant minTo = minNullable(aTo, bTo);
    return minTo == null || maxFrom.isBefore(minTo);
}
```

---

## 9. Template Selection Hierarchy for Multi-Tenancy

Multi-tenant template biasanya punya fallback.

Contoh hierarchy:

```text
1. tenant + locale exact
2. tenant + default locale
3. global + locale exact
4. global + default locale
```

Contoh:

```text
Resolve: case.approval.email, tenant=CEA, locale=ms-SG

Try:
- CEA / ms-SG
- CEA / en-SG
- GLOBAL / ms-SG
- GLOBAL / en-SG
```

Namun fallback harus eksplisit dan auditable.

Jangan hanya fallback diam-diam tanpa record.

Render audit harus menyimpan:

```text
requested_tenant = CEA
resolved_tenant = GLOBAL
requested_locale = ms-SG
resolved_locale = en-SG
fallback_used = true
fallback_reason = TENANT_LOCALE_NOT_FOUND
```

### 9.1 Fallback Risk

Fallback bisa berbahaya.

Contoh:

- tenant A memakai disclaimer legal berbeda;
- fallback ke global menghilangkan clause wajib;
- locale fallback membuat user menerima bahasa yang salah;
- branding fallback menampilkan logo salah.

Rule praktis:

```text
Allowed fallback should be configured per template type.
```

Contoh:

| Template Type | Fallback Allowed? |
|---|---:|
| Generic notification | yes |
| Legal notice | maybe, with approval |
| Contract document | no |
| Tenant branding block | no |
| Password reset email | yes |

---

## 10. Template Repository Model

Minimal relational schema:

```sql
CREATE TABLE template_definition (
    id                  VARCHAR(64) PRIMARY KEY,
    template_key        VARCHAR(200) NOT NULL,
    tenant_id           VARCHAR(100),
    locale_tag          VARCHAR(20) NOT NULL,
    channel             VARCHAR(30) NOT NULL,
    output_kind         VARCHAR(30) NOT NULL,
    engine              VARCHAR(30) NOT NULL,
    version_no          INTEGER NOT NULL,
    status              VARCHAR(30) NOT NULL,
    content             CLOB NOT NULL,
    content_sha256      VARCHAR(64) NOT NULL,
    effective_from      TIMESTAMP,
    effective_to        TIMESTAMP,
    created_by          VARCHAR(100) NOT NULL,
    created_at          TIMESTAMP NOT NULL,
    submitted_by        VARCHAR(100),
    submitted_at        TIMESTAMP,
    approved_by         VARCHAR(100),
    approved_at         TIMESTAMP,
    published_by        VARCHAR(100),
    published_at        TIMESTAMP,
    retired_by          VARCHAR(100),
    retired_at          TIMESTAMP,
    change_reason       VARCHAR(1000),
    UNIQUE(template_key, tenant_id, locale_tag, channel, output_kind, version_no)
);
```

Untuk PostgreSQL, bisa pakai `TEXT`. Untuk Oracle, `CLOB` masuk akal.

Namun hati-hati: jika template banyak dan sering dibaca, jangan load CLOB terus-menerus tanpa caching.

### 10.1 Metadata Table

Pisahkan catalog dari version jika perlu.

```sql
CREATE TABLE template_catalog (
    template_key        VARCHAR(200) PRIMARY KEY,
    name                VARCHAR(300) NOT NULL,
    description         VARCHAR(1000),
    owner_team          VARCHAR(100),
    business_owner      VARCHAR(100),
    default_channel     VARCHAR(30),
    default_output_kind VARCHAR(30),
    fallback_policy     VARCHAR(50),
    security_policy     VARCHAR(50),
    created_at          TIMESTAMP NOT NULL
);
```

Dan:

```sql
CREATE TABLE template_version (
    id                  VARCHAR(64) PRIMARY KEY,
    template_key        VARCHAR(200) NOT NULL,
    ...
);
```

Pemisahan ini berguna jika satu template punya banyak versi/locale/tenant.

---

## 11. Template Status State Machine

Jangan gunakan status tanpa state transition rule.

Contoh enum:

```java
public enum TemplateStatus {
    DRAFT,
    SUBMITTED,
    APPROVED,
    SCHEDULED,
    PUBLISHED,
    SUSPENDED,
    RETIRED,
    REJECTED
}
```

Transition rule:

```text
DRAFT -> SUBMITTED
SUBMITTED -> APPROVED
SUBMITTED -> REJECTED
REJECTED -> DRAFT
APPROVED -> SCHEDULED
APPROVED -> PUBLISHED
SCHEDULED -> PUBLISHED
PUBLISHED -> SUSPENDED
PUBLISHED -> RETIRED
SUSPENDED -> PUBLISHED
SUSPENDED -> RETIRED
```

Java sketch:

```java
public final class TemplateStateMachine {
    private static final Map<TemplateStatus, Set<TemplateStatus>> ALLOWED = new EnumMap<>(TemplateStatus.class);

    static {
        ALLOWED.put(TemplateStatus.DRAFT, EnumSet.of(TemplateStatus.SUBMITTED));
        ALLOWED.put(TemplateStatus.SUBMITTED, EnumSet.of(TemplateStatus.APPROVED, TemplateStatus.REJECTED));
        ALLOWED.put(TemplateStatus.REJECTED, EnumSet.of(TemplateStatus.DRAFT));
        ALLOWED.put(TemplateStatus.APPROVED, EnumSet.of(TemplateStatus.SCHEDULED, TemplateStatus.PUBLISHED));
        ALLOWED.put(TemplateStatus.SCHEDULED, EnumSet.of(TemplateStatus.PUBLISHED, TemplateStatus.RETIRED));
        ALLOWED.put(TemplateStatus.PUBLISHED, EnumSet.of(TemplateStatus.SUSPENDED, TemplateStatus.RETIRED));
        ALLOWED.put(TemplateStatus.SUSPENDED, EnumSet.of(TemplateStatus.PUBLISHED, TemplateStatus.RETIRED));
        ALLOWED.put(TemplateStatus.RETIRED, EnumSet.noneOf(TemplateStatus.class));
    }

    public void assertCanTransition(TemplateStatus from, TemplateStatus to) {
        if (!ALLOWED.getOrDefault(from, Collections.emptySet()).contains(to)) {
            throw new IllegalStateException("Invalid template transition: " + from + " -> " + to);
        }
    }
}
```

Untuk Java 9+, bisa lebih ringkas memakai `Set.of`, tetapi Java 8 compatibility membutuhkan `EnumSet`/`Collections`.

---

## 12. Approval Workflow

Template approval bukan formalitas. Ia mengurangi risiko production.

Minimal role:

| Role | Tanggung Jawab |
|---|---|
| Author | membuat/mengedit draft |
| Reviewer | review grammar, content, clarity |
| Legal Approver | review clause legal/regulatory |
| Security Reviewer | review expression, raw HTML, variable exposure |
| Publisher | mengaktifkan template |

Untuk sistem kecil, beberapa role bisa digabung. Untuk sistem regulatori, pemisahan role bisa penting.

### 12.1 Four-Eyes Principle

Rule:

```text
Author cannot approve own template.
```

Tambahkan constraint aplikasi:

```java
if (template.getCreatedBy().equals(currentUser.getId())) {
    throw new AuthorizationException("Template author cannot approve own template");
}
```

### 12.2 Approval Evidence

Simpan:

```text
who approved
when approved
what content hash was approved
what validation result was approved
what preview artifact was reviewed
approval comment
```

Jangan hanya simpan `approved = true`.

### 12.3 Approval Should Freeze Content

Setelah approved, content tidak boleh berubah.

Jika reviewer meminta perubahan:

```text
SUBMITTED -> REJECTED -> DRAFT
```

atau:

```text
Create new draft revision.
```

---

## 13. Compatibility Check Before Publish

Sebelum template published, pastikan compatible dengan rendering model.

Compatibility check minimal:

1. Syntax valid.
2. Required variables tersedia.
3. Forbidden directives tidak digunakan.
4. Output format sesuai.
5. Template bisa dirender dengan sample model.
6. Tidak memakai raw output tanpa izin.
7. Tidak memanggil method/class terlarang.
8. Locale bundle tersedia.
9. Fragment/macro dependency tersedia.
10. Output size masuk batas.

### 13.1 Variable Contract

Simpan contract per template key.

Contoh YAML:

```yaml
templateKey: case.approval.email
modelVersion: 3
requiredFields:
  - caseReferenceNo
  - applicantName
  - approvalDateText
  - officerName
optionalFields:
  - remarks
  - appealDeadlineText
forbiddenFields:
  - applicantNric
  - internalRiskScore
```

Model renderer harus memvalidasi sebelum render.

```java
public final class TemplateModelValidator {
    public void validate(TemplateContract contract, Map<String, Object> model) {
        for (String field : contract.getRequiredFields()) {
            if (!model.containsKey(field) || model.get(field) == null) {
                throw new MissingTemplateFieldException(field);
            }
        }
        for (String forbidden : contract.getForbiddenFields()) {
            if (model.containsKey(forbidden)) {
                throw new ForbiddenTemplateFieldException(forbidden);
            }
        }
    }
}
```

### 13.2 Static Variable Extraction Is Hard

FreeMarker dan Thymeleaf expressions bisa dinamis.

Contoh FreeMarker:

```ftl
${user[fieldName]}
```

Contoh Thymeleaf:

```html
<span th:text="${caseData[dynamicField]}"></span>
```

Static analysis bisa membantu, tetapi tidak boleh menjadi satu-satunya guard.

Gunakan kombinasi:

```text
static scan + restricted syntax + sample render + runtime validation + contract tests
```

---

## 14. Template Dependency Graph

Template bisa bergantung pada:

- layout;
- macro library;
- fragment;
- message bundle;
- CSS;
- image asset;
- legal clause;
- data model schema.

Contoh dependency:

```text
case.approval.email.html
  -> layout.email.base.v2
  -> fragment.footer.legal.v5
  -> macro.button.v1
  -> messages.en-SG
  -> brand.CEA.logo.v3
```

Jika `fragment.footer.legal.v5` berubah, template mana terdampak?

Perlu dependency graph.

### 14.1 Explicit Dependency Metadata

Jangan hanya infer dari parsing template.

```yaml
dependencies:
  templates:
    - layout.email.base
    - fragment.footer.legal
  assets:
    - brand.logo
  messageBundles:
    - email-common
```

### 14.2 Dependency Compatibility

Ketika macro library naik versi:

```text
macro.button.v1 -> macro.button.v2
```

Pastikan signature tidak memecahkan template lama.

Contoh breaking change:

```ftl
<#-- v1 -->
<#macro button href label>

<#-- v2 breaking -->
<#macro button url text variant>
```

Lebih aman:

```ftl
<#macro button href label variant="primary">
```

---

## 15. Macro and Fragment Versioning

Macro library adalah API.

Jika template lain memanggil macro, macro punya contract.

Rule:

> Treat macro parameters like public method signatures.

Contoh FreeMarker:

```ftl
<#macro officialNotice title recipientName referenceNo>
  ...
</#macro>
```

Breaking changes:

- rename parameter;
- remove parameter;
- change escaping behavior;
- change required nested content;
- change semantic meaning;
- change output structure yang dipakai downstream PDF engine.

Non-breaking changes:

- tambah optional parameter dengan default;
- fix typo;
- improve markup without changing contract;
- add CSS class if safe.

### 15.1 Versioned Import

Daripada:

```ftl
<#import "/lib/layout.ftlh" as layout>
```

Pertimbangkan:

```ftl
<#import "/lib/v2/layout.ftlh" as layout>
```

Atau resolver logical:

```text
lib.layout@2
```

Untuk dynamic repository, dependency bisa ditentukan sebagai metadata, lalu resolver mengikat versi.

---

## 16. CMS-like Editing: Jangan Memberi Mesin Jet Ke Editor Konten

CMS-like editing sering diminta:

> “Kami ingin user bisa edit email template sendiri.”

Pertanyaan yang harus dijawab:

1. Apakah user boleh menulis FTL/Thymeleaf expression?
2. Apakah user boleh loop?
3. Apakah user boleh conditional?
4. Apakah user boleh include fragment?
5. Apakah user boleh raw HTML?
6. Apakah user boleh upload image?
7. Apakah user boleh akses semua variable?
8. Apakah user boleh preview data production?

Jika jawabannya semua “ya”, maka fitur itu bukan CMS sederhana. Itu adalah **programmable rendering platform**.

### 16.1 Editing Modes

Pisahkan mode.

#### Plain Text Mode

User hanya mengisi teks.

```text
Dear {{applicantName}}, your application has been approved.
```

Engine internal bisa map placeholder ke value.

Aman untuk kebanyakan business user.

#### Rich Text Mode

User memakai editor WYSIWYG.

Risiko:

- unsafe HTML;
- inline style;
- broken email rendering;
- hidden tracking links;
- copied HTML from Word;
- script injection.

Butuh sanitizer.

#### Restricted Template Mode

User boleh pakai placeholder dan simple conditional.

Contoh:

```text
Dear ${applicantName},
<#if remarks?has_content>
Remarks: ${remarks}
</#if>
```

Harus dibatasi.

#### Full Template Mode

Hanya untuk trusted developer/admin.

### 16.2 Placeholder DSL Alternative

Untuk business-owned content, sering lebih aman membuat mini DSL sendiri.

Contoh:

```text
Dear {{applicantName}},

Your application {{caseReferenceNo}} has been approved.
```

Lalu compiler internal mengubah ke FreeMarker/Thymeleaf atau render langsung.

Keuntungan:

- lebih aman;
- mudah divalidasi;
- editor friendly;
- tidak mengekspos Java object;
- tidak memberi akses directive kompleks.

Kekurangan:

- fitur terbatas;
- harus membangun parser/validator;
- conditional/loop perlu desain khusus.

Top 1% decision:

> Jangan otomatis expose FreeMarker/Thymeleaf kepada business user. Pilih level expressiveness sesuai trust dan risiko.

---

## 17. Secure Dynamic Template Platform

Jika template bisa diedit runtime, threat model berubah.

### 17.1 Threats

1. Server-side template injection.
2. XSS dari raw HTML.
3. Data exfiltration melalui variable yang tidak seharusnya terlihat.
4. Resource exhaustion melalui loop/recursion/output besar.
5. Unauthorized template modification.
6. Tenant A melihat/menimpa template Tenant B.
7. Template mengirim link phishing.
8. Template menyisipkan tracking pixel tanpa approval.
9. Preview memakai data production sensitif.
10. Rollback ke versi yang sudah tidak legally valid.

### 17.2 Control Layers

Gunakan defense in depth:

```text
Authorization
  -> Template authoring restrictions
  -> Syntax validation
  -> Forbidden construct scanner
  -> Data model whitelist
  -> Engine sandbox config
  -> Output escaping/sanitization
  -> Resource limits
  -> Approval workflow
  -> Immutable publish
  -> Audit trail
```

### 17.3 FreeMarker Security Controls

FreeMarker memberi mekanisme seperti `TemplateClassResolver` untuk membatasi fitur yang mendapatkan class berdasarkan string. Object wrapper juga menentukan bagaimana Java object terlihat oleh FTL.

Prinsip aman:

- jangan expose service/repository;
- jangan expose arbitrary Java object;
- jangan expose classloader/runtime;
- jangan aktifkan API access sembarangan;
- gunakan data model Map/DTO yang sudah dipersempit;
- gunakan output format `.ftlh`/`.ftlx` untuk auto-escaping;
- scan forbidden built-ins jika template untrusted.

### 17.4 Thymeleaf Security Controls

Untuk Thymeleaf dynamic templates, hati-hati dengan:

- expression injection;
- `th:utext`;
- inline JavaScript;
- SpringEL access;
- expression utility exposure;
- template resolver yang membaca dari DB/string.

Untuk business-owned content, lebih aman menggunakan Thymeleaf sebagai engine internal dengan template yang developer-owned, sedangkan business content menjadi escaped variable atau sanitized HTML block.

---

## 18. Authorization Model

Template governance butuh permission granular.

Contoh permissions:

```text
TEMPLATE_VIEW
TEMPLATE_CREATE_DRAFT
TEMPLATE_EDIT_DRAFT
TEMPLATE_SUBMIT_REVIEW
TEMPLATE_REVIEW
TEMPLATE_APPROVE
TEMPLATE_PUBLISH
TEMPLATE_SUSPEND
TEMPLATE_RETIRE
TEMPLATE_ROLLBACK
TEMPLATE_PREVIEW
TEMPLATE_VIEW_AUDIT
```

Tambahkan scope:

```text
tenant scope
channel scope
template key scope
locale scope
environment scope
```

Contoh:

```text
User A can edit EMAIL templates for tenant CEA only.
User B can approve LEGAL_NOTICE templates globally.
User C can preview but not publish.
```

### 18.1 Tenant Isolation

Jangan hanya filter di UI.

Repository query harus enforce tenant scope.

Buruk:

```java
Template t = repository.findById(id);
if (user.canAccess(t.getTenantId())) { ... }
```

Lebih baik:

```java
Template t = repository.findByIdAndTenantScope(id, user.allowedTenants());
```

Untuk database level, bisa tambah row-level security di DB tertentu, tetapi aplikasi tetap harus enforce.

---

## 19. Preview System

Preview adalah fitur wajib untuk dynamic template.

Preview harus bisa menjawab:

- output terlihat seperti apa?
- variable apa yang missing?
- locale mana dipakai?
- tenant branding mana dipakai?
- dependency versi mana dipakai?
- apakah HTML aman?
- apakah PDF page break benar?
- apakah email plain text alternative tersedia?

### 19.1 Sample Data

Jangan preview langsung dengan data production tanpa kontrol.

Gunakan sample data set:

```text
NORMAL_CASE
LONG_NAME_CASE
MISSING_OPTIONAL_FIELDS
MULTI_ITEM_CASE
UNICODE_CASE
RIGHT_TO_LEFT_CASE
LARGE_TABLE_CASE
```

Setiap sample data harus punya classification.

```text
contains_pii: false
contains_sensitive: false
source: synthetic
```

### 19.2 Preview Artifact

Simpan preview artifact yang direview saat approval.

Contoh:

```text
preview_id
preview_generated_at
sample_data_id
template_content_hash
rendered_html_hash
rendered_pdf_hash
reviewer_id
```

Ini penting untuk audit: reviewer menyetujui apa yang dilihat, bukan hanya template raw.

### 19.3 Preview Watermark

Untuk PDF/email preview, tambahkan watermark:

```text
PREVIEW ONLY - NOT FOR OFFICIAL USE
```

Dan pastikan preview email tidak terkirim ke real recipient tanpa test mode.

---

## 20. Publishing Pipeline

Template publishing sebaiknya seperti release pipeline.

Pipeline:

```text
Draft Save
  -> Syntax Validate
  -> Static Policy Scan
  -> Contract Validate
  -> Render Sample Matrix
  -> Security Scan
  -> Review
  -> Approve
  -> Schedule/Publish
  -> Cache Invalidate
  -> Audit Event
  -> Smoke Render
```

### 20.1 Validation Stages

#### Syntax Validate

FreeMarker:

```java
Configuration cfg = ...;
new Template("candidate", templateText, cfg);
```

Thymeleaf:

- parse via engine with test context;
- catch template processing exceptions;
- use resolver configured for candidate template.

#### Policy Scan

Examples:

```text
Disallow FreeMarker ?api
Disallow ?eval
Disallow ?interpret for business templates
Disallow #assign global
Disallow th:utext unless approved
Disallow inline JavaScript for business templates
Disallow external image URL unless allowlisted
```

#### Contract Validate

Check required model fields.

#### Sample Render

Render with matrix:

```text
tenant x locale x sampleData x outputFormat
```

#### Security Review

Check:

- raw HTML;
- URL domains;
- hidden fields;
- sensitive variables;
- tenant branding;
- external assets.

---

## 21. Rollback Strategy

Rollback is not always “go back to previous version”.

Possible rollback types:

### 21.1 Immediate Template Rollback

Make previous version active again.

```text
v5 published -> issue found -> v4 republished
```

But do not mutate v4. Create a new publication event:

```text
publication_id: p102
resolved_version: v4
reason: rollback from v5 due to broken rendering
```

### 21.2 Suspend Bad Version

If no safe previous version exists:

```text
v5 -> SUSPENDED
resolver blocks rendering
fallback policy decides next step
```

### 21.3 Hotfix Version

Create v6 from v5 with fix.

```text
v5 bad -> v6 hotfix -> publish
```

### 21.4 Rollback Restrictions

Do not allow rollback to version that:

- is legally expired;
- has known security vulnerability;
- belongs to wrong tenant;
- incompatible with current data model;
- depends on retired macro unavailable at runtime.

Rollback must run compatibility checks too.

---

## 22. Cache Invalidation

Dynamic templates need caching, but caching introduces invalidation risk.

### 22.1 Cache Key

Cache key must include enough identity.

Bad:

```text
cacheKey = templateKey
```

Good:

```text
cacheKey = templateId + version + contentSha256 + engine + outputKind
```

For resolved template:

```text
resolvedKey = templateKey + tenant + locale + channel + outputKind + renderTimeBucket
```

But be careful with renderTime in key because exact timestamp creates unbounded cache.

Better:

- cache published immutable template by version/content hash;
- resolver result cache with TTL;
- invalidate resolver cache on publish/suspend/retire.

### 22.2 Invalidation Events

When template published:

```text
TemplatePublishedEvent(templateKey, tenantId, locale, channel, outputKind, version)
```

Consumers:

- local app cache;
- distributed cache;
- preview service;
- rendering workers;
- admin UI.

### 22.3 Immutable Content Cache

If published templates are immutable, parsed template cache becomes easier:

```text
id + contentSha256 -> parsed template
```

No need to worry that same version body changed.

---

## 23. Audit Trail

Template audit must answer at least:

1. Who created the template?
2. Who edited it?
3. What changed?
4. Who submitted it?
5. Who approved it?
6. Who published it?
7. When did it become effective?
8. Which template version was selected for rendering?
9. Which data model version was used?
10. Which output artifact was generated?
11. Was fallback used?
12. Was there any render error?

### 23.1 Audit Events

Events:

```text
TEMPLATE_DRAFT_CREATED
TEMPLATE_DRAFT_UPDATED
TEMPLATE_SUBMITTED
TEMPLATE_REJECTED
TEMPLATE_APPROVED
TEMPLATE_SCHEDULED
TEMPLATE_PUBLISHED
TEMPLATE_SUSPENDED
TEMPLATE_RETIRED
TEMPLATE_ROLLBACK_EXECUTED
TEMPLATE_RENDERED
TEMPLATE_RENDER_FAILED
```

Event payload should include:

```json
{
  "templateKey": "case.approval.email",
  "templateVersion": 4,
  "templateId": "tplv_123",
  "contentSha256": "...",
  "tenantId": "CEA",
  "locale": "en-SG",
  "actor": "user123",
  "timestamp": "2026-06-19T03:30:00Z",
  "reason": "Updated appeal deadline wording"
}
```

### 23.2 Render Audit

For every official rendering:

```text
render_id
business_event_id
case_id
template_key
resolved_template_id
resolved_version
content_sha256
model_version
model_hash / snapshot_id
locale
timezone
tenant_id
output_format
rendered_artifact_id
rendered_artifact_hash
rendered_at
renderer_version
engine_version
```

This makes document generation defensible.

---

## 24. Reproducibility

Reproducibility means:

> Given the same template version, model snapshot, locale, timezone, renderer version, and assets, the system can reproduce the same output or explain why it cannot.

For legal documents, reproducibility is more important than latest template correctness.

Store:

- template content hash;
- selected template version;
- model snapshot or source data version;
- message bundle version;
- asset version;
- CSS version;
- PDF engine version;
- timezone;
- locale;
- clock timestamp;
- renderer app version.

### 24.1 Model Snapshot vs Re-query

Bad for legal regeneration:

```text
Regenerate document by querying current database state.
```

Because data may have changed.

Better:

```text
Store render model snapshot or immutable business snapshot.
```

If snapshot contains PII, secure it properly.

---

## 25. Environment Strategy

Template lifecycle across environments:

```text
DEV -> SIT -> UAT -> PROD
```

Questions:

1. Are templates promoted like code?
2. Can PROD template be edited directly?
3. Is UAT using production-like template content?
4. Are template IDs stable across environments?
5. How to migrate template versions?
6. How to prevent test template from going to PROD?

### 25.1 Promotion Model

Safer enterprise approach:

```text
Author/edit in lower env
Export template package
Review package
Import to PROD as immutable version
Publish in PROD
```

Template package:

```json
{
  "templateKey": "case.approval.email",
  "version": 4,
  "locale": "en-SG",
  "tenantId": "CEA",
  "engine": "FREEMARKER",
  "outputKind": "HTML_EMAIL",
  "content": "...",
  "contentSha256": "...",
  "dependencies": [...],
  "contractVersion": 3
}
```

### 25.2 Direct Production Editing

Sometimes business demands direct PROD editing.

If allowed, require:

- strong RBAC;
- approval workflow;
- preview;
- audit;
- no direct publish without validation;
- immutable versioning;
- emergency rollback;
- notification to support team.

---

## 26. Migration Strategy for Existing Templates

If system already has unversioned templates, migrate gradually.

### 26.1 Inventory

Collect:

```text
template path/key
engine
owner
channel
output format
locale
tenant dependency
variables used
fragments/macros used
current usage count
last modified
risk classification
```

### 26.2 Assign Logical Keys

Map paths to keys:

```text
/templates/email/approval.ftlh -> case.approval.email
/templates/document/warning.ftlh -> case.warning.notice.pdf
```

### 26.3 Create Initial Version

Current production content becomes `v1`.

```text
status = PUBLISHED
version = 1
contentSha256 = hash(current content)
```

### 26.4 Backfill Render Audit

For future renders, store version. Old historical renders may not have version. Mark them:

```text
legacy_template_version_unknown = true
```

Do not pretend historical accuracy you do not have.

---

## 27. Data Model Versioning

Template versioning is incomplete without model versioning.

Example:

Template v5 expects:

```text
caseReferenceNo
applicantDisplayName
approvalDateText
```

But renderer v2 provides:

```text
caseRefNo
applicantName
approvedDate
```

Published template can still fail.

### 27.1 Model Contract Version

Define:

```text
template_key: case.approval.email
model_contract_version: 3
```

Renderer supports:

```text
case.approval.email model v1, v2, v3
```

### 27.2 Compatibility Matrix

```text
Template v1 -> Model v1
Template v2 -> Model v1
Template v3 -> Model v2
Template v4 -> Model v3
```

When publishing new template, check:

```text
Is required model contract deployed in target environment?
```

This prevents template published ahead of application code.

### 27.3 Backward-Compatible Model Evolution

Safe changes:

- add optional field;
- add derived display field;
- keep old field alias temporarily.

Breaking changes:

- rename field;
- remove field;
- change type;
- change locale formatting responsibility;
- change null policy.

---

## 28. Tenant Override Strategy

Multi-tenant templates need clear override semantics.

### 28.1 Full Template Override

Tenant gets entire template copy.

Pros:

- maximum flexibility;
- simple resolver.

Cons:

- duplication;
- hard to apply global fixes;
- tenant templates drift;
- difficult audit.

### 28.2 Block Override

Global layout/template stays, tenant overrides blocks.

Example:

```text
global template:
- header block
- body block
- legal footer block

tenant CEA overrides:
- header block
- legal footer block
```

Pros:

- less duplication;
- global fixes easier;
- controlled customization.

Cons:

- more complex composition;
- dependency graph needed.

### 28.3 Variable-Based Branding

Template global, tenant branding via data model:

```ftl
<img src="${brand.logoUrl}" alt="${brand.name}">
```

Pros:

- simplest;
- good for logo/name/colors.

Cons:

- not enough for legal wording variation.

### 28.4 Recommended Pattern

```text
Global developer-owned layout
+ tenant-specific branding variables
+ optional tenant-owned content blocks
+ strict legal template override only when required
```

---

## 29. Template Editor UX for Governance

Good backend governance fails if editor UX encourages mistakes.

Template editor should show:

- template key;
- tenant;
- locale;
- output type;
- current status;
- version;
- required variables;
- available variables;
- forbidden variables;
- syntax errors;
- preview panel;
- validation result;
- approval history;
- dependency list;
- effective date;
- diff from previous version.

### 29.1 Diff View

Diff should show:

```text
Previous published version vs current draft
```

For HTML templates, raw diff can be noisy. Provide:

- raw source diff;
- rendered preview diff;
- text-only diff for email;
- PDF visual diff if needed.

### 29.2 Variable Picker

Instead of asking users to type `${applicantName}`, provide variable picker.

Example:

```text
Applicant
- applicantDisplayName
- applicantMaskedId
- applicantEmail

Case
- caseReferenceNo
- submissionDateText
- decisionDateText
```

Do not show forbidden/internal fields.

### 29.3 Validation Feedback

Bad:

```text
Template error.
```

Good:

```text
Line 14, column 22: variable `appealDeadline` is not available.
Available alternatives: `appealDeadlineText`, `appealDeadlineDate`.
```

---

## 30. Template Policy as Code

Governance should not live only in human checklist.

Represent policy in code/config.

Example:

```yaml
policies:
  LEGAL_NOTICE:
    allowRawHtml: false
    allowExternalImages: false
    requireLegalApproval: true
    requireSecurityReview: true
    allowFallback: false
    maxOutputBytes: 1048576
    forbiddenFreeMarkerBuiltins:
      - api
      - eval
      - interpret
    requiredSampleData:
      - NORMAL_CASE
      - LONG_NAME_CASE
      - UNICODE_CASE
  MARKETING_EMAIL:
    allowRawHtml: true
    allowExternalImages: true
    requireLegalApproval: false
    requireSecurityReview: true
    allowFallback: true
```

Then enforce:

```java
public final class TemplatePolicyEnforcer {
    public void validate(TemplateCandidate candidate, TemplatePolicy policy) {
        if (!policy.isAllowRawHtml() && candidate.containsRawHtmlMarker()) {
            throw new PolicyViolationException("Raw HTML is not allowed for this template type");
        }
        for (String builtin : policy.getForbiddenFreeMarkerBuiltins()) {
            if (candidate.usesBuiltin(builtin)) {
                throw new PolicyViolationException("Forbidden FreeMarker built-in: " + builtin);
            }
        }
    }
}
```

Static scanning must be conservative. It should not be the only defense.

---

## 31. Template Resolver Design

A production resolver should be explicit.

```java
public interface TemplateResolverService {
    ResolvedTemplate resolve(TemplateResolveRequest request);
}

public final class TemplateResolveRequest {
    private final String templateKey;
    private final String tenantId;
    private final Locale locale;
    private final Channel channel;
    private final OutputKind outputKind;
    private final Instant selectionTime;
    private final boolean allowFallback;
}

public final class ResolvedTemplate {
    private final String templateId;
    private final String templateKey;
    private final int version;
    private final String tenantId;
    private final Locale locale;
    private final TemplateEngineKind engine;
    private final OutputKind outputKind;
    private final String content;
    private final String contentSha256;
    private final boolean fallbackUsed;
    private final List<String> resolutionTrace;
}
```

Resolution trace example:

```text
try tenant=CEA locale=ms-SG -> not found
try tenant=CEA locale=en-SG -> not found
try tenant=GLOBAL locale=ms-SG -> not found
try tenant=GLOBAL locale=en-SG -> found v4
```

This trace is useful for debugging and audit.

---

## 32. Rendering Request Should Capture Resolved Template

Bad:

```java
renderer.render("case.approval.email", model);
```

Better:

```java
ResolvedTemplate template = resolver.resolve(request);
RenderResult result = renderer.render(template, model, renderContext);
```

Best for async systems:

```text
When business event occurs:
- resolve template version
- persist rendering job with resolved template_id/version
- later worker renders exactly that version
```

This avoids retry selecting a different template.

---

## 33. Rendering Job Model

For async rendering:

```sql
CREATE TABLE render_job (
    id                  VARCHAR(64) PRIMARY KEY,
    business_event_id   VARCHAR(100) NOT NULL,
    template_id         VARCHAR(64) NOT NULL,
    template_key        VARCHAR(200) NOT NULL,
    template_version    INTEGER NOT NULL,
    model_snapshot_id   VARCHAR(64) NOT NULL,
    locale_tag          VARCHAR(20) NOT NULL,
    timezone_id         VARCHAR(50) NOT NULL,
    tenant_id           VARCHAR(100),
    output_kind         VARCHAR(30) NOT NULL,
    status              VARCHAR(30) NOT NULL,
    attempt_count       INTEGER NOT NULL,
    created_at          TIMESTAMP NOT NULL,
    rendered_at         TIMESTAMP,
    artifact_id         VARCHAR(64),
    error_code          VARCHAR(100),
    error_message       VARCHAR(1000)
);
```

Important invariant:

```text
render_job.template_id must not be re-resolved on retry.
```

Retry should render same selected template unless human explicitly creates a new job.

---

## 34. Handling Template Dependencies at Runtime

If dynamic template imports other template:

FreeMarker example:

```ftl
<#import "/lib/email-layout.ftlh" as layout>
```

Question:

- Which version of `email-layout.ftlh`?
- Global or tenant-specific?
- Is it immutable?
- Does cache key include it?

Options:

### 34.1 Freeze Dependency Version at Publish

When publishing template v4, resolve dependencies and record versions.

```text
case.approval.email.v4
  uses layout.email.base.v2
  uses footer.legal.v7
```

At render time, use those exact versions.

Best for reproducibility.

### 34.2 Resolve Dependencies Dynamically

At render time, imports get latest active dependency.

Easier, but dangerous:

- old templates change behavior;
- audit harder;
- rendered output can drift.

Recommendation:

> Freeze dependencies for official/legal outputs. Dynamic dependency resolution may be acceptable for non-critical web UI fragments.

---

## 35. Dynamic Template Loading in FreeMarker

FreeMarker `TemplateLoader` loads raw template text based on abstract template paths. For DB-backed templates, implement custom loader or use string-based construction carefully.

Conceptual design:

```java
public final class VersionedTemplateLoader implements TemplateLoader {
    private final TemplateContentRepository repository;

    @Override
    public Object findTemplateSource(String name) throws IOException {
        TemplateContent content = repository.findByResolvedName(name);
        if (content == null) {
            return null;
        }
        return content;
    }

    @Override
    public long getLastModified(Object templateSource) {
        TemplateContent content = (TemplateContent) templateSource;
        return content.getPublishedAt().toEpochMilli();
    }

    @Override
    public Reader getReader(Object templateSource, String encoding) {
        TemplateContent content = (TemplateContent) templateSource;
        return new StringReader(content.getBody());
    }

    @Override
    public void closeTemplateSource(Object templateSource) {
        // no-op
    }
}
```

However, production version needs:

- cache key handling;
- tenant/version resolution;
- dependency freezing;
- exception mapping;
- metric instrumentation;
- protection from path traversal semantics;
- immutable content source.

Do not let arbitrary user input become template path.

---

## 36. Dynamic Template Loading in Thymeleaf

Thymeleaf template resolver determines how template names resolve to resources. For DB/string-backed templates, you can use custom resolver or string resolver patterns.

But warning:

> If template content is loaded from user-editable storage, the template is now executable template code, not ordinary content.

For business-owned Thymeleaf content, prefer:

- developer-owned Thymeleaf shell;
- business content as escaped variable;
- sanitized rich text if absolutely needed;
- no arbitrary `th:*` authored by business users.

---

## 37. Governance for Raw HTML

Raw HTML is common in email/document templates.

But raw HTML is dangerous.

Classify raw HTML sources:

| Source | Risk |
|---|---|
| developer-owned template | lower |
| approved legal snippet | medium |
| admin WYSIWYG content | high |
| external user input | very high |

Rules:

1. Never render external user HTML raw without sanitization.
2. Do not allow `<script>`.
3. For email, disallow most active content anyway.
4. Allowlist tags and attributes.
5. Block external domains unless allowlisted.
6. Rewrite links if needed.
7. Audit raw HTML usage.

Template policy should record:

```text
raw_html_allowed = true/false
sanitizer_profile = EMAIL_SAFE / DOCUMENT_SAFE / NONE_DEVELOPER_ONLY
```

---

## 38. Multi-Locale Governance

Localization is not only message bundle.

A template might have:

```text
case.approval.email.en-SG.v4
case.approval.email.zh-SG.v3
case.approval.email.ms-SG.v2
case.approval.email.ta-SG.v1
```

Question:

- Must all locales be updated before publishing?
- Can en-SG v4 go live while ms-SG remains v2?
- Is fallback allowed?
- Who approves translations?

### 38.1 Locale Release Group

Use release group:

```text
template_release_group_id = case.approval.email.release-2026-07
```

Contains:

```text
en-SG v4
zh-SG v4
ms-SG v4
ta-SG v4
```

Publish group atomically if policy requires all locales together.

### 38.2 Translation Drift

Translation drift happens when one locale is updated but another is not.

Mitigation:

- translation status per locale;
- diff from source language;
- approval per locale;
- release group;
- fallback policy.

---

## 39. Operational Observability

Template platform needs metrics.

Metrics:

```text
template_resolve_count
template_resolve_latency
template_resolve_fallback_count
template_render_count
template_render_latency
template_render_failure_count
template_cache_hit_ratio
template_publish_count
template_rollback_count
template_validation_failure_count
template_missing_variable_count
```

Dimensions:

```text
template_key
tenant_id
locale
channel
output_kind
engine
version
status
```

But beware cardinality explosion. Do not put raw template ID in high-cardinality metrics unless backend supports it.

Use logs/traces for detailed IDs.

### 39.1 Alerts

Alerts:

- render failure rate > threshold;
- missing variable spike;
- fallback spike;
- publish failed;
- cache miss storm;
- render latency p95 regression;
- output size too large;
- suspended template still selected;
- no active template for key.

---

## 40. Failure Model

Template platform failures should be classified.

| Failure | Example | Response |
|---|---|---|
| Not found | no template for key/tenant/locale | fallback or fail |
| Ambiguous active | two active templates overlap | fail hard |
| Invalid syntax | template cannot parse | block publish |
| Missing variable | model incomplete | fail render, alert |
| Forbidden construct | uses `?api` | block publish |
| Dependency missing | macro not found | block publish/render fail |
| Render timeout | huge loop/output | abort |
| Output unsafe | sanitizer violation | block |
| Approval missing | direct publish attempt | reject transition |
| Tenant violation | user edits wrong tenant | deny |

Top 1% invariant:

> Ambiguity in template selection must fail closed, not pick randomly.

---

## 41. Example Architecture

Text diagram:

```text
[Admin UI]
   |
   v
[Template Management API]
   |-- RBAC / Tenant Scope
   |-- Draft Editing
   |-- Validation Pipeline
   |-- Preview Renderer
   |-- Approval Workflow
   |-- Publish Scheduler
   |
   v
[Template Repository]
   |-- Catalog
   |-- Versioned Content
   |-- Dependency Metadata
   |-- Approval Records
   |-- Audit Events

[Business Service]
   |
   v
[Template Resolver]
   |-- Tenant/Locale/Time Selection
   |-- Fallback Policy
   |-- Active Version Check
   |
   v
[Rendering Service]
   |-- FreeMarker Adapter
   |-- Thymeleaf Adapter
   |-- Model Validation
   |-- Escaping/Sanitization
   |-- Observability
   |
   v
[Artifact Store / Email Sender / HTTP Response]
```

---

## 42. Example Java Interfaces

### 42.1 Template Repository

```java
public interface TemplateRepository {
    TemplateVersion saveDraft(NewTemplateDraft draft);

    Optional<TemplateVersion> findVersion(String templateId);

    List<TemplateVersion> findCandidates(TemplateCandidateQuery query);

    void updateStatus(String templateId, TemplateStatus newStatus, AuditActor actor, String reason);

    void appendAuditEvent(TemplateAuditEvent event);
}
```

### 42.2 Template Resolver

```java
public interface VersionedTemplateResolver {
    ResolvedTemplate resolve(TemplateResolveRequest request);
}
```

### 42.3 Template Validator

```java
public interface TemplateValidationService {
    TemplateValidationReport validate(TemplateValidationRequest request);
}
```

### 42.4 Renderer

```java
public interface ManagedTemplateRenderer {
    RenderResult render(ResolvedTemplate template, Map<String, Object> model, RenderContext context);
}
```

### 42.5 Audit

```java
public interface TemplateAuditService {
    void recordLifecycleEvent(TemplateLifecycleEvent event);

    void recordRenderEvent(TemplateRenderAuditEvent event);
}
```

---

## 43. Example Resolve Algorithm

```java
public ResolvedTemplate resolve(TemplateResolveRequest request) {
    List<ResolutionAttempt> attempts = buildAttempts(request);
    List<String> trace = new ArrayList<>();

    for (ResolutionAttempt attempt : attempts) {
        List<TemplateVersion> candidates = repository.findActiveCandidates(
            attempt.templateKey,
            attempt.tenantId,
            attempt.locale,
            request.getChannel(),
            request.getOutputKind(),
            request.getSelectionTime()
        );

        trace.add(attempt.describe() + " -> " + candidates.size() + " candidate(s)");

        if (candidates.size() > 1) {
            throw new AmbiguousTemplateResolutionException(request, candidates, trace);
        }

        if (candidates.size() == 1) {
            TemplateVersion v = candidates.get(0);
            return ResolvedTemplate.from(v, attempt.isFallback(), trace);
        }
    }

    throw new TemplateNotFoundException(request, trace);
}
```

Invariant:

```text
0 candidate -> continue fallback or fail
1 candidate -> success
>1 candidate -> fail hard
```

---

## 44. Example Publish Validation Flow

```java
public PublishResult publish(String templateId, Actor actor) {
    TemplateVersion candidate = repository.getForUpdate(templateId);

    stateMachine.assertCanTransition(candidate.getStatus(), TemplateStatus.PUBLISHED);
    authorization.assertCanPublish(actor, candidate);

    TemplateValidationReport report = validator.validate(
        TemplateValidationRequest.forPublish(candidate)
    );

    if (!report.isSuccess()) {
        throw new TemplateValidationException(report);
    }

    overlapChecker.assertNoActiveOverlap(candidate);
    dependencyChecker.assertDependenciesResolvable(candidate);
    approvalChecker.assertApproved(candidate);

    repository.markPublished(candidate.getId(), actor, Instant.now());
    audit.recordLifecycleEvent(TemplatePublishedEvent.from(candidate, actor));
    cacheInvalidator.invalidate(candidate.selectorKey());

    return PublishResult.success(candidate.getId(), candidate.getVersionNo());
}
```

---

## 45. Anti-Patterns

### 45.1 Updating Published Template In Place

Symptom:

```text
Nobody knows which content generated old email.
```

Fix:

```text
Immutable versions only.
```

### 45.2 Latest Template Resolution Everywhere

Symptom:

```text
Retry uses new wording unexpectedly.
```

Fix:

```text
Resolve once at business event time and persist version.
```

### 45.3 Exposing Domain Entity Directly

Symptom:

```ftl
${case.internalRiskScore}
${case.applicant.nric}
```

Fix:

```text
Use rendering DTO/ViewModel with explicit allowlist.
```

### 45.4 Business Users Editing Full FreeMarker/Thymeleaf

Symptom:

```text
Template editor becomes hidden programming environment.
```

Fix:

```text
Use restricted placeholder DSL or heavily sandboxed template mode.
```

### 45.5 Silent Fallback

Symptom:

```text
Wrong tenant/legal wording rendered without anyone noticing.
```

Fix:

```text
Fallback policy + audit + metrics + alert.
```

### 45.6 No Dependency Version Freeze

Symptom:

```text
Old template output changes after shared footer update.
```

Fix:

```text
Freeze dependency versions for official output.
```

### 45.7 No Preview Sample Matrix

Symptom:

```text
Template works only for happy path; breaks for long name, missing optional field, Unicode.
```

Fix:

```text
Render sample matrix before approval.
```

### 45.8 No Output Artifact Hash

Symptom:

```text
Cannot prove document was unchanged.
```

Fix:

```text
Store rendered artifact hash.
```

---

## 46. Java 8–25 Considerations

### 46.1 Java 8 Baseline

If supporting Java 8:

- no records;
- no `var`;
- no `List.of`;
- no `Map.of`;
- no `HexFormat`;
- no sealed classes;
- no pattern matching;
- no virtual threads.

Use:

- final classes;
- builders;
- enums;
- `Collections.unmodifiableList`;
- explicit DTOs;
- `MessageDigest` with manual hex.

### 46.2 Java 11–17

Improvements:

- better runtime performance;
- `HttpClient` if template platform calls external services;
- compact strings already since Java 9;
- records in Java 16+ for immutable data carriers;
- `HexFormat` in Java 17.

Example record if Java 17+:

```java
public record TemplateIdentity(
    String templateKey,
    String tenantId,
    Locale locale,
    Channel channel,
    OutputKind outputKind,
    int version
) {}
```

### 46.3 Java 21–25

Useful for large rendering platforms:

- virtual threads for blocking I/O-heavy rendering orchestration;
- structured concurrency if available/appropriate in target Java version;
- improved GC options;
- better JFR/profiling.

Caution:

> Virtual threads do not make CPU-heavy template rendering faster. They help when many tasks block on I/O, DB, object storage, or email/document services.

---

## 47. Production Checklist

Before enabling dynamic/multi-tenant template production, check:

### Identity and Versioning

- [ ] Template has stable logical key.
- [ ] Published version is immutable.
- [ ] Content hash is stored.
- [ ] Effective date is explicit.
- [ ] No overlapping active templates.

### Governance

- [ ] Draft/review/approve/publish lifecycle exists.
- [ ] Author cannot self-approve if required.
- [ ] Approval records content hash.
- [ ] Change reason is mandatory.
- [ ] Rollback is supported.

### Security

- [ ] Data model is allowlisted.
- [ ] Domain entity is not exposed directly.
- [ ] Dangerous FreeMarker/Thymeleaf constructs are restricted for business templates.
- [ ] Raw HTML policy exists.
- [ ] Sanitization is applied where needed.
- [ ] Tenant scope is enforced in backend.

### Compatibility

- [ ] Required variables are validated.
- [ ] Model contract version is known.
- [ ] Dependencies are resolved and versioned.
- [ ] Sample render matrix passes.
- [ ] Locale fallback policy is explicit.

### Operations

- [ ] Cache key includes version/hash.
- [ ] Publish invalidates resolver cache.
- [ ] Render audit records selected version.
- [ ] Metrics exist.
- [ ] Alerts exist.
- [ ] Preview is available.

### Reproducibility

- [ ] Model snapshot or data version is stored for official outputs.
- [ ] Artifact hash is stored.
- [ ] Renderer version is recorded.
- [ ] Asset/message bundle version is recorded.

---

## 48. Mental Model Summary

Template governance exists because template output often becomes official communication.

For simple web pages, file-based templates in Git are usually enough.

For enterprise notification, correspondence, legal document, and multi-tenant rendering, template must be treated as governed production artifact.

The top-level principles:

1. Published template versions are immutable.
2. Template selection must be deterministic.
3. Effective date and tenant/locale fallback must be explicit.
4. Template data model is a contract.
5. Business-owned content should not automatically mean business-owned executable template code.
6. Approval must approve a specific content hash and preview result.
7. Rollback must be validated, not improvised.
8. Rendering audit must record selected template version and model snapshot.
9. Dependency versions must be frozen for official output.
10. Security boundary must assume dynamic templates are executable input.

In short:

> A mature template platform is closer to release management than to string formatting.

---

## 49. What Comes Next

Part 24 akan masuk ke threat model yang lebih dalam:

```text
Part 24 — Template Security Beyond XSS: SSTI, Sandbox, Data Leakage, and Abuse Cases
```

Kita akan membahas:

- Server-Side Template Injection;
- trusted vs untrusted templates;
- trusted vs untrusted data;
- FreeMarker attack surface;
- Thymeleaf expression injection;
- dangerous object exposure;
- resource exhaustion;
- data exfiltration;
- secure dynamic template platform;
- security testing checklist.

---

## 50. Status Series

```text
Part 23 selesai.
Seri belum selesai.
Berikutnya: Part 24 — Template Security Beyond XSS: SSTI, Sandbox, Data Leakage, and Abuse Cases.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-022.md">⬅️ Part 22 — Template Data Model Design: DTO, ViewModel, Presenter, and Contract Stability</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-024.md">Part 24 — Template Security Beyond XSS: SSTI, Sandbox, Data Leakage, and Abuse Cases ➡️</a>
</div>
