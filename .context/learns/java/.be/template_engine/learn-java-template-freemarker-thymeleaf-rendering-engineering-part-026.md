# learn-java-template-freemarker-thymeleaf-rendering-engineering — Part 26
# Building a Production Template Rendering Service

> Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`  
> Part: `026`  
> Topik: Production Template Rendering Service  
> Scope Java: Java 8 sampai Java 25  
> Fokus engine: FreeMarker, Thymeleaf, dan abstraction layer di atas keduanya

---

## 0. Tujuan Part Ini

Di part sebelumnya kita sudah membahas template dari banyak sudut:

- FreeMarker architecture, FTL, macros, object wrapping, escaping, error handling, performance, Spring/Jakarta integration.
- Thymeleaf architecture, expressions, attributes, forms, fragments, security, performance.
- Email, document generation, localization, data model design, governance, security beyond XSS, dan testing.

Part ini menyatukan semuanya menjadi satu bentuk yang biasa dibutuhkan di sistem enterprise:

> **Production Template Rendering Service** — sebuah subsystem yang menerima request render, memilih template yang tepat, memvalidasi model, menjalankan engine yang tepat, menghasilkan output, mencatat audit/metrics, dan mengembalikan hasil secara aman dan repeatable.

Kita tidak lagi berpikir:

```text
Controller langsung panggil FreeMarker/Thymeleaf.
```

Kita berpikir:

```text
Business event / controller / batch / workflow
        ↓
Rendering use case
        ↓
Template Rendering Service
        ↓
Template registry + model validator + engine adapter
        ↓
FreeMarker / Thymeleaf
        ↓
HTML / text / email body / XML / CSV / PDF-preHTML / generated artifact
        ↓
Audit + observability + durable result policy
```

Goal akhirnya: kamu bisa mendesain subsystem rendering yang layak untuk:

- UI server-side.
- Email notification.
- Regulatory correspondence.
- Approval/rejection letter.
- Case lifecycle document.
- Multi-tenant template.
- Localized output.
- Audit-defensible generated artifact.
- Batch rendering.
- Preview rendering.
- Template publishing workflow.

---

## 1. Masalah Nyata yang Diselesaikan Rendering Service

Tanpa rendering service, sistem biasanya berkembang seperti ini:

```java
// Controller A
model.addAttribute("case", caseEntity);
return "case/detail";

// Service B
Template t = freemarker.getTemplate("email.ftlh");
t.process(Map.of("user", user, "case", caseEntity), writer);

// Batch C
String html = thymeleaf.process("reminder", context);

// Workflow D
String body = templateRepository.findByCode(code).render(model);
```

Awalnya terasa cepat. Lama-lama muncul masalah:

1. Template tersebar di banyak layer.
2. Tidak jelas siapa pemilik template.
3. Data model tidak konsisten.
4. Entity bocor ke template.
5. Escaping bergantung pada disiplin developer.
6. Error render sulit diklasifikasi.
7. Tidak ada audit template version.
8. Tidak ada preview standar.
9. Tidak ada compatibility check sebelum publish template.
10. Tidak ada observability render latency/cache/failure.
11. Sulit migrasi FreeMarker ke Thymeleaf atau sebaliknya.
12. Sulit membuat output yang repeatable untuk dokumen legal/regulatory.
13. Batch rendering rentan memory blow-up.
14. Multi-tenant override menjadi ad-hoc.
15. Tidak ada boundary jelas antara domain service dan presentation logic.

Production rendering service menyelesaikan ini dengan membuat rendering sebagai kapabilitas aplikasi yang eksplisit.

---

## 2. Definisi Rendering Service

Rendering service adalah application service/subsystem yang bertanggung jawab untuk:

1. Menerima render command.
2. Menentukan template identity dan version.
3. Menentukan output format.
4. Menentukan locale/timezone.
5. Memvalidasi data model.
6. Memilih engine adapter.
7. Mengeksekusi render.
8. Mengklasifikasi error.
9. Merekam metrics/log/audit.
10. Mengembalikan output atau artifact metadata.

Secara sederhana:

```java
RenderedOutput render(RenderRequest request);
```

Namun desain production tidak boleh berhenti di method itu saja. Kita perlu contract yang cukup kaya untuk memenuhi kebutuhan runtime, security, governance, dan operasi.

---

## 3. Mental Model: Rendering Service sebagai Compiler Pipeline Mini

Template rendering mirip compiler pipeline kecil.

```text
Input:
  - template id/version
  - model
  - locale/timezone
  - output format
  - render policy

Pipeline:
  1. Resolve template metadata
  2. Load template source
  3. Validate model contract
  4. Select engine
  5. Prepare engine context
  6. Render
  7. Post-process output
  8. Persist/audit/emit metrics

Output:
  - rendered content
  - content type
  - encoding
  - template version
  - render timestamp
  - diagnostics
```

Top 1% mental model:

> Rendering service bukan wrapper tipis di atas template engine. Rendering service adalah policy boundary antara business system dan output artifact.

Template engine tahu cara mengevaluasi template. Rendering service tahu **template mana yang boleh dipakai, model apa yang valid, output apa yang diizinkan, bagaimana error diklasifikasi, dan bagaimana hasilnya dipertanggungjawabkan**.

---

## 4. Kapan Perlu Rendering Service?

Tidak semua aplikasi butuh subsystem besar. Gunakan prinsip berikut.

### 4.1 Cukup pakai engine langsung jika

- Aplikasi kecil.
- Hanya beberapa halaman SSR.
- Template developer-owned.
- Tidak ada multi-tenant override.
- Tidak ada email/dokumen kritikal.
- Tidak ada audit/legal requirement.
- Tidak ada runtime template editing.

Contoh:

```java
@GetMapping("/hello")
public String hello(Model model) {
    model.addAttribute("name", "Fajar");
    return "hello";
}
```

Itu normal untuk MVC sederhana.

### 4.2 Rendering service mulai penting jika

- Template dipakai lintas module.
- Ada email/document/correspondence.
- Ada template versioning.
- Ada preview.
- Ada audit trail.
- Ada approval workflow.
- Ada multi-tenant/agency branding.
- Ada batch rendering.
- Ada template yang bisa diedit non-developer.
- Ada kebutuhan legal reproducibility.
- Ada lebih dari satu output format.
- Ada FreeMarker dan Thymeleaf dalam satu platform.

### 4.3 Rendering service wajib jika

- Template menentukan komunikasi resmi ke user/regulator/customer.
- Output menjadi evidence record.
- Template bisa diedit lewat admin UI.
- Ada data sensitif/PII.
- Ada strict compliance.
- Ada workflow state yang memilih template.
- Ada high-volume notification/document generation.

---

## 5. Core Domain Concepts

Sebelum coding, definisikan vocabulary.

### 5.1 Template Code

Identifier logical untuk template.

Contoh:

```text
CASE_APPROVAL_EMAIL
CASE_REJECTION_LETTER
PASSWORD_RESET_EMAIL
SLA_ESCALATION_NOTICE
MONTHLY_REPORT_CSV
```

Template code harus stabil. Jangan pakai filename sebagai business identifier.

Buruk:

```text
emails/case-approved-v2.ftlh
```

Lebih baik:

```text
code: CASE_APPROVAL_EMAIL
version: 2.1.0
variant: html
locale: en-SG
```

### 5.2 Template Version

Versi immutable dari template.

```text
1.0.0
1.1.0
2.0.0
2026-06-19.1
```

Pilih format yang cocok. Untuk regulated environment, sering lebih baik versi eksplisit plus effective date.

### 5.3 Template Variant

Satu logical template bisa punya beberapa variant:

```text
html
text
subject
pdf-html
xml
csv
```

Contoh email:

```text
CASE_APPROVAL_EMAIL
  - subject.en-SG.ftl
  - body-html.en-SG.ftlh
  - body-text.en-SG.ftlt
```

### 5.4 Output Format

Output format bukan sekadar file extension.

```text
HTML
TEXT
XML
CSV
JSON_TEXT
EMAIL_SUBJECT
EMAIL_HTML_BODY
EMAIL_TEXT_BODY
PDF_SOURCE_HTML
```

Output format menentukan:

- escaping policy
- content type
- encoding
- post-processing
- size limit
- validation rule

### 5.5 Render Model

Data yang diberikan ke template.

```text
RenderModel = immutable presentation contract
```

Bukan entity. Bukan service. Bukan repository. Bukan session object mentah.

### 5.6 Render Context

Metadata eksekusi render.

Berisi:

- locale
- timezone
- tenant id
- user id/system actor
- correlation id
- request id
- clock/render timestamp
- output format
- preview/production mode
- template version selection policy

### 5.7 Render Result

Hasil rendering tidak cukup hanya `String`.

Minimal:

```java
public final class RenderedOutput {
    private final String content;
    private final String contentType;
    private final Charset charset;
    private final TemplateIdentity template;
    private final Instant renderedAt;
    private final Locale locale;
    private final ZoneId zoneId;
    private final Map<String, String> diagnostics;
}
```

Untuk output besar, jangan selalu pakai `String`. Gunakan stream/file/blob abstraction.

---

## 6. Architecture Overview

Production rendering service bisa digambarkan begini:

```text
┌────────────────────────────────────────────────────────────┐
│                    Application Use Cases                    │
│  MVC Controller | Email Service | Batch Job | BPMN Worker    │
└─────────────────────────────┬──────────────────────────────┘
                              │ RenderRequest
                              ▼
┌────────────────────────────────────────────────────────────┐
│                 Template Rendering Service                  │
│                                                            │
│  - request validation                                      │
│  - template resolution                                     │
│  - model contract validation                               │
│  - engine selection                                        │
│  - render execution                                        │
│  - error classification                                    │
│  - metrics/logging/audit                                   │
└───────┬───────────────┬─────────────────┬──────────────────┘
        │               │                 │
        ▼               ▼                 ▼
┌─────────────┐ ┌────────────────┐ ┌────────────────────────┐
│ Template    │ │ Model Contract │ │ Engine Adapter Registry │
│ Registry    │ │ Validator      │ │                        │
└──────┬──────┘ └────────────────┘ └───────┬────────────────┘
       │                                   │
       ▼                                   ▼
┌───────────────┐                 ┌─────────────────────────┐
│ Template Store│                 │ FreeMarker Adapter      │
│ file/db/git   │                 │ Thymeleaf Adapter       │
└───────────────┘                 └─────────────┬───────────┘
                                                │
                                                ▼
                                      ┌──────────────────┐
                                      │ Rendered Output  │
                                      └──────────────────┘
```

---

## 7. Layering: Jangan Salah Tempatkan Rendering

Rendering service biasanya berada di application layer, bukan domain layer.

```text
Domain Layer:
  - Case
  - Approval
  - RejectionReason
  - WorkflowState
  - Business invariant

Application Layer:
  - ApproveCaseUseCase
  - SendCaseApprovalEmailUseCase
  - GenerateApprovalLetterUseCase
  - TemplateRenderingService

Infrastructure Layer:
  - FreeMarkerAdapter
  - ThymeleafAdapter
  - DatabaseTemplateRepository
  - S3TemplateRepository
  - MailSender
```

Domain tidak boleh tahu FreeMarker/Thymeleaf.

Buruk:

```java
case.renderApprovalLetter(); // domain object tahu rendering
```

Lebih baik:

```java
CaseApprovalLetterModel model = presenter.toApprovalLetterModel(caseAggregate);
renderingService.render(RenderRequest.of("CASE_APPROVAL_LETTER", model, context));
```

---

## 8. Public API Design

### 8.1 Minimal Interface

```java
public interface TemplateRenderingService {
    RenderedOutput render(RenderRequest request);
}
```

Terlalu sederhana untuk production, tapi titik awal yang bagus.

### 8.2 Better Interface

```java
public interface TemplateRenderingService {

    RenderedOutput render(RenderRequest request);

    RenderedOutput preview(PreviewRenderRequest request);

    TemplateValidationResult validateTemplate(TemplateValidationRequest request);

    TemplateCompatibilityResult checkCompatibility(TemplateCompatibilityRequest request);
}
```

Kenapa perlu method selain render?

- `preview`: untuk admin UI/template editor.
- `validateTemplate`: parse check, forbidden construct check, escaping policy check.
- `checkCompatibility`: memastikan template cocok dengan model contract sebelum publish.

### 8.3 Separate Use-Case Interface

Untuk sistem besar, hindari satu interface jumbo.

```java
public interface RenderTemplateUseCase {
    RenderedOutput render(RenderRequest request);
}

public interface PreviewTemplateUseCase {
    RenderedOutput preview(PreviewRenderRequest request);
}

public interface ValidateTemplateUseCase {
    TemplateValidationResult validate(TemplateValidationRequest request);
}

public interface CheckTemplateCompatibilityUseCase {
    TemplateCompatibilityResult check(TemplateCompatibilityRequest request);
}
```

Ini lebih bersih jika masing-masing punya authorization, logging, dan policy berbeda.

---

## 9. RenderRequest Design

### 9.1 Jangan Mulai dengan Map Saja

Buruk:

```java
render(String template, Map<String, Object> model);
```

Masalah:

- Tidak ada locale.
- Tidak ada timezone.
- Tidak ada output format.
- Tidak ada version policy.
- Tidak ada tenant.
- Tidak ada correlation id.
- Tidak ada audit metadata.
- Tidak ada render mode.
- Tidak ada size limit.

### 9.2 Production RenderRequest

```java
public final class RenderRequest {
    private final TemplateSelector templateSelector;
    private final Object model;
    private final RenderContext context;
    private final RenderPolicy policy;

    // constructor/factory/getters
}
```

### 9.3 TemplateSelector

```java
public final class TemplateSelector {
    private final String templateCode;
    private final OutputVariant variant;
    private final Optional<String> explicitVersion;
    private final VersionSelectionPolicy versionPolicy;
}
```

Contoh:

```java
TemplateSelector selector = TemplateSelector.latestActive(
    "CASE_APPROVAL_EMAIL",
    OutputVariant.EMAIL_HTML_BODY
);
```

Atau untuk audit-replay:

```java
TemplateSelector selector = TemplateSelector.exactVersion(
    "CASE_APPROVAL_EMAIL",
    OutputVariant.EMAIL_HTML_BODY,
    "2.3.1"
);
```

### 9.4 RenderContext

```java
public final class RenderContext {
    private final Locale locale;
    private final ZoneId zoneId;
    private final String tenantId;
    private final String actorId;
    private final String correlationId;
    private final Instant requestedAt;
    private final RenderMode mode;
}
```

`RenderMode`:

```java
public enum RenderMode {
    PRODUCTION,
    PREVIEW,
    TEST,
    REPLAY
}
```

### 9.5 RenderPolicy

```java
public final class RenderPolicy {
    private final boolean failOnMissingVariable;
    private final int maxOutputBytes;
    private final Duration timeout;
    private final boolean auditRequired;
    private final boolean allowDynamicTemplate;
}
```

Policy membuat rendering eksplisit.

---

## 10. RenderedOutput Design

### 10.1 Small Output

Untuk email subject/body, HTML page, text kecil:

```java
public final class RenderedOutput {
    private final String content;
    private final MediaType mediaType;
    private final Charset charset;
    private final TemplateResolvedIdentity template;
    private final Instant renderedAt;
    private final RenderDiagnostics diagnostics;
}
```

### 10.2 Large Output

Untuk PDF source HTML besar, CSV besar, report besar:

```java
public interface RenderedArtifact {
    MediaType mediaType();
    Charset charset();
    long sizeBytes();
    InputStream openStream();
    TemplateResolvedIdentity template();
    RenderDiagnostics diagnostics();
}
```

Atau:

```java
public final class RenderedFileArtifact {
    private final Path path;
    private final MediaType mediaType;
    private final Charset charset;
    private final long sizeBytes;
}
```

Jangan memaksa semua output menjadi `String`. Itu akan membuat memory tidak stabil.

---

## 11. Engine Adapter Pattern

Rendering service sebaiknya tidak bergantung langsung pada FreeMarker/Thymeleaf API di core use case.

### 11.1 Interface Adapter

```java
public interface TemplateEngineAdapter {

    EngineId engineId();

    boolean supports(TemplateMetadata template);

    RenderedOutput render(ResolvedTemplate template,
                          Object model,
                          RenderContext context,
                          RenderPolicy policy);

    TemplateValidationResult validate(TemplateSource source,
                                      TemplateMetadata metadata);
}
```

Engine id:

```java
public enum EngineId {
    FREEMARKER,
    THYMELEAF
}
```

### 11.2 FreeMarker Adapter Responsibility

FreeMarker adapter mengurus:

- `Configuration`
- `TemplateLoader`
- object wrapper
- output format
- template exception handler
- locale/timezone setting
- model conversion
- writer creation
- FreeMarker-specific exception mapping

### 11.3 Thymeleaf Adapter Responsibility

Thymeleaf adapter mengurus:

- `TemplateEngine`
- `ITemplateResolver`
- `Context`/`WebContext`
- template mode
- dialects
- locale
- cache settings
- Thymeleaf-specific exception mapping

### 11.4 Registry

```java
public final class TemplateEngineAdapterRegistry {
    private final Map<EngineId, TemplateEngineAdapter> adapters;

    public TemplateEngineAdapter get(EngineId engineId) {
        TemplateEngineAdapter adapter = adapters.get(engineId);
        if (adapter == null) {
            throw new UnsupportedTemplateEngineException(engineId);
        }
        return adapter;
    }
}
```

---

## 12. Template Registry

Template registry adalah source of truth metadata template.

### 12.1 Metadata yang Dibutuhkan

```java
public final class TemplateMetadata {
    private final String code;
    private final String version;
    private final OutputVariant variant;
    private final EngineId engine;
    private final String location;
    private final Locale locale;
    private final String tenantId;
    private final TemplateStatus status;
    private final Instant effectiveFrom;
    private final Optional<Instant> effectiveUntil;
    private final String modelContractId;
    private final String checksum;
}
```

Status:

```java
public enum TemplateStatus {
    DRAFT,
    REVIEWED,
    APPROVED,
    ACTIVE,
    RETIRED,
    REJECTED
}
```

### 12.2 Registry Interface

```java
public interface TemplateRegistry {
    ResolvedTemplate resolve(TemplateSelector selector, RenderContext context);
    Optional<TemplateMetadata> findExact(String code, String version, OutputVariant variant);
    List<TemplateMetadata> listActive(String code, OutputVariant variant);
}
```

### 12.3 Resolution Rules

Contoh urutan resolution:

```text
1. Exact version requested?
   → use exact version if allowed.

2. Tenant-specific active template exists?
   → use tenant override.

3. Locale-specific template exists?
   → use locale match.

4. Fallback locale exists?
   → use fallback.

5. Global active default exists?
   → use global default.

6. Otherwise fail with TEMPLATE_NOT_FOUND.
```

### 12.4 Kenapa Registry Lebih Baik daripada Hardcoded Path

Hardcoded path:

```java
render("templates/email/case-approved.ftlh", model);
```

Registry-based:

```java
render("CASE_APPROVAL_EMAIL", OutputVariant.EMAIL_HTML_BODY, context);
```

Kelebihan:

- Versioning lebih mudah.
- Multi-tenant override lebih mudah.
- Audit lebih jelas.
- Rename file tidak mengubah business use case.
- Bisa pindah storage dari classpath ke DB/git/S3 tanpa mengubah caller.
- Bisa enforce approval workflow.

---

## 13. Template Source Storage Strategy

### 13.1 Classpath Templates

Cocok untuk:

- developer-owned template
- versioned with application code
- simple deployment
- strict review via Git PR

Kelebihan:

- predictable
- fast
- immutable per release
- mudah dites di CI

Kekurangan:

- butuh redeploy untuk perubahan template
- kurang cocok untuk business-owned template

### 13.2 Filesystem Templates

Cocok untuk:

- deployment yang template-nya mounted config volume
- legacy app
- operational template replacement

Risiko:

- drift antar instance
- permission/security
- cache invalidation
- rollback discipline

### 13.3 Database Templates

Cocok untuk:

- CMS-like editing
- approval workflow
- tenant override
- effective date
- preview

Risiko:

- template source menjadi runtime data berisiko tinggi
- perlu sandbox/validation ketat
- perlu cache
- perlu immutable published version
- perlu migration strategy

### 13.4 Git-backed Templates

Cocok untuk:

- template dikelola seperti code
- review workflow kuat
- audit history kuat
- non-developer tetap bisa edit via UI yang membuat PR

Risiko:

- integrasi lebih kompleks
- publish pipeline perlu dibuat

### 13.5 Object Storage Templates

Cocok untuk:

- artifact besar
- distributed runtime
- immutable versioned template bundle

Risiko:

- latency
- cache invalidation
- eventual consistency
- permission model

### 13.6 Decision Matrix

| Storage | Best For | Main Risk |
|---|---|---|
| Classpath | Developer-owned template | Redeploy required |
| Filesystem | Simple externalization | Drift and permission |
| Database | CMS-like dynamic templates | Security and governance |
| Git-backed | Controlled publishing | Tooling complexity |
| Object storage | Immutable bundles | Cache and latency |

---

## 14. Model Contract Validation

Template rendering gagal bukan hanya karena syntax template. Sering gagal karena model tidak cocok.

### 14.1 Contract Problem

Template membutuhkan:

```ftl
${recipient.fullName}
${case.referenceNo}
${decision.approvedAt}
```

Tapi renderer memberi:

```json
{
  "recipientName": "Fajar",
  "caseNo": "C-123"
}
```

Hasilnya missing variable runtime.

### 14.2 Contract sebagai First-Class Artifact

Setiap template code/version harus punya model contract.

Contoh sederhana:

```json
{
  "contractId": "case-approval-email-v2",
  "required": [
    "recipient.fullName",
    "case.referenceNo",
    "decision.approvedAt"
  ],
  "optional": [
    "decision.remarks",
    "portalUrl"
  ]
}
```

### 14.3 Java Contract Type

```java
public final class CaseApprovalEmailModel {
    private final RecipientView recipient;
    private final CaseView caseInfo;
    private final DecisionView decision;
    private final String portalUrl;
}
```

Production rule:

> Model contract sebaiknya typed di Java dan bisa divalidasi sebelum render.

### 14.4 Bean Validation

```java
public final class CaseApprovalEmailModel {

    @NotNull
    private final RecipientView recipient;

    @NotNull
    private final CaseView caseInfo;

    @NotNull
    private final DecisionView decision;

    @NotBlank
    private final String portalUrl;
}
```

Validation sebelum render:

```java
Set<ConstraintViolation<Object>> violations = validator.validate(model);
if (!violations.isEmpty()) {
    throw new InvalidRenderModelException(violations);
}
```

### 14.5 Template Static Analysis

Untuk FreeMarker/Thymeleaf, static extraction variabel tidak selalu sempurna karena expression dinamis, macro, include, fragment, dan method call.

Tapi tetap berguna untuk:

- menemukan obvious missing field
- mendeteksi forbidden construct
- mengestimasi dependency template
- compatibility check sebelum publish

### 14.6 Contract Compatibility

Saat template baru dipublish:

```text
Template v2.1 requires fields:
  recipient.fullName
  case.referenceNo
  decision.approvedAt
  decision.reviewerName

Model provider supports:
  recipient.fullName
  case.referenceNo
  decision.approvedAt

Result:
  incompatible because decision.reviewerName missing
```

Publish harus gagal.

---

## 15. Version Selection Policy

### 15.1 Latest Active

Untuk kebanyakan runtime:

```text
Use latest ACTIVE template effective at render time.
```

### 15.2 Exact Version

Untuk replay/audit:

```text
Use template version 2.3.1 exactly.
```

### 15.3 Effective Date

Untuk dokumen legal:

```text
Use template active at event date, not current date.
```

Contoh:

```text
Case decision made at: 2026-06-01
Template changed at:    2026-06-15
Letter generated at:    2026-06-19
```

Pertanyaan penting:

> Dokumen harus pakai template yang berlaku saat decision dibuat, atau saat dokumen digenerate?

Jawabannya domain-specific, tapi harus eksplisit.

### 15.4 Pinned Version in Workflow

Untuk workflow panjang:

```text
At case creation, pin correspondence template major version.
During lifecycle, use compatible minor version only.
```

Ini mencegah isi dokumen berubah drastis di tengah lifecycle.

---

## 16. Error Taxonomy

Jangan hanya throw `RuntimeException`.

### 16.1 Error Categories

```java
public enum RenderErrorCode {
    TEMPLATE_NOT_FOUND,
    TEMPLATE_NOT_ACTIVE,
    TEMPLATE_VERSION_NOT_FOUND,
    TEMPLATE_PARSE_ERROR,
    TEMPLATE_RUNTIME_ERROR,
    MODEL_VALIDATION_FAILED,
    MODEL_CONTRACT_INCOMPATIBLE,
    UNSUPPORTED_OUTPUT_FORMAT,
    UNSUPPORTED_ENGINE,
    SECURITY_POLICY_VIOLATION,
    OUTPUT_TOO_LARGE,
    RENDER_TIMEOUT,
    POST_PROCESSING_FAILED,
    INTERNAL_ENGINE_ERROR
}
```

### 16.2 Exception Design

```java
public class TemplateRenderException extends RuntimeException {
    private final RenderErrorCode code;
    private final TemplateIdentity template;
    private final String correlationId;
    private final Map<String, String> diagnostics;
}
```

### 16.3 Mapping FreeMarker Errors

FreeMarker error mapping:

```text
IOException while loading template     → TEMPLATE_NOT_FOUND / TEMPLATE_LOAD_FAILED
ParseException                         → TEMPLATE_PARSE_ERROR
TemplateException missing variable     → TEMPLATE_RUNTIME_ERROR or MODEL_CONTRACT_INCOMPATIBLE
TemplateException method/security      → SECURITY_POLICY_VIOLATION
```

### 16.4 Mapping Thymeleaf Errors

Thymeleaf error mapping:

```text
TemplateInputException       → TEMPLATE_NOT_FOUND / TEMPLATE_PARSE_ERROR
TemplateProcessingException  → TEMPLATE_RUNTIME_ERROR
SpEL/OGNL evaluation issue   → TEMPLATE_RUNTIME_ERROR / SECURITY_POLICY_VIOLATION
```

### 16.5 Fail-Fast vs Lenient

Production email/legal document:

```text
Fail fast. Do not send broken output.
```

Preview mode:

```text
May show diagnostics placeholder.
```

UI page:

```text
Fail page rendering, return safe error page.
```

Batch:

```text
Fail one item, continue batch if policy allows, record item failure.
```

---

## 17. Observability Design

Rendering service harus observable.

### 17.1 Metrics

Minimal metrics:

```text
render.requests.total
render.success.total
render.failure.total
render.duration
render.output.bytes
render.template.cache.hit
render.template.cache.miss
render.model.validation.duration
render.template.resolve.duration
```

Dimensi/tag:

```text
engine=freemarker|thymeleaf
template_code=CASE_APPROVAL_EMAIL
variant=email_html
status=success|failure
error_code=TEMPLATE_RUNTIME_ERROR
tenant=...
mode=production|preview|test|replay
```

Hati-hati cardinality. Jangan masukkan:

- user id
- case id
- raw template version jika terlalu banyak
- request id
- email address

### 17.2 Timer

Rendering adalah operasi latency-sensitive. Gunakan timer.

Pseudo-code:

```java
Timer.Sample sample = Timer.start(meterRegistry);
try {
    RenderedOutput output = doRender(request);
    sample.stop(renderTimer("success", output.engine()));
    return output;
} catch (TemplateRenderException ex) {
    sample.stop(renderTimer("failure", ex.code()));
    throw ex;
}
```

### 17.3 Structured Logging

Log success tidak perlu verbose.

```json
{
  "event": "template_rendered",
  "templateCode": "CASE_APPROVAL_EMAIL",
  "templateVersion": "2.1.0",
  "variant": "EMAIL_HTML_BODY",
  "engine": "FREEMARKER",
  "durationMs": 14,
  "outputBytes": 8123,
  "correlationId": "..."
}
```

Log failure:

```json
{
  "event": "template_render_failed",
  "errorCode": "MODEL_VALIDATION_FAILED",
  "templateCode": "CASE_APPROVAL_EMAIL",
  "templateVersion": "2.1.0",
  "variant": "EMAIL_HTML_BODY",
  "engine": "FREEMARKER",
  "correlationId": "...",
  "diagnostics": {
    "missingField": "decision.approvedAt"
  }
}
```

Jangan log model penuh. Jangan log PII.

### 17.4 Tracing

Span structure:

```text
usecase.sendCaseApprovalEmail
  └─ template.resolve
  └─ template.model.validate
  └─ template.render
      └─ freemarker.process
  └─ email.send
```

Trace attribute aman:

```text
template.code
template.variant
template.engine
render.mode
render.error_code
```

Jangan taruh rendered content di trace.

---

## 18. Audit Design

Audit berbeda dari log. Log untuk operasi. Audit untuk akuntabilitas.

### 18.1 Kapan Audit Required?

Audit wajib untuk:

- official email
- legal notice
- approval/rejection letter
- regulatory correspondence
- generated document attached to case
- notification yang mempengaruhi SLA/rights/obligation

Audit mungkin tidak perlu untuk:

- normal MVC page render
- preview internal sementara
- static informational page

### 18.2 Audit Record

```java
public final class RenderAuditRecord {
    private final String renderId;
    private final String templateCode;
    private final String templateVersion;
    private final OutputVariant variant;
    private final EngineId engine;
    private final String templateChecksum;
    private final String modelChecksum;
    private final String outputChecksum;
    private final Locale locale;
    private final ZoneId zoneId;
    private final String tenantId;
    private final String actorId;
    private final String correlationId;
    private final Instant renderedAt;
    private final RenderMode mode;
}
```

### 18.3 Store Output or Store Hash?

Ada tiga opsi:

1. Store full output.
2. Store hash only.
3. Store output in object storage and hash in DB.

Untuk dokumen resmi, biasanya opsi 3 paling masuk akal:

```text
DB audit record:
  render_id
  template_code/version/checksum
  model_checksum
  output_checksum
  storage_uri
  rendered_at

Object storage:
  immutable rendered artifact
```

### 18.4 Model Snapshot

Agar bisa reproduce:

```text
Need template version + data snapshot + locale/timezone + rendering engine behavior.
```

Tapi menyimpan full model bisa mengandung PII. Jadi pilih:

- snapshot penuh untuk dokumen legal dengan akses terbatas
- redacted snapshot untuk operational audit
- hash untuk integrity check

---

## 19. Security Boundary

Rendering service adalah security boundary.

### 19.1 Input Trust Matrix

| Template | Data | Risk |
|---|---|---|
| Trusted | Trusted | Low |
| Trusted | Untrusted | XSS/output injection |
| Untrusted | Trusted | data exfiltration/SSTI |
| Untrusted | Untrusted | highest risk |

### 19.2 Policy by Template Source

Developer-owned classpath template:

```text
Can use full internal macro library.
Still no service/repository in model.
```

Business-owned DB template:

```text
Restricted engine features.
Whitelisted data model only.
No arbitrary class access.
No raw HTML unless sanitized.
Strict output limits.
```

External user-owned template:

```text
Avoid general-purpose template engine if possible.
Prefer constrained logic-less templating.
If unavoidable, sandbox heavily.
```

### 19.3 Forbidden Objects in Model

Never expose:

```text
ApplicationContext
DataSource
EntityManager
Repository
Service
SecurityContext raw object
HttpServletRequest raw object
Session raw object
ClassLoader
Runtime
File/Path unrestricted
ProcessBuilder
```

### 19.4 FreeMarker Hardening

Policy ideas:

- Use restricted `ObjectWrapper`.
- Avoid exposing raw Java objects for dynamic templates.
- Disable/limit API exposure.
- Restrict class resolver.
- Use `.ftlh`/`.ftlx` for auto-escaping when relevant.
- Avoid `?no_esc` except audited macro boundary.
- Use typed view models.

### 19.5 Thymeleaf Hardening

Policy ideas:

- Avoid dynamic template names from user input.
- Avoid evaluating untrusted expressions.
- Prefer `th:text` over `th:utext`.
- Validate URLs.
- Restrict template resolver locations.
- Separate preview and production rendering.
- Do not expose broad objects in context.

### 19.6 Output Size Limits

Template can accidentally or maliciously generate huge output.

```java
public final class BoundedWriter extends Writer {
    private final Writer delegate;
    private final long maxChars;
    private long count;

    // throw OutputTooLargeException if limit exceeded
}
```

### 19.7 Timeout

Java does not provide safe arbitrary thread termination. Timeout is tricky.

Better controls:

- pre-validate templates
- restrict loops/features for user templates
- limit model collection sizes
- run dynamic templates in separate worker pool/process if needed
- set output size bound
- avoid untrusted Turing-complete templates

---

## 20. Preview Endpoint Design

Preview is not production render.

### 20.1 Preview Requirements

Preview should support:

- selected template version/draft
- sample model
- locale/timezone selection
- tenant branding
- diagnostics display
- warning for missing fields
- generated HTML/text preview
- optional PDF/email preview

### 20.2 Preview Request

```java
public final class PreviewRenderRequest {
    private final String templateCode;
    private final Optional<String> version;
    private final OutputVariant variant;
    private final Object sampleModel;
    private final Locale locale;
    private final ZoneId zoneId;
    private final String tenantId;
}
```

### 20.3 Preview Safety

Preview must not:

- send real email
- persist official document
- trigger workflow transition
- use real recipient unless explicitly test-mode
- expose secret fields in diagnostics

### 20.4 Preview Watermark

For document/email preview:

```text
PREVIEW ONLY — NOT SENT — NOT OFFICIAL
```

For HTML preview, inject visible banner.

---

## 21. Email Rendering Service on Top of Template Rendering Service

Email service should compose rendering, not embed engine logic.

```text
EmailNotificationUseCase
   → render subject
   → render html body
   → render text body
   → compose MIME message
   → send or enqueue
   → audit communication
```

### 21.1 Email Template Set

```text
PASSWORD_RESET_EMAIL
  subject
  body_html
  body_text

CASE_APPROVAL_EMAIL
  subject
  body_html
  body_text
```

### 21.2 Email Rendering API

```java
public final class RenderedEmail {
    private final String subject;
    private final String htmlBody;
    private final String textBody;
    private final List<RenderedAttachment> attachments;
    private final List<RenderAuditRecord> renderAuditRecords;
}
```

### 21.3 Failure Policy

If subject render succeeds but body render fails:

```text
Do not send.
Mark notification as render failed.
Record diagnostics.
Retry only if failure is transient.
```

Most template errors are not transient.

---

## 22. Document Rendering Service on Top

Document generation usually has two phases:

```text
Template render → source artifact
Source artifact → final document engine
```

Example HTML-to-PDF:

```text
Template render HTML
      ↓
Validate/sanitize/check assets
      ↓
HTML-to-PDF engine
      ↓
PDF artifact
      ↓
Store/audit
```

### 22.1 Document Rendering API

```java
public interface DocumentGenerationService {
    GeneratedDocument generate(DocumentGenerationRequest request);
}
```

```java
public final class DocumentGenerationRequest {
    private final TemplateSelector templateSelector;
    private final Object model;
    private final RenderContext context;
    private final DocumentFormat outputFormat;
}
```

### 22.2 Document Audit

Store:

- template version
- source HTML checksum
- final PDF checksum
- model checksum
- generation engine/version if relevant
- rendered timestamp
- actor/correlation

---

## 23. MVC Integration

For SSR pages, there are two possible models.

### 23.1 Framework-Native MVC

Controller returns view name:

```java
@GetMapping("/cases/{id}")
public String detail(@PathVariable String id, Model model) {
    model.addAttribute("page", casePagePresenter.present(id));
    return "cases/detail";
}
```

This is fine for normal UI pages.

### 23.2 Rendering Service for Special Pages

Use rendering service when:

- page can be previewed/versioned
- page is tenant-customizable
- page output is stored
- page is also used as email/pdf source

```java
@GetMapping("/cases/{id}/letter-preview")
@ResponseBody
public String previewLetter(@PathVariable String id) {
    CaseLetterModel model = presenter.present(id);
    return renderingService.render(...).content();
}
```

Do not force all MVC pages through rendering service. Use the right boundary.

---

## 24. Batch Rendering

Batch rendering has different constraints.

### 24.1 Problems

- Thousands/millions of outputs.
- Memory pressure.
- Partial failure.
- Retry strategy.
- Throughput control.
- Output storage.
- Template cache warm-up.
- Model loading N+1.

### 24.2 Batch Design

```text
Read item page
  → build model
  → render using shared template cache
  → write output to sink
  → record item status
  → continue
```

### 24.3 Avoid Collecting All Outputs

Bad:

```java
List<String> outputs = items.stream()
    .map(item -> renderingService.render(...).content())
    .toList();
```

Better:

```java
for (BatchItem item : page) {
    RenderedArtifact artifact = renderer.renderToArtifact(...);
    outputStore.put(item.id(), artifact);
    batchStatus.markRendered(item.id());
}
```

### 24.4 Failure Policy

```text
Parse/config/template compatibility failure:
  fail batch early.

One data item invalid:
  mark item failed, continue if allowed.

Output store transient failure:
  retry with backoff.

Template runtime bug affecting all items:
  stop batch after threshold.
```

---

## 25. Concurrency Model

### 25.1 Shared Engine Objects

FreeMarker `Configuration` and parsed templates are generally designed to be shared after configuration is complete. Thymeleaf `TemplateEngine` is also normally configured once and reused.

Application rule:

```text
Configure engine at startup.
Do not mutate engine configuration during render.
Use per-render context/model/writer.
```

### 25.2 Worker Pools

Rendering is CPU + memory + I/O depending on template source/output sink.

For synchronous web rendering:

```text
Use request thread; rely on template cache; avoid blocking remote template loading.
```

For batch/email/document rendering:

```text
Use bounded executor.
Limit concurrency by CPU/memory/output sink.
```

### 25.3 Virtual Threads Java 21+

Virtual threads can help if rendering workflow includes blocking I/O:

- load model from DB/API
- read template from remote store
- write artifact to storage
- send email

But pure template evaluation is CPU-bound; virtual threads do not make CPU faster.

Guideline:

```text
Use virtual threads for orchestration/blocking boundaries.
Use bounded parallelism for CPU-heavy rendering.
```

### 25.4 Backpressure

For high-volume rendering, apply queue limits:

```text
max queued render jobs
max concurrent render jobs
timeout per render
max output bytes
failure threshold
```

---

## 26. Caching Strategy

There are multiple cache layers.

### 26.1 Engine Template Cache

FreeMarker/Thymeleaf can cache parsed templates.

Use it in production.

### 26.2 Registry Cache

Cache metadata lookup:

```text
templateCode + variant + tenant + locale + effectiveDate → metadata
```

Invalidate on publish/retire.

### 26.3 Source Cache

If source is DB/object storage, cache source by immutable version/checksum.

```text
key = templateCode:version:variant:checksum
```

Immutable cache is easier than mutable cache.

### 26.4 Rendered Output Cache

Use carefully.

Good for:

- public static-ish pages
- same template/model repeated
- expensive document preview

Bad for:

- personalized email
- PII output
- authorization-sensitive page
- rapidly changing model

Cache key must include:

- template version/checksum
- model checksum
- locale/timezone
- tenant
- output variant
- authorization-sensitive dimensions

---

## 27. Configuration Design

### 27.1 Application Properties

Example:

```yaml
template:
  rendering:
    default-locale: en-SG
    default-timezone: Asia/Singapore
    max-output-bytes: 1048576
    default-timeout: 2s
    audit-enabled: true
    preview-watermark-enabled: true
    engines:
      freemarker:
        enabled: true
        template-loader-path: classpath:/templates/freemarker/
      thymeleaf:
        enabled: true
        prefix: classpath:/templates/thymeleaf/
        suffix: .html
    registry:
      type: database
      cache-ttl: 60s
```

### 27.2 Separate DEV and PROD Behavior

DEV:

```text
cache disabled/short TTL
detailed diagnostics
sample preview enabled
```

PROD:

```text
cache enabled
safe errors
no content logging
strict missing variable policy
strict template status check
```

---

## 28. Implementation Blueprint

### 28.1 Package Structure

```text
com.example.template
  application
    RenderTemplateUseCase.java
    PreviewTemplateUseCase.java
    ValidateTemplateUseCase.java
    DefaultTemplateRenderingService.java
  domain
    TemplateIdentity.java
    TemplateSelector.java
    TemplateMetadata.java
    TemplateStatus.java
    OutputVariant.java
    RenderContext.java
    RenderPolicy.java
    RenderedOutput.java
    RenderDiagnostics.java
    RenderErrorCode.java
  registry
    TemplateRegistry.java
    DatabaseTemplateRegistry.java
    ClasspathTemplateRegistry.java
  contract
    ModelContract.java
    ModelContractValidator.java
    BeanValidationModelValidator.java
  engine
    TemplateEngineAdapter.java
    TemplateEngineAdapterRegistry.java
    FreemarkerTemplateEngineAdapter.java
    ThymeleafTemplateEngineAdapter.java
  audit
    RenderAuditService.java
    RenderAuditRecord.java
  observability
    RenderingMetrics.java
  security
    TemplateSecurityPolicy.java
    TemplateFeaturePolicy.java
```

### 28.2 Render Flow Code Sketch

```java
public final class DefaultTemplateRenderingService implements RenderTemplateUseCase {

    private final TemplateRegistry templateRegistry;
    private final ModelContractValidator modelValidator;
    private final TemplateEngineAdapterRegistry adapterRegistry;
    private final RenderAuditService auditService;
    private final RenderingMetrics metrics;
    private final Clock clock;

    @Override
    public RenderedOutput render(RenderRequest request) {
        Instant startedAt = clock.instant();
        RenderTimer.Sample timer = metrics.startTimer();

        try {
            validateRequest(request);

            ResolvedTemplate template = templateRegistry.resolve(
                request.templateSelector(),
                request.context()
            );

            modelValidator.validate(
                template.metadata().modelContractId(),
                request.model()
            );

            TemplateEngineAdapter adapter = adapterRegistry.get(template.metadata().engine());

            RenderedOutput output = adapter.render(
                template,
                request.model(),
                request.context(),
                request.policy()
            );

            if (request.policy().auditRequired()) {
                auditService.recordSuccess(request, template, output, startedAt);
            }

            metrics.recordSuccess(timer, template, output);
            return output;
        } catch (TemplateRenderException ex) {
            metrics.recordFailure(timer, ex);
            auditService.recordFailureIfRequired(request, ex, startedAt);
            throw ex;
        } catch (RuntimeException ex) {
            TemplateRenderException mapped = TemplateRenderException.internal(ex, request);
            metrics.recordFailure(timer, mapped);
            auditService.recordFailureIfRequired(request, mapped, startedAt);
            throw mapped;
        }
    }
}
```

---

## 29. FreeMarker Adapter Sketch

```java
public final class FreemarkerTemplateEngineAdapter implements TemplateEngineAdapter {

    private final Configuration configuration;

    @Override
    public EngineId engineId() {
        return EngineId.FREEMARKER;
    }

    @Override
    public RenderedOutput render(ResolvedTemplate template,
                                 Object model,
                                 RenderContext context,
                                 RenderPolicy policy) {
        try {
            Template freemarkerTemplate = configuration.getTemplate(
                template.location(),
                context.locale(),
                StandardCharsets.UTF_8.name()
            );

            StringWriter writer = new StringWriter();
            Writer boundedWriter = new BoundedWriter(writer, policy.maxOutputChars());

            Map<String, Object> root = toRootModel(model, context);
            freemarkerTemplate.process(root, boundedWriter);

            return RenderedOutput.text(
                writer.toString(),
                template.identity(),
                template.metadata().mediaType(),
                StandardCharsets.UTF_8,
                context
            );
        } catch (TemplateException ex) {
            throw mapFreemarkerException(template, context, ex);
        } catch (IOException ex) {
            throw mapFreemarkerIOException(template, context, ex);
        }
    }
}
```

### 29.1 Root Model Design

```java
private Map<String, Object> toRootModel(Object model, RenderContext context) {
    Map<String, Object> root = new LinkedHashMap<>();
    root.put("model", model);
    root.put("render", RenderContextView.safe(context));
    return Collections.unmodifiableMap(root);
}
```

Template uses:

```ftl
${model.recipient.fullName}
${model.caseInfo.referenceNo}
```

This avoids dumping many top-level names.

---

## 30. Thymeleaf Adapter Sketch

```java
public final class ThymeleafTemplateEngineAdapter implements TemplateEngineAdapter {

    private final TemplateEngine templateEngine;

    @Override
    public EngineId engineId() {
        return EngineId.THYMELEAF;
    }

    @Override
    public RenderedOutput render(ResolvedTemplate template,
                                 Object model,
                                 RenderContext context,
                                 RenderPolicy policy) {
        try {
            Context thymeleafContext = new Context(context.locale());
            thymeleafContext.setVariable("model", model);
            thymeleafContext.setVariable("render", RenderContextView.safe(context));

            String output = templateEngine.process(template.location(), thymeleafContext);

            if (output.getBytes(StandardCharsets.UTF_8).length > policy.maxOutputBytes()) {
                throw TemplateRenderException.outputTooLarge(template.identity(), context);
            }

            return RenderedOutput.text(
                output,
                template.identity(),
                template.metadata().mediaType(),
                StandardCharsets.UTF_8,
                context
            );
        } catch (TemplateInputException ex) {
            throw mapInputException(template, context, ex);
        } catch (TemplateProcessingException ex) {
            throw mapProcessingException(template, context, ex);
        }
    }
}
```

Note: Thymeleaf commonly returns `String` from `process`, but can also process with a writer in some usage patterns. For large artifacts, choose API/path carefully and enforce size limits.

---

## 31. API Endpoint Design

### 31.1 Internal Render Endpoint

Avoid exposing a general render endpoint publicly unless it is heavily protected.

Internal API example:

```http
POST /internal/templates/render
Content-Type: application/json
```

Request:

```json
{
  "templateCode": "CASE_APPROVAL_EMAIL",
  "variant": "EMAIL_HTML_BODY",
  "versionPolicy": "LATEST_ACTIVE",
  "locale": "en-SG",
  "timezone": "Asia/Singapore",
  "tenantId": "cea",
  "mode": "PREVIEW",
  "model": {
    "recipient": {
      "fullName": "Fajar"
    },
    "caseInfo": {
      "referenceNo": "CASE-2026-0001"
    }
  }
}
```

### 31.2 Risk of Generic Render Endpoint

A generic endpoint can become dangerous because it allows:

- template enumeration
- previewing unauthorized data
- rendering unapproved templates
- model injection
- output exfiltration
- brute-force expensive render

Restrict by:

- authentication
- authorization per template code
- mode restriction
- input model schema
- rate limit
- no production send side effects
- no raw engine feature exposure

---

## 32. Admin Template Publishing Pipeline

A mature rendering service often includes template lifecycle.

```text
Draft
  → Validate syntax
  → Validate forbidden constructs
  → Preview with sample model
  → Compatibility check
  → Review
  → Approve
  → Publish active version
  → Runtime use
  → Retire
```

### 32.1 Publish Gate

Before a template becomes ACTIVE:

1. Syntax parse passes.
2. Engine feature policy passes.
3. Output format policy passes.
4. Model contract compatibility passes.
5. Sample renders pass.
6. Security lint passes.
7. Approval exists.
8. Effective date valid.
9. No conflicting active template for same scope.
10. Audit entry created.

### 32.2 Immutable Published Version

Once ACTIVE/PUBLISHED, template source must not be mutated.

If change needed:

```text
create new version
```

This is essential for audit.

---

## 33. Multi-Tenant Rendering

### 33.1 Tenant Override Model

```text
Global template:
  CASE_APPROVAL_EMAIL v2.0.0 en-SG

Tenant override:
  CASE_APPROVAL_EMAIL v2.0.0 en-SG tenant=CEA
```

Resolution:

```text
tenant-specific active → global active
```

### 33.2 Avoid Copy-Paste Tenant Explosion

Do not copy entire template for every tenant if only branding changes.

Better:

- shared base template
- tenant branding model
- tenant fragment override only where necessary
- tenant CSS/theme config
- controlled macro library

### 33.3 Tenant Data Isolation

Rendering request with `tenantId=A` must not resolve template or branding from `tenantId=B`.

Test this explicitly.

---

## 34. Idempotency and Re-rendering

### 34.1 Render Is Pure, But Use Case May Not Be

Rendering itself should be deterministic. But surrounding use case may send email/store document.

Separate:

```text
render artifact
send/store artifact
```

### 34.2 Idempotency Key

For official communication:

```text
idempotencyKey = communicationType + caseId + eventId + recipientId
```

If retried, do not generate/send duplicate unless policy allows.

### 34.3 Re-render Policy

If template changed after original render:

- Should re-render use original template version?
- Should it use latest active?
- Should it preserve original output?

For legal/regulatory output, preserve original output and original template version.

---

## 35. Performance Budget

### 35.1 Latency Budget Example

For email render:

```text
template resolve:       < 5 ms
model validation:       < 2 ms
render subject:         < 2 ms
render text body:       < 10 ms
render html body:       < 20 ms
audit record:           async or < 10 ms
```

For UI page:

```text
model loading:          dominant cost
render:                 ideally < 20–50 ms for normal page
large table render:     avoid; paginate
```

For PDF source generation:

```text
HTML render:            < 100 ms for moderate doc
PDF generation:         separate budget, often much larger
```

### 35.2 Optimize in This Order

1. Avoid N+1 model loading.
2. Shape model before template.
3. Enable template cache.
4. Avoid large output in memory.
5. Simplify fragments/macros.
6. Measure with profiler/JFR/JMH/load test.
7. Tune GC only after allocation evidence.

---

## 36. Testing the Rendering Service

### 36.1 Unit Tests

- Template registry resolution.
- Version selection.
- Tenant fallback.
- Locale fallback.
- Model validation.
- Error mapping.
- Engine adapter mapping.

### 36.2 Integration Tests

- Render real FreeMarker template.
- Render real Thymeleaf template.
- Validate output escaping.
- Validate missing field failure.
- Validate audit record.
- Validate metrics tag not high-cardinality.

### 36.3 Contract Tests

For each template code/version:

```text
sample model renders successfully
missing required model fails clearly
optional field missing renders acceptable output
locale variants render successfully
```

### 36.4 Security Tests

- XSS payload escaped.
- `th:utext`/raw HTML forbidden unless allowed.
- FreeMarker API/class access restricted.
- Dynamic template cannot access service object.
- Output size limit works.
- Unauthorized template preview rejected.

### 36.5 Golden Output Tests

Use for stable documents/emails.

Caution:

- Normalize whitespace if not semantically important.
- Freeze clock/locale/timezone.
- Avoid brittle tests for purely visual layout unless intended.

---

## 37. Operational Runbook

### 37.1 Common Alert: Render Failure Spike

Check:

1. Which template code/version?
2. Which error code?
3. Started after new template publish?
4. Model provider changed?
5. Locale/tenant-specific only?
6. Engine adapter error?
7. Output too large?

Immediate mitigation:

- rollback template version
- disable tenant override
- switch to previous active version
- stop batch job
- route to manual review queue

### 37.2 Common Alert: Render Latency Spike

Check:

1. Template cache disabled?
2. Template source DB slow?
3. Model loading slow?
4. Large list rendered?
5. New macro/fragment recursion?
6. Output size increased?
7. GC pressure?

### 37.3 Common Alert: Preview Works, Production Fails

Possible causes:

- preview sample model differs from production model
- production uses stricter policy
- tenant/locale resolution differs
- draft template differs from active template
- production missing data due to workflow state

---

## 38. Design Anti-Patterns

### 38.1 Generic Map Everywhere

```java
Map<String, Object> model = new HashMap<>();
```

Acceptable at adapter boundary. Bad as application contract.

### 38.2 Exposing Entity Graph

```java
model.put("case", caseEntity);
```

Problems:

- lazy loading
- N+1
- security leak
- template coupling to persistence model
- uncontrolled method exposure

### 38.3 Template Engine in Domain Layer

Domain should not know template engine.

### 38.4 Runtime Editable Template Without Sandbox

This is one of the most dangerous patterns.

### 38.5 Logging Rendered Content

Rendered output can contain PII, tokens, legal content.

### 38.6 Latest Template for Audit Replay

Audit replay should use exact original version and original model snapshot where required.

### 38.7 No Output Size Limit

A template loop can create huge memory pressure.

### 38.8 Treating UI Hide as Authorization

Template rendering can hide a button. Backend must still enforce permission.

---

## 39. Java 8–25 Implementation Notes

### 39.1 Java 8 Baseline

Use:

- immutable classes manually
- `Optional` carefully
- `java.time`
- Bean Validation
- ExecutorService for batch

Avoid relying on records/sealed interfaces.

### 39.2 Java 11+

Useful:

- better HTTP client if template/admin service calls internal APIs
- improved runtime/container behavior
- `String`/GC improvements compared to older baselines

### 39.3 Java 17+

Useful:

- records for DTOs if allowed
- sealed types for result/error hierarchy
- pattern matching improvements depending version
- stronger baseline for Spring Boot 3 ecosystem

Example:

```java
public record RenderContext(
    Locale locale,
    ZoneId zoneId,
    String tenantId,
    String actorId,
    String correlationId,
    Instant requestedAt,
    RenderMode mode
) {}
```

### 39.4 Java 21+

Useful:

- virtual threads for blocking orchestration
- structured concurrency if available/appropriate in your baseline
- better operational profile for modern services

Use virtual threads carefully; do not assume they solve CPU-heavy rendering.

### 39.5 Java 25

For Java 25-era systems, design should still avoid tying template service to preview/incubator features unless your org accepts that risk. Prefer stable language/runtime features for platform code.

---

## 40. Minimal Production Checklist

Before calling a rendering service production-ready, verify:

### API and Contract

- [ ] Template code is logical, not filesystem path.
- [ ] Template version is explicit in metadata.
- [ ] Output variant is explicit.
- [ ] Locale/timezone are explicit.
- [ ] Render mode is explicit.
- [ ] Render policy is explicit.
- [ ] Model is typed or validated.

### Engine

- [ ] FreeMarker/Thymeleaf configured once and reused.
- [ ] Template cache enabled in production.
- [ ] Engine errors mapped to domain error codes.
- [ ] Escaping policy is output-format aware.
- [ ] Dangerous object exposure is prevented.

### Governance

- [ ] Template lifecycle exists.
- [ ] Published templates are immutable.
- [ ] Compatibility check exists.
- [ ] Preview exists for editable templates.
- [ ] Approval workflow exists where needed.

### Security

- [ ] No raw entity/service/repository in model.
- [ ] No rendered content in logs.
- [ ] Output size limit exists.
- [ ] Dynamic template features restricted.
- [ ] Authorization enforced before preview/render.
- [ ] UI authorization not trusted as backend authorization.

### Observability

- [ ] Render latency metric exists.
- [ ] Failure metric by error code exists.
- [ ] Template code/engine/variant tags exist with controlled cardinality.
- [ ] Structured logs include correlation id.
- [ ] Audit exists for official output.

### Testing

- [ ] Real template render tests exist.
- [ ] Missing variable tests exist.
- [ ] Escaping tests exist.
- [ ] Locale matrix tests exist.
- [ ] Golden output tests exist for stable artifacts.
- [ ] Security tests exist for dynamic templates.

---

## 41. Reference Architecture Summary

A mature rendering subsystem has these components:

```text
TemplateRenderingService
  - orchestrates rendering

TemplateRegistry
  - resolves code/version/tenant/locale/variant

TemplateRepository/Store
  - loads source/metadata

ModelContractValidator
  - validates model before render

EngineAdapterRegistry
  - selects FreeMarker/Thymeleaf adapter

FreeMarkerAdapter
  - maps request to FreeMarker runtime

ThymeleafAdapter
  - maps request to Thymeleaf runtime

RenderAuditService
  - records official render evidence

RenderingMetrics
  - exposes latency/count/failure metrics

TemplateSecurityPolicy
  - restricts features/exposure/output

PreviewService
  - safe rendering for draft/sample model
```

---

## 42. Key Takeaways

1. Rendering service is not a convenience wrapper. It is a policy boundary.
2. Template code/version/variant should be first-class, not implicit filenames.
3. Data model must be a stable rendering contract, not an entity graph.
4. Engine adapters keep FreeMarker/Thymeleaf replaceable and governable.
5. Error taxonomy is mandatory for real operations.
6. Observability must include latency, failure, template identity, and engine.
7. Audit is separate from logging.
8. Preview must be safe and side-effect free.
9. Dynamic/business-owned templates require stricter sandboxing than developer-owned templates.
10. Large output needs stream/artifact design, not always `String`.
11. Exact template version matters for legal/regulatory replay.
12. Production readiness is mostly about boundaries, invariants, and failure behavior.

---

## 43. Latihan Praktis

### Latihan 1 — Design API

Buat interface Java untuk:

- `RenderTemplateUseCase`
- `PreviewTemplateUseCase`
- `TemplateRegistry`
- `TemplateEngineAdapter`

Pastikan tidak ada API yang menerima template filename langsung dari caller business.

### Latihan 2 — Error Taxonomy

Ambil 10 failure berikut dan map ke `RenderErrorCode`:

1. Template code tidak ditemukan.
2. Template ditemukan tapi status DRAFT.
3. FreeMarker syntax error.
4. Thymeleaf expression gagal.
5. Model field wajib null.
6. Output lebih dari 5 MB.
7. Template mencoba akses class berbahaya.
8. Locale-specific template tidak ada.
9. PDF post-processing gagal.
10. Audit DB down setelah render sukses.

### Latihan 3 — Audit Model

Desain table `render_audit_record` untuk dokumen resmi. Sertakan:

- render id
- template code/version
- checksum
- actor
- tenant
- locale/timezone
- output storage location
- correlation id

### Latihan 4 — Multi-Tenant Resolution

Buat pseudo-code resolution template dengan fallback:

```text
tenant + locale
tenant + default locale
global + locale
global + default locale
```

### Latihan 5 — Security Review

Review desain kamu dan jawab:

- Apakah template bisa diedit runtime?
- Siapa author template?
- Apakah template bisa mengakses Java methods?
- Apakah model mengandung entity/service?
- Apakah output di-log?
- Apakah ada output size limit?
- Apakah preview bisa render data tenant lain?

---

## 44. Referensi

- Apache FreeMarker Manual — Configuration, Template Loading, Object Wrapper, Auto Escaping, Error Handling: https://freemarker.apache.org/docs/
- Apache FreeMarker Java API — `Configuration`, `Template`, `TemplateExceptionHandler`: https://freemarker.apache.org/docs/api/
- Thymeleaf 3.1 Documentation — TemplateEngine, Template Resolvers, Template Modes, Standard Dialect: https://www.thymeleaf.org/doc/tutorials/3.1/usingthymeleaf.html
- Thymeleaf + Spring Documentation: https://www.thymeleaf.org/doc/tutorials/3.1/thymeleafspring.html
- Spring Boot Common Application Properties — FreeMarker and Thymeleaf properties: https://docs.spring.io/spring-boot/appendix/application-properties/index.html
- Micrometer Documentation — Timers, Counters, Gauges, dimensional metrics: https://docs.micrometer.io/micrometer/reference/
- OWASP XSS Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
- OWASP Web Security Testing Guide — Server-Side Template Injection: https://owasp.org/www-project-web-security-testing-guide/

---

## 45. Status Seri

Part 26 selesai.

Seri belum selesai.

Berikutnya:

```text
Part 27 — Advanced Integration Patterns: MVC, REST, Batch, Messaging, BPMN, and Case Management
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-025.md">⬅️ Part 25 — Testing Strategy for Template Systems</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-027.md">Part 27 — Advanced Integration Patterns: MVC, REST, Batch, Messaging, BPMN, and Case Management ➡️</a>
</div>
