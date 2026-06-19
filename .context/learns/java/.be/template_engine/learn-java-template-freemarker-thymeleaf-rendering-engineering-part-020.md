# learn-java-template-freemarker-thymeleaf-rendering-engineering — Part 20
# Document Generation: HTML-to-PDF, DOCX, XML, CSV, and Text Outputs

> Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`  
> Part: `020`  
> Topik: Document generation dengan Java template engine  
> Fokus: HTML-to-PDF, DOCX, XML, CSV, fixed-width text, config/source generation, reproducibility, auditability, dan production failure model  
> Target Java: Java 8 sampai Java 25

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas email template engineering. Email adalah contoh artifact yang dirender dari template, tetapi email masih dekat dengan HTML/text communication.

Part ini melangkah lebih jauh: template engine dipakai sebagai bagian dari **document generation pipeline**.

Dokumen yang dimaksud bukan hanya PDF. Dalam sistem enterprise, regulatory system, workflow system, case management, finance, insurance, banking, public sector, procurement, dan compliance platform, document generation dapat mencakup:

1. HTML page yang kemudian dikonversi menjadi PDF.
2. PDF final untuk notice, approval letter, rejection letter, warning letter, invoice, statement, certificate, atau decision document.
3. DOCX sebagai editable document.
4. XML sebagai machine-readable artifact.
5. CSV untuk export/reporting.
6. Fixed-width text untuk legacy integration.
7. Plain text untuk notification, legal extract, command file, atau audit artifact.
8. Configuration file generation.
9. Source code generation.
10. Evidence bundle generation.

Mental model penting:

```text
Template engine does not magically generate documents.
Template engine generates an intermediate representation or text artifact.
Document generation is a pipeline around that rendered output.
```

FreeMarker dan Thymeleaf sangat kuat untuk menghasilkan teks terstruktur. Namun PDF, DOCX, CSV, dan XML memiliki aturan sendiri. Engineer top-tier harus tahu batas antara:

```text
Template Engine
    vs
Document Format Engine
    vs
Rendering Pipeline
    vs
Artifact Lifecycle
    vs
Audit / Reproducibility Model
```

Kalau batas ini kabur, sistem biasanya menjadi rapuh: PDF berubah tanpa jejak, template tidak kompatibel dengan data lama, dokumen legal tidak bisa direproduksi, output rusak karena escaping salah, atau batch document generation menyebabkan memory spike.

---

## 1. Core Mental Model: Document Generation adalah Transformation Pipeline

Document generation harus dipahami sebagai pipeline deterministik:

```text
Domain/Event/Request
        |
        v
Data Collection
        |
        v
Presentation Model / Document Model
        |
        v
Template Selection
        |
        v
Template Rendering
        |
        v
Intermediate Artifact
        |
        v
Format Conversion / Post Processing
        |
        v
Final Artifact
        |
        v
Storage / Delivery / Audit
```

Contoh untuk PDF letter:

```text
CaseApprovedEvent
        |
        v
Collect case, applicant, decision, officer, agency, template metadata
        |
        v
ApprovalLetterModel
        |
        v
approval-letter.en-SG.v3.ftlh
        |
        v
HTML string / stream
        |
        v
HTML-to-PDF renderer
        |
        v
PDF bytes
        |
        v
Object storage + checksum + audit trail + delivery
```

Contoh untuk CSV export:

```text
ReportRequest
        |
        v
Query paginated records
        |
        v
CSV row model stream
        |
        v
CSV writer / template row renderer
        |
        v
CSV bytes
        |
        v
Download response / storage / audit
```

Contoh untuk DOCX:

```text
DocumentDraftRequest
        |
        v
DocumentDraftModel
        |
        v
DOCX template package
        |
        v
Placeholder replacement / content control binding
        |
        v
Generated DOCX
        |
        v
User edits / approval workflow
```

The invariant:

```text
Final artifact quality depends more on the pipeline boundary than on template syntax.
```

---

## 2. Template Engine vs Document Engine

A template engine answers:

```text
Given template + data model, how do I generate text/markup?
```

A document engine answers:

```text
Given structured document representation, how do I create/edit/save a document format?
```

A PDF renderer answers:

```text
Given HTML/CSS or drawing commands, how do I paginate, layout, embed fonts, and produce PDF bytes?
```

A CSV writer answers:

```text
Given fields/rows, how do I serialize them safely according to CSV rules?
```

A DOCX library answers:

```text
Given an OpenXML package, how do I manipulate paragraphs, runs, tables, styles, headers, footers, relationships, and embedded media?
```

Therefore:

```text
FreeMarker/Thymeleaf can render HTML/XML/text.
They do not by themselves solve pagination, DOCX packaging, PDF fonts, CSV escaping, or legal reproducibility.
```

That separation gives us a cleaner architecture:

```text
Template Engine Adapter
    - FreeMarkerRenderer
    - ThymeleafRenderer

Document Conversion Adapter
    - HtmlToPdfConverter
    - DocxGenerator
    - CsvExporter
    - XmlArtifactWriter

Artifact Service
    - stores bytes
    - computes checksum
    - records metadata
    - enforces retention
    - emits audit event
```

---

## 3. Taxonomy of Generated Artifacts

Different artifacts have different failure modes.

| Artifact | Primary Concern | Good Tool Shape | Common Mistake |
|---|---|---|---|
| HTML | Escaping, layout, browser compatibility | Thymeleaf/FreeMarker | Inline business logic in template |
| PDF | Pagination, fonts, immutable artifact | HTML-to-PDF or PDF API | Assuming browser CSS equals PDF CSS |
| DOCX | Editability, Word layout, OpenXML structure | docx4j/POI-style library | Treating DOCX as simple text file |
| XML | Schema correctness, escaping, namespaces | XML writer or XML template with strict validation | String concatenation without XML validation |
| CSV | Delimiter/quote/newline correctness | CSV writer | Manual join with comma |
| Fixed-width text | byte/char alignment, encoding | explicit formatter | Assuming character count equals byte count |
| Config files | syntax correctness, secrets handling | template + parser validation | generating invalid config at deploy time |
| Source code | formatting, compileability | codegen template + compiler/test check | generating code without validation |

Top-level rule:

```text
Use template engine to express stable text structure.
Use format-specific library/validator to enforce format semantics.
```

---

## 4. HTML-to-PDF Pipeline

HTML-to-PDF is the most common pattern for enterprise document generation because HTML is easy to template, preview, and style.

Typical pipeline:

```text
DocumentModel
    -> FreeMarker/Thymeleaf HTML template
    -> XHTML/HTML string or stream
    -> HTML-to-PDF renderer
    -> PDF bytes
    -> artifact storage
```

### 4.1 Why HTML-to-PDF is Popular

Advantages:

1. HTML is familiar.
2. Templates can be previewed in browser.
3. CSS allows layout reuse.
4. Same model can sometimes render preview and PDF.
5. Works well for letters, notices, invoices, statements, and reports.

But there is a trap:

```text
HTML-to-PDF rendering is not the same as browser rendering.
```

Many PDF renderers implement a subset of HTML/CSS. Some support CSS 2.1 well, some support partial CSS3, some require XHTML-like input, some have limitations around flexbox/grid, page breaks, fonts, and images.

### 4.2 Recommended Pipeline Shape

```java
public interface DocumentRenderer<M> {
    RenderedDocument render(M model, DocumentRenderOptions options);
}

public record DocumentRenderOptions(
        Locale locale,
        ZoneId zoneId,
        String templateId,
        String templateVersion,
        OutputFormat outputFormat
) {}

public enum OutputFormat {
    HTML_PREVIEW,
    PDF
}

public record RenderedDocument(
        byte[] bytes,
        String mediaType,
        String filename,
        String checksumSha256,
        Map<String, String> metadata
) {}
```

Separate stages:

```java
public interface HtmlTemplateRenderer<M> {
    String renderHtml(String templateName, M model, Locale locale, ZoneId zoneId);
}

public interface HtmlToPdfConverter {
    byte[] convert(String html, PdfConversionOptions options);
}
```

Do not mix:

```text
Controller
  -> template string hacks
  -> PDF library directly
  -> manual file write
  -> email send
```

That produces untestable logic.

### 4.3 HTML Template Requirements for PDF

HTML for PDF should be stricter than regular web HTML.

Recommended properties:

1. Valid HTML or XHTML-like structure.
2. Explicit charset.
3. Embedded or resolvable CSS.
4. Predictable fonts.
5. Absolute or controlled resource paths.
6. No external uncontrolled network fetches during conversion.
7. No runtime JavaScript dependency.
8. Explicit page size/margins.
9. Tested page breaks.
10. Stable table rendering.

Example skeleton:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Approval Letter</title>
  <style>
    @page {
      size: A4;
      margin: 20mm 18mm 20mm 18mm;
    }

    body {
      font-family: "Noto Sans", sans-serif;
      font-size: 11pt;
      line-height: 1.45;
    }

    .page-break {
      page-break-before: always;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    th, td {
      border: 1px solid #333;
      padding: 4px 6px;
    }
  </style>
</head>
<body>
  <header>
    <h1>Approval Letter</h1>
  </header>

  <main>
    <!-- rendered content -->
  </main>
</body>
</html>
```

### 4.4 Page Breaks

PDF is paginated. HTML is scroll-based. This mismatch creates many bugs.

Common issues:

1. Table row split unexpectedly.
2. Header/footer not repeated.
3. Signature block split from signatory name.
4. Section heading appears alone at bottom of page.
5. Long unbroken text overflows.
6. Image exceeds page width.

Design rule:

```text
Pagination is a first-class requirement, not a final CSS tweak.
```

Model your document around sections:

```java
public record DocumentSection(
        String title,
        List<DocumentParagraph> paragraphs,
        boolean pageBreakBefore,
        boolean keepTogether
) {}
```

Then template can express pagination hints:

```html
<section class="section ${section.pageBreakBefore()?string('page-break','')} ${section.keepTogether()?string('keep-together','')}">
  <h2>${section.title}</h2>
  <#list section.paragraphs as paragraph>
    <p>${paragraph.text}</p>
  </#list>
</section>
```

CSS:

```css
.keep-together {
  page-break-inside: avoid;
}
```

### 4.5 Fonts and Unicode

PDF generation often fails silently around fonts.

Problems:

1. Missing glyphs for non-Latin characters.
2. Different rendering between environments.
3. Font not embedded.
4. Bold/italic variant missing.
5. Container image missing OS font package.

Production rule:

```text
Document rendering must control its fonts explicitly.
```

Do not rely on whatever fonts happen to exist on the server.

Recommended:

1. Package approved fonts with the application or document-renderer image.
2. Register fonts explicitly in PDF converter.
3. Test representative languages.
4. Include font version in document-rendering metadata.
5. Avoid using fonts with unclear licensing.

### 4.6 Images and Static Resources

PDF renderer must resolve image paths.

Bad:

```html
<img src="/assets/logo.png">
```

This assumes a web server context.

Better:

```text
Template resolves image through controlled resource resolver.
```

Possible approaches:

1. Embed image as base64 data URI for small stable assets.
2. Use classpath resource resolver.
3. Use signed internal URL with controlled timeout.
4. Preload image bytes and pass as rendering resource.

For highly regulated documents, prefer controlled classpath or storage-resolved resources over arbitrary HTTP fetch.

### 4.7 HTML-to-PDF Failure Model

Failure classes:

| Failure | Example | Recovery |
|---|---|---|
| Template error | missing variable | fail render, log model contract error |
| Invalid HTML | unclosed tags, malformed XML mode | fail validation before conversion |
| Unsupported CSS | layout wrong | visual regression / PDF preview test |
| Font missing | tofu boxes | fail environment readiness check |
| Resource missing | logo absent | fail render or use approved fallback |
| Converter crash | malformed input/bug | retry only if transient; otherwise quarantine |
| Memory spike | large table | pagination/chunking, limit output size |

Do not blindly retry deterministic rendering errors. A missing variable will not become valid on retry.

---

## 5. FreeMarker for Document HTML

FreeMarker is excellent for document generation when output is text-like and layout logic is explicit.

Use FreeMarker when:

1. You need strict template control.
2. Output is not necessarily web page.
3. You generate HTML, XML, text, CSV-like lines, config, or source.
4. You want macro libraries for document sections.
5. Designers do not need natural HTML preview as much.
6. You need powerful template composition.

Example file naming:

```text
approval-letter.ftlh    # HTML output format + escaping
case-export.ftlx        # XML output format + escaping
legacy-message.ftl      # plain text output
```

FreeMarker-specific recommendation:

```text
Use .ftlh for HTML document templates.
Use .ftlx for XML document templates.
Avoid generic .ftl for HTML unless output format is configured explicitly.
```

### 5.1 FreeMarker Document Layout Example

```ftl
<#-- approval-letter.ftlh -->
<#import "document-layout.ftlh" as layout>
<#import "components.ftlh" as c>

<@layout.document title="Approval Letter" locale=locale>
  <@c.letterHeader agency=agency />

  <p>Dear ${recipient.displayName},</p>

  <p>
    We are pleased to inform you that your application
    <strong>${application.referenceNo}</strong>
    has been approved on ${decision.approvedDate}.
  </p>

  <@c.decisionSummary decision=decision />

  <@c.signatureBlock signatory=signatory />
</@layout.document>
```

Macro library:

```ftl
<#-- components.ftlh -->
<#macro letterHeader agency>
  <div class="letter-header">
    <img src="${agency.logoDataUri}" alt="${agency.name} logo" />
    <h1>${agency.name}</h1>
  </div>
</#macro>

<#macro signatureBlock signatory>
  <div class="signature-block">
    <p>Yours sincerely,</p>
    <p class="signatory-name">${signatory.name}</p>
    <p>${signatory.designation}</p>
  </div>
</#macro>
```

### 5.2 FreeMarker Document Model

Do not pass entities.

Bad:

```java
model.put("case", caseEntity);
model.put("application", applicationEntity);
model.put("user", userEntity);
```

Better:

```java
public record ApprovalLetterModel(
        AgencyView agency,
        RecipientView recipient,
        ApplicationView application,
        DecisionView decision,
        SignatoryView signatory,
        Locale locale,
        ZoneId zoneId,
        DocumentMetadata metadata
) {}
```

Why?

1. Entity may expose fields template should not see.
2. Lazy loading can cause hidden DB queries during rendering.
3. Entity changes can break old templates.
4. Template becomes coupled to persistence model.
5. Security redaction is harder.

### 5.3 FreeMarker XML Generation

FreeMarker can generate XML, but XML must be validated.

Template:

```ftl
<#ftl output_format="XML" auto_esc=true>
<CaseDecision xmlns="urn:example:case-decision:v1">
  <ReferenceNo>${case.referenceNo}</ReferenceNo>
  <Decision>${decision.type}</Decision>
  <DecisionDate>${decision.date}</DecisionDate>
</CaseDecision>
```

Pipeline:

```text
Render XML
    -> parse XML
    -> validate against XSD if applicable
    -> canonicalize if needed
    -> store/send
```

Do not trust generated XML until it has been parsed and validated.

---

## 6. Thymeleaf for Document HTML

Thymeleaf is excellent when the intermediate artifact is HTML and natural-template preview matters.

Use Thymeleaf when:

1. Designers need to open the template as HTML.
2. The template resembles web page/layout structure.
3. You already use Spring MVC/Thymeleaf.
4. You want fragment-based HTML components.
5. You use message bundles and Spring integration.

Example:

```html
<!doctype html>
<html lang="en" xmlns:th="http://www.thymeleaf.org">
<head>
  <meta charset="UTF-8" />
  <title th:text="${documentTitle}">Approval Letter</title>
</head>
<body>
  <header th:replace="~{fragments/letter :: header(${agency})}"></header>

  <main>
    <p>
      Dear <span th:text="${recipient.displayName}">Recipient Name</span>,
    </p>

    <p>
      Your application
      <strong th:text="${application.referenceNo}">APP-0001</strong>
      has been approved.
    </p>
  </main>
</body>
</html>
```

Natural template benefit:

```text
The file remains meaningful as static HTML before runtime processing.
```

That is useful for:

1. Designer workflow.
2. Preview tooling.
3. Visual regression fixtures.
4. Faster feedback for layout changes.

But Thymeleaf is still not a PDF renderer. It renders HTML. PDF correctness still depends on the conversion pipeline.

---

## 7. DOCX Generation

DOCX is not plain text. It is an OpenXML package, essentially a ZIP package containing XML parts, relationships, media, styles, numbering, headers, footers, and document metadata.

Mental model:

```text
DOCX generation is structured package manipulation, not string replacement in a .docx file.
```

Common approaches:

1. DOCX template with placeholders.
2. Content controls / structured document tags.
3. Programmatic document building.
4. Convert HTML to DOCX.
5. Generate DOCX first, then convert to PDF.

Each has trade-offs.

### 7.1 DOCX Template with Placeholders

A business user creates a `.docx` template:

```text
Dear ${recipientName},

Your application ${referenceNo} has been approved.
```

Then Java replaces placeholders.

This sounds simple but has hidden problems:

1. Word may split placeholder text across multiple runs.
2. Formatting can split `${referenceNo}` into multiple XML nodes.
3. Placeholder replacement can break styles.
4. Tables/repeating sections are harder.
5. Conditional blocks are awkward.

### 7.2 Content Controls

Content controls are more structured. They allow tagged parts of a Word document to be bound or replaced.

Better for:

1. Business-editable templates.
2. Repeating tables.
3. Named fields.
4. Structured authoring.

But they require more knowledge of WordprocessingML/OpenXML.

### 7.3 DOCX as Draft vs Final Artifact

DOCX is editable. PDF is usually treated as final.

Ask:

```text
Is the document meant to be edited after generation?
```

If yes, DOCX may be suitable.

If no, PDF is usually better.

Enterprise pattern:

```text
DOCX draft
    -> human review/edit
    -> approval
    -> final PDF snapshot
    -> immutable storage
```

### 7.4 DOCX Failure Model

| Failure | Cause | Mitigation |
|---|---|---|
| Placeholder not replaced | split runs or typo | template linting |
| Formatting lost | replacement destroys run structure | structured replacement |
| Repeating table malformed | wrong row clone logic | table-specific tests |
| Header/footer missing data | only body processed | process all parts |
| PDF conversion mismatch | Word layout dependency | approved conversion engine |
| Template edited incorrectly | business user changed control tags | validation before publish |

---

## 8. XML Generation

XML generation has two styles:

1. Template-based XML.
2. API-based XML writer/marshaller.

Use template-based XML when:

1. Structure is simple and stable.
2. Human readability matters.
3. Template owner needs control over exact layout.
4. You validate output rigorously.

Use XML writer/marshaller when:

1. Schema is complex.
2. Namespaces are non-trivial.
3. You need strong typing.
4. You need canonicalization/signature.
5. Output is integration-critical.

### 8.1 XML Escaping

XML special characters:

```text
<  -> &lt;
>  -> &gt; in some contexts
&  -> &amp;
"  -> &quot; in attributes
'  -> &apos; in attributes
```

Template engine can escape these if XML output mode is configured.

But XML correctness also includes:

1. Single root element.
2. Namespace correctness.
3. Attribute uniqueness.
4. Schema compliance.
5. Character encoding.
6. Valid characters.
7. Element order.

Escaping alone is not enough.

### 8.2 XML Validation Pipeline

```java
public final class XmlArtifactValidator {
    public void validate(byte[] xmlBytes, Schema schema) {
        // 1. parse with secure XML parser settings
        // 2. validate against XSD
        // 3. fail fast with line/column diagnostics
    }
}
```

Pipeline:

```text
Render XML template
    -> secure parse
    -> XSD validation
    -> optional canonicalization
    -> optional signature
    -> store/send
```

### 8.3 Do Not Generate Security-Sensitive XML Casually

For SAML, signed XML, regulatory submission XML, payment XML, or digitally signed artifacts, prefer specialized libraries and strict canonicalization. Template engines can help with non-sensitive wrapper content, but signature-sensitive XML often requires exact canonical form.

---

## 9. CSV Generation

CSV looks simple but is full of edge cases.

Bad:

```java
String line = name + "," + email + "," + comment;
```

This breaks when fields contain:

1. Comma.
2. Quote.
3. Newline.
4. Carriage return.
5. Leading/trailing spaces.
6. Formula injection payload.
7. Different delimiter conventions.

### 9.1 CSV Escaping Rules

Common CSV rules:

1. Field containing comma, quote, CR, or LF must be quoted.
2. Quote inside quoted field is doubled.
3. Rows end with consistent line ending.
4. Charset should be explicit.

Example:

```text
Name,Comment
Alice,"Hello, world"
Bob,"He said ""Yes"""
Charlie,"Line 1
Line 2"
```

### 9.2 Formula Injection

Spreadsheet applications can execute formulas from CSV cells.

Dangerous leading characters often include:

```text
= + - @ tab carriage-return
```

Example malicious field:

```text
=HYPERLINK("http://attacker", "click")
```

Mitigation depends on business context:

1. Prefix dangerous cells with apostrophe.
2. Escape/sanitize fields intended for spreadsheet opening.
3. Provide warning in exported file metadata/UI.
4. Use XLSX with typed cells if appropriate.
5. Treat CSV export as outbound data boundary.

### 9.3 Template Engine for CSV?

Use template engine for CSV only when the CSV structure is fixed and simple.

For large exports, prefer streaming CSV writer.

Bad for large data:

```text
Load 1 million rows into model
Render one huge template
Return String
```

Better:

```text
Stream rows from DB page/cursor
Write CSV row-by-row to OutputStream
Flush periodically
```

Template can still help with header/footer metadata, but row serialization should usually use a CSV library or strict writer.

---

## 10. Fixed-Width Text Generation

Fixed-width files appear in banking, government integration, mainframe bridges, payroll, clearing systems, and legacy batch processes.

Example:

```text
HDR20260619AGENCY001          
DTL000001JOHN TAN       000012500
DTL000002SITI AMINAH    000009900
TRL0000020000022400
```

Key difficulty:

```text
Character width is not always byte width.
```

If integration spec says field length is 20 bytes, Java `String.length()` is not enough, especially with UTF-8 and non-ASCII characters.

### 10.1 Fixed-Width Field Specification

Represent the spec explicitly:

```java
public enum Align {
    LEFT,
    RIGHT
}

public record FixedFieldSpec(
        String name,
        int length,
        Align align,
        char padChar,
        Charset charset,
        boolean truncateAllowed
) {}
```

Then build deterministic formatter:

```java
public final class FixedWidthFormatter {
    public String format(String value, FixedFieldSpec spec) {
        // validate byte length or char length based on spec
        // pad left/right
        // reject if overflow unless truncate is explicitly allowed
        return value;
    }
}
```

Do not hide fixed-width logic in template expressions. Keep it in Java, then pass preformatted fields to template or writer.

### 10.2 Failure Model

| Failure | Cause | Mitigation |
|---|---|---|
| Wrong byte length | UTF-8/non-ASCII | byte-aware validation |
| Silent truncation | naive substring | explicit truncate policy |
| Wrong numeric padding | manual formatting | field specs |
| Wrong line ending | OS-dependent newline | fixed CRLF/LF config |
| Invalid file total | trailer mismatch | compute totals from emitted records |

---

## 11. Plain Text Documents

Plain text is still important.

Examples:

1. Text email alternative.
2. SMS body.
3. Notification body.
4. Legal extract.
5. CLI output.
6. Audit detail export.
7. Human-readable evidence summary.

Plain text has its own constraints:

1. Line width.
2. Newline convention.
3. Encoding.
4. Whitespace control.
5. Wrapping behavior.
6. Alignment.
7. No visual emphasis except text conventions.

FreeMarker is often excellent for text output because it has strong whitespace and macro capabilities.

Example:

```ftl
Decision Notice
===============

Reference No : ${referenceNo}
Applicant    : ${applicantName}
Decision     : ${decisionStatus}
Decision Date: ${decisionDate}

<#if remarks?has_content>
Remarks:
${remarks}
</#if>
```

For plain text, test output exactly. Whitespace matters.

---

## 12. Config File Generation

Template engines are frequently used to generate:

1. Nginx config.
2. Kubernetes YAML.
3. application.properties.
4. Terraform variables.
5. SQL scripts.
6. Shell scripts.
7. INI files.
8. JSON config.
9. XML config.

This is useful, but dangerous.

### 12.1 Config Generation Risk

Config output can affect production infrastructure. A single escaping or indentation error can break deployment.

Risks:

1. Invalid YAML indentation.
2. Unescaped shell values.
3. Secret leaked into generated file.
4. Wrong environment variable interpolation.
5. Invalid JSON due to manual comma logic.
6. Insecure config generated by default.

### 12.2 Safer Pattern

```text
Template render
    -> parse generated config
    -> validate schema/rules
    -> dry-run if possible
    -> produce artifact
```

For JSON/YAML, consider generating from typed structures instead of text template when possible.

Bad:

```ftl
{
  "name": "${name}",
  "enabled": ${enabled?string("true", "false")}
}
```

Better when data is complex:

```text
Build typed object
    -> serialize using JSON/YAML library
```

Template is more appropriate for config formats with strong human layout needs and limited variables.

---

## 13. Source Code Generation

Template engines can generate Java, TypeScript, SQL, OpenAPI snippets, clients, DTOs, mappers, and boilerplate.

However, source code generation must be treated like compiler engineering.

Pipeline:

```text
Schema/Model
    -> codegen model
    -> template render
    -> formatter
    -> compile/typecheck/test
    -> publish/generated source
```

Rules:

1. Generated code must be clearly marked.
2. Do not edit generated code manually.
3. Generator version must be recorded.
4. Input schema version must be recorded.
5. Generated code must compile in CI.
6. Generated code should be formatted.
7. Avoid generating code with runtime secrets.
8. Use deterministic ordering.

Example header:

```java
// -----------------------------------------------------------------------------
// <auto-generated>
// Generated by case-client-codegen 2.4.1
// Source schema: case-api-openapi.yaml sha256:...
// Generated at: 2026-06-19T00:00:00Z
// Do not edit manually.
// </auto-generated>
// -----------------------------------------------------------------------------
```

Determinism matters. If generator produces different output for same input, diff noise destroys maintainability.

---

## 14. Reproducibility and Legal Defensibility

For regulatory/case-management documents, the key question is not only:

```text
Can we generate the document now?
```

The better question is:

```text
Can we prove what was generated, from which data, using which template version, at which time, under which rules?
```

### 14.1 Immutable Render Record

A serious document system records:

```java
public record DocumentRenderRecord(
        String documentId,
        String documentType,
        String templateId,
        String templateVersion,
        String modelSchemaVersion,
        String modelSnapshotHash,
        String outputSha256,
        String outputMediaType,
        Instant renderedAt,
        String renderedBy,
        Locale locale,
        ZoneId zoneId,
        String rendererVersion,
        Map<String, String> environmentMetadata
) {}
```

Minimum metadata:

1. Template ID.
2. Template version.
3. Data/model snapshot or hash.
4. Render timestamp.
5. Renderer version.
6. Output checksum.
7. Locale/timezone.
8. User/system actor.
9. Document type.
10. Storage location.

### 14.2 Snapshot vs Re-render

There are two models:

#### Model A — Store Final Artifact

```text
Generate once
Store PDF/DOCX bytes
Return same bytes forever
```

Pros:

1. Strong reproducibility.
2. No dependency on old template/data behavior.
3. Good for legal records.

Cons:

1. Storage cost.
2. Retention management.
3. Data privacy concerns.

#### Model B — Re-render on Demand

```text
Store data/template reference
Generate again when requested
```

Pros:

1. Lower storage.
2. Can apply updated layout.
3. Useful for non-final previews.

Cons:

1. Output may change.
2. Old templates may be unavailable.
3. Data may have changed.
4. Legal defensibility weaker.

For final legal/regulatory documents:

```text
Store the final artifact.
Do not depend on re-rendering as proof.
```

You may also store the model snapshot for explainability, subject to privacy and retention rules.

### 14.3 Effective-Date Template Selection

Template selection often depends on time.

Example:

```text
If decision date < 2026-01-01 -> use template v2
If decision date >= 2026-01-01 -> use template v3
```

Do not select based only on current time during rendering.

Better:

```java
TemplateRef selectTemplate(DocumentType type, LocalDate businessEffectiveDate, Locale locale, TenantId tenantId);
```

This protects historical correctness.

---

## 15. Document Storage and Checksum

Generated documents should be stored with integrity metadata.

Pipeline:

```text
PDF bytes
    -> compute SHA-256
    -> store immutable object
    -> record object key + checksum
    -> verify read-after-write if required
```

Example:

```java
public record StoredArtifact(
        String artifactId,
        String storageKey,
        String mediaType,
        long sizeBytes,
        String sha256
) {}
```

Why checksum?

1. Detect corruption.
2. Prove exact bytes generated.
3. Support audit comparison.
4. Prevent accidental overwrite ambiguity.
5. Enable content-addressable storage strategies.

Storage policy:

1. Immutable final artifacts.
2. Versioned bucket/container if using object storage.
3. Server-side encryption.
4. Access logging.
5. Retention lifecycle.
6. Legal hold if needed.
7. Deletion policy aligned with privacy/regulation.

---

## 16. Streaming vs In-Memory Rendering

Document generation can be memory-heavy.

Bad pattern:

```text
Large dataset
    -> List of 1,000,000 records
    -> giant model
    -> StringWriter
    -> huge String
    -> getBytes()
    -> PDF/CSV bytes
```

This duplicates memory multiple times.

Better options:

1. Stream CSV rows directly to `OutputStream`.
2. Page data for large reports.
3. Generate multiple files and zip them.
4. Use temporary files for large artifacts.
5. Put hard limits on document size.
6. Split huge PDFs into sections.
7. Queue async generation for expensive artifacts.

### 16.1 StringWriter Cost

`StringWriter` stores characters in memory. Converting to bytes creates another copy. For large outputs, this matters.

For small/medium letters, it is fine.

For large reports, avoid it.

Decision heuristic:

| Output Size | Approach |
|---|---|
| < 1 MB | StringWriter acceptable |
| 1–20 MB | measure; consider streaming/temp file |
| > 20 MB | avoid full in-memory string where possible |
| Huge tabular export | streaming writer |

---

## 17. Synchronous vs Asynchronous Generation

Not all documents should be generated inside a user request.

Synchronous is acceptable when:

1. Document is small.
2. Rendering is fast and predictable.
3. User needs immediate preview.
4. Failure can be shown directly.

Asynchronous is better when:

1. Document is large.
2. It requires many data sources.
3. It involves PDF conversion.
4. It is batch-generated.
5. It may take seconds/minutes.
6. It should be retried/quarantined.
7. It must not hold web request threads.

Async pipeline:

```text
User requests document
    -> create DocumentJob
    -> enqueue job
    -> worker renders
    -> stores artifact
    -> marks job completed/failed
    -> user downloads when ready
```

Job states:

```text
REQUESTED
VALIDATING
RENDERING_TEMPLATE
CONVERTING
STORING
COMPLETED
FAILED_RETRYABLE
FAILED_PERMANENT
CANCELLED
```

This state model matters for operations.

---

## 18. Failure Classification

Document generation failures should be classified, not just logged as `Exception`.

Suggested taxonomy:

```java
public enum DocumentFailureType {
    TEMPLATE_NOT_FOUND,
    TEMPLATE_PARSE_ERROR,
    TEMPLATE_MODEL_CONTRACT_ERROR,
    TEMPLATE_RENDER_ERROR,
    INVALID_INTERMEDIATE_OUTPUT,
    CONVERSION_ERROR,
    RESOURCE_RESOLUTION_ERROR,
    OUTPUT_VALIDATION_ERROR,
    STORAGE_ERROR,
    PERMISSION_ERROR,
    TIMEOUT,
    SIZE_LIMIT_EXCEEDED,
    UNKNOWN
}
```

Retry rules:

| Failure | Retry? | Reason |
|---|---:|---|
| Template not found | No | deterministic config/content issue |
| Missing variable | No | model contract issue |
| Invalid XML | No | deterministic template/model issue |
| PDF converter timeout | Maybe | depends on load/input size |
| Storage transient error | Yes | infrastructure issue |
| Resource temporary unavailable | Maybe | depends on resource policy |
| Size limit exceeded | No | input/policy violation |

Do not retry permanent failures. You only increase load.

---

## 19. Security Concerns in Document Generation

Document generation touches sensitive data and outbound artifacts.

Security concerns:

1. XSS in HTML preview.
2. HTML injection in PDF content.
3. Server-side template injection if templates are user-editable.
4. Path traversal when resolving images/templates.
5. SSRF if PDF converter fetches remote URLs.
6. Secret leakage in generated config/source.
7. PII overexposure in export files.
8. CSV formula injection.
9. Insecure document download authorization.
10. Storing documents without encryption/retention rules.
11. Audit log leaking rendered content.
12. Template editor privilege escalation.

### 19.1 Resource Resolution Safety

Do not let templates fetch arbitrary resources.

Bad:

```html
<img src="${userProvidedImageUrl}">
```

PDF converter may fetch it server-side.

Better:

```text
User uploads image
    -> virus scan / validation
    -> store controlled object
    -> renderer accesses by internal resource id
```

### 19.2 Download Authorization

Document generation often creates files stored outside normal application rows. Authorization must be enforced on download too.

Bad:

```text
GET /documents/{storageKey}
```

Better:

```text
GET /cases/{caseId}/documents/{documentId}
    -> verify user can access case
    -> verify document belongs to case
    -> issue controlled download
```

---

## 20. Testing Generated Documents

Testing document generation requires multiple layers.

### 20.1 Template Contract Test

Ensure model satisfies template.

```text
Given sample ApprovalLetterModel
When rendering approval-letter v3
Then rendering succeeds with no missing variable
```

### 20.2 Golden Master Test

Store expected output for deterministic text/HTML/XML.

```text
Render with fixed clock/locale/timezone
Compare normalized output with approved fixture
```

Normalize carefully:

1. Timestamps.
2. Whitespace if irrelevant.
3. Generated IDs.
4. Environment-specific paths.

### 20.3 XML Validation Test

```text
Render XML
Parse XML
Validate against XSD
Assert canonical values
```

### 20.4 CSV Test

Test:

1. Comma field.
2. Quote field.
3. Newline field.
4. Empty field.
5. Null field.
6. Formula injection field.
7. Unicode field.
8. Large row count.

### 20.5 PDF Test

PDF testing is harder.

Possible checks:

1. PDF file exists and opens.
2. Text extraction contains expected values.
3. Page count expected.
4. Metadata expected.
5. No missing fonts/glyph warnings.
6. Visual regression for critical templates.
7. Manual approval for layout changes.

Do not rely only on text extraction for legal layout correctness.

### 20.6 DOCX Test

Test:

1. DOCX package opens.
2. Expected text exists.
3. Placeholders are fully replaced.
4. Header/footer processed.
5. Tables generated correctly.
6. Word validation if available.
7. Conversion to PDF if part of workflow.

---

## 21. Observability for Document Rendering

Metrics:

1. Render count by document type/template version.
2. Render latency.
3. Conversion latency.
4. Storage latency.
5. Failure count by failure type.
6. Output size distribution.
7. Page count distribution for PDF.
8. Queue wait time for async jobs.
9. Retry count.
10. Template cache hit/miss if available.

Logs should include:

1. Correlation ID.
2. Job ID.
3. Document ID.
4. Template ID/version.
5. Failure type.
6. Line/column for template errors when available.
7. Output size.
8. Duration.

Logs should not include:

1. Full rendered document.
2. Full model with PII.
3. Secrets.
4. Access tokens.
5. Sensitive case narrative.

Trace span model:

```text
DocumentGeneration
  ├── collect-model
  ├── select-template
  ├── render-template
  ├── validate-intermediate
  ├── convert-to-pdf
  ├── compute-checksum
  └── store-artifact
```

---

## 22. Java 8–25 Considerations

The core principles are stable across Java 8–25, but runtime capabilities differ.

### 22.1 Java 8 Baseline

Available:

1. `java.time` exists.
2. Streams exist.
3. CompletableFuture exists.
4. NIO.2 exists.
5. Most template/document libraries support or historically supported Java 8.

Limitations:

1. No records.
2. No text blocks.
3. No virtual threads.
4. Less ergonomic immutable model creation.

### 22.2 Java 11+

Useful additions:

1. Better container awareness compared with early Java 8 builds.
2. `HttpClient` if fetching controlled resources.
3. Long-term support ecosystem.

### 22.3 Java 15+

Text blocks help test fixtures and template snippets:

```java
String expected = """
        Decision Notice
        ===============
        Reference No : APP-001
        """;
```

Useful for tests, not necessarily for production templates.

### 22.4 Java 16+

Records are excellent for document models:

```java
public record DecisionSummaryView(
        String referenceNo,
        String decisionLabel,
        String decisionDateText
) {}
```

### 22.5 Java 21+

Virtual threads can help with blocking document jobs, especially if a job waits on storage, database, or remote services. But virtual threads do not make CPU-heavy PDF conversion free.

Rule:

```text
Virtual threads help blocking concurrency.
They do not remove CPU, memory, or library thread-safety constraints.
```

### 22.6 Java 25

For this series, Java 25 is treated as the modern upper-bound runtime. Design should remain compatible in concept, but code examples will avoid requiring preview features.

---

## 23. Production Architecture Blueprint

A robust document generation subsystem:

```text
                 +-------------------+
Request/Event -->| Document Facade    |
                 +---------+---------+
                           |
                           v
                 +-------------------+
                 | Authorization     |
                 +---------+---------+
                           |
                           v
                 +-------------------+
                 | Template Selector |
                 +---------+---------+
                           |
                           v
                 +-------------------+
                 | Model Builder     |
                 +---------+---------+
                           |
                           v
                 +-------------------+
                 | Model Validator   |
                 +---------+---------+
                           |
                           v
                 +-------------------+
                 | Template Renderer |
                 +---------+---------+
                           |
                           v
                 +-------------------+
                 | Output Validator  |
                 +---------+---------+
                           |
                           v
                 +-------------------+
                 | Converter         |
                 +---------+---------+
                           |
                           v
                 +-------------------+
                 | Artifact Store    |
                 +---------+---------+
                           |
                           v
                 +-------------------+
                 | Audit Trail       |
                 +-------------------+
```

### 23.1 Suggested Package Structure

```text
com.example.document
  DocumentGenerationFacade.java
  DocumentGenerationService.java
  DocumentRequest.java
  DocumentResult.java

com.example.document.template
  TemplateSelector.java
  TemplateRef.java
  TemplateMetadata.java
  TemplateRenderer.java
  FreeMarkerDocumentRenderer.java
  ThymeleafDocumentRenderer.java

com.example.document.model
  DocumentModel.java
  ApprovalLetterModel.java
  RejectionLetterModel.java
  ModelValidator.java

com.example.document.convert
  HtmlToPdfConverter.java
  PdfConversionOptions.java
  DocxGenerator.java
  CsvExporter.java

com.example.document.storage
  ArtifactStore.java
  StoredArtifact.java
  ChecksumService.java

com.example.document.audit
  DocumentRenderRecord.java
  DocumentAuditService.java

com.example.document.job
  DocumentJob.java
  DocumentJobStatus.java
  DocumentWorker.java
```

### 23.2 Core Interface

```java
public interface DocumentGenerationService {
    DocumentResult generate(DocumentRequest request);
}

public record DocumentRequest(
        String documentType,
        String businessReferenceId,
        Locale locale,
        ZoneId zoneId,
        OutputFormat outputFormat,
        Instant businessEffectiveAt,
        String requestedBy
) {}

public record DocumentResult(
        String documentId,
        String mediaType,
        String filename,
        long sizeBytes,
        String sha256,
        URI downloadUri
) {}
```

### 23.3 Generation Flow

```java
public final class DefaultDocumentGenerationService implements DocumentGenerationService {

    private final TemplateSelector templateSelector;
    private final DocumentModelBuilderRegistry modelBuilders;
    private final ModelValidator modelValidator;
    private final TemplateRenderer templateRenderer;
    private final DocumentConverterRegistry converters;
    private final ArtifactStore artifactStore;
    private final DocumentAuditService auditService;

    @Override
    public DocumentResult generate(DocumentRequest request) {
        TemplateRef template = templateSelector.select(
                request.documentType(),
                request.businessEffectiveAt(),
                request.locale()
        );

        DocumentModel model = modelBuilders.build(request, template);
        modelValidator.validate(model, template);

        RenderedIntermediate intermediate = templateRenderer.render(template, model, request);
        ConvertedArtifact artifact = converters.convert(intermediate, request.outputFormat());

        StoredArtifact stored = artifactStore.store(artifact);

        auditService.record(request, template, model, artifact, stored);

        return new DocumentResult(
                stored.artifactId(),
                stored.mediaType(),
                stored.filename(),
                stored.sizeBytes(),
                stored.sha256(),
                stored.downloadUri()
        );
    }
}
```

---

## 24. Document Model Design

Good document model properties:

1. Immutable.
2. Explicit.
3. Already authorized/redacted.
4. Already localized where necessary.
5. No lazy-loading entities.
6. No service/repository references.
7. No hidden DB access.
8. Stable schema version.
9. Nullable fields documented.
10. Validated before rendering.

Example:

```java
public record ApprovalLetterModel(
        String schemaVersion,
        AgencyBlock agency,
        RecipientBlock recipient,
        ApplicationBlock application,
        DecisionBlock decision,
        SignatureBlock signature,
        DocumentMetadata metadata
) implements DocumentModel {}
```

Do not expose:

```java
public class ApprovalLetterModel {
    public CaseEntity caseEntity;
    public UserEntity userEntity;
    public ApplicationService applicationService;
}
```

That is not a model. That is a leak.

---

## 25. Document Template Versioning

Template versioning is not optional for serious document systems.

Version metadata:

```text
template_id: approval-letter
template_version: 3.2.0
locale: en-SG
status: ACTIVE
effective_from: 2026-01-01
effective_to: null
model_schema: approval-letter-model.v2
renderer: freemarker-html-pdf
```

Template lifecycle:

```text
DRAFT
    -> REVIEWED
    -> APPROVED
    -> ACTIVE
    -> RETIRED
```

Do not let production rendering use arbitrary draft templates.

### 25.1 Compatibility

A template version should declare required model schema.

Example:

```text
approval-letter.v3.ftlh requires ApprovalLetterModel schema v2
```

Before activating a template:

1. Render sample model.
2. Render edge-case model.
3. Validate output.
4. Run security lint.
5. Run visual regression if PDF/HTML.
6. Approve by owner.

---

## 26. Common Anti-Patterns

### 26.1 “Just Generate a PDF in the Controller”

Bad because:

1. No versioning.
2. No testable pipeline.
3. No audit metadata.
4. No failure classification.
5. No reuse.

### 26.2 Passing Entity Graphs to Template

Bad because:

1. Hidden lazy load.
2. Security leakage.
3. Schema instability.
4. Coupling to persistence.

### 26.3 Treating PDF as Styling Afterthought

Bad because:

1. Pagination is core.
2. Fonts are core.
3. Layout is core.
4. Browser preview may lie.

### 26.4 Manual CSV Concatenation

Bad because:

1. Escaping breaks.
2. Spreadsheet injection risk.
3. Newline handling breaks.

### 26.5 Re-rendering Legal Documents Without Snapshot

Bad because:

1. Template may change.
2. Data may change.
3. Formatter may change.
4. Runtime may change.
5. Result may not match original.

### 26.6 User-Editable Templates Without Sandbox

Bad because:

1. SSTI risk.
2. Data exfiltration risk.
3. Resource exhaustion risk.
4. Privilege escalation risk.

---

## 27. Decision Matrix

| Need | Recommended Approach |
|---|---|
| HTML preview + PDF final | Thymeleaf/FreeMarker -> HTML -> PDF converter |
| Highly structured XML integration | XML writer/marshaller; template only if simple |
| Large CSV export | Streaming CSV writer |
| Small fixed text notice | FreeMarker text template |
| Large fixed-width integration file | Java formatter + streaming writer |
| Editable business document | DOCX template + docx library |
| Final legal artifact | PDF stored immutably with checksum |
| Code generation | Template + formatter + compile/test |
| Config generation | Template + parser/schema validation |
| User-editable templates | sandbox + allowlisted model + approval workflow |

---

## 28. Practical Checklist

Before generating a document in production, ask:

1. What is the final artifact type?
2. Is it preview, draft, or final legal artifact?
3. Is it editable after generation?
4. Which template version is used?
5. Which data/model schema is used?
6. Is model snapshot required?
7. Is output stored immutably?
8. Is checksum recorded?
9. Is locale/timezone explicit?
10. Are fonts controlled?
11. Are images/resources controlled?
12. Is HTML/XML/CSV escaping correct?
13. Is output validated after rendering?
14. Is failure classified?
15. Is retry policy correct?
16. Is document download authorized?
17. Is sensitive data redacted in logs?
18. Is generation observable?
19. Is there a golden-output test?
20. Is there a rollback plan for template changes?

---

## 29. Minimal Production Design Summary

A production-grade document generation subsystem should have:

1. Typed document request.
2. Template selector with version/effective-date logic.
3. Explicit immutable document model.
4. Model validation.
5. Template renderer abstraction.
6. Format-specific converter/writer.
7. Output validation.
8. Artifact storage.
9. Checksum.
10. Audit record.
11. Failure classification.
12. Observability.
13. Security controls.
14. Test suite.
15. Template governance.

The important shift:

```text
Do not think: “I need to generate a PDF.”
Think: “I need a reproducible, governed, validated artifact generation pipeline.”
```

That is the top-tier engineering lens.

---

## 30. Summary

Document generation is one of the places where template engineering becomes enterprise engineering.

FreeMarker and Thymeleaf can render excellent intermediate artifacts, especially HTML, XML, and text. But PDF, DOCX, CSV, fixed-width text, source code, and configuration files each have their own rules.

The engineer’s job is to design a pipeline where:

1. Template selection is explicit.
2. Data model is controlled.
3. Rendering is deterministic.
4. Conversion is format-aware.
5. Output is validated.
6. Artifact is stored with integrity metadata.
7. Security is enforced.
8. Failures are classified.
9. Documents are auditable and reproducible.

For regulatory and case-management systems, this is especially important. A generated document is not just UI output. It may become evidence, a legal communication, a decision record, or a compliance artifact.

---

## 31. What Comes Next

Part berikutnya:

```text
Part 21 — Internationalization, Localization, Locale, Timezone, and Formatting
```

Kita akan membahas bagaimana rendering berubah ketika bahasa, negara, timezone, number format, currency, pluralization, dan effective-date semantics masuk ke sistem template.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-019.md">⬅️ Part 19 — Email Template Engineering with FreeMarker and Thymeleaf</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-021.md">Part 21 — Internationalization, Localization, Locale, Timezone, and Formatting ➡️</a>
</div>
