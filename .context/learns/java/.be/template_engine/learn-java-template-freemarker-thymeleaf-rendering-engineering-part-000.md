# learn-java-template-freemarker-thymeleaf-rendering-engineering-part-000

# Part 0 — Orientation: Mental Model Template Engineering

> Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`  
> Scope Java: Java 8 sampai Java 25  
> Fokus: Java template engineering, FreeMarker, Thymeleaf, server-side rendering, email/document generation, template security, performance, extensibility, dan production architecture.

---

## 0.1 Kenapa Part 0 Penting?

Sebelum masuk ke syntax FreeMarker seperti `${name}`, `<#list>`, `?html`, atau Thymeleaf seperti `th:text`, `th:each`, `@{...}`, kita perlu membangun mental model yang benar.

Banyak engineer melihat template engine hanya sebagai:

```text
HTML + variable = dynamic page
```

Itu benar, tetapi terlalu dangkal.

Untuk level production dan top-tier engineering, template engine harus dipahami sebagai:

```text
A deterministic rendering subsystem that transforms a validated presentation model
into a target output format under explicit rules for escaping, formatting,
localization, versioning, performance, security, observability, and auditability.
```

Dalam bahasa sederhana:

```text
Template engine adalah mesin transformasi.
Input-nya bukan sekadar data.
Output-nya bukan sekadar string.
Prosesnya bukan sekadar replace placeholder.
```

Ia berada di batas penting antara:

1. domain model,
2. presentation model,
3. user-visible output,
4. security boundary,
5. audit/legal artifact,
6. operational runtime.

Itulah kenapa template engineering bisa menjadi bagian penting dari sistem enterprise: email, surat resmi, PDF, notifikasi, page server-side rendered, export XML/CSV, config generation, source generation, dan correspondence workflow.

---

## 0.2 Baseline Definisi: Apa Itu Template Engine?

Template engine adalah library/runtime yang menerima:

```text
template + data model + render context -> output
```

Contoh paling sederhana:

```text
Template:
Hello ${user.name}, your application ${application.referenceNo} has been approved.

Data model:
{
  user: { name: "Fajar" },
  application: { referenceNo: "APP-2026-0001" }
}

Output:
Hello Fajar, your application APP-2026-0001 has been approved.
```

Tetapi pada sistem nyata, input-nya jauh lebih kompleks:

```text
Template identifier     : correspondence.approval.notice
Template version        : 3.4.2
Locale                  : en-SG
Timezone                : Asia/Singapore
Output format           : HTML email + plain text fallback + PDF attachment
Tenant/agency           : CEA
Recipient role          : applicant
Security classification : restricted
Rendering timestamp     : 2026-06-19T12:00:00+08:00
Data snapshot version   : case-event-98123
```

Dan output-nya bukan hanya string:

```text
- HTML page
- HTML email
- plain text email
- PDF pre-render HTML
- XML
- CSV
- fixed-width text
- generated source code
- generated config
- legal notice
- archived correspondence artifact
```

FreeMarker secara resmi diposisikan sebagai generic tool untuk menghasilkan text output, dari HTML sampai generated source code, berdasarkan template. Thymeleaf diposisikan sebagai server-side Java template engine untuk web maupun standalone environment, dengan natural templates yang bisa dibuka sebagai HTML statis di browser. Jakarta Pages/JSP mendefinisikan template engine untuk web application yang mencampur textual content, custom tags, expression language, dan embedded Java code, lalu dikompilasi menjadi Jakarta Servlet. Referensi ini penting karena Part 0 membangun landscape sebelum kita memilih engine.

---

## 0.3 Template Engine Bukan String Replacement

String replacement biasanya seperti ini:

```java
String output = template
    .replace("{{name}}", user.getName())
    .replace("{{referenceNo}}", application.getReferenceNo());
```

Untuk use case kecil, ini terlihat cukup.

Tetapi begitu sistem butuh:

1. conditional rendering,
2. looping,
3. escaping HTML,
4. null handling,
5. number/date formatting,
6. localization,
7. reusable fragments,
8. template caching,
9. template versioning,
10. error diagnostics,
11. macro/component library,
12. security policy,
13. auditability,
14. designer collaboration,
15. multi-output generation,

string replacement mulai runtuh.

Masalah string replacement:

```text
- Tidak paham output context.
- Tidak punya escaping model.
- Tidak punya expression model yang konsisten.
- Tidak punya template dependency model.
- Tidak punya cache parsing.
- Tidak punya diagnostics line/column yang baik.
- Tidak punya abstraction untuk data model.
- Mudah berubah menjadi mini-template-engine buatan sendiri yang tidak aman.
```

Top-tier rule:

```text
Jika kebutuhan sudah menyentuh escaping, conditionals, loops, layout, i18n,
atau versioning, jangan bangun template engine ad-hoc dengan replace().
Gunakan engine yang punya semantic model dan operational behavior yang jelas.
```

---

## 0.4 Formula Dasar Rendering

Mental model pertama:

```text
Template + Data Model + Render Context + Engine Configuration = Output
```

Bukan hanya:

```text
Template + Data = Output
```

Karena hasil rendering dipengaruhi oleh:

1. template source,
2. template version,
3. template loader,
4. template cache,
5. object wrapper / expression resolver,
6. locale,
7. timezone,
8. number/date formatter,
9. output format,
10. escaping policy,
11. message bundle,
12. security dialect/directives,
13. engine version,
14. Java version,
15. runtime configuration.

Contoh:

```text
amount = 1234567.5
```

Output dapat berbeda:

```text
1,234,567.50       // en-US style
1.234.567,50       // id-ID style
SGD 1,234,567.50   // currency format
1234567.5          // machine format
```

Tanggal juga begitu:

```text
2026-06-19T04:00:00Z
```

Bisa menjadi:

```text
19 Jun 2026, 12:00 PM SGT
19 Juni 2026, 11:00 WIB
2026-06-19
Friday, June 19, 2026
```

Jadi render context bukan detail kecil. Ia bagian dari input kontraktual.

---

## 0.5 Rendering Sebagai Deterministic Transformation

Idealnya, rendering harus deterministic:

```text
Input yang sama + template version yang sama + config yang sama = output yang sama.
```

Ini penting untuk:

1. audit,
2. dispute resolution,
3. legal correspondence,
4. reproducible PDF/email,
5. testability,
6. debugging,
7. rollback,
8. data retention.

Jika sistem menghasilkan surat penolakan aplikasi pada 1 Juni 2026, lalu user bertanya 6 bulan kemudian “kenapa isi surat saya seperti itu?”, kita harus bisa menjawab:

```text
- template mana yang digunakan,
- versi template berapa,
- data snapshot apa,
- locale/timezone apa,
- rule state apa,
- siapa yang men-trigger,
- output final apa,
- apakah output itu immutable atau regenerated.
```

Kesalahan umum:

```text
Regenerate document from current data and current template.
```

Itu berbahaya karena current data/template mungkin sudah berubah.

Production-grade rule:

```text
Untuk output legal, financial, compliance, notification resmi, atau correspondence,
output yang sudah dikirim harus diperlakukan sebagai immutable artifact atau harus
punya kemampuan deterministic replay dari exact template version + exact data snapshot.
```

---

## 0.6 Empat Komponen Besar Template System

Secara arsitektural, template system terdiri dari empat komponen besar:

```text
1. Template Source
2. Data Model
3. Render Context
4. Rendering Engine
```

Diagram:

```text
+-------------------+        +-------------------+
| Template Source   |        | Data Model        |
| - file            |        | - ViewModel       |
| - classpath       |        | - DTO             |
| - database        |        | - Map             |
| - CMS             |        | - generated model |
+---------+---------+        +---------+---------+
          |                            |
          v                            v
+------------------------------------------------+
| Render Context                                 |
| - locale                                       |
| - timezone                                     |
| - output format                                |
| - tenant                                       |
| - template version                             |
| - security classification                      |
+----------------------+-------------------------+
                       |
                       v
+------------------------------------------------+
| Rendering Engine                               |
| - FreeMarker / Thymeleaf / JSP / other         |
| - parser                                       |
| - evaluator                                    |
| - cache                                        |
| - escaping                                     |
| - diagnostics                                  |
+----------------------+-------------------------+
                       |
                       v
+------------------------------------------------+
| Output                                         |
| - HTML page                                    |
| - HTML email                                   |
| - plain text                                   |
| - PDF pre-render HTML                          |
| - XML / CSV / source / config                  |
+------------------------------------------------+
```

Setiap komponen punya failure mode.

Template Source bisa gagal:

```text
- template tidak ditemukan,
- versi salah,
- syntax invalid,
- dependency fragment hilang,
- template belum approved,
- template owner salah publish.
```

Data Model bisa gagal:

```text
- field missing,
- null tidak ditangani,
- tipe tidak sesuai,
- data belum di-redact,
- entity malas/lazy loading meledak,
- collection terlalu besar,
- timezone ambigu.
```

Render Context bisa gagal:

```text
- locale tidak tersedia,
- timezone tidak diset,
- tenant branding salah,
- output format salah,
- security classification tidak cocok,
- template version tidak dipin.
```

Engine bisa gagal:

```text
- escaping salah,
- cache stale,
- object exposure terlalu luas,
- expression terlalu mahal,
- render latency tinggi,
- exception tidak observable.
```

---

## 0.7 Template Source: Bukan Sekadar File `.ftl` atau `.html`

Template source dapat berasal dari banyak tempat:

```text
- classpath resource
- filesystem
- servlet context
- database
- object storage
- Git-backed repository
- CMS/admin portal
- multi-tenant template registry
- generated template
```

Pilihan source menentukan operational behavior.

### 0.7.1 Classpath Template

Biasanya dipaketkan di aplikasi:

```text
src/main/resources/templates/notice/approval.ftlh
src/main/resources/templates/email/application-approved.html
```

Kelebihan:

```text
- versioned with code,
- reproducible deployment,
- aman dari perubahan runtime liar,
- mudah dites di CI,
- cocok untuk developer-owned templates.
```

Kekurangan:

```text
- perubahan butuh deployment,
- kurang cocok untuk business-editable correspondence,
- rollback ikut release artifact.
```

### 0.7.2 Filesystem Template

Kelebihan:

```text
- bisa diubah tanpa rebuild,
- cocok untuk on-prem legacy deployment,
- mudah diinspect.
```

Kekurangan:

```text
- drift antar node,
- permission risk,
- deployment consistency risk,
- sulit audit kalau tidak dikontrol.
```

### 0.7.3 Database Template

Kelebihan:

```text
- bisa versioning,
- bisa approval workflow,
- bisa multi-tenant,
- bisa runtime publish,
- cocok untuk notification/correspondence platform.
```

Kekurangan:

```text
- butuh governance,
- butuh sandbox/security,
- cache invalidation kompleks,
- perlu migration strategy,
- bisa menjadi CMS mini yang tidak direncanakan.
```

### 0.7.4 Git-backed Template Repository

Kelebihan:

```text
- reviewable,
- auditable,
- diffable,
- cocok untuk engineer-owned templates,
- bisa CI validation.
```

Kekurangan:

```text
- business user sulit edit,
- publish pipeline lebih kompleks,
- runtime sync harus dirancang.
```

### 0.7.5 Rule of Thumb

```text
Developer-owned UI template        -> classpath/Git
Business-owned email template      -> DB/CMS with approval
Legal correspondence template      -> versioned DB/Git with immutable publication
Tenant-specific branding template  -> registry + fallback chain
Generated source/config template   -> classpath/Git
```

---

## 0.8 Data Model: API Antara Backend dan Template

Kesalahan besar dalam template engineering adalah memberikan entity/domain object langsung ke template.

Contoh buruk:

```java
model.put("case", caseEntity);
model.put("applicant", applicantEntity);
model.put("officer", officerEntity);
```

Lalu di template:

```ftl
${case.applicant.profile.identityDocument.number}
${case.currentAssessment.assignedOfficer.department.name}
```

Atau di Thymeleaf:

```html
<span th:text="${case.applicant.profile.identityDocument.number}"></span>
```

Masalahnya:

```text
- Template tahu terlalu banyak struktur domain.
- Refactor domain merusak template.
- Lazy loading dapat terjadi saat rendering.
- Sensitive field bisa bocor.
- Authorization sulit diterapkan.
- Null path panjang sulit dikontrol.
- Template menjadi business logic reader.
- Testing menjadi rapuh.
```

Mental model yang benar:

```text
Template tidak boleh bergantung pada domain model internal.
Template harus bergantung pada rendering contract.
```

Contoh lebih baik:

```java
public record ApprovalNoticeViewModel(
    String recipientName,
    String applicationReferenceNo,
    String approvalDateText,
    String licenseNumber,
    String agencyDisplayName,
    List<ConditionViewModel> conditions
) {}
```

Template:

```ftl
Dear ${recipientName},

Your application ${applicationReferenceNo} has been approved on ${approvalDateText}.
```

Atau:

```html
<p th:text="|Dear ${recipientName},|">Dear Recipient,</p>
<p th:text="|Your application ${applicationReferenceNo} has been approved on ${approvalDateText}.|">
    Your application APP-XXXX has been approved on 19 Jun 2026.
</p>
```

Top-tier rule:

```text
The template data model is a public API.
Treat it with the same discipline as REST API contracts.
```

Artinya:

```text
- stable fields,
- clear null policy,
- documented meaning,
- versioned changes,
- backward compatibility,
- tests,
- ownership,
- security review.
```

---

## 0.9 Presentation Model vs Domain Model

Domain model menjawab:

```text
Apa kebenaran bisnis sistem?
```

Presentation model menjawab:

```text
Apa yang perlu ditampilkan/dihasilkan dalam output ini?
```

Contoh domain:

```java
class Application {
    ApplicationId id;
    Applicant applicant;
    ApplicationStatus status;
    Instant submittedAt;
    List<Assessment> assessments;
    List<Document> documents;
    Money feePaid;
}
```

Contoh presentation model untuk email approval:

```java
record ApprovalEmailModel(
    String applicantDisplayName,
    String referenceNo,
    String submittedDate,
    String approvedDate,
    String nextStepUrl,
    String supportEmail,
    String agencyName
) {}
```

Contoh presentation model untuk PDF approval letter:

```java
record ApprovalLetterModel(
    String letterReferenceNo,
    String applicantLegalName,
    String applicantAddressBlock,
    String applicationReferenceNo,
    String approvalDateLongText,
    String licenseNumber,
    List<String> approvalConditions,
    String signatoryName,
    String signatoryTitle,
    String agencyLetterheadAssetPath
) {}
```

Data yang sama bisa menghasilkan banyak view model berbeda.

```text
Application domain object
        |
        +--> ApprovalEmailModel
        +--> ApprovalLetterModel
        +--> AdminPageModel
        +--> AuditSummaryModel
        +--> CSVExportRow
```

Ini bukan duplikasi buruk. Ini separation of concerns.

---

## 0.10 Template as Contract

Template dan data model membentuk kontrak.

Jika template membutuhkan:

```text
recipientName
applicationReferenceNo
approvalDateText
conditions[].label
conditions[].description
```

Renderer harus menjamin field itu tersedia dengan tipe yang benar.

Kontrak minimal harus mendefinisikan:

```text
- template id,
- template version,
- required fields,
- optional fields,
- field type,
- nullability,
- formatting responsibility,
- escaping expectation,
- locale behavior,
- security classification,
- sample data,
- expected output examples.
```

Contoh kontrak sederhana:

```yaml
templateId: correspondence.approval.notice
version: 1.0.0
outputFormat: html-email
model:
  recipientName:
    type: string
    required: true
    escapedBy: engine
  applicationReferenceNo:
    type: string
    required: true
    escapedBy: engine
  approvalDateText:
    type: string
    required: true
    formattedBy: renderer
  conditions:
    type: list
    required: false
    item:
      label:
        type: string
        required: true
      description:
        type: string
        required: true
```

Tanpa kontrak, error baru muncul saat runtime:

```text
TemplateException: The following has evaluated to null or missing...
```

Atau lebih buruk: output tetap terkirim tetapi salah.

---

## 0.11 Template Engine sebagai Boundary Layer

Template engine berada di boundary layer.

Boundary berarti tempat sistem internal menyentuh dunia luar.

Contoh boundary:

```text
- REST API response
- database persistence
- message broker event
- external API call
- file export
- rendered document/email/page
```

Kenapa boundary penting?

Karena di boundary terjadi transformasi:

```text
internal representation -> external representation
```

Pada template:

```text
domain facts -> user-visible text/HTML/document
```

Jika boundary salah, dampaknya bisa besar:

```text
- user salah memahami status,
- email bocor PII,
- surat legal salah tanggal,
- tombol action tampil untuk role salah,
- XSS,
- PDF tidak bisa dipakai sebagai evidence,
- audit tidak bisa membuktikan versi template.
```

Top-tier engineer memperlakukan rendering seperti boundary serius, bukan dekorasi UI.

---

## 0.12 Rendering Pipeline End-to-End

Pipeline konseptual:

```text
1. Receive render request
2. Resolve template id
3. Resolve template version
4. Resolve output format
5. Resolve locale/timezone/tenant
6. Build presentation model
7. Validate model contract
8. Load template
9. Parse/compile template if not cached
10. Execute template with model/context
11. Escape/format according to output context
12. Write output to sink
13. Record metrics/log/audit
14. Return artifact metadata/output
```

Diagram:

```text
RenderRequest
    |
    v
TemplateSelector
    |
    v
TemplateRepository ----> TemplateVersion
    |
    v
ModelAssembler ----> PresentationModel
    |
    v
ModelValidator
    |
    v
EngineAdapter
    |       
    |        +--> FreeMarker
    |        +--> Thymeleaf
    v
RenderedOutput
    |
    +--> HTTP Response
    +--> Email Body
    +--> PDF Generator
    +--> Object Storage
    +--> Audit Record
```

Setiap langkah bisa dites dan diobservasi.

---

## 0.13 FreeMarker Mental Model

FreeMarker cocok dipahami sebagai:

```text
Generic text rendering engine with a powerful template language.
```

Ia tidak terbatas pada HTML.

Use case kuat:

```text
- email body,
- notification text,
- HTML pre-render untuk PDF,
- XML output,
- CSV/fixed-width text,
- generated source code,
- generated config,
- correspondence letter,
- template-driven reports.
```

Arsitektur dasar FreeMarker:

```text
Configuration
    |
    +--> TemplateLoader
    +--> ObjectWrapper
    +--> TemplateExceptionHandler
    +--> OutputFormat / AutoEscaping
    +--> Template Cache

Template
    |
    +--> process(dataModel, Writer)
```

Mental model:

```text
FreeMarker melihat Java object melalui ObjectWrapper.
Template tidak langsung melihat Java seperti Java code melihat object.
ObjectWrapper menerjemahkan Java object ke FreeMarker TemplateModel.
```

Ini penting untuk security.

Jika object exposure terlalu luas, template bisa menjadi terlalu powerful.

FreeMarker powerful karena:

```text
- expression language kaya,
- macro/function/directive,
- include/import,
- custom directives dari Java,
- output format/auto-escaping,
- object wrapper customization,
- data model fleksibel.
```

Tapi power itu juga risiko:

```text
- template logic terlalu kompleks,
- data leakage,
- server-side template injection,
- hidden dependency pada Java object,
- performance cost dari reflection/object access,
- business logic pindah ke template.
```

Rule awal:

```text
Gunakan FreeMarker untuk output generatif yang butuh fleksibilitas tinggi,
terutama non-interactive output seperti email, letter, PDF pre-render, XML, text,
dan code/config generation.
```

---

## 0.14 Thymeleaf Mental Model

Thymeleaf cocok dipahami sebagai:

```text
DOM/natural-template oriented server-side rendering engine.
```

Ia sangat kuat untuk HTML server-side rendering.

Kekuatan utamanya:

```text
- natural templates,
- HTML bisa dipreview di browser,
- integration kuat dengan Spring MVC,
- form binding,
- validation error rendering,
- fragment/layout composition,
- message/i18n integration,
- template modes untuk HTML, XML, TEXT, JavaScript, CSS, RAW.
```

Mental model Thymeleaf:

```text
Template HTML statis
    -> diproses oleh attribute processor seperti th:text, th:each, th:if
    -> menghasilkan HTML final
```

Contoh:

```html
<p th:text="${recipientName}">Static Recipient Name</p>
```

Saat dibuka langsung sebagai file HTML:

```html
Static Recipient Name
```

Saat dirender oleh Thymeleaf:

```html
Fajar
```

Inilah natural template: template tetap bisa menjadi prototype valid tanpa running server.

Rule awal:

```text
Gunakan Thymeleaf ketika output utama adalah HTML server-side rendered,
terutama dengan Spring MVC, forms, validation, fragments, admin portals,
dan pages yang designer/developer perlu preview sebagai HTML.
```

---

## 0.15 Jakarta Pages/JSP Mental Model

JSP/Jakarta Pages tetap perlu dipahami sebagai baseline historis dan interoperability.

Mental model JSP:

```text
JSP page -> compiled into Servlet -> executed to generate dynamic web content
```

Jakarta Pages mendukung textual content seperti HTML/XML, custom tags, expression language, dan historically embedded Java code. Tetapi untuk modern architecture, scriptlet Java di template biasanya dianggap legacy smell.

JSP masih relevan saat:

```text
- maintain legacy application,
- migrate old Java EE/Jakarta EE app,
- understand taglib/JSTL/EL heritage,
- compare server-side rendering models,
- perform modernization to Thymeleaf/FreeMarker.
```

Tetapi untuk sistem baru, terutama Spring Boot modern atau standalone rendering service, FreeMarker/Thymeleaf biasanya lebih fleksibel tergantung use case.

---

## 0.16 Template Engine Decision Matrix

| Use Case | Strong Candidate | Why |
|---|---:|---|
| Server-side HTML page with forms | Thymeleaf | Natural HTML, Spring MVC form/validation integration |
| Admin portal SSR | Thymeleaf | Layout/fragments, readable HTML, Spring Security integration |
| HTML email | FreeMarker or Thymeleaf | FreeMarker flexible text generation; Thymeleaf good HTML authoring |
| Plain text email | FreeMarker | Text-first, concise syntax |
| PDF pre-render HTML | FreeMarker or Thymeleaf | Depends on HTML complexity and team preference |
| XML generation | FreeMarker | Strong generic text output use case |
| CSV/fixed-width output | FreeMarker | Better text control |
| Source code generation | FreeMarker | Designed for generic generated text |
| Config generation | FreeMarker | Generic text output |
| Business-editable correspondence | FreeMarker often easier to sandbox/version | But security/governance is decisive |
| Designer-friendly HTML prototype | Thymeleaf | Natural templates |
| Legacy JSP migration to modern SSR | Thymeleaf | Strong replacement path for JSP pages |
| Dynamic user-supplied templates | Neither by default without sandbox | High SSTI/security risk |

Important nuance:

```text
The best template engine is not universal.
The best engine is the one whose semantics match the output, ownership model,
security model, and operational lifecycle.
```

---

## 0.17 Template Ownership Model

Ownership menentukan risiko.

### 0.17.1 Developer-Owned Template

Template ditulis oleh engineer.

Cocok untuk:

```text
- UI page,
- system email,
- source generation,
- internal reports,
- technical configs.
```

Governance:

```text
- code review,
- CI tests,
- version control,
- release pipeline.
```

### 0.17.2 Business-Owned Template

Template ditulis/diedit oleh business/admin user.

Cocok untuk:

```text
- correspondence wording,
- notification copy,
- legal text,
- tenant-specific terms.
```

Governance:

```text
- role-based editing,
- approval workflow,
- preview with sample data,
- publish/retire state,
- versioning,
- sandbox,
- restricted syntax,
- audit trail.
```

### 0.17.3 External/User-Supplied Template

Template berasal dari pihak tidak trusted.

Default position:

```text
Avoid unless you build a hardened sandbox.
```

Risiko:

```text
- server-side template injection,
- data exfiltration,
- resource exhaustion,
- method invocation abuse,
- introspection abuse,
- output injection.
```

---

## 0.18 Trust Model: Trusted Template vs Trusted Data

Ada dua dimensi trust:

```text
1. Apakah template trusted?
2. Apakah data trusted?
```

Matrix:

| Template | Data | Risk |
|---|---|---|
| Trusted | Trusted | Relatif aman, tetap perlu escaping |
| Trusted | Untrusted | XSS/output injection risk |
| Untrusted | Trusted | Data exfiltration/SSTI risk |
| Untrusted | Untrusted | Risiko paling tinggi |

Contoh trusted template + untrusted data:

```html
<p th:text="${comment}"></p>
```

Aman jika escaped.

Bahaya:

```html
<p th:utext="${comment}"></p>
```

Jika `comment` berisi HTML/script berbahaya.

Contoh untrusted template + trusted data:

```ftl
${user.sensitiveInternalNote}
```

Jika template author tidak trusted, ia bisa mencoba mengambil field yang tidak seharusnya tampil.

Rule penting:

```text
Escaping protects output context.
Sandboxing protects server/data access.
They solve different problems.
```

---

## 0.19 Output Context: Escaping Tidak Universal

Escaping bukan satu hal universal.

HTML body context:

```html
<p>${value}</p>
```

HTML attribute context:

```html
<a href="${url}">Open</a>
```

JavaScript string context:

```html
<script>
  const name = "${name}";
</script>
```

CSS context:

```html
<style>
  .banner { background-image: url('${url}'); }
</style>
```

URL context:

```html
<a href="/search?q=${query}">Search</a>
```

Setiap context punya aturan escaping berbeda.

Kesalahan umum:

```text
"Sudah di-HTML escape, berarti aman untuk JavaScript."
```

Salah.

HTML escaping tidak otomatis aman untuk JavaScript string. URL encoding tidak sama dengan HTML escaping. Sanitization tidak sama dengan escaping.

Mental model:

```text
Escaping is context-specific output encoding.
Sanitization is content filtering/normalization.
Validation is input acceptance decision.
Authorization is permission decision.
Sandboxing is capability restriction.
```

Jangan campur.

---

## 0.20 Auto-Escaping: Kenapa Harus Default Aman

Manual escaping rawan lupa.

Buruk:

```ftl
${userInput?html}
${anotherUserInput?html}
${thirdUserInput}
```

Satu field lupa escaping, XSS.

Lebih baik:

```text
Gunakan output format dan auto-escaping sebagai default.
```

FreeMarker modern mendukung output format dan auto-escaping. Thymeleaf `th:text` secara default melakukan escaped text output, sedangkan `th:utext` menghasilkan unescaped text dan harus diperlakukan berbahaya.

Rule:

```text
Default must be escaped.
Raw output must be explicit, rare, reviewed, and justified.
```

Raw output harus diberi nama yang jelas dalam model:

```java
record ArticleView(
    String title,
    SanitizedHtml bodyHtml
) {}
```

Bukan:

```java
record ArticleView(
    String title,
    String body
) {}
```

Karena `body` ambigu: plain text atau trusted HTML?

---

## 0.21 Template Logic: Seberapa Banyak Logic yang Boleh Ada?

Template butuh logic kecil:

```text
- show/hide section,
- loop list,
- choose label,
- render optional field,
- include fragment,
- format simple display.
```

Tetapi template tidak boleh menjadi tempat business logic besar:

```text
- determine eligibility,
- calculate fee,
- run workflow rule,
- decide approval state,
- query database,
- call service,
- perform authorization final decision,
- mutate state.
```

Boundary:

```text
Template boleh memutuskan bagaimana menampilkan data.
Template tidak boleh menentukan kebenaran bisnis utama.
```

Contoh buruk:

```ftl
<#if applicant.age >= 21 && applicant.hasPassedExam && !applicant.hasDisciplinaryRecord>
  Approved
<#else>
  Rejected
</#if>
```

Lebih baik:

```java
record ApplicationDecisionView(
    String decisionLabel,
    String decisionReasonText,
    boolean showAppealInstruction
) {}
```

Template:

```ftl
Decision: ${decisionLabel}
Reason: ${decisionReasonText}
```

Top-tier rule:

```text
If a template condition affects legal/business outcome, it probably belongs in Java/domain/workflow layer.
If it affects visual layout only, it may belong in template.
```

---

## 0.22 The Presentation Logic Gradient

Tidak semua logic di template buruk. Gunakan gradient berikut:

| Logic Type | Template? | Example |
|---|---:|---|
| Text interpolation | Yes | `Dear ${name}` |
| Simple conditional display | Yes | show section if list non-empty |
| Loop rendering | Yes | render rows |
| Formatting display | Sometimes | date/number if policy clear |
| Layout composition | Yes | header/footer/sidebar |
| Permission display hint | Sometimes | show/hide button, but backend still enforces |
| Business decision | No | approve/reject eligibility |
| Data fetching | No | repository/service call |
| State mutation | Never | update case status |
| External API call | Never | call payment/address API |
| Security final authorization | No | must be backend enforced |

Heuristic:

```text
Template logic should be cheap, deterministic, side-effect free, and presentation-oriented.
```

---

## 0.23 Rendering Is Not Authorization

UI can hide a button.

But hiding a button is not authorization.

Example Thymeleaf:

```html
<button th:if="${canApprove}">Approve</button>
```

This improves UX, but it does not secure the action.

Backend must still enforce:

```java
approvalService.approve(caseId, currentUser);
```

with permission checks.

Rule:

```text
Template-level authorization is display filtering.
Service/API-level authorization is enforcement.
```

Jika engineer menganggap `th:if` atau template condition cukup untuk security, sistem rapuh.

---

## 0.24 Rendering and Case/Workflow Systems

Dalam case management, template sering tergantung pada state.

Contoh:

```text
Case State: SUBMITTED
Template: acknowledgement.email

Case State: INFO_REQUESTED
Template: request-for-information.notice

Case State: APPROVED
Template: approval.notice

Case State: REJECTED
Template: rejection.notice

Case State: APPEALED
Template: appeal-received.notice

Case State: CLOSED
Template: closure.notice
```

Rendering trigger bisa berasal dari:

```text
- state transition,
- scheduled SLA reminder,
- manual officer action,
- batch job,
- external event,
- BPMN task completion,
- appeal submission,
- payment confirmation.
```

Mental model:

```text
State machine decides when and why something must be rendered.
Template engine decides how the output is produced.
```

Jangan campur:

```text
Template should not decide workflow transition.
Workflow should not hardcode presentation string.
```

---

## 0.25 Template Selection Model

Dalam sistem nyata, memilih template bisa lebih sulit daripada merendernya.

Template selection dapat dipengaruhi oleh:

```text
- document type,
- case type,
- state,
- action,
- tenant/agency,
- user role,
- recipient type,
- locale,
- effective date,
- channel,
- output format,
- version policy.
```

Contoh key:

```text
templateKey = {
  domain: "case",
  caseType: "licensing",
  event: "approved",
  recipientType: "applicant",
  channel: "email",
  locale: "en-SG",
  tenant: "cea",
  effectiveAt: "2026-06-19T12:00:00+08:00"
}
```

Selector:

```text
Find active template where:
- template.domain = case
- template.caseType = licensing
- template.event = approved
- template.recipientType = applicant
- template.channel = email
- template.locale = en-SG or fallback
- template.tenant = cea or default
- effectiveFrom <= eventTime
- effectiveTo is null or eventTime < effectiveTo
```

This is not merely rendering. It is policy resolution.

---

## 0.26 Render Time: Before Commit or After Commit?

Important architectural question:

```text
Should rendering happen inside the database transaction?
```

Usually, avoid long rendering inside transaction.

Bad:

```text
Begin transaction
  update case state
  render PDF
  send email
  store audit
Commit
```

Problems:

```text
- transaction held too long,
- rendering failure rolls back business state,
- email may be sent before commit succeeds,
- PDF generation can be slow,
- external I/O inside transaction.
```

Better pattern:

```text
Begin transaction
  update case state
  insert outbox event: CaseApproved
Commit

Async worker:
  read outbox event
  build render model from committed state or event snapshot
  render output
  send/store artifact
  mark notification/document generated
```

But there is nuance.

For audit/legal output, use event snapshot or stored rendering snapshot so future changes do not alter output.

---

## 0.27 Rendered Output as Artifact

Not all rendered outputs have same durability.

### 0.27.1 Ephemeral Output

Example:

```text
Admin dashboard HTML page.
```

Can be regenerated anytime.

### 0.27.2 Semi-Durable Output

Example:

```text
Email preview.
```

May not need long retention.

### 0.27.3 Durable Output

Example:

```text
Email sent to applicant.
PDF official notice.
Legal correspondence.
```

Need retention/audit.

For durable output, store metadata:

```text
- artifact id,
- template id,
- template version,
- render timestamp,
- renderer version,
- Java/application version,
- locale/timezone,
- recipient,
- data snapshot hash,
- output hash,
- storage location,
- send status,
- correlation id.
```

Artifact metadata example:

```json
{
  "artifactId": "art_20260619_000001",
  "templateId": "correspondence.approval.notice",
  "templateVersion": "3.4.2",
  "outputFormat": "html-email",
  "locale": "en-SG",
  "timezone": "Asia/Singapore",
  "renderedAt": "2026-06-19T12:00:00+08:00",
  "modelHash": "sha256:...",
  "outputHash": "sha256:...",
  "caseId": "CASE-001",
  "eventId": "evt-98123"
}
```

---

## 0.28 Template Versioning: Why It Matters

Template text changes over time.

Example old version:

```text
Your application has been approved.
```

New version:

```text
Your application has been approved subject to the conditions listed below.
```

If an email was sent using old version, future audit must not pretend it used new version.

Versioning policy:

```text
- draft: editable, not used for production
- published: immutable, can be used
- retired: no new rendering, old artifacts remain valid
```

Never mutate published template silently.

Better:

```text
v1.0.0 published
v1.0.1 published for typo correction
v1.1.0 published for wording change
v2.0.0 published for model contract change
```

Contract change means template expects different model.

Examples:

```text
Patch: spelling correction, no model change
Minor: optional field added
Major: required field changed/removed
```

---

## 0.29 Template Governance

Template governance answers:

```text
- Who can create template?
- Who can edit template?
- Who can approve template?
- Who can publish template?
- Who can retire template?
- Who can use template?
- Who can preview with real data?
- Who can view rendered artifact?
- Who can change shared macros/fragments?
```

Without governance:

```text
Template system becomes hidden production rule system.
```

A business user changing wording can accidentally change legal meaning.

A developer changing a macro can break 40 templates.

A template editor using raw HTML can introduce XSS.

Governance design:

```text
- role-based access control,
- approval workflow,
- preview environment,
- sample data,
- static validation,
- security lint,
- render tests,
- publishing audit,
- rollback plan,
- dependency graph.
```

---

## 0.30 Template Security Threat Model

Template systems face several security classes.

### 0.30.1 XSS

Untrusted data rendered into HTML/JS/CSS context incorrectly.

Example:

```html
<p th:utext="${comment}"></p>
```

If comment contains:

```html
<img src=x onerror=alert(1)>
```

Risk.

### 0.30.2 Server-Side Template Injection

Attacker controls template expression or template source.

Example conceptual risk:

```text
User input becomes template code, not template data.
```

Dangerous pattern:

```java
String template = "Hello " + userProvidedTemplateFragment;
engine.process(template, model);
```

If user controls expression syntax, they may access unintended objects depending on engine/configuration.

### 0.30.3 Data Leakage

Template can access fields not intended for output.

Cause:

```text
- exposing entity graph,
- exposing session/security object,
- exposing service beans,
- allowing broad method access.
```

### 0.30.4 Resource Exhaustion

Template causes high CPU/memory/output:

```text
- huge loops,
- recursive macros,
- large generated output,
- expensive nested expression,
- repeated formatting,
- heavy object traversal.
```

### 0.30.5 Log Leakage

Template exception logs full model including PII.

Bad:

```text
Template failed with model: { applicantNric=..., email=..., address=... }
```

Good:

```text
Template failed: templateId=..., version=..., line=..., field=..., correlationId=...
```

without dumping sensitive values.

---

## 0.31 Safe Rendering Design Principles

Use these principles as defaults:

```text
1. Templates are code-like artifacts.
2. Template data model is an API contract.
3. Default output must be escaped.
4. Raw HTML requires explicit trusted type.
5. Domain entities should not be exposed directly.
6. Services/repositories must not be exposed to templates.
7. Template author capability must match trust level.
8. Published templates should be immutable.
9. Legal/correspondence output must be reproducible or stored.
10. Rendering must be observable.
11. Rendering must be testable.
12. Rendering should be side-effect free.
13. Selection policy should be explicit.
14. Template errors should fail safely.
15. Rendering should not hide backend authorization requirements.
```

---

## 0.32 Performance Mental Model

Template performance has several layers:

```text
Total render latency =
    template resolution
  + template loading
  + parse/compile if cache miss
  + model assembly
  + expression evaluation
  + escaping/formatting
  + output writing
  + downstream I/O
```

Common mistake:

```text
Blame template engine when actual latency comes from model assembly/database queries.
```

Example:

```text
Rendering page takes 900 ms.
Template engine time is 25 ms.
DB queries caused by lazy access from template take 800 ms.
```

Root cause is not engine. It is model design.

Performance rule:

```text
Shape data before rendering.
Do not let template traversal trigger expensive domain access.
```

Template engine performance checklist:

```text
- template cache enabled in production,
- avoid parsing per request,
- use appropriate template loader,
- avoid huge model graphs,
- avoid rendering enormous lists,
- precompute expensive derived values,
- stream output when possible,
- avoid building huge intermediate strings for large artifacts,
- monitor render latency and failure rate,
- benchmark realistic templates, not only micro examples.
```

---

## 0.33 Java 8–25 Considerations

Template engines run on the JVM, so Java version matters indirectly.

### 0.33.1 Java 8 Baseline

Java 8 introduced `java.time`, lambdas, streams, and remains common in legacy systems.

For template rendering:

```text
- prefer java.time over Date/Calendar where possible,
- beware older framework compatibility,
- records are unavailable,
- use ordinary DTO classes/builders.
```

### 0.33.2 Java 11/17/21 Enterprise Baselines

Many enterprise systems standardize around LTS releases.

Rendering benefits:

```text
- better GC options,
- compact strings since Java 9,
- improved runtime performance,
- records available since Java 16,
- virtual threads available in Java 21 for concurrent workloads.
```

Virtual threads can help if rendering workflow includes blocking I/O around template loading, storage, or email/document pipeline. They do not magically make CPU-heavy rendering faster.

### 0.33.3 Java 25

Java 25 is relevant as a modern target for current JDK documentation and future-facing platform behavior. For template systems, the core concerns remain:

```text
- immutable view model design,
- memory allocation behavior,
- GC observability,
- JFR profiling,
- structured lifecycle for async/batch rendering,
- modern language features for model clarity.
```

Records are especially useful for view models:

```java
public record ApprovalNoticeModel(
    String recipientName,
    String referenceNo,
    String approvalDateText,
    List<ConditionModel> conditions
) {}
```

But do not expose records blindly if they contain sensitive fields.

---

## 0.34 Template Rendering and Encoding

Encoding bugs are common in email/PDF/document output.

Always clarify:

```text
- source template encoding,
- runtime output encoding,
- HTTP response charset,
- email MIME charset,
- file encoding,
- PDF font/unicode support,
- database stored template encoding.
```

Rule:

```text
Use UTF-8 everywhere unless there is a strong external constraint.
```

Potential failures:

```text
- apostrophe/quote changed,
- accented characters broken,
- CJK characters missing in PDF,
- emoji unsupported,
- line endings differ,
- BOM issues in CSV,
- email client rendering mismatch.
```

For regulatory/legal output, encoding is correctness, not cosmetic.

---

## 0.35 Template Rendering and Localization

Localization is more than translating labels.

It includes:

```text
- language,
- date format,
- time format,
- timezone,
- currency,
- number format,
- pluralization,
- address format,
- name order,
- legal wording,
- fallback language,
- template availability.
```

Bad approach:

```text
One English template with some replaced labels.
```

Better options:

```text
Option A: one template per locale
Option B: one template with message bundle
Option C: hybrid template + message bundle
```

For legal/correspondence, one template per locale can be safer because sentence structure and legal wording may not map cleanly through message fragments.

Locale fallback policy:

```text
en-SG -> en -> default
id-ID -> id -> default
zh-SG -> zh -> default
```

But legal documents may require:

```text
If exact locale template is unavailable, fail instead of fallback.
```

Top-tier rule:

```text
Fallback is a business/legal decision, not only a technical convenience.
```

---

## 0.36 Template Rendering and Accessibility

For HTML pages and emails, rendering should consider accessibility.

Examples:

```text
- semantic HTML,
- proper headings,
- alt text for images,
- label/input association,
- error message association,
- keyboard navigation,
- color contrast,
- table headers,
- language attribute,
- meaningful link text.
```

Template component libraries can enforce accessibility.

Bad:

```html
<div class="error">Required</div>
```

Better:

```html
<input id="email" name="email" aria-describedby="email-error" aria-invalid="true">
<div id="email-error">Email is required.</div>
```

In enterprise systems, accessibility is part of quality and sometimes compliance.

---

## 0.37 Template Rendering and Observability

Rendering should produce useful telemetry.

Metrics:

```text
- render.request.count
- render.success.count
- render.failure.count
- render.duration
- render.template.cache.hit
- render.template.cache.miss
- render.output.size
- render.model.validation.failure
- render.by.template.id
- render.by.template.version
- render.by.output.format
```

Logs:

```text
INFO  Render success templateId=... version=... durationMs=... outputBytes=... correlationId=...
ERROR Render failure templateId=... version=... line=... column=... errorCode=... correlationId=...
```

Traces:

```text
CaseApprovedHandler
  -> BuildApprovalNoticeModel
  -> ResolveTemplate
  -> RenderTemplate
  -> StoreArtifact
  -> SendEmail
```

Avoid logging full model.

Instead log:

```text
- model class,
- model schema version,
- field name that failed,
- safe identifiers,
- correlation id.
```

---

## 0.38 Template Testing Pyramid

Template testing should be layered.

```text
                  Visual regression / manual preview
                --------------------------------------
              Golden output snapshot tests
            ------------------------------------------
          Semantic HTML/XML tests
        ----------------------------------------------
      Contract tests: model <-> template
    --------------------------------------------------
  Unit tests for model assembler and renderer adapter
------------------------------------------------------
Static checks/lint/security rules
```

Test categories:

```text
- template loads,
- template parses,
- template renders with sample model,
- missing required field fails,
- optional field behavior correct,
- HTML escaped correctly,
- raw HTML only allowed for trusted field,
- locale variants render,
- large list does not explode,
- generated email has subject/body/plain-text,
- generated PDF pre-render contains required legal clauses,
- links are valid,
- accessibility basics pass.
```

Golden master test example concept:

```text
Given template approval.notice v1.0.0
And sample model approval-case-basic.json
When rendered with en-SG and Asia/Singapore
Then output equals approval-case-basic.expected.html
```

Golden tests need review discipline because output changes are intentional sometimes.

---

## 0.39 Template System Failure Model

A production renderer should classify failures.

Failure classes:

```text
TEMPLATE_NOT_FOUND
TEMPLATE_VERSION_NOT_FOUND
TEMPLATE_NOT_PUBLISHED
TEMPLATE_PARSE_ERROR
MODEL_VALIDATION_ERROR
MISSING_REQUIRED_FIELD
UNSUPPORTED_LOCALE
UNSUPPORTED_OUTPUT_FORMAT
RENDER_TIMEOUT
RENDER_SECURITY_VIOLATION
OUTPUT_TOO_LARGE
ARTIFACT_STORE_FAILURE
EMAIL_SEND_FAILURE
PDF_GENERATION_FAILURE
```

Do not collapse everything into:

```text
RuntimeException: render failed
```

Different failures need different responses.

Example:

| Failure | Retry? | Owner |
|---|---:|---|
| Template not found | No | Configuration/template admin |
| DB unavailable loading dynamic template | Yes maybe | Platform/DB |
| Missing required model field | No | Developer/model assembler |
| Email send failure | Yes | Integration/SMTP |
| PDF storage failure | Yes | Storage/platform |
| Security violation | No | Security/app owner |
| Unsupported locale | No or fallback | Product/business |

---

## 0.40 Template Rendering Service Interface

A mature system often benefits from a rendering service abstraction.

Example conceptual Java API:

```java
public interface TemplateRenderingService {
    RenderedOutput render(RenderRequest request);
}

public record RenderRequest(
    TemplateRef template,
    OutputFormat outputFormat,
    Locale locale,
    ZoneId zoneId,
    String tenantId,
    Object model,
    RenderPurpose purpose,
    Map<String, Object> attributes
) {}

public record TemplateRef(
    String templateId,
    String version
) {}

public record RenderedOutput(
    String contentType,
    Charset charset,
    byte[] bytes,
    RenderMetadata metadata
) {}
```

But for large output, avoid always returning `byte[]`:

```java
public interface StreamingTemplateRenderingService {
    RenderMetadata render(RenderRequest request, Writer writer);
}
```

Design considerations:

```text
- String output is easy but memory-heavy.
- Writer streaming is better for large text/HTML.
- PDF generation may need intermediate HTML.
- Email rendering needs subject + HTML body + text body.
- Multi-part output needs richer abstraction.
```

---

## 0.41 FreeMarker vs Thymeleaf: First-Principles Comparison

### FreeMarker

Think:

```text
I need precise and flexible generated text.
```

Strengths:

```text
- generic text output,
- strong macro/directive model,
- good for email/text/XML/config/source,
- flexible template loaders,
- customizable object wrapping,
- output format model,
- standalone rendering use cases.
```

Weaknesses/risks:

```text
- syntax less HTML-native,
- designer preview less natural,
- powerful template language can be abused,
- object exposure must be controlled,
- dynamic templates need strong sandboxing.
```

### Thymeleaf

Think:

```text
I need server-rendered HTML that remains natural HTML.
```

Strengths:

```text
- excellent HTML natural template workflow,
- Spring MVC integration,
- forms/validation/fragments,
- clear attribute-based transformation,
- designer-friendly prototypes,
- strong SSR page use case.
```

Weaknesses/risks:

```text
- less ideal for highly precise arbitrary text generation,
- HTML/DOM orientation can feel heavy for plain text/config,
- expression overuse can still create complexity,
- unescaped output remains dangerous.
```

### Decision Heuristic

```text
If primary artifact is an interactive server-rendered HTML page -> Thymeleaf.
If primary artifact is generated text/email/XML/config/source/letter -> FreeMarker often fits better.
If primary artifact is HTML email -> both are viable; choose based on authoring workflow, security, and team expertise.
If templates are business-editable -> engine choice is secondary to sandbox/governance.
```

---

## 0.42 Anti-Patterns to Avoid from Day One

### Anti-Pattern 1: Passing Entity Graphs to Templates

```java
model.put("case", caseEntity);
```

Risk:

```text
Template couples to domain internals and may trigger lazy loading/data leak.
```

Better:

```java
model.put("notice", approvalNoticeViewModel);
```

### Anti-Pattern 2: Putting Business Rules in Template

```ftl
<#if score > 70 && paid && !blacklisted>Approved</#if>
```

Better:

```java
model.decisionLabel()
```

### Anti-Pattern 3: Raw HTML Everywhere

```html
<div th:utext="${body}"></div>
```

Better:

```text
Use escaped output by default.
Only allow sanitized/trusted HTML type.
```

### Anti-Pattern 4: Dynamic Template from User Input

```java
engine.render(userInput, model);
```

Risk:

```text
SSTI/capability abuse.
```

### Anti-Pattern 5: No Template Version

```java
render("approval-email", model)
```

Better:

```java
render("approval-email", "3.4.2", model)
```

or version resolved from event effective date and recorded in artifact metadata.

### Anti-Pattern 6: Rendering Inside Long Transaction

Bad for email/PDF/batch output.

Use outbox/event-driven pattern where appropriate.

### Anti-Pattern 7: No Observability

If production error says only “template failed”, debugging becomes slow.

### Anti-Pattern 8: Template Cache Disabled in Production

Good for development, bad for production.

### Anti-Pattern 9: Template as Mini-CMS Without Governance

If business can edit templates, you need workflow/security/versioning.

### Anti-Pattern 10: Treating Preview as Production Truth

Preview may use sample data, not exact production snapshot. Make that explicit.

---

## 0.43 Top 1% Mental Models

### Mental Model 1: Template Is Code-Like, Not Content-Only

Template can contain expressions, loops, conditions, includes, macros, and sometimes access to objects.

Therefore:

```text
Review it.
Test it.
Version it.
Secure it.
Observe it.
```

### Mental Model 2: Data Model Is an API

Template depends on data model fields like a client depends on REST API.

Therefore:

```text
Document it.
Version it.
Validate it.
Avoid breaking it casually.
```

### Mental Model 3: Rendering Is a Boundary

Rendering converts internal truth into external representation.

Therefore:

```text
Escape correctly.
Redact correctly.
Format correctly.
Authorize correctly before model construction.
```

### Mental Model 4: Output Format Determines Safety Rules

HTML, XML, JS, CSS, URL, text, CSV, PDF-pre-HTML all differ.

Therefore:

```text
Never assume one escaping rule fits all.
```

### Mental Model 5: Legal Output Needs Immutable Evidence

If output can affect user rights, regulatory process, payment, license, appeal, enforcement, or dispute, treat it as evidence.

Therefore:

```text
Store artifact or store enough exact inputs to reproduce it.
```

### Mental Model 6: Template Selection Is Policy

Choosing which template version applies is often a business rule.

Therefore:

```text
Make selection explicit, testable, and auditable.
```

### Mental Model 7: Template Engine Is Not the Architecture

FreeMarker/Thymeleaf are tools.

The architecture is:

```text
template repository + model contract + renderer + security + governance + tests + observability + artifact lifecycle
```

---

## 0.44 Practical Architecture Styles

### Style A: Simple MVC Rendering

```text
Controller -> Model -> Thymeleaf -> HTML Response
```

Good for:

```text
- admin portal,
- internal tools,
- CRUD forms,
- low-to-medium complexity SSR pages.
```

### Style B: Email Rendering Service

```text
Business Event -> Model Assembler -> FreeMarker/Thymeleaf -> Email Body -> SMTP Provider
```

Good for:

```text
- notifications,
- approval/rejection emails,
- reminders,
- receipts.
```

### Style C: Correspondence Platform

```text
Case Event -> Template Selector -> Versioned Template -> Model Contract -> Render -> Store Artifact -> Send/Expose
```

Good for:

```text
- regulatory systems,
- legal notices,
- government correspondence,
- enforcement lifecycle documents.
```

### Style D: Document Generation Pipeline

```text
Domain Snapshot -> HTML Template -> HTML Output -> PDF Renderer -> Object Storage -> Audit Metadata
```

Good for:

```text
- PDF letters,
- certificates,
- invoices,
- reports.
```

### Style E: Code/Config Generation

```text
Schema/Metadata -> FreeMarker -> Generated Source/Config -> Build/Deploy Pipeline
```

Good for:

```text
- OpenAPI client/server stubs,
- SQL migration skeletons,
- configuration files,
- repetitive boilerplate.
```

---

## 0.45 Minimal Production Checklist for Any Template System

Before choosing syntax details, answer these:

```text
[ ] What outputs are generated?
[ ] Who owns templates?
[ ] Are templates trusted?
[ ] Is data trusted?
[ ] What output contexts exist?
[ ] What is escaped by default?
[ ] Is raw HTML allowed?
[ ] Is there a template version?
[ ] Is the model contract documented?
[ ] Are domain entities exposed?
[ ] How are locale/timezone determined?
[ ] How are template errors handled?
[ ] Is render output stored or reproducible?
[ ] Is rendering inside or outside transaction?
[ ] How is template cache configured?
[ ] How are templates tested?
[ ] How are template changes approved?
[ ] What metrics/logs/traces exist?
[ ] What is the rollback strategy?
[ ] What happens if rendering fails?
```

If many answers are unclear, the problem is not FreeMarker vs Thymeleaf. The problem is missing rendering architecture.

---

## 0.46 Example: Naive vs Production-Grade Email Rendering

### Naive Version

```java
String body = "Dear " + applicant.getName()
    + ", your application " + application.getReferenceNo()
    + " has been approved.";
mailService.send(applicant.getEmail(), "Application Approved", body);
```

Problems:

```text
- no escaping,
- no template version,
- no localization,
- no audit artifact,
- no retry boundary,
- no plain text/HTML structure,
- no preview,
- no governance,
- hardcoded wording,
- hard to test variants.
```

### Better Version

```java
ApprovalEmailModel model = approvalEmailModelAssembler.from(eventSnapshot);

RenderRequest request = RenderRequest.builder()
    .templateId("email.application.approved")
    .templateVersion("2.1.0")
    .outputFormat(OutputFormat.HTML_EMAIL)
    .locale(Locale.forLanguageTag("en-SG"))
    .zoneId(ZoneId.of("Asia/Singapore"))
    .tenantId("cea")
    .model(model)
    .purpose(RenderPurpose.CORRESPONDENCE)
    .build();

RenderedEmail email = emailRenderer.render(request);

artifactStore.save(email.artifactMetadata(), email.htmlBody(), email.textBody());
mailService.send(email);
```

Why better:

```text
- explicit template id/version,
- explicit output format,
- explicit locale/timezone,
- dedicated model,
- renderer can validate contract,
- output can be audited,
- email body can be tested,
- template can be changed without changing business code if governance permits.
```

---

## 0.47 Example: Naive vs Production-Grade SSR Page Rendering

### Naive Controller

```java
@GetMapping("/cases/{id}")
public String detail(@PathVariable Long id, Model model) {
    model.addAttribute("case", caseRepository.findById(id).orElseThrow());
    return "case-detail";
}
```

Problems:

```text
- exposes entity,
- template may trigger lazy loading,
- authorization unclear,
- sensitive fields may be accessible,
- model not optimized for display,
- hard to reason about template dependencies.
```

### Better Controller

```java
@GetMapping("/cases/{id}")
public String detail(@PathVariable CaseId id, Model model) {
    CurrentUser user = currentUserProvider.get();
    CaseDetailView page = caseDetailPageQuery.load(id, user);

    model.addAttribute("page", page);
    return "case/detail";
}
```

`CaseDetailView` contains exactly what UI needs:

```java
record CaseDetailView(
    String caseReferenceNo,
    String statusLabel,
    String submittedDateText,
    List<ActionButtonView> actions,
    List<TimelineItemView> timeline,
    boolean canViewSensitiveSection
) {}
```

The backend query applies authorization and shaping before rendering.

---

## 0.48 Example: State-Based Correspondence

Case event:

```json
{
  "eventType": "CASE_APPROVED",
  "caseId": "CASE-2026-0001",
  "occurredAt": "2026-06-19T12:00:00+08:00",
  "actor": "officer-123",
  "recipientType": "applicant",
  "locale": "en-SG"
}
```

Template selector chooses:

```text
correspondence.case-approved.applicant.email.en-SG v3.2.0
```

Model assembler builds:

```json
{
  "recipientName": "Fajar Abdi Nugraha",
  "caseReferenceNo": "CASE-2026-0001",
  "approvalDate": "19 Jun 2026",
  "conditions": [
    { "label": "Condition 1", "description": "Submit updated document within 14 days." }
  ],
  "supportEmail": "support@example.gov"
}
```

Renderer outputs:

```text
- email subject,
- HTML body,
- plain text body,
- artifact metadata.
```

Audit stores:

```text
- event id,
- template id/version,
- model hash,
- output hash,
- rendered timestamp,
- send status.
```

This is template engineering in a real system.

---

## 0.49 How to Think About FreeMarker and Thymeleaf Together

Do not force one engine to solve every problem.

Possible hybrid:

```text
Thymeleaf:
- admin web pages,
- internal SSR UI,
- forms,
- validation screens,
- HTML preview UI.

FreeMarker:
- emails,
- official letters,
- text templates,
- XML/CSV/config/source generation,
- batch rendering.
```

But hybrid has cost:

```text
- two syntaxes,
- two escaping models,
- two extension models,
- two test utilities,
- team training cost,
- governance complexity.
```

Use hybrid only when the difference in use cases justifies it.

Alternative:

```text
Use Thymeleaf for both SSR page and HTML email if team values one engine.
Use FreeMarker for both text and HTML if team values generic rendering.
```

Decision should be explicit.

---

## 0.50 What We Will Not Repeat from Previous Series

Because previous series already covered Java/Jakarta foundations, this series will avoid re-teaching:

```text
- basic Java syntax,
- collections/streams basics,
- concurrency fundamentals,
- Servlet fundamentals,
- HTTP fundamentals,
- Spring/Jakarta basic architecture,
- persistence/JPA basics,
- validation basics,
- general security basics,
- deployment basics,
- general testing basics,
- generic performance/JVM fundamentals.
```

We will reuse those ideas only when they are specific to template engineering.

For example:

```text
We will not re-teach XSS from zero.
We will focus on how FreeMarker/Thymeleaf escaping models influence XSS risk.
```

```text
We will not re-teach JMH from zero.
We will focus on benchmarking template rendering correctly.
```

```text
We will not re-teach state machines from zero.
We will focus on state-based template selection and correspondence rendering.
```

---

## 0.51 Part 0 Summary

The most important lessons:

```text
1. Template engine is a rendering subsystem, not string replacement.
2. Rendering transforms presentation model into output under explicit context.
3. Template data model is an API contract.
4. Domain entities should not be exposed directly.
5. Escaping is output-context specific.
6. Raw output must be rare and reviewed.
7. Template logic must remain presentation-oriented and side-effect free.
8. Template selection is often business policy.
9. Legal/correspondence output needs versioning and auditability.
10. FreeMarker is strongest as generic text-output rendering engine.
11. Thymeleaf is strongest as natural HTML server-side rendering engine.
12. JSP/Jakarta Pages matters as legacy/baseline compiled-servlet template model.
13. Production template systems need security, governance, observability, testing, and failure modeling.
```

A top 1% engineer does not ask only:

```text
How do I write a loop in template syntax?
```

They ask:

```text
What is the rendering contract?
What is the trust boundary?
What is the output context?
What is the artifact lifecycle?
What is the failure model?
How do I prove this output is correct, safe, reproducible, and operable?
```

---

## 0.52 Readiness Checklist Before Part 1

You are ready to continue if you can explain:

```text
[ ] Why template engine is not just string replacement.
[ ] Why data model should be treated as API contract.
[ ] Why exposing entity graph to template is risky.
[ ] Difference between escaping, sanitization, validation, authorization, and sandboxing.
[ ] Why legal/correspondence output needs template version and artifact metadata.
[ ] When FreeMarker is likely better than Thymeleaf.
[ ] When Thymeleaf is likely better than FreeMarker.
[ ] Why hiding a button in template is not backend authorization.
[ ] Why rendering inside database transaction can be problematic.
[ ] Why template ownership model affects architecture.
```

---

## 0.53 References

- Apache FreeMarker Manual — general manual, data model, object wrapper, output formats, and auto-escaping.
- Thymeleaf official documentation — Thymeleaf 3.1 usage, natural templates, template modes, Spring integration, dialect/template engine model.
- Spring Framework reference — Thymeleaf integration with Spring MVC and natural HTML template workflow.
- Jakarta Pages specification — JSP/Jakarta Pages as template engine compiled into Jakarta Servlet.
- Oracle JDK 25 documentation — Java SE/JDK 25 reference point for modern Java platform scope.

---

## 0.54 Status Seri

```text
Part 0 selesai.
Seri belum selesai.
Masih lanjut ke Part 1 — Template Engine Landscape di Java: JSP, FreeMarker, Thymeleaf, Mustache, Pebble, Velocity.
```
