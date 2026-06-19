# learn-java-template-freemarker-thymeleaf-rendering-engineering — Part 34
# Capstone: Designing a Top 1% Java Template Rendering Architecture

> Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`  
> Part: `034`  
> Status: **FINAL PART**  
> Scope Java: **Java 8 sampai Java 25**  
> Fokus: desain arsitektur final untuk rendering subsystem berbasis FreeMarker, Thymeleaf, dan prinsip template engineering production-grade.

---

## 0. Posisi Part Ini dalam Seri

Part ini adalah sintesis final dari seluruh seri.

Bagian-bagian sebelumnya sudah membangun fondasi:

1. mental model template engineering;
2. landscape JSP, FreeMarker, Thymeleaf, Mustache, Pebble, Velocity;
3. core rendering model: template + data model = output;
4. FreeMarker architecture, FTL, macro, directive, object wrapping, escaping, diagnostics, performance, Spring/Jakarta integration;
5. Thymeleaf architecture, expressions, DOM transformation, forms, fragments, security, performance;
6. email template engineering;
7. document generation;
8. i18n/l10n;
9. view model and contract design;
10. governance, versioning, multi-tenancy;
11. SSTI, sandbox, data leakage, abuse cases;
12. testing strategy;
13. production rendering service;
14. integration patterns;
15. migration engineering;
16. template engine internals and extensibility;
17. performance lab;
18. three real-world blueprints.

Part 34 menyatukan semua itu menjadi satu desain arsitektur yang bisa dipakai untuk sistem enterprise nyata.

Targetnya bukan sekadar bisa memakai `FreeMarker` atau `Thymeleaf`, tetapi mampu mendesain **template rendering platform** yang:

- aman;
- deterministic;
- testable;
- observable;
- versioned;
- auditable;
- scalable;
- extensible;
- migration-friendly;
- cocok untuk web UI, email, PDF, surat, notifikasi workflow, dokumen legal, dan output teks lain.

---

## 1. Problem Statement

Bayangkan kita membangun sistem Java enterprise dengan kebutuhan berikut:

1. Ada UI admin berbasis server-side rendering.
2. Ada email notification untuk workflow event.
3. Ada PDF notice/warning/approval/rejection letter.
4. Ada template multi-bahasa.
5. Ada template multi-tenant atau multi-agency.
6. Ada template yang dimiliki developer dan sebagian bisa diedit business/admin.
7. Ada audit requirement: dokumen yang sudah terkirim harus bisa dibuktikan versi template dan datanya.
8. Ada security requirement: tidak boleh XSS, SSTI, data leakage, privilege bypass.
9. Ada performance requirement: render cepat, batch email tidak membebani JVM, UI tidak melakukan N+1 query.
10. Ada operations requirement: error rendering harus jelas, bisa dilihat metriknya, bisa dirollback.

Pendekatan lemah biasanya seperti ini:

```text
Controller -> Map<String,Object> -> template -> output
```

Itu cukup untuk demo, tetapi rapuh untuk sistem production.

Pendekatan yang matang:

```text
Domain Event / Request
  -> Template Selection
  -> Data Assembly
  -> View Model Contract Validation
  -> Policy & Security Boundary
  -> Template Resolution
  -> Engine Rendering
  -> Output Validation
  -> Storage / Delivery
  -> Audit / Metrics / Trace
```

Inilah yang akan kita desain.

---

## 2. Arsitektur Final: Big Picture

### 2.1 Komponen Utama

```text
+--------------------------------------------------------------------------------+
|                                Application Layer                               |
|--------------------------------------------------------------------------------|
|  MVC Controller | REST Artifact API | Batch Job | Message Consumer | BPMN Task  |
+-----------------------------------------+--------------------------------------+
                                          |
                                          v
+--------------------------------------------------------------------------------+
|                           Template Rendering Facade                            |
|--------------------------------------------------------------------------------|
|  renderHtml() | renderText() | renderEmail() | renderDocument() | preview()   |
+-----------------------------------------+--------------------------------------+
                                          |
                                          v
+--------------------------------------------------------------------------------+
|                              Rendering Orchestrator                            |
|--------------------------------------------------------------------------------|
|  1. Validate Request                                                           |
|  2. Resolve Template                                                           |
|  3. Resolve Version                                                            |
|  4. Build Render Context                                                       |
|  5. Build/Validate View Model                                                  |
|  6. Select Engine Adapter                                                      |
|  7. Render                                                                     |
|  8. Validate Output                                                            |
|  9. Record Audit + Metrics                                                     |
+--------------------+---------------------+--------------------+---------------+
                     |                     |                    |
                     v                     v                    v
+---------------------------+  +-----------------------+  +----------------------+
| Template Registry         |  | View Model Registry   |  | Policy Registry      |
|---------------------------|  |-----------------------|  |----------------------|
| template id               |  | model schema          |  | escaping policy      |
| tenant                    |  | required fields       |  | engine allowlist     |
| locale                    |  | model version         |  | object exposure      |
| effective date            |  | validation rules      |  | max render limits    |
| state                     |  | redaction rules       |  | author permissions   |
+---------------------------+  +-----------------------+  +----------------------+
                     |                     |                    |
                     +----------+----------+--------------------+
                                |
                                v
+--------------------------------------------------------------------------------+
|                              Engine Adapter Layer                              |
|--------------------------------------------------------------------------------|
|  FreeMarkerAdapter       | ThymeleafAdapter       | Future Adapter           |
+--------------------------+------------------------+--------------------------+
                                |
                                v
+--------------------------------------------------------------------------------+
|                             Output and Delivery Layer                          |
|--------------------------------------------------------------------------------|
|  HTTP Response | Email MIME | PDF Renderer | Object Storage | Audit Store       |
+--------------------------------------------------------------------------------+
```

### 2.2 Prinsip Desain

Arsitektur ini dibangun di atas prinsip berikut:

1. **Rendering is a deterministic transformation.**
   Dengan input yang sama, template version yang sama, locale/timezone yang sama, engine version yang sama, output harus sama atau setidaknya explainable.

2. **Template is a contract, not a script dump.**
   Template mendeklarasikan bentuk output, bukan menjalankan business process.

3. **View model is an API.**
   Template tidak boleh bergantung langsung pada entity/domain aggregate yang berubah-ubah.

4. **Security boundary happens before rendering.**
   Data exposure, authorization, redaction, escaping policy, dan object wrapping harus ditentukan sebelum engine mengeksekusi template.

5. **Templates are versioned artifacts.**
   Template yang sudah dipakai untuk email/dokumen legal tidak boleh hilang atau berubah tanpa jejak.

6. **Rendering failures are classified.**
   Error harus bisa dibedakan: template missing, invalid model, unsafe template, engine error, output validation error, delivery error.

7. **Observability is part of design.**
   Render latency, failure rate, template id, template version, output type, engine, dan tenant harus bisa dilacak.

8. **Testing is a release gate.**
   Template bukan file statis bebas risiko; ia harus melewati validation, contract test, escaping test, golden output test, dan preview.

---

## 3. Domain Model Arsitektur

### 3.1 Template Identity

Template tidak cukup diidentifikasi dengan path file seperti:

```text
emails/welcome.ftlh
```

Dalam sistem enterprise, template identity sebaiknya explicit:

```java
public record TemplateKey(
    String templateId,
    OutputKind outputKind,
    String tenantId,
    Locale locale,
    Instant businessTime
) {}
```

Contoh:

```text
templateId    = CASE_REJECTION_NOTICE
outputKind    = PDF
tenantId      = CEA
locale        = en-SG
businessTime  = 2026-06-19T03:00:00Z
```

Kenapa `businessTime` penting?

Karena template bisa punya `effectiveFrom` dan `effectiveTo`. Rendering dokumen untuk event 2025 tidak selalu boleh memakai template terbaru 2026.

### 3.2 Template Version

```java
public record TemplateVersion(
    String templateId,
    String version,
    TemplateEngineKind engine,
    OutputKind outputKind,
    TemplateState state,
    Instant effectiveFrom,
    Instant effectiveTo,
    String contentHash,
    String createdBy,
    Instant createdAt,
    String approvedBy,
    Instant approvedAt
) {}
```

`contentHash` penting untuk audit. Bukan hanya menyimpan `version = 1.2.3`, tetapi juga hash konten yang benar-benar dirender.

### 3.3 Template State

```java
public enum TemplateState {
    DRAFT,
    VALIDATING,
    REVIEWED,
    APPROVED,
    ACTIVE,
    RETIRED,
    REJECTED
}
```

State machine minimal:

```text
DRAFT
  -> VALIDATING
  -> REVIEWED
  -> APPROVED
  -> ACTIVE
  -> RETIRED

DRAFT / VALIDATING / REVIEWED
  -> REJECTED
```

Invariant:

- hanya `ACTIVE` yang boleh dipakai production rendering;
- `DRAFT` boleh dipakai preview internal;
- `RETIRED` tetap disimpan untuk audit/re-render historical;
- version yang pernah aktif tidak boleh diubah in-place;
- perubahan menghasilkan version baru.

---

## 4. Rendering Request dan Render Context

### 4.1 Rendering Request

```java
public record RenderRequest(
    TemplateKey templateKey,
    String modelName,
    String modelVersion,
    Object model,
    RenderPurpose purpose,
    String correlationId,
    String requestedBy,
    boolean preview
) {}
```

`RenderPurpose`:

```java
public enum RenderPurpose {
    MVC_PAGE,
    EMAIL_SUBJECT,
    EMAIL_HTML_BODY,
    EMAIL_TEXT_BODY,
    PDF_HTML_INTERMEDIATE,
    PDF_FINAL,
    XML_EXPORT,
    CSV_EXPORT,
    TEXT_DOCUMENT,
    PREVIEW
}
```

### 4.2 Render Context

Render context adalah environment eksplisit yang memengaruhi output.

```java
public record RenderContext(
    Locale locale,
    ZoneId zoneId,
    Clock clock,
    String tenantId,
    String actorId,
    Set<String> permissions,
    Map<String, Object> safeGlobals,
    RenderLimits limits
) {}
```

Jangan biarkan template diam-diam bergantung pada:

- default JVM locale;
- default JVM timezone;
- current system time langsung;
- session object mentah;
- Spring Security context mentah;
- request object mentah;
- service/repository bean.

Semua dependency rendering harus masuk sebagai explicit context yang aman.

### 4.3 Render Limits

```java
public record RenderLimits(
    int maxOutputBytes,
    int maxCollectionItems,
    Duration timeout,
    int maxNestedDepth
) {}
```

Ini penting untuk dynamic template atau batch rendering.

Template bisa gagal bukan hanya karena syntax, tetapi karena:

- output terlalu besar;
- list terlalu panjang;
- loop terlalu kompleks;
- nested macro terlalu dalam;
- rendering terlalu lama;
- memory allocation terlalu tinggi.

---

## 5. Template Selection Strategy

### 5.1 Selection Algorithm

Template selection biasanya butuh fallback.

Urutan umum:

```text
1. tenant-specific + locale-specific + active for business time
2. tenant-specific + default locale + active for business time
3. global + locale-specific + active for business time
4. global + default locale + active for business time
5. fail with TEMPLATE_NOT_FOUND
```

Contoh:

```text
CASE_REJECTION_NOTICE / CEA / ms-SG
CASE_REJECTION_NOTICE / CEA / en-SG
CASE_REJECTION_NOTICE / GLOBAL / ms-SG
CASE_REJECTION_NOTICE / GLOBAL / en-SG
```

### 5.2 Explicit Fallback Record

Fallback harus dicatat.

```java
public record TemplateResolutionResult(
    TemplateVersion selected,
    List<TemplateCandidate> attempted,
    boolean fallbackUsed
) {}
```

Audit event harus tahu apakah output memakai tenant-specific template atau fallback global.

### 5.3 Effective Date

Jangan selalu pakai `Instant.now()` untuk memilih template.

Untuk dokumen berbasis case event:

```text
businessTime = waktu state transition / waktu notice issued
```

Untuk preview:

```text
businessTime = user-selected preview date
```

Untuk UI runtime:

```text
businessTime = request time
```

---

## 6. View Model Contract Architecture

### 6.1 View Model Bukan Entity

Anti-pattern:

```java
model.put("case", caseEntity);
model.put("user", userEntity);
model.put("agency", agencyEntity);
```

Masalah:

1. Template bisa mengakses field yang seharusnya tidak diekspos.
2. Lazy loading bisa memicu query dari template.
3. Perubahan entity merusak template.
4. Field authorization sulit.
5. Audit sulit karena model tidak stabil.
6. Object wrapper bisa mengekspos method yang tidak diinginkan.

Lebih baik:

```java
public record CaseRejectionNoticeModel(
    String caseReferenceNo,
    String applicantName,
    String applicantMaskedIdentifier,
    String rejectionReasonDisplay,
    String decisionDateDisplay,
    String appealDeadlineDisplay,
    String officerDisplayName,
    String agencyName,
    String agencyContactEmail
) {}
```

### 6.2 Preformatted vs Raw Values

Ada dua strategi:

#### Strategy A — Raw Values + Template Formatting

```java
public record NoticeModel(
    LocalDate decisionDate,
    BigDecimal feeAmount,
    String applicantName
) {}
```

Template melakukan formatting:

```html
<span th:text="${#temporals.format(decisionDate, 'dd MMM yyyy')}"></span>
```

Kelebihan:

- fleksibel;
- locale-aware;
- template bisa memilih format.

Kekurangan:

- formatting tersebar;
- testing lebih kompleks;
- template lebih pintar.

#### Strategy B — Preformatted Display Values

```java
public record NoticeModel(
    String decisionDateDisplay,
    String feeAmountDisplay,
    String applicantName
) {}
```

Kelebihan:

- template sederhana;
- output lebih deterministic;
- cocok untuk dokumen legal.

Kekurangan:

- model builder lebih banyak kerja;
- perlu convention field display.

Rule of thumb:

| Output | Preferensi |
|---|---|
| Admin UI | raw + template formatting masih wajar |
| Email | hybrid |
| PDF/legal document | lebih sering preformatted |
| CSV/XML machine output | raw/typed values lebih cocok |
| Multi-locale notice | preformatted dengan locale eksplisit sering lebih aman |

### 6.3 Model Contract Descriptor

```java
public record TemplateModelContract(
    String modelName,
    String modelVersion,
    Set<FieldContract> fields,
    Set<String> allowedTemplates,
    Set<OutputKind> allowedOutputs
) {}

public record FieldContract(
    String path,
    FieldType type,
    boolean required,
    boolean sensitive,
    String description
) {}
```

Contoh field:

```text
caseReferenceNo             STRING   required=true   sensitive=false
applicantName               STRING   required=true   sensitive=true
applicantMaskedIdentifier   STRING   required=true   sensitive=true
appealDeadlineDisplay       STRING   required=true   sensitive=false
```

### 6.4 Model Validation Gate

Sebelum render:

```text
RenderRequest
  -> model contract lookup
  -> required field check
  -> forbidden field check
  -> sensitive field policy check
  -> collection size limit check
  -> output-specific model check
  -> render
```

Jangan menunggu template runtime error untuk menemukan model invalid.

---

## 7. Engine Selection: FreeMarker vs Thymeleaf

### 7.1 Rule of Thumb

| Use Case | Recommended Engine |
|---|---|
| Admin SSR HTML pages | Thymeleaf |
| Form binding with Spring MVC | Thymeleaf |
| Natural HTML prototype workflow | Thymeleaf |
| Email HTML body | FreeMarker or Thymeleaf |
| Email subject/plain text | FreeMarker often simpler |
| PDF HTML intermediate | FreeMarker or Thymeleaf |
| XML/text/config/code generation | FreeMarker |
| Highly controlled dynamic template platform | FreeMarker with strict wrapper/policy or restricted DSL |
| UI fragment/component system | Thymeleaf |
| Generic text artifact generation | FreeMarker |

### 7.2 Engine Adapter Interface

```java
public interface TemplateEngineAdapter {
    TemplateEngineKind kind();

    RenderedOutput render(
        ResolvedTemplate template,
        Object safeModel,
        RenderContext context
    ) throws TemplateRenderException;

    TemplateValidationResult validateTemplate(
        TemplateSource source,
        TemplatePolicy policy
    );
}
```

`FreeMarkerAdapter` dan `ThymeleafAdapter` mengimplementasikan kontrak yang sama.

Aplikasi tidak boleh memanggil engine langsung dari controller/job/consumer.

### 7.3 Why Adapter Matters

Adapter memberi boundary untuk:

- observability;
- error normalization;
- engine-specific configuration;
- future migration;
- multi-engine support;
- security policy enforcement;
- consistent audit event.

---

## 8. Security Architecture

### 8.1 Security Layers

```text
Layer 1: Template Author Authorization
Layer 2: Template Source Validation
Layer 3: Template Engine Policy
Layer 4: Object Exposure Policy
Layer 5: Model Redaction Policy
Layer 6: Output Escaping Policy
Layer 7: Output Validation
Layer 8: Audit and Monitoring
```

### 8.2 Trusted vs Untrusted Matrix

| Template Source | Data Source | Risk Level | Strategy |
|---|---:|---:|---|
| Developer-owned | Internal validated model | Low/Medium | normal engine config + tests |
| Developer-owned | User-generated data | Medium | strict escaping + sanitization |
| Admin-editable | Internal model | High | sandbox + allowlist + preview gate |
| Admin-editable | User-generated data | Very High | strict sandbox + no method exposure + output validation |
| Public user-editable | Any | Extreme | avoid full template engine; use constrained DSL |

### 8.3 FreeMarker Security Policy

FreeMarker policy baseline:

```java
Configuration cfg = new Configuration(Configuration.VERSION_2_3_34);
cfg.setDefaultEncoding("UTF-8");
cfg.setLocalizedLookup(false);
cfg.setLogTemplateExceptions(false);
cfg.setWrapUncheckedExceptions(true);
cfg.setTemplateExceptionHandler(TemplateExceptionHandler.RETHROW_HANDLER);
cfg.setOutputFormat(HTMLOutputFormat.INSTANCE);
cfg.setRecognizeStandardFileExtensions(true);
cfg.setAutoEscapingPolicy(Configuration.ENABLE_IF_SUPPORTED_AUTO_ESCAPING_POLICY);
```

For stricter HTML/email/PDF platform:

```java
cfg.setAutoEscapingPolicy(Configuration.FORCE_AUTO_ESCAPING_POLICY);
```

But forcing auto-escaping can break text templates. Therefore, configure per output kind.

Recommended split:

```text
FreeMarkerHtmlEngineConfig
FreeMarkerXmlEngineConfig
FreeMarkerTextEngineConfig
```

Do not use one global configuration for all output formats if policies differ significantly.

### 8.4 FreeMarker Object Exposure Rule

Hard rule:

```text
Never expose service, repository, EntityManager, DataSource, ApplicationContext,
SecurityContext, HttpServletRequest, HttpSession, Runtime, ClassLoader, File, Path,
or arbitrary domain aggregate to FreeMarker templates.
```

Expose only immutable DTO/view model.

### 8.5 Thymeleaf Security Policy

Baseline:

1. prefer `th:text` over `th:utext`;
2. avoid inline JavaScript with untrusted values;
3. never treat UI authorization as backend authorization;
4. never expose raw entity graph to model;
5. use CSRF protection for unsafe methods;
6. keep expression complexity low;
7. avoid dynamic expression construction from user input;
8. sanitize rich HTML before rendering;
9. test authorization fragments.

### 8.6 Output Context Rule

Escaping must match output context:

| Context | Risk | Strategy |
|---|---|---|
| HTML text node | XSS | HTML escape |
| HTML attribute | attribute injection | attribute-safe escaping |
| URL attribute | javascript/data URL injection | URL validation + encode |
| Inline JS string | JS injection | JS-string encode or avoid inline JS |
| Inline CSS | CSS injection | avoid or strict allowlist |
| Raw HTML | stored XSS | sanitize + trusted markup marker |
| XML | malformed XML / injection | XML escape |
| CSV | formula injection | CSV escaping + spreadsheet formula guard |

---

## 9. Rendering Pipeline Detail

### 9.1 Full Pipeline

```text
1. Receive render request
2. Assign correlation id
3. Validate basic request
4. Resolve template key
5. Resolve template version
6. Check template state
7. Check author/tenant/output policy
8. Resolve model contract
9. Validate model
10. Redact sensitive fields if needed
11. Build safe model map
12. Build render context
13. Select engine adapter
14. Start timer/span
15. Render with limits
16. Validate output
17. Compute output hash
18. Store output if needed
19. Emit audit event
20. Emit metrics
21. Return output/delivery reference
```

### 9.2 Pseudocode

```java
public RenderResult render(RenderRequest request) {
    String correlationId = correlation.ensure(request.correlationId());

    TemplateResolutionResult resolution = templateResolver.resolve(request.templateKey());
    TemplateVersion version = resolution.selected();

    policyGuard.assertRenderable(version, request);

    TemplateModelContract contract = modelContracts.find(
        request.modelName(),
        request.modelVersion()
    );

    ModelValidationResult modelValidation = modelValidator.validate(
        request.model(),
        contract,
        request.templateKey().outputKind()
    );

    if (!modelValidation.valid()) {
        throw RenderFailure.invalidModel(modelValidation.errors());
    }

    Object safeModel = modelSanitizer.toSafeModel(
        request.model(),
        contract,
        request.purpose()
    );

    RenderContext context = contextFactory.create(request, version);

    TemplateEngineAdapter adapter = adapters.get(version.engine());

    Timer.Sample sample = Timer.start(meterRegistry);

    try {
        RenderedOutput output = adapter.render(
            templateStore.load(version),
            safeModel,
            context
        );

        outputValidator.validate(output, version, request.purpose());

        RenderAudit audit = auditFactory.success(request, version, output, resolution);
        auditStore.append(audit);

        sample.stop(metrics.renderTimer(version, request));

        return RenderResult.success(output, audit.auditId());
    } catch (Exception ex) {
        RenderFailure failure = errorClassifier.classify(ex, request, version);
        auditStore.append(auditFactory.failure(request, version, failure));
        metrics.incrementFailure(failure);
        throw failure.toException();
    }
}
```

---

## 10. Error Taxonomy

Top 1% architecture tidak hanya punya `RuntimeException`.

### 10.1 Error Categories

```java
public enum RenderErrorCode {
    TEMPLATE_NOT_FOUND,
    TEMPLATE_NOT_ACTIVE,
    TEMPLATE_VERSION_CONFLICT,
    TEMPLATE_PARSE_ERROR,
    TEMPLATE_POLICY_VIOLATION,
    MODEL_CONTRACT_NOT_FOUND,
    MODEL_VALIDATION_FAILED,
    MODEL_UNSAFE_FIELD,
    ENGINE_RENDER_ERROR,
    OUTPUT_TOO_LARGE,
    OUTPUT_VALIDATION_FAILED,
    LOCALE_UNSUPPORTED,
    TIMEZONE_UNSUPPORTED,
    RENDER_TIMEOUT,
    STORAGE_FAILURE,
    DELIVERY_FAILURE,
    UNKNOWN
}
```

### 10.2 Why Classification Matters

| Error | Owner | Action |
|---|---|---|
| `TEMPLATE_NOT_FOUND` | Template/config owner | publish/restore template |
| `TEMPLATE_PARSE_ERROR` | Template author | fix syntax |
| `MODEL_VALIDATION_FAILED` | Application/model builder owner | fix data assembly |
| `TEMPLATE_POLICY_VIOLATION` | Security/platform owner | block unsafe feature |
| `OUTPUT_TOO_LARGE` | Business/platform owner | paginate, split document, adjust limit |
| `DELIVERY_FAILURE` | Email/storage/integration owner | retry/dlq |
| `RENDER_TIMEOUT` | Platform/template author | optimize template/model |

### 10.3 User-Facing vs Internal Error

Internal log:

```text
templateId=CASE_REJECTION_NOTICE
version=3.4.1
engine=FREEMARKER
line=42
column=17
error=MISSING_REQUIRED_FIELD
field=appealDeadlineDisplay
correlationId=...
```

User-facing message:

```text
The document could not be generated. Please contact support with reference ID ABC-123.
```

Never leak template source, stack trace, model values, or internal class names into user output.

---

## 11. Observability Design

### 11.1 Metrics

Minimum metrics:

```text
render.requests.total{engine,outputKind,templateId,tenant,result}
render.duration{engine,outputKind,templateId,tenant}
render.failures.total{engine,outputKind,errorCode}
template.resolution.fallback.total{templateId,tenant,locale}
template.cache.hit.total{engine}
template.cache.miss.total{engine}
render.output.bytes{outputKind,templateId}
render.model.validation.failures.total{modelName,modelVersion}
```

Be careful with cardinality.

Avoid labels like:

- case ID;
- user ID;
- email address;
- document ID;
- raw template path with version hash if too many;
- correlation ID.

### 11.2 Logs

Structured log fields:

```json
{
  "event": "template_render_failed",
  "correlationId": "...",
  "templateId": "CASE_REJECTION_NOTICE",
  "templateVersion": "3.4.1",
  "engine": "FREEMARKER",
  "outputKind": "PDF",
  "tenant": "CEA",
  "locale": "en-SG",
  "errorCode": "MODEL_VALIDATION_FAILED",
  "durationMs": 18
}
```

Do not log full model.

For debugging, log only:

- field paths;
- types;
- missing/invalid marker;
- redacted sample;
- correlation ID.

### 11.3 Tracing

Useful spans:

```text
render.resolve_template
render.validate_model
render.load_template_source
render.engine_render
render.validate_output
render.store_output
render.deliver_email
```

Attributes:

```text
engine
output.kind
template.id
template.version
tenant
locale
result
error.code
```

---

## 12. Testing and Release Gate

### 12.1 Test Pyramid for Templates

```text
                         Visual / E2E tests
                    Contract + integration tests
              Golden output + semantic output tests
        Unit tests for model builder and directives/dialects
 Static validation, linting, policy check, parse check
```

### 12.2 Required Tests per Template

For every production template:

1. parse test;
2. model contract test;
3. required fields test;
4. missing optional fields test;
5. escaping test;
6. locale test;
7. timezone test;
8. golden output test;
9. output size test;
10. security policy test;
11. preview sample test.

For email:

1. subject render test;
2. HTML body render test;
3. text body render test;
4. MIME structure test;
5. link validation;
6. no accidental production recipient test;
7. PII redaction test.

For PDF:

1. HTML intermediate test;
2. PDF generation test;
3. font/unicode test;
4. page break scenario;
5. long table scenario;
6. hash/audit metadata test.

For SSR UI:

1. controller model test;
2. authorization fragment test;
3. CSRF token presence;
4. validation error rendering;
5. pagination test;
6. accessibility smoke test;
7. XSS fixture test.

### 12.3 CI Gate

```text
On template change:
  - parse all changed templates
  - enforce naming convention
  - run policy scanner
  - run model contract tests
  - run golden output tests
  - run escaping tests
  - run locale matrix subset
  - generate preview artifacts
  - require approval for active template publication
```

---

## 13. Performance Architecture

### 13.1 Performance Budget

Define budget per output kind.

Example:

| Output Kind | p95 Render Budget | Notes |
|---|---:|---|
| Admin page | 100–300 ms total server-side path | includes DB and rendering |
| Email body | 10–50 ms render only | batch-safe |
| PDF intermediate HTML | 20–100 ms render only | PDF conversion separate |
| PDF conversion | 100 ms–several seconds | depends on complexity |
| CSV/text export | streaming preferred | avoid full in-memory string |

### 13.2 Common Bottlenecks

1. Template cache disabled in production.
2. Template loading from slow remote storage on every render.
3. Large object graph exposed to template.
4. Lazy loading triggered by template property access.
5. Huge list rendering in UI.
6. Inline formatting repeated thousands of times.
7. Macro/fragment explosion.
8. StringWriter accumulating huge output.
9. PDF renderer, not template engine, being actual bottleneck.
10. Logging model/output on error.

### 13.3 Performance Strategy

```text
Use template cache.
Use immutable engine configuration.
Use DTO/view model.
Precompute expensive values.
Paginate UI lists.
Stream large text outputs.
Separate template render benchmark from full business flow benchmark.
Measure allocation, not only wall time.
Use JFR for production-like profiling.
```

### 13.4 Virtual Threads Consideration

For Java 21+:

Virtual threads can help if rendering pipeline includes blocking I/O:

- load template source from storage;
- load sample data;
- write output to object storage;
- send email;
- call PDF service;
- wait on external delivery.

Virtual threads do not magically speed CPU-bound template evaluation.

Rule:

```text
Virtual threads help concurrency of blocking workflows.
They do not reduce CPU cost of rendering expressions/macros/fragments.
```

---

## 14. Storage and Audit Model

### 14.1 Template Storage

Tables/concepts:

```text
TEMPLATE
- template_id
- description
- owner_team
- default_engine
- default_output_kind
- created_at

TEMPLATE_VERSION
- template_id
- version
- tenant_id
- locale
- engine
- output_kind
- state
- effective_from
- effective_to
- content_hash
- source_location
- created_by
- created_at
- approved_by
- approved_at

TEMPLATE_DEPENDENCY
- template_id
- version
- depends_on_template_id
- depends_on_version_range
```

### 14.2 Render Audit

```text
RENDER_AUDIT
- audit_id
- correlation_id
- template_id
- template_version
- content_hash
- engine
- output_kind
- tenant_id
- locale
- timezone
- model_name
- model_version
- model_hash
- output_hash
- render_purpose
- rendered_by
- rendered_at
- result
- error_code
- fallback_used
```

Do not necessarily store full model if it contains sensitive data.

Options:

1. store full snapshot encrypted;
2. store redacted snapshot;
3. store model hash + source domain reference;
4. store rendered output only;
5. store both output and minimal provenance.

For legal/regulatory documents, prefer immutable output + enough metadata to prove how it was produced.

### 14.3 Output Storage

```text
OBJECT_STORAGE
- document_id
- audit_id
- output_kind
- mime_type
- storage_uri
- output_hash
- size_bytes
- retention_policy
- created_at
```

Immutability rules:

- document already issued should not be overwritten;
- new correction should create new document version;
- link old/new through correction metadata;
- deletion follows retention/legal policy.

---

## 15. Deployment Architecture

### 15.1 In-Process Library vs Dedicated Service

#### In-Process Library

```text
Application -> Rendering Library -> Engine
```

Good for:

- simple MVC pages;
- low governance;
- developer-owned templates;
- small system.

Risk:

- duplicated config across services;
- inconsistent policies;
- hard cross-system audit;
- harder template governance.

#### Dedicated Rendering Service

```text
Application -> Rendering Service -> Template Registry / Engine / Audit
```

Good for:

- multi-application correspondence;
- centralized governance;
- dynamic business templates;
- strict audit;
- multi-tenant platform.

Risk:

- network latency;
- service availability dependency;
- version compatibility;
- more operations complexity.

#### Hybrid

```text
UI SSR remains in application.
Email/document rendering centralized.
Shared library provides common model/policy contracts.
```

Often the best enterprise compromise.

### 15.2 Recommended Enterprise Split

```text
Application Service
  - SSR Thymeleaf pages local
  - builds domain events
  - builds view models for local pages

Rendering Platform Service
  - FreeMarker/Thymeleaf artifact rendering
  - email/PDF/document templates
  - template registry
  - approval workflow
  - audit store

Shared Contract Library
  - template ids
  - model records
  - validation annotations
  - output kinds
  - error codes
```

---

## 16. Code Structure Blueprint

```text
src/main/java/com/example/rendering
  api/
    RenderRequest.java
    RenderResult.java
    RenderContext.java
    TemplateKey.java
    OutputKind.java
    RenderPurpose.java

  registry/
    TemplateRegistry.java
    TemplateVersion.java
    TemplateResolver.java
    TemplateResolutionResult.java

  model/
    TemplateModelContract.java
    ModelValidator.java
    ModelSanitizer.java
    FieldContract.java

  engine/
    TemplateEngineAdapter.java
    freemarker/
      FreeMarkerTemplateEngineAdapter.java
      FreeMarkerConfigurationFactory.java
      SafeObjectWrapperFactory.java
    thymeleaf/
      ThymeleafTemplateEngineAdapter.java
      ThymeleafEngineFactory.java

  policy/
    TemplatePolicy.java
    PolicyGuard.java
    EscapingPolicy.java
    ObjectExposurePolicy.java
    RenderLimits.java

  audit/
    RenderAudit.java
    RenderAuditStore.java
    RenderAuditFactory.java

  metrics/
    RenderMetrics.java

  errors/
    RenderErrorCode.java
    TemplateRenderException.java
    ErrorClassifier.java

  delivery/
    EmailDeliveryService.java
    DocumentStorageService.java
    PdfGenerationService.java
```

---

## 17. ADR: Architecture Decision Record

### ADR-001: Rendering Access Goes Through Facade

Decision:

```text
Controllers, batch jobs, consumers, and workflow handlers must call RenderingFacade,
not FreeMarker/Thymeleaf directly.
```

Reason:

- consistent security;
- consistent metrics;
- consistent audit;
- easier migration;
- fewer ad-hoc configs.

Consequence:

- slightly more boilerplate;
- teams must define template ids and model contracts.

### ADR-002: View Model Must Be Explicit

Decision:

```text
Templates consume explicit DTO/view model records, not JPA entities or domain aggregates.
```

Reason:

- prevents data leakage;
- avoids lazy query surprises;
- stabilizes template contract;
- improves testing.

Consequence:

- mapping layer required;
- more types to maintain.

### ADR-003: Template Version Is Immutable After Activation

Decision:

```text
Once a template version becomes ACTIVE, its source content cannot be changed in-place.
```

Reason:

- audit defensibility;
- reproducibility;
- rollback clarity.

Consequence:

- every change creates new version;
- storage grows over time.

### ADR-004: Output Format Is Explicit

Decision:

```text
Every template has declared output kind and output format.
```

Reason:

- escaping depends on output context;
- prevents accidental HTML/text mismatch;
- improves validation.

Consequence:

- no generic “render anything” endpoint without policy.

### ADR-005: UI SSR and Artifact Rendering Have Different Policies

Decision:

```text
Thymeleaf MVC pages and FreeMarker/Thymeleaf artifact rendering use separate engine configurations.
```

Reason:

- UI needs fragments/forms/security dialect;
- artifact rendering needs versioning/audit/output storage;
- different performance and security risks.

---

## 18. Review Checklist

### 18.1 Template Design Checklist

- [ ] Template has clear `templateId`.
- [ ] Template has declared output kind.
- [ ] Template has declared engine.
- [ ] Template has owner team.
- [ ] Template has model contract.
- [ ] Template has test data.
- [ ] Template has locale strategy.
- [ ] Template has escaping strategy.
- [ ] Template avoids business logic.
- [ ] Template avoids service/repository access.
- [ ] Template handles missing optional fields.
- [ ] Template has golden output test.
- [ ] Template has XSS/security fixture test.
- [ ] Template has preview sample.

### 18.2 Model Checklist

- [ ] Model is not JPA entity.
- [ ] Model exposes only required fields.
- [ ] Sensitive fields are marked.
- [ ] Display fields are preformatted where needed.
- [ ] Locale/timezone are explicit.
- [ ] Collection sizes are bounded.
- [ ] Null policy is clear.
- [ ] Model version is explicit.

### 18.3 Security Checklist

- [ ] No raw domain aggregate exposure.
- [ ] No service/repository exposure.
- [ ] No `ApplicationContext` exposure.
- [ ] No request/session exposure unless wrapped safely.
- [ ] FreeMarker object wrapper is restricted.
- [ ] Dangerous FreeMarker features are blocked for dynamic templates.
- [ ] `th:utext` usage is reviewed.
- [ ] Inline JS variables are encoded or avoided.
- [ ] URL outputs are validated.
- [ ] Rich HTML is sanitized.
- [ ] CSRF exists for unsafe forms.
- [ ] UI authorization is backed by server authorization.

### 18.4 Performance Checklist

- [ ] Template cache enabled in production.
- [ ] Template source loading is not slow per render.
- [ ] Large outputs are streamed or bounded.
- [ ] UI lists are paginated.
- [ ] Model builder avoids N+1 queries.
- [ ] Expensive formatting is precomputed if repeated.
- [ ] Benchmark exists for hot templates.
- [ ] JFR profile exists for major rendering path.
- [ ] PDF conversion measured separately from template rendering.

### 18.5 Operations Checklist

- [ ] Render failures have error codes.
- [ ] Logs are structured.
- [ ] Logs do not leak full model or template source.
- [ ] Metrics include duration and failure count.
- [ ] Audit records include template version and hash.
- [ ] Rollback process exists.
- [ ] Preview process exists.
- [ ] DLQ/retry exists for async delivery.
- [ ] Runbook exists for rendering incidents.

---

## 19. Production Runbook

### 19.1 Incident: Template Render Failure Spike

Symptoms:

```text
render.failures.total increases
specific templateId affected
user reports document/email generation failure
```

Immediate triage:

1. Identify `templateId`, `version`, `tenant`, `locale`, `errorCode`.
2. Check if new template version was activated recently.
3. Check model validation errors.
4. Check missing field paths.
5. Compare with preview/golden test.
6. Roll back active template version if template issue.
7. Disable delivery if output is legally risky.
8. Reprocess failed async events after fix.

### 19.2 Incident: XSS/Suspicious Output

Immediate triage:

1. Identify affected template and output context.
2. Check raw HTML usage.
3. Check `th:utext`, `?no_esc`, unsafe markup output.
4. Check user-generated field source.
5. Disable template if needed.
6. Sanitize source data if stored XSS.
7. Patch template and add regression test.
8. Review policy scanner.

### 19.3 Incident: Rendering Latency Regression

Immediate triage:

1. Compare latency by template id/version.
2. Check template cache hit ratio.
3. Check model assembly DB query count.
4. Check output size.
5. Check list sizes.
6. Profile render path with JFR.
7. Separate template render time from PDF/email/storage time.
8. Roll back template if fragment/macro explosion caused regression.

### 19.4 Incident: Wrong Template Version Used

Immediate triage:

1. Check business time.
2. Check effective date window.
3. Check tenant fallback.
4. Check locale fallback.
5. Check active version overlap.
6. Fix template registry data.
7. Re-render only if policy allows.
8. Create correction record if already issued.

---

## 20. Advanced Failure Modelling

### 20.1 Render Before Commit vs After Commit

Rendering inside transaction:

```text
Pros:
- sees consistent in-transaction state
- can fail whole operation

Cons:
- template/PDF/email latency holds DB transaction
- external delivery inside transaction is dangerous
- rollback may not undo email already sent
```

Rendering after commit:

```text
Pros:
- avoids long DB transaction
- integrates with outbox/event flow
- delivery retry easier

Cons:
- data must be snapshotted or reproducible
- eventual consistency
- user may wait for async artifact
```

Recommended:

```text
For legal/email/document side effects:
  transaction commits domain event + outbox
  renderer consumes after commit
  renderer uses immutable snapshot or stable domain reference
```

For MVC UI:

```text
render within request, but avoid side effects
```

### 20.2 Re-render Policy

Not all artifacts can be re-rendered.

| Artifact | Re-render Allowed? | Notes |
|---|---|---|
| Admin page | yes | transient UI |
| Email preview | yes | not official |
| Sent email | usually no | store sent MIME/body |
| Legal PDF notice | usually no in-place | issue correction/version |
| Report export | depends | if data snapshot exists, yes |
| Audit document | no mutation | preserve original |

Rule:

```text
If the artifact has legal/evidential meaning, preserve rendered output.
Do not rely only on ability to re-render later.
```

---

## 21. Java 8–25 Considerations

### 21.1 Java 8 Baseline

If supporting Java 8:

- use `java.time` where possible;
- avoid records unless separate module/profile;
- use POJO DTOs instead of records;
- no virtual threads;
- no modern switch expression;
- use classic executor model.

### 21.2 Java 11/17 Baseline

For Java 11/17:

- better runtime baseline for Spring Boot 2/3 transition;
- `var` local variable available since Java 10;
- records available since Java 16;
- sealed classes since Java 17;
- stronger container/JVM improvements.

### 21.3 Java 21+

For Java 21+:

- records are excellent for view models;
- sealed interfaces are good for render result/error hierarchy;
- virtual threads can simplify blocking delivery pipelines;
- pattern matching improves error handling code;
- structured concurrency may help orchestrate render + storage + delivery workflows where available.

### 21.4 Java 25

For Java 25-era systems:

- keep architecture stable across LTS/non-LTS runtime changes;
- do not tie template correctness to preview/incubator language features;
- use modern JVM profiling and observability;
- prefer immutable data models;
- use explicit locale/timezone/charset everywhere.

---

## 22. Final Architecture Example

### 22.1 Use Case

A case transitions to `REJECTED`.

System must:

1. generate rejection notice PDF;
2. send email to applicant;
3. store generated artifacts;
4. audit template version and model hash;
5. allow officer to preview before sending if manual workflow;
6. use tenant-specific template if available;
7. fall back to global template if not;
8. support English and Malay;
9. prevent leaking internal rejection notes.

### 22.2 Event

```java
public record CaseRejectedEvent(
    String caseId,
    String caseReferenceNo,
    String tenantId,
    String applicantId,
    Instant rejectedAt,
    String rejectionReasonCode,
    String officerId
) {}
```

### 22.3 Model Builder

```java
public final class CaseRejectionNoticeModelBuilder {

    public CaseRejectionNoticeModel build(
        CaseRejectedEvent event,
        Locale locale,
        ZoneId zoneId
    ) {
        // Load domain data explicitly.
        // Apply authorization/redaction here.
        // Format legal display values here where needed.
        // Do not pass entity to template.

        return new CaseRejectionNoticeModel(
            event.caseReferenceNo(),
            applicantDisplayName(event.applicantId()),
            maskedIdentifier(event.applicantId()),
            rejectionReasonDisplay(event.rejectionReasonCode(), locale),
            formatDate(event.rejectedAt(), locale, zoneId),
            formatDate(calculateAppealDeadline(event.rejectedAt()), locale, zoneId),
            officerDisplayName(event.officerId()),
            agencyName(event.tenantId()),
            agencyContactEmail(event.tenantId())
        );
    }
}
```

### 22.4 Rendering

```java
RenderRequest pdfHtmlRequest = new RenderRequest(
    new TemplateKey(
        "CASE_REJECTION_NOTICE",
        OutputKind.PDF_HTML_INTERMEDIATE,
        event.tenantId(),
        locale,
        event.rejectedAt()
    ),
    "CaseRejectionNoticeModel",
    "1.0",
    model,
    RenderPurpose.PDF_HTML_INTERMEDIATE,
    correlationId,
    "system",
    false
);

RenderedOutput html = renderingFacade.render(pdfHtmlRequest).output();
PdfDocument pdf = pdfService.convert(html);
documentStore.store(pdf);
```

### 22.5 Audit

```text
caseId=...
templateId=CASE_REJECTION_NOTICE
templateVersion=3.4.1
contentHash=sha256:...
modelName=CaseRejectionNoticeModel
modelVersion=1.0
modelHash=sha256:...
outputHash=sha256:...
locale=en-SG
timezone=Asia/Singapore
renderedAt=...
issuedAt=event.rejectedAt
```

---

## 23. What Separates Top 1% Template Engineering from Average Usage

Average usage:

```text
I know how to put ${name} into an HTML/email template.
```

Strong engineer:

```text
I know how to configure FreeMarker/Thymeleaf safely and render outputs.
```

Top 1% engineer:

```text
I can design a rendering subsystem where templates are versioned artifacts,
view models are contracts, output contexts are explicit, rendering is observable,
security boundaries are enforced before execution, failures are classified,
and every generated artifact can be explained, tested, reproduced, audited,
and operated safely in production.
```

Top 1% thinking is less about memorizing syntax and more about maintaining invariants.

Core invariants:

1. A template must not receive data it should not know.
2. A template must not execute business operations.
3. A template must not silently choose security policy.
4. A rendered legal artifact must be traceable to exact template and data version.
5. Rendering errors must identify owner and recovery path.
6. Output format must drive escaping.
7. Locale/timezone must be explicit.
8. Template version must be immutable after activation.
9. Dynamic templates require sandboxing and governance.
10. Performance must be measured by output kind and use case, not assumed.

---

## 24. Final Learning Map After This Series

After completing this series, the natural next advanced topics are:

1. **HTML-to-PDF deep engineering**
   - CSS paged media;
   - fonts;
   - accessibility;
   - signatures;
   - legal document reproducibility.

2. **Enterprise correspondence platform design**
   - template CMS;
   - approval workflow;
   - evidence store;
   - delivery audit;
   - multi-channel notification.

3. **Spring MVC SSR architecture**
   - advanced form flows;
   - server-side component systems;
   - htmx/Alpine-style hybrid SSR;
   - progressive enhancement.

4. **Secure dynamic scripting/DSL design**
   - sandboxing;
   - policy languages;
   - expression evaluators;
   - rule engine integration.

5. **Document lifecycle and digital evidence engineering**
   - immutable documents;
   - WORM storage;
   - hash chains;
   - retention;
   - legal defensibility.

6. **Performance and JVM profiling for rendering workloads**
   - JFR;
   - allocation profiling;
   - concurrency model;
   - template cache internals;
   - PDF conversion bottlenecks.

---

## 25. References

- Apache FreeMarker Manual — Configuration, Template Loading, ObjectWrapper, Output Format, Auto-Escaping, Directives, Error Handling: https://freemarker.apache.org/docs/
- Apache FreeMarker API — `Configuration`: https://freemarker.apache.org/docs/api/freemarker/template/Configuration.html
- Thymeleaf 3.1 Documentation — Using Thymeleaf: https://www.thymeleaf.org/doc/tutorials/3.1/usingthymeleaf.html
- Thymeleaf + Spring Documentation: https://www.thymeleaf.org/doc/tutorials/3.1/thymeleafspring.html
- Spring Framework View Technologies — Thymeleaf: https://docs.spring.io/spring-framework/reference/web/webmvc-view/mvc-thymeleaf.html
- Spring Framework View Technologies — FreeMarker: https://docs.spring.io/spring-framework/reference/web/webmvc-view/mvc-freemarker.html
- Micrometer Timers: https://docs.micrometer.io/micrometer/reference/concepts/timers.html
- OWASP XSS Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
- OWASP Web Security Testing Guide — Server-Side Template Injection: https://owasp.org/www-project-web-security-testing-guide/
- OpenJDK JMH: https://openjdk.org/projects/code-tools/jmh/
- Java SE 25 Documentation: https://docs.oracle.com/en/java/javase/25/

---

## 26. Status Seri

```text
Part 34 selesai.
Seri learn-java-template-freemarker-thymeleaf-rendering-engineering selesai.
Ini adalah bagian terakhir dari seri ini.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-033.md">⬅️ Part 33 — World Blueprint III: Rule/State-Based Document Rendering for Case Management</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<span></span>
</div>
