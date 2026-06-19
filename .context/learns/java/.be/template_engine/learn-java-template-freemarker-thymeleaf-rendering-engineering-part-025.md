# learn-java-template-freemarker-thymeleaf-rendering-engineering — Part 25
# Testing Strategy for Template Systems

> Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`  
> Part: `025`  
> Topik: Testing strategy untuk FreeMarker, Thymeleaf, email template, document rendering, template security, contract stability, visual regression, dan CI quality gate  
> Target: Java 8 sampai Java 25  
> Status: Lanjutan dari Part 24 — Template Security Beyond XSS

---

## 1. Tujuan Part Ini

Pada part sebelumnya, kita membahas threat model template: XSS, SSTI, sandbox, object exposure, data leakage, dan resource abuse. Setelah threat model dipahami, langkah berikutnya adalah menjadikan template system sebagai bagian dari engineering discipline yang bisa diuji.

Part ini bertujuan membangun strategi testing yang komprehensif untuk sistem template Java berbasis FreeMarker dan Thymeleaf.

Setelah menyelesaikan part ini, kita ingin memiliki kemampuan untuk:

1. Menganggap template sebagai artifact software yang wajib dites, bukan file teks pasif.
2. Mendesain test pyramid khusus template rendering.
3. Menulis unit test renderer untuk FreeMarker dan Thymeleaf.
4. Membuat golden master/snapshot test tanpa membuat test rapuh.
5. Memvalidasi HTML/XML/email/PDF/document output.
6. Menguji escaping, XSS safety, dan output-context correctness.
7. Menguji contract antara template dan data model.
8. Menguji locale, timezone, number/date formatting, dan fallback message.
9. Menguji form rendering dan validation error untuk Thymeleaf.
10. Menguji fragment/macro/component library.
11. Membuat linting/static analysis untuk template.
12. Membuat CI quality gate untuk perubahan template.
13. Mendesain test data factory dan deterministic rendering harness.
14. Memahami kapan cukup unit test, kapan perlu integration test, dan kapan perlu visual regression.

---

## 2. Core Thesis: Template Output Adalah Public Contract

Kesalahan umum dalam banyak tim adalah memperlakukan template sebagai “view file” yang cukup diuji manual lewat browser atau email preview. Ini lemah untuk sistem production.

Template output sering menjadi:

1. halaman HTML yang dilihat user,
2. email legal/operasional,
3. PDF pemberitahuan,
4. surat approval/rejection,
5. notifikasi workflow,
6. generated config,
7. XML/CSV untuk integrasi,
8. dokumen audit/regulatory.

Dalam semua kasus itu, output template adalah contract.

Contract tersebut bisa gagal karena:

1. field hilang,
2. format berubah,
3. locale salah,
4. timezone salah,
5. escaping salah,
6. link salah,
7. permission rendering salah,
8. fragment tidak kompatibel,
9. template version mismatch,
10. data model berubah tanpa template diupdate,
11. template diupdate tanpa regression test,
12. CSS/email client behavior berubah,
13. HTML-to-PDF pipeline memecah layout,
14. hidden field membocorkan data sensitif,
15. user input dirender sebagai HTML aktif.

Jadi mental model-nya:

```text
Template file bukan hanya presentation.
Template file adalah transformation contract.

Input  : template id + version + render context + data model + locale + timezone
Process: template engine + resolver + escaping + formatter + macro/fragment library
Output : HTML/email/text/XML/CSV/PDF-pre-render artifact

Semua elemen itu harus bisa diuji.
```

Top 1% engineer tidak hanya bertanya:

> “Apakah halaman/email ini terlihat benar?”

Tetapi bertanya:

> “Invariant apa yang harus selalu benar untuk setiap output, setiap locale, setiap role, setiap tenant, setiap template version, dan setiap state workflow?”

---

## 3. Testing Template Tidak Sama dengan Testing Controller

Controller test menjawab:

1. route bisa dipanggil,
2. status HTTP benar,
3. model attribute ada,
4. view name benar,
5. redirect benar,
6. validation error dikembalikan.

Template test menjawab hal lain:

1. field model benar-benar dikonsumsi template,
2. output HTML/text/XML benar,
3. escaping benar,
4. fragment/macro compatible,
5. locale/timezone formatting benar,
6. missing variable gagal dengan jelas,
7. forbidden construct tidak digunakan,
8. output tidak membocorkan data,
9. template masih renderable setelah library fragment berubah,
10. output snapshot tidak berubah tanpa review.

Keduanya berbeda. Dalam sistem matang, kita butuh dua-duanya.

---

## 4. Template Testing Pyramid

Testing strategy yang baik harus berlapis. Jangan semua diuji dengan browser end-to-end. Itu lambat, rapuh, dan mahal. Jangan juga hanya unit test string kecil. Itu tidak menangkap integrasi nyata.

Pyramid yang disarankan:

```text
                 ┌─────────────────────────────┐
                 │ E2E / Browser / Email Client │
                 │ Visual / PDF Regression      │
                 └──────────────▲──────────────┘
                                │ sedikit
                 ┌──────────────┴──────────────┐
                 │ Integration Rendering Tests  │
                 │ MVC / Mail / Document        │
                 └──────────────▲──────────────┘
                                │ sedang
                 ┌──────────────┴──────────────┐
                 │ Contract + Golden Tests      │
                 │ Template + ViewModel         │
                 └──────────────▲──────────────┘
                                │ banyak
                 ┌──────────────┴──────────────┐
                 │ Unit Renderer Tests          │
                 │ Macro / Fragment / Escaping  │
                 └─────────────────────────────┘
```

Interpretasi:

| Layer | Tujuan | Jumlah | Kecepatan | Contoh |
|---|---:|---:|---:|---|
| Unit renderer test | Render satu template/macro/fragment dengan model kecil | Banyak | Cepat | FreeMarker render HTML email body |
| Contract test | Template requirements vs ViewModel | Banyak | Cepat-sedang | Semua required fields tersedia |
| Golden/snapshot test | Mendeteksi perubahan output tidak disengaja | Sedang | Sedang | Generated email HTML dibanding baseline |
| Integration test | Resolver, i18n, Spring MVC/Mail config | Sedang | Sedang | MockMvc returns rendered page |
| Security test | Escaping, forbidden construct, SSTI guard | Banyak | Cepat-sedang | `<script>` tidak menjadi executable markup |
| Visual/PDF regression | Layout dan rendering final | Sedikit | Lambat | PDF diff, screenshot diff |
| E2E | User journey lengkap | Sedikit | Lambat | Submit form lalu lihat confirmation page |

---

## 5. Invariant yang Harus Diuji

Sebelum menulis test, tentukan invariant. Template testing tanpa invariant biasanya berubah menjadi brittle string comparison.

### 5.1 Invariant struktural

Contoh:

1. output HTML harus valid secara minimal,
2. form harus memiliki CSRF token,
3. table harus memiliki header tertentu,
4. email harus punya subject, plain text body, HTML body,
5. PDF source HTML harus memiliki title/legal footer,
6. XML harus sesuai schema,
7. CSV harus punya header stabil.

### 5.2 Invariant data

Contoh:

1. application number muncul di email,
2. recipient name muncul dengan escaping,
3. approval date memakai timezone user/agency,
4. amount memakai currency locale,
5. rejected reason muncul hanya untuk rejection template,
6. internal notes tidak muncul ke public email.

### 5.3 Invariant security

Contoh:

1. user input tidak menjadi raw HTML,
2. script payload di-escape,
3. unsafe URL tidak muncul sebagai href aktif,
4. hidden field tidak berisi field sensitif,
5. role unauthorized tidak melihat action button,
6. template tidak bisa memanggil object/service berbahaya,
7. error output tidak membocorkan stack trace.

### 5.4 Invariant compatibility

Contoh:

1. template v1 masih render dengan ViewModel v1,
2. template v2 compatible dengan macro library v2,
3. tenant override tetap memiliki required fragment,
4. semua locale bundle memiliki key yang dibutuhkan,
5. semua template published bisa preflight render.

### 5.5 Invariant observability

Contoh:

1. render failure menghasilkan classification yang tepat,
2. template id/version muncul di log/metric,
3. sensitive model field tidak masuk log,
4. render latency metric tercatat.

---

## 6. Deterministic Rendering Harness

Testing template membutuhkan rendering yang deterministic. Jika tidak, snapshot test akan sering false positive.

Render output bisa berubah karena:

1. current time,
2. system default locale,
3. system default timezone,
4. random id,
5. unordered map iteration,
6. generated CSRF token,
7. asset fingerprint,
8. template cache state,
9. whitespace normalization,
10. JVM-specific formatting behavior,
11. environment-specific path/URL.

Solusinya adalah membuat `RenderingTestHarness`.

Secara konseptual:

```java
public final class RenderingTestHarness {
    private final Clock clock;
    private final Locale locale;
    private final ZoneId zoneId;
    private final TemplateRenderer renderer;

    public RenderingTestHarness(
            Clock clock,
            Locale locale,
            ZoneId zoneId,
            TemplateRenderer renderer
    ) {
        this.clock = clock;
        this.locale = locale;
        this.zoneId = zoneId;
        this.renderer = renderer;
    }

    public RenderedOutput render(String templateId, Object model) {
        RenderContext context = RenderContext.builder()
                .templateId(templateId)
                .locale(locale)
                .zoneId(zoneId)
                .clock(clock)
                .build();

        return renderer.render(context, model);
    }
}
```

Prinsipnya:

```text
Jangan test dengan system clock.
Jangan test dengan default locale.
Jangan test dengan default timezone.
Jangan test dengan random unordered model.
```

Gunakan:

```java
Clock fixedClock = Clock.fixed(
    Instant.parse("2026-06-19T04:00:00Z"),
    ZoneOffset.UTC
);

Locale locale = Locale.US;
ZoneId zoneId = ZoneId.of("Asia/Singapore");
```

Untuk Java 8–25, prinsip ini tetap sama karena `java.time.Clock`, `Locale`, dan `ZoneId` sudah tersedia sejak Java 8.

---

## 7. Test Data Factory untuk Template

Template test tidak boleh bergantung pada entity/database penuh. Buat test data factory khusus rendering.

Contoh buruk:

```java
ApplicationEntity app = applicationRepository.findById(id).get();
String html = renderer.render("approval-email", app);
```

Masalah:

1. test lambat,
2. butuh database,
3. template melihat entity terlalu dalam,
4. output berubah jika entity mapping berubah,
5. tidak jelas field apa yang diperlukan template.

Contoh lebih baik:

```java
ApprovalEmailViewModel model = ApprovalEmailViewModelFixture.validApprovedApplication()
        .withApplicantName("Alice <script>alert(1)</script>")
        .withApplicationNo("APP-2026-0001")
        .withApprovedAt(Instant.parse("2026-06-19T02:30:00Z"))
        .build();

String html = renderer.render("email/approval.ftlh", model);
```

Fixture harus mendukung variasi:

1. happy path,
2. missing optional field,
3. long text,
4. special characters,
5. malicious input,
6. empty list,
7. large list,
8. multiple locale,
9. multiple tenant,
10. role-specific rendering.

Contoh factory:

```java
public final class ApprovalEmailViewModelFixture {

    public static Builder validApprovedApplication() {
        return new Builder()
                .applicationNo("APP-2026-0001")
                .applicantName("Alice Tan")
                .approvedAt(Instant.parse("2026-06-19T02:30:00Z"))
                .agencyName("Example Agency")
                .portalUrl("https://example.gov/applications/APP-2026-0001");
    }

    public static final class Builder {
        private String applicationNo;
        private String applicantName;
        private Instant approvedAt;
        private String agencyName;
        private String portalUrl;

        public Builder applicationNo(String value) {
            this.applicationNo = value;
            return this;
        }

        public Builder applicantName(String value) {
            this.applicantName = value;
            return this;
        }

        public Builder approvedAt(Instant value) {
            this.approvedAt = value;
            return this;
        }

        public Builder agencyName(String value) {
            this.agencyName = value;
            return this;
        }

        public Builder portalUrl(String value) {
            this.portalUrl = value;
            return this;
        }

        public ApprovalEmailViewModel build() {
            return new ApprovalEmailViewModel(
                    applicationNo,
                    applicantName,
                    approvedAt,
                    agencyName,
                    portalUrl
            );
        }
    }
}
```

---

## 8. FreeMarker Unit Renderer Test

FreeMarker mudah dites karena ia library rendering teks dan tidak butuh Servlet environment.

Minimal setup test:

```java
import freemarker.template.Configuration;
import freemarker.template.Template;
import freemarker.template.TemplateExceptionHandler;
import org.junit.jupiter.api.Test;

import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

final class FreeMarkerRenderingTest {

    private Configuration configuration() {
        Configuration cfg = new Configuration(Configuration.VERSION_2_3_34);
        cfg.setClassLoaderForTemplateLoading(
                Thread.currentThread().getContextClassLoader(),
                "/templates"
        );
        cfg.setDefaultEncoding(StandardCharsets.UTF_8.name());
        cfg.setTemplateExceptionHandler(TemplateExceptionHandler.RETHROW_HANDLER);
        cfg.setLogTemplateExceptions(false);
        cfg.setWrapUncheckedExceptions(true);
        return cfg;
    }

    @Test
    void rendersApprovalEmail() throws Exception {
        Configuration cfg = configuration();
        Template template = cfg.getTemplate("email/approval.ftlh");

        Map<String, Object> model = Map.of(
                "applicationNo", "APP-2026-0001",
                "applicantName", "Alice Tan"
        );

        StringWriter out = new StringWriter();
        template.process(model, out);

        String html = out.toString();

        assertThat(html).contains("APP-2026-0001");
        assertThat(html).contains("Alice Tan");
    }
}
```

Yang penting:

1. gunakan `RETHROW_HANDLER`,
2. jangan pakai debug handler untuk production-like test,
3. gunakan encoding eksplisit,
4. gunakan template loader yang sama dengan production jika memungkinkan,
5. render ke `StringWriter` untuk assertion kecil,
6. render ke `Writer`/temporary file untuk output besar.

FreeMarker mendukung auto-escaping melalui output format; pastikan test memakai suffix/config yang sama dengan production, misalnya `.ftlh` untuk HTML.

---

## 9. FreeMarker Missing Variable Test

Missing variable adalah salah satu bug paling umum.

Kita harus memilih policy:

1. fail-fast untuk dokumen/email formal,
2. default value eksplisit untuk optional field,
3. lenient hanya untuk area yang memang aman.

Test fail-fast:

```java
import freemarker.template.TemplateException;
import org.junit.jupiter.api.Test;

import java.io.StringWriter;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

final class FreeMarkerMissingVariableTest {

    @Test
    void failsWhenRequiredApplicationNoIsMissing() throws Exception {
        Configuration cfg = configuration();
        Template template = cfg.getTemplate("email/approval.ftlh");

        Map<String, Object> model = Map.of(
                "applicantName", "Alice Tan"
        );

        assertThatThrownBy(() -> template.process(model, new StringWriter()))
                .isInstanceOf(TemplateException.class)
                .hasMessageContaining("applicationNo");
    }
}
```

Jika template memang memiliki optional field, test harus membuktikan fallback jelas:

```ftl
${secondaryPhone!"Not provided"}
```

Test:

```java
@Test
void rendersFallbackForMissingOptionalPhone() throws Exception {
    String html = render("profile/contact.ftlh", Map.of(
            "name", "Alice Tan"
    ));

    assertThat(html).contains("Not provided");
}
```

Rule desain:

```text
Required field missing → render fail.
Optional field missing → explicit fallback.
Silent missing handling global → hindari untuk template penting.
```

---

## 10. FreeMarker Escaping Test

Escaping harus diuji dengan payload berbahaya.

Contoh:

```java
@Test
void escapesUserControlledApplicantName() throws Exception {
    String html = render("email/approval.ftlh", Map.of(
            "applicationNo", "APP-2026-0001",
            "applicantName", "<script>alert(1)</script>"
    ));

    assertThat(html).doesNotContain("<script>alert(1)</script>");
    assertThat(html).contains("&lt;script&gt;alert(1)&lt;/script&gt;");
}
```

Payload minimal untuk HTML escaping:

```text
<script>alert(1)</script>
"><script>alert(1)</script>
<img src=x onerror=alert(1)>
& < > " '
```

Untuk HTML attribute:

```html
<a href="${portalUrl}">Open</a>
```

Test tidak cukup hanya memastikan `<script>` tidak ada. Harus memastikan URL policy benar.

```java
@Test
void rejectsJavascriptUrlBeforeRendering() {
    ApprovalEmailViewModel model = ApprovalEmailViewModelFixture.validApprovedApplication()
            .portalUrl("javascript:alert(1)")
            .build();

    assertThatThrownBy(() -> renderer.render("email/approval.ftlh", model))
            .isInstanceOf(InvalidRenderModelException.class)
            .hasMessageContaining("portalUrl");
}
```

Prinsip:

```text
Escaping mengubah karakter agar aman dalam konteks output.
Validation menentukan apakah value boleh dipakai sama sekali.

URL javascript: tidak cukup di-escape.
Ia harus ditolak oleh model validation atau URL policy.
```

---

## 11. Thymeleaf Unit Renderer Test

Thymeleaf juga bisa dites sebagai standalone engine, tanpa full Spring MVC.

Contoh setup:

```java
import org.junit.jupiter.api.Test;
import org.thymeleaf.TemplateEngine;
import org.thymeleaf.context.Context;
import org.thymeleaf.templateresolver.ClassLoaderTemplateResolver;

import java.nio.charset.StandardCharsets;
import java.util.Locale;

import static org.assertj.core.api.Assertions.assertThat;

final class ThymeleafRenderingTest {

    private TemplateEngine templateEngine() {
        ClassLoaderTemplateResolver resolver = new ClassLoaderTemplateResolver();
        resolver.setPrefix("templates/");
        resolver.setSuffix(".html");
        resolver.setTemplateMode("HTML");
        resolver.setCharacterEncoding(StandardCharsets.UTF_8.name());
        resolver.setCacheable(false);

        TemplateEngine engine = new TemplateEngine();
        engine.setTemplateResolver(resolver);
        return engine;
    }

    @Test
    void rendersProfilePage() {
        TemplateEngine engine = templateEngine();

        Context context = new Context(Locale.US);
        context.setVariable("name", "Alice Tan");
        context.setVariable("applicationNo", "APP-2026-0001");

        String html = engine.process("profile/detail", context);

        assertThat(html).contains("Alice Tan");
        assertThat(html).contains("APP-2026-0001");
    }
}
```

Untuk test ini, kita tidak butuh Tomcat, Servlet, atau full Spring Boot. Ini cocok untuk:

1. template page sederhana,
2. email template Thymeleaf,
3. fragment library,
4. output text/XML,
5. escaping test,
6. i18n test.

---

## 12. Thymeleaf Escaping Test

`th:text` escape by default, sedangkan `th:utext` output unescaped. Test harus membuktikan template memakai mekanisme yang benar.

Template:

```html
<p th:text="${applicantName}">Applicant Name</p>
```

Test:

```java
@Test
void thTextEscapesUserInput() {
    TemplateEngine engine = templateEngine();
    Context context = new Context(Locale.US);
    context.setVariable("applicantName", "<script>alert(1)</script>");

    String html = engine.process("email/approval", context);

    assertThat(html).doesNotContain("<script>alert(1)</script>");
    assertThat(html).contains("&lt;script&gt;alert(1)&lt;/script&gt;");
}
```

Jika ada `th:utext`, test harus jauh lebih ketat.

Contoh acceptable use case:

1. content berasal dari sanitizer allowlist,
2. output disimpan sebagai trusted sanitized HTML,
3. field type merepresentasikan `SafeHtml`, bukan `String` biasa.

Model:

```java
public final class SafeHtml {
    private final String sanitizedHtml;

    private SafeHtml(String sanitizedHtml) {
        this.sanitizedHtml = sanitizedHtml;
    }

    public static SafeHtml fromSanitized(String sanitizedHtml) {
        return new SafeHtml(sanitizedHtml);
    }

    public String value() {
        return sanitizedHtml;
    }
}
```

Test:

```java
@Test
void richTextOutputOnlyAcceptsSafeHtmlType() {
    assertThatThrownBy(() -> modelFactory.fromRawRichText("<script>alert(1)</script>"))
            .isInstanceOf(UnsafeHtmlException.class);
}
```

Rule:

```text
th:utext harus dianggap dangerous API.
Setiap penggunaan th:utext wajib punya test dan justification.
```

---

## 13. HTML Semantic Test vs Raw String Test

Raw string assertion mudah dibuat, tetapi rapuh terhadap whitespace, attribute order, atau formatting.

Contoh rapuh:

```java
assertThat(html).contains("<a class=\"btn primary\" href=\"/x\">Open</a>");
```

Lebih baik parse HTML dan assert semantik.

Dengan Jsoup:

```java
import org.jsoup.Jsoup;
import org.jsoup.nodes.Document;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

@Test
void rendersOpenApplicationLink() {
    String html = renderTemplate();

    Document doc = Jsoup.parse(html);

    assertThat(doc.select("a[data-testid=open-application]")).hasSize(1);
    assertThat(doc.select("a[data-testid=open-application]").attr("href"))
            .isEqualTo("/applications/APP-2026-0001");
}
```

Gunakan `data-testid` untuk elemen yang penting secara test.

Contoh:

```html
<a th:href="@{/applications/{id}(id=${applicationNo})}"
   data-testid="open-application">
    Open application
</a>
```

Prinsip:

```text
Raw string test untuk text kecil.
Semantic HTML test untuk struktur.
Snapshot test untuk output besar.
Visual test untuk layout final.
```

---

## 14. Golden Master / Snapshot Test

Golden master test membandingkan output render dengan file baseline.

Cocok untuk:

1. email HTML,
2. email plain text,
3. generated XML,
4. generated CSV,
5. document pre-render HTML,
6. regulatory letter text,
7. config/code generation.

Contoh struktur:

```text
src/test/resources/
  golden/
    email/
      approval.en_US.html
      approval.en_US.txt
      rejection.en_US.html
    document/
      warning-letter.en_SG.html
```

Test:

```java
@Test
void approvalEmailMatchesGoldenHtml() throws Exception {
    ApprovalEmailViewModel model = ApprovalEmailViewModelFixture.validApprovedApplication().build();

    String actual = normalizeHtml(renderer.renderHtml("email/approval", model));
    String expected = readResource("golden/email/approval.en_US.html");

    assertThat(actual).isEqualTo(expected);
}
```

### 14.1 Normalization

Jangan membandingkan output mentah jika output mengandung noise.

Normalisasi:

1. line ending `\r\n` ke `\n`,
2. trim trailing whitespace,
3. stable pretty-print untuk HTML/XML,
4. replace dynamic token dengan placeholder,
5. sort attribute jika tool mendukung,
6. normalize timestamps ke fixed time.

Contoh:

```java
private String normalizeText(String value) {
    return value
            .replace("\r\n", "\n")
            .replaceAll("[ \t]+\n", "\n")
            .trim();
}
```

### 14.2 Golden Test Anti-Pattern

Golden test buruk jika:

1. snapshot terlalu besar tanpa semantic assertions,
2. developer update snapshot tanpa review,
3. output punya terlalu banyak random/dynamic field,
4. whitespace noise membuat test sering gagal,
5. test tidak menjelaskan invariant penting.

Golden test bagus jika:

1. output penting secara bisnis/legal,
2. perubahan output harus visible di PR diff,
3. snapshot kecil atau dinormalisasi,
4. semantic assertions tetap ada untuk invariant penting,
5. review process jelas.

---

## 15. Contract Test: Template Requirements vs ViewModel

Problem besar dalam template system adalah drift:

```text
Template butuh field A, B, C.
ViewModel berubah menyediakan A, B, D.
Runtime gagal saat render.
```

Atau lebih buruk:

```text
Template memakai fallback default.
Field penting hilang.
Output tetap jadi tapi salah.
```

Contract test bertujuan memastikan data model dan template kompatibel.

### 15.1 Contract eksplisit sederhana

Buat metadata:

```yaml
template: email/approval
version: 2
requiredFields:
  - applicationNo
  - applicantName
  - approvedAt
  - portalUrl
optionalFields:
  - secondaryContactName
```

Test:

```java
@Test
void approvalEmailViewModelSatisfiesTemplateContract() {
    TemplateContract contract = contractRepository.load("email/approval", 2);
    Set<String> viewModelFields = ViewModelIntrospector.fieldsOf(ApprovalEmailViewModel.class);

    assertThat(viewModelFields).containsAll(contract.requiredFields());
}
```

### 15.2 Render-based contract test

Lebih praktis: render semua template published dengan canonical model.

```java
@TestFactory
Stream<DynamicTest> allPublishedTemplatesRenderWithCanonicalModels() {
    return templateCatalog.publishedTemplates().stream()
            .map(template -> DynamicTest.dynamicTest(template.id(), () -> {
                Object model = canonicalModelFactory.forTemplate(template.id(), template.version());
                RenderedOutput output = renderer.render(template.id(), template.version(), model);
                assertThat(output.body()).isNotBlank();
            }));
}
```

Ini menangkap:

1. missing variable,
2. syntax error,
3. resolver error,
4. missing macro/fragment,
5. incompatible library,
6. invalid model shape.

### 15.3 Negative contract test

Test juga harus memastikan required field tidak diam-diam optional.

```java
@Test
void approvalEmailFailsWithoutApprovedAt() {
    ApprovalEmailViewModel model = ApprovalEmailViewModelFixture.validApprovedApplication()
            .approvedAt(null)
            .build();

    assertThatThrownBy(() -> renderer.render("email/approval", model))
            .isInstanceOf(RenderModelValidationException.class)
            .hasMessageContaining("approvedAt");
}
```

---

## 16. Model Validation Before Rendering

Template engine bukan tempat terbaik untuk validasi model. Validasi harus dilakukan sebelum render.

Contoh annotation:

```java
public final class ApprovalEmailViewModel {

    @NotBlank
    private final String applicationNo;

    @NotBlank
    private final String applicantName;

    @NotNull
    private final Instant approvedAt;

    @NotNull
    private final URI portalUrl;

    // constructor/getters
}
```

Renderer:

```java
public final class ValidatingTemplateRenderer {
    private final Validator validator;
    private final TemplateRenderer delegate;

    public RenderedOutput render(RenderRequest request) {
        Set<ConstraintViolation<Object>> violations = validator.validate(request.model());

        if (!violations.isEmpty()) {
            throw new RenderModelValidationException(violations);
        }

        return delegate.render(request);
    }
}
```

Test:

```java
@Test
void rejectsInvalidModelBeforeTemplateEvaluation() {
    ApprovalEmailViewModel model = ApprovalEmailViewModelFixture.validApprovedApplication()
            .applicationNo("")
            .build();

    assertThatThrownBy(() -> renderer.render("email/approval", model))
            .isInstanceOf(RenderModelValidationException.class);
}
```

Benefit:

1. error lebih jelas,
2. fail sebelum template logic,
3. bisa report field error,
4. tidak tergantung engine-specific exception,
5. cocok untuk template governance platform.

---

## 17. Locale Matrix Test

Locale bug sering tidak terlihat di happy path.

Hal yang perlu diuji:

1. message key tersedia,
2. fallback benar,
3. tanggal benar,
4. angka benar,
5. currency benar,
6. pluralization/singular wording benar,
7. layout tidak rusak karena teks panjang,
8. PDF/email masih muat.

Contoh dynamic test:

```java
@TestFactory
Stream<DynamicTest> approvalEmailRendersForAllSupportedLocales() {
    List<Locale> locales = List.of(Locale.ENGLISH, Locale.forLanguageTag("id-ID"));

    return locales.stream().map(locale -> DynamicTest.dynamicTest(locale.toLanguageTag(), () -> {
        RenderContext context = RenderContext.builder()
                .locale(locale)
                .zoneId(ZoneId.of("Asia/Jakarta"))
                .clock(FIXED_CLOCK)
                .build();

        ApprovalEmailViewModel model = ApprovalEmailViewModelFixture.validApprovedApplication().build();

        String html = renderer.renderHtml("email/approval", context, model);

        assertThat(html).doesNotContain("???");
        assertThat(html).doesNotContain("approval.subject");
        assertThat(html).contains("APP-2026-0001");
    }));
}
```

Untuk Thymeleaf/Spring, missing message bisa terlihat sebagai unresolved key tergantung konfigurasi. Untuk FreeMarker, jika memakai `ResourceBundle`/shared messages, pastikan key lookup punya policy jelas.

---

## 18. Timezone Test

Timezone tidak boleh implicit.

Contoh bug:

```text
Approved at: 2026-06-19 00:30 UTC
Singapore/Jakarta date: 2026-06-19
America/New_York date: 2026-06-18
```

Jika dokumen legal memakai tanggal agency, timezone harus eksplisit.

Test:

```java
@Test
void rendersApprovalDateUsingAgencyTimezone() {
    ApprovalEmailViewModel model = ApprovalEmailViewModelFixture.validApprovedApplication()
            .approvedAt(Instant.parse("2026-06-18T17:30:00Z"))
            .build();

    RenderContext context = RenderContext.builder()
            .locale(Locale.ENGLISH)
            .zoneId(ZoneId.of("Asia/Singapore"))
            .clock(FIXED_CLOCK)
            .build();

    String html = renderer.renderHtml("email/approval", context, model);

    assertThat(html).contains("19 Jun 2026");
}
```

Negative test:

```java
@Test
void sameInstantCanRenderDifferentDateForDifferentTimezone() {
    Instant instant = Instant.parse("2026-06-19T00:30:00Z");

    String singapore = formatter.formatDate(instant, ZoneId.of("Asia/Singapore"), Locale.ENGLISH);
    String newYork = formatter.formatDate(instant, ZoneId.of("America/New_York"), Locale.ENGLISH);

    assertThat(singapore).isNotEqualTo(newYork);
}
```

Rule:

```text
Never rely on ZoneId.systemDefault() in template rendering tests.
```

---

## 19. Message Bundle Completeness Test

Jika ada banyak locale, test semua bundle.

Struktur:

```text
messages.properties
messages_en.properties
messages_id.properties
messages_zh.properties
```

Test:

```java
@Test
void allLocalizedBundlesContainBaseKeys() {
    Set<String> baseKeys = loadKeys("messages.properties");

    for (String bundle : List.of("messages_en.properties", "messages_id.properties")) {
        Set<String> localizedKeys = loadKeys(bundle);
        assertThat(localizedKeys)
                .as(bundle)
                .containsAll(baseKeys);
    }
}
```

Untuk enterprise, lebih baik ada allowlist untuk key yang memang boleh tidak diterjemahkan.

```yaml
allowedMissingTranslations:
  id-ID:
    - experimental.banner
```

Rule:

```text
Missing translation harus intentional, bukan accidental.
```

---

## 20. Link Validation Test

Template sering menghasilkan link salah.

Hal yang perlu diuji:

1. absolute vs relative URL,
2. correct base URL per environment/tenant,
3. no localhost in production template,
4. no unsafe scheme,
5. no missing path parameter,
6. no double slash accidental,
7. no raw user input in link without validation.

Test HTML:

```java
@Test
void emailLinksUseExpectedPublicBaseUrl() {
    String html = renderApprovalEmail();
    Document doc = Jsoup.parse(html);

    String href = doc.select("a[data-testid=open-application]").attr("href");

    assertThat(href).startsWith("https://portal.example.gov/");
    assertThat(href).doesNotContain("localhost");
    assertThat(href).doesNotContain("javascript:");
}
```

Test all links:

```java
@Test
void allEmailLinksUseHttps() {
    Document doc = Jsoup.parse(renderApprovalEmail());

    for (Element link : doc.select("a[href]")) {
        String href = link.attr("href");
        assertThat(href).startsWith("https://");
    }
}
```

Untuk internal SSR page, relative link mungkin valid. Rule-nya harus sesuai artifact type.

---

## 21. Accessibility Test untuk HTML Template

Accessibility bukan hanya frontend SPA concern. Server-side template juga harus diuji.

Invariant minimal:

1. form input punya label,
2. image punya alt text atau decorative role,
3. heading hierarchy masuk akal,
4. button text jelas,
5. table punya header,
6. error message terhubung ke field,
7. focus target tersedia untuk error summary,
8. color bukan satu-satunya indikator.

Test sederhana dengan Jsoup:

```java
@Test
void allInputsHaveLabels() {
    Document doc = Jsoup.parse(renderFormPage());

    for (Element input : doc.select("input:not([type=hidden])")) {
        String id = input.id();
        assertThat(id).as("input id").isNotBlank();
        assertThat(doc.select("label[for=" + id + "]"))
                .as("label for " + id)
                .hasSize(1);
    }
}
```

Test table:

```java
@Test
void dataTablesHaveColumnHeaders() {
    Document doc = Jsoup.parse(renderListPage());

    for (Element table : doc.select("table[data-testid]")) {
        assertThat(table.select("thead th")).isNotEmpty();
    }
}
```

Untuk level lebih matang, gunakan accessibility scanner di E2E/browser test, tetapi semantic checks sederhana bisa menangkap banyak regression cepat.

---

## 22. Thymeleaf Form Rendering and Validation Test

Form rendering perlu test khusus karena melibatkan binding, errors, CSRF, dan submitted value preservation.

Dengan Spring MVC dan MockMvc:

```java
@WebMvcTest(ApplicationController.class)
class ApplicationFormControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Test
    void getFormRendersCsrfAndFields() throws Exception {
        MvcResult result = mockMvc.perform(get("/applications/new"))
                .andExpect(status().isOk())
                .andExpect(view().name("applications/form"))
                .andExpect(model().attributeExists("form"))
                .andReturn();

        String html = result.getResponse().getContentAsString();
        Document doc = Jsoup.parse(html);

        assertThat(doc.select("input[name=applicantName]")).hasSize(1);
        assertThat(doc.select("input[name=_csrf]")).hasSize(1);
    }
}
```

Validation error:

```java
@Test
void postInvalidFormRendersValidationErrors() throws Exception {
    MvcResult result = mockMvc.perform(post("/applications")
                    .param("applicantName", "")
                    .param("applicationType", "RENEWAL")
                    .with(csrf()))
            .andExpect(status().isOk())
            .andExpect(view().name("applications/form"))
            .andExpect(model().hasErrors())
            .andReturn();

    String html = result.getResponse().getContentAsString();
    Document doc = Jsoup.parse(html);

    assertThat(doc.select("[data-testid=applicantName-error]").text())
            .contains("required");
}
```

Invariants:

1. invalid POST returns form page,
2. errors are visible,
3. submitted values are preserved safely,
4. CSRF required for unsafe method,
5. success uses redirect, not direct render,
6. hidden fields do not include server-owned sensitive values.

---

## 23. CSRF Rendering Test

Untuk Thymeleaf + Spring Security, form harus menyertakan CSRF token untuk unsafe methods.

Test:

```java
@Test
void formContainsCsrfToken() throws Exception {
    MvcResult result = mockMvc.perform(get("/applications/new"))
            .andExpect(status().isOk())
            .andReturn();

    Document doc = Jsoup.parse(result.getResponse().getContentAsString());

    assertThat(doc.select("form[method=post] input[name=_csrf]")).hasSize(1);
}
```

Negative flow:

```java
@Test
void postWithoutCsrfIsRejected() throws Exception {
    mockMvc.perform(post("/applications")
                    .param("applicantName", "Alice"))
            .andExpect(status().isForbidden());
}
```

Rule:

```text
Template test memastikan token dirender.
Security integration test memastikan token enforced.
```

---

## 24. Authorization Rendering Test

UI authorization bukan backend authorization, tetapi tetap perlu diuji agar user tidak melihat action yang tidak relevan.

Contoh:

```html
<button sec:authorize="hasAuthority('APPLICATION_APPROVE')"
        data-testid="approve-button">
    Approve
</button>
```

Test:

```java
@Test
@WithMockUser(authorities = "APPLICATION_VIEW")
void viewerDoesNotSeeApproveButton() throws Exception {
    MvcResult result = mockMvc.perform(get("/applications/APP-1"))
            .andExpect(status().isOk())
            .andReturn();

    Document doc = Jsoup.parse(result.getResponse().getContentAsString());

    assertThat(doc.select("[data-testid=approve-button]")).isEmpty();
}

@Test
@WithMockUser(authorities = "APPLICATION_APPROVE")
void approverSeesApproveButton() throws Exception {
    MvcResult result = mockMvc.perform(get("/applications/APP-1"))
            .andExpect(status().isOk())
            .andReturn();

    Document doc = Jsoup.parse(result.getResponse().getContentAsString());

    assertThat(doc.select("[data-testid=approve-button]")).hasSize(1);
}
```

Tetap wajib ada backend enforcement:

```java
@Test
@WithMockUser(authorities = "APPLICATION_VIEW")
void viewerCannotApproveEvenIfButtonIsForged() throws Exception {
    mockMvc.perform(post("/applications/APP-1/approve").with(csrf()))
            .andExpect(status().isForbidden());
}
```

---

## 25. Fragment and Macro Library Test

Fragment/macro/component library bisa rusak tanpa halaman utama langsung gagal di compile.

Test fragment contract:

```java
@Test
void paginationFragmentRendersExpectedLinks() {
    Context context = new Context(Locale.US);
    context.setVariable("page", PageViewModel.of(2, 10, 100));

    String html = templateEngine.process("fragments/pagination :: pagination", context);

    Document doc = Jsoup.parse(html);

    assertThat(doc.select("a[data-page=1]")).hasSize(1);
    assertThat(doc.select("a[data-page=2].active")).hasSize(1);
    assertThat(doc.select("a[data-page=3]")).hasSize(1);
}
```

FreeMarker macro library test:

```ftl
<#import "/macros/form.ftl" as form>
<@form.input name="applicantName" label="Applicant Name" value=applicantName />
```

Test:

```java
@Test
void inputMacroEscapesValueAndRendersLabel() throws Exception {
    String html = renderStringTemplate(
            "<#import '/macros/form.ftl' as form>" +
            "<@form.input name='applicantName' label='Applicant Name' value=applicantName />",
            Map.of("applicantName", "<script>alert(1)</script>")
    );

    Document doc = Jsoup.parse(html);

    assertThat(doc.select("label[for=applicantName]").text()).isEqualTo("Applicant Name");
    assertThat(html).doesNotContain("<script>");
}
```

Macro/fragment library harus punya test karena ia dipakai banyak template. Satu regression di macro bisa memengaruhi puluhan halaman/email.

---

## 26. XML Output Test

Jika template menghasilkan XML, test harus lebih ketat daripada HTML.

Test well-formed:

```java
@Test
void generatedXmlIsWellFormed() throws Exception {
    String xml = renderer.renderText("integration/application-export.ftlx", model);

    DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
    factory.setNamespaceAware(true);
    factory.newDocumentBuilder()
            .parse(new InputSource(new StringReader(xml)));
}
```

Test schema:

```java
@Test
void generatedXmlMatchesSchema() throws Exception {
    String xml = renderer.renderText("integration/application-export.ftlx", model);

    SchemaFactory schemaFactory = SchemaFactory.newInstance(XMLConstants.W3C_XML_SCHEMA_NS_URI);
    Schema schema = schemaFactory.newSchema(resource("schema/application-export.xsd"));
    Validator validator = schema.newValidator();

    validator.validate(new StreamSource(new StringReader(xml)));
}
```

Security note:

Jika parsing XML dalam test, konfigurasi parser harus aman dari XXE bila input bisa tidak trusted. Untuk output internal test, risk lebih kecil, tetapi biasakan secure parser config.

---

## 27. CSV Output Test

CSV tampak sederhana, tetapi banyak bug:

1. comma dalam value,
2. quote dalam value,
3. newline dalam value,
4. Excel formula injection,
5. encoding/BOM,
6. column order berubah,
7. missing header,
8. locale number formatting salah.

Test minimal:

```java
@Test
void generatedCsvHasStableHeaderAndEscapesValues() {
    String csv = renderer.renderText("export/applications.csv.ftl", modelWithCommaAndNewline());

    List<List<String>> rows = csvParser.parse(csv);

    assertThat(rows.get(0)).containsExactly("Application No", "Applicant Name", "Status");
    assertThat(rows.get(1).get(1)).isEqualTo("Alice, Tan\nDirector");
}
```

Formula injection test:

```java
@Test
void csvEscapesFormulaLikeValues() {
    String csv = renderer.renderText("export/applications.csv.ftl", modelWithApplicantName("=HYPERLINK(\"http://evil\")"));

    assertThat(csv).doesNotContain(",=HYPERLINK");
    assertThat(csv).contains(",'=HYPERLINK");
}
```

Rule:

```text
Jika output CSV bisa dibuka di spreadsheet, treat it as executable-ish surface.
```

---

## 28. Email Template Test

Email template perlu testing ganda:

1. subject,
2. HTML body,
3. plain text body,
4. MIME structure,
5. inline CSS,
6. links,
7. unsubscribe/footer/legal disclaimer,
8. tenant branding,
9. no PII leak,
10. no unsafe dynamic HTML.

Contoh object:

```java
public final class RenderedEmail {
    private final String subject;
    private final String htmlBody;
    private final String textBody;
    private final List<Attachment> attachments;
}
```

Test:

```java
@Test
void approvalEmailHasSubjectHtmlAndTextBody() {
    RenderedEmail email = emailRenderer.renderApprovalEmail(model, context);

    assertThat(email.subject()).contains("APP-2026-0001");
    assertThat(email.htmlBody()).contains("APP-2026-0001");
    assertThat(email.textBody()).contains("APP-2026-0001");
    assertThat(email.htmlBody()).contains("data-testid=\"email-footer\"");
}
```

MIME test:

```java
@Test
void mailSenderCreatesMultipartAlternativeMessage() throws Exception {
    MimeMessage message = mailComposer.compose(email);

    Object content = message.getContent();

    assertThat(content).isInstanceOf(MimeMultipart.class);
    MimeMultipart multipart = (MimeMultipart) content;

    assertThat(multipart.getCount()).isGreaterThanOrEqualTo(2);
}
```

Email-specific invariant:

```text
Jika HTML body ada, plain text body juga harus ada.
Jika email eksternal, semua link harus absolute HTTPS.
Jika email berisi action, harus ada non-sensitive reference id.
Jika email legal, footer/disclaimer harus mandatory.
```

---

## 29. PDF/Document Rendering Test

Template engine biasanya menghasilkan HTML pre-render, lalu PDF engine membuat binary PDF. Test harus dipisah.

Layer 1 — source HTML test:

```java
@Test
void warningLetterHtmlContainsLegalFooter() {
    String html = documentRenderer.renderHtml("document/warning-letter", model);

    Document doc = Jsoup.parse(html);

    assertThat(doc.select("[data-testid=legal-footer]")).hasSize(1);
    assertThat(doc.text()).contains("APP-2026-0001");
}
```

Layer 2 — PDF generation smoke test:

```java
@Test
void warningLetterPdfCanBeGenerated() {
    byte[] pdf = documentRenderer.renderPdf("document/warning-letter", model);

    assertThat(pdf).startsWith("%PDF".getBytes(StandardCharsets.US_ASCII));
    assertThat(pdf.length).isGreaterThan(10_000);
}
```

Layer 3 — text extraction assertion:

```java
@Test
void generatedPdfContainsExpectedText() {
    byte[] pdf = documentRenderer.renderPdf("document/warning-letter", model);

    String text = pdfTextExtractor.extract(pdf);

    assertThat(text).contains("APP-2026-0001");
    assertThat(text).contains("Warning Notice");
}
```

Layer 4 — visual regression, hanya untuk critical templates:

```text
render PDF → convert page to image → compare with baseline image → threshold diff
```

PDF visual regression jangan terlalu banyak karena mahal dan sering environment-sensitive karena font/rendering engine.

---

## 30. Template Linting and Static Analysis

Tidak semua masalah harus ditangkap lewat render test. Beberapa lebih baik dicegah lewat linting.

Lint rule contoh:

### FreeMarker rules

1. no `?api` unless allowlisted,
2. no `?eval`,
3. no `?interpret` for business templates,
4. no `?no_esc` without waiver,
5. no `#global` outside library templates,
6. no class instantiation/new built-in,
7. no direct service/repository variable names,
8. no included template from dynamic user input,
9. no inline JavaScript interpolation without approved encoder,
10. required `.ftlh` for HTML templates.

### Thymeleaf rules

1. no `th:utext` without waiver,
2. no inline JavaScript raw interpolation,
3. no form without CSRF for POST/PUT/PATCH/DELETE,
4. no hidden input for sensitive fields,
5. no `javascript:` href,
6. no external link without allowlist for email,
7. no missing `data-testid` on critical actions,
8. no admin button without authorization marker,
9. no direct entity field dump in debug table,
10. no template expression calling service-like methods.

Linting bisa dimulai sederhana dengan script regex/AST-ish scanner.

Contoh pseudo-code:

```java
public final class TemplateLintRuleNoThUtext implements TemplateLintRule {
    @Override
    public List<LintFinding> check(TemplateFile file) {
        if (!file.content().contains("th:utext")) {
            return List.of();
        }

        if (file.hasWaiver("ALLOW_TH_UTEXT")) {
            return List.of();
        }

        return List.of(new LintFinding(
                file.path(),
                "THYMELEAF_NO_UTEXT",
                "th:utext is forbidden unless the value type is SafeHtml and the usage is waived."
        ));
    }
}
```

CI rule:

```text
Lint finding severity ERROR → build fail.
Lint finding severity WARN → PR comment.
Waiver → must include reason, expiry, owner.
```

---

## 31. Security Test Corpus

Untuk template security, buat corpus payload.

Contoh:

```java
public final class MaliciousPayloads {
    public static List<String> htmlPayloads() {
        return List.of(
                "<script>alert(1)</script>",
                "\"><script>alert(1)</script>",
                "<img src=x onerror=alert(1)>",
                "<svg onload=alert(1)>",
                "& < > \" '",
                "</textarea><script>alert(1)</script>"
        );
    }

    public static List<String> urlPayloads() {
        return List.of(
                "javascript:alert(1)",
                "data:text/html,<script>alert(1)</script>",
                "//evil.example.com/path",
                "https://example.gov.evil.com/login"
        );
    }

    public static List<String> csvPayloads() {
        return List.of(
                "=1+1",
                "+cmd|' /C calc'!A0",
                "@SUM(1+1)",
                "-10+20"
        );
    }
}
```

Dynamic test:

```java
@TestFactory
Stream<DynamicTest> approvalEmailEscapesAllHtmlPayloads() {
    return MaliciousPayloads.htmlPayloads().stream()
            .map(payload -> DynamicTest.dynamicTest(payload, () -> {
                ApprovalEmailViewModel model = ApprovalEmailViewModelFixture.validApprovedApplication()
                        .applicantName(payload)
                        .build();

                String html = renderer.renderHtml("email/approval", model);

                assertThat(html).doesNotContain(payload);
                assertThat(Jsoup.parse(html).select("script")).isEmpty();
            }));
}
```

Caveat:

```text
Security corpus test bukan pengganti threat modeling.
Ia regression safety net.
```

---

## 32. Resource Exhaustion Test

Template bisa gagal karena output terlalu besar atau loop terlalu banyak.

Test besar tapi terkendali:

```java
@Test
void largeTableRenderingStaysUnderLatencyBudget() {
    List<RowViewModel> rows = RowFixture.rows(1_000);

    long start = System.nanoTime();
    String html = renderer.renderHtml("report/table", Map.of("rows", rows));
    long elapsedMillis = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start);

    assertThat(html).contains("row-999");
    assertThat(elapsedMillis).isLessThan(500);
}
```

Hati-hati: test latency di CI bisa flaky. Lebih baik:

1. gunakan threshold longgar,
2. pisahkan performance test dari unit test reguler,
3. gunakan JMH/JFR untuk benchmark serius,
4. test correctness large output di unit test,
5. test performance di nightly/performance profile.

Resource safety invariant:

```text
Renderer harus punya max model size / max output size / max render timeout untuk untrusted or semi-trusted template platform.
```

Test output size guard:

```java
@Test
void rendererRejectsOutputAboveConfiguredLimit() {
    Object hugeModel = HugeModelFixture.withRows(1_000_000);

    assertThatThrownBy(() -> renderer.render("report/huge", hugeModel))
            .isInstanceOf(RenderOutputLimitExceededException.class);
}
```

---

## 33. Template Catalog Preflight Test

Untuk platform template, setiap template published harus bisa di-preflight.

```java
@TestFactory
Stream<DynamicTest> allPublishedTemplatesPassPreflight() {
    return templateCatalog.findPublished().stream()
            .map(template -> DynamicTest.dynamicTest(template.id() + "@" + template.version(), () -> {
                PreflightResult result = preflightService.preflight(template.id(), template.version());

                assertThat(result.syntaxValid()).isTrue();
                assertThat(result.contractValid()).isTrue();
                assertThat(result.securityFindings()).isEmpty();
                assertThat(result.sampleRenderSuccessful()).isTrue();
            }));
}
```

Preflight should check:

1. template syntax,
2. dependency exists,
3. macro/fragment imports resolvable,
4. required model contract exists,
5. sample canonical render works,
6. locale bundles complete,
7. lint/security rules pass,
8. output format configured,
9. template version metadata valid,
10. effective date not conflicting.

---

## 34. CI Pipeline untuk Template System

Pipeline yang direkomendasikan:

```text
1. Compile Java
2. Unit tests
3. Template lint
4. Template contract tests
5. Renderer unit tests
6. Security escaping tests
7. Locale matrix tests
8. Golden snapshot diff
9. Integration tests
10. Optional PDF/email visual tests
11. Package artifact
12. Publish template catalog metadata
```

Untuk PR yang mengubah template:

```text
Changed files:
- src/main/resources/templates/email/approval.ftlh

CI must run:
- lint for approval.ftlh
- render approval.ftlh with canonical models
- compare golden email approval snapshots
- run escaping tests for approval model
- check message keys used by approval.ftlh
- verify template metadata version increment if published template changed
```

Policy penting:

```text
Jika published template berubah, version harus berubah.
Jika golden output berubah, reviewer harus melihat diff.
Jika security lint menemukan dangerous construct, PR tidak boleh merge tanpa waiver.
```

---

## 35. Versioned Template Regression Test

Jika sistem menyimpan template version, jangan hanya test latest version.

```java
@TestFactory
Stream<DynamicTest> allActiveTemplateVersionsStillRender() {
    return templateCatalog.findActiveAndRecentlyRetired().stream()
            .map(template -> DynamicTest.dynamicTest(template.id() + "@" + template.version(), () -> {
                Object model = sampleModelRepository.forContract(template.contractVersion());

                RenderedOutput output = renderer.render(
                        template.id(),
                        template.version(),
                        model
                );

                assertThat(output.body()).isNotBlank();
            }));
}
```

Kenapa recently retired juga dites?

Karena dokumen historis kadang perlu re-render untuk preview/audit/recovery. Jika policy sistem adalah immutable stored output dan tidak pernah re-render old template, maka test retired version bisa dibatasi. Tetapi kebijakan itu harus eksplisit.

---

## 36. Testing Template Error Classification

Renderer production tidak boleh hanya melempar raw exception.

Contoh classification:

```java
public enum RenderFailureType {
    TEMPLATE_NOT_FOUND,
    TEMPLATE_SYNTAX_ERROR,
    TEMPLATE_RUNTIME_ERROR,
    MODEL_VALIDATION_ERROR,
    UNSAFE_MODEL_VALUE,
    OUTPUT_LIMIT_EXCEEDED,
    SECURITY_POLICY_VIOLATION,
    LOCALE_MESSAGE_MISSING,
    UNKNOWN
}
```

Test:

```java
@Test
void missingTemplateIsClassified() {
    assertThatThrownBy(() -> renderer.render("missing/template", Map.of()))
            .isInstanceOf(RenderingException.class)
            .extracting("failureType")
            .isEqualTo(RenderFailureType.TEMPLATE_NOT_FOUND);
}
```

Test log redaction:

```java
@Test
void renderingErrorDoesNotLogSensitiveModelValues() {
    SecretCaptureAppender appender = attachLogCapture();

    SensitiveModel model = new SensitiveModel("Alice", "S1234567A");

    assertThatThrownBy(() -> renderer.render("broken/template", model))
            .isInstanceOf(RenderingException.class);

    assertThat(appender.messages()).doesNotContain("S1234567A");
}
```

---

## 37. Testing Observability

Observability juga bisa dites.

Metrics expected:

1. `template.render.count`,
2. `template.render.duration`,
3. `template.render.failure.count`,
4. tags: template id, version, output type, status, failure type,
5. avoid tags: user id, application no, PII.

Test with fake meter registry:

```java
@Test
void successfulRenderRecordsMetricsWithoutPiiTags() {
    SimpleMeterRegistry registry = new SimpleMeterRegistry();
    TemplateRenderer renderer = rendererWithMetrics(registry);

    renderer.render("email/approval", modelWithApplicationNo("APP-2026-0001"));

    Timer timer = registry.find("template.render.duration")
            .tag("template", "email/approval")
            .timer();

    assertThat(timer).isNotNull();

    registry.getMeters().forEach(meter -> {
        meter.getId().getTags().forEach(tag -> {
            assertThat(tag.getValue()).doesNotContain("APP-2026-0001");
        });
    });
}
```

---

## 38. Testing Template Loader/Resolver Configuration

Template bugs sering muncul karena environment path beda.

Test config:

```java
@Test
void productionTemplateResolverFindsApprovalTemplate() throws Exception {
    Configuration cfg = productionLikeFreeMarkerConfiguration();

    Template template = cfg.getTemplate("email/approval.ftlh");

    assertThat(template).isNotNull();
}
```

Thymeleaf:

```java
@Test
void productionTemplateResolverFindsApplicationPage() {
    TemplateEngine engine = productionLikeTemplateEngine();

    String html = engine.process("applications/detail", contextWithSampleModel());

    assertThat(html).contains("Application Detail");
}
```

Config test should cover:

1. prefix/suffix,
2. template mode,
3. encoding,
4. cache setting,
5. resolver order,
6. tenant override resolver,
7. fallback resolver,
8. classpath packaging.

---

## 39. Testing Multi-Tenant Templates

Multi-tenant rendering needs more than “one tenant works”.

Test matrix:

| Case | Expected |
|---|---|
| default template | renders default branding |
| tenant override exists | uses tenant branding/template |
| tenant override missing optional template | falls back to default |
| tenant override missing required fragment | preflight fails |
| tenant A render | does not leak tenant B branding/data |
| retired tenant template | not selected for new render |

Example:

```java
@Test
void tenantOverrideDoesNotLeakOtherTenantBranding() {
    RenderContext tenantA = RenderContext.builder().tenantId("tenant-a").build();
    RenderContext tenantB = RenderContext.builder().tenantId("tenant-b").build();

    String htmlA = renderer.renderHtml("email/approval", tenantA, model);
    String htmlB = renderer.renderHtml("email/approval", tenantB, model);

    assertThat(htmlA).contains("Tenant A Portal");
    assertThat(htmlA).doesNotContain("Tenant B Portal");

    assertThat(htmlB).contains("Tenant B Portal");
    assertThat(htmlB).doesNotContain("Tenant A Portal");
}
```

---

## 40. Avoiding Brittle Tests

Brittle template tests biasanya muncul karena assertion terlalu dekat dengan implementation detail.

Avoid:

```java
assertThat(html).contains("<div class=\"row mt-2 mb-3\">");
```

Prefer:

```java
assertThat(doc.select("[data-testid=application-status]").text())
        .isEqualTo("Approved");
```

Avoid:

```java
assertThat(html).isEqualTo("<html>...</html>");
```

Prefer combination:

```java
assertThat(doc.select("title").text()).isEqualTo("Application Detail");
assertThat(doc.select("[data-testid=application-no]").text()).isEqualTo("APP-2026-0001");
assertThat(normalizedHtml).isEqualTo(goldenHtml);
```

Rule:

```text
Test invariant, bukan incidental markup.
Gunakan golden test untuk intentional full-output regression.
Gunakan semantic assertions untuk business-critical fields.
```

---

## 41. Recommended Test Suite per Template Type

### 41.1 SSR page template

Minimal tests:

1. render with valid model,
2. semantic HTML assertions,
3. form CSRF if applicable,
4. validation error rendering if form,
5. role-based UI rendering,
6. escaping malicious text,
7. locale formatting,
8. no sensitive hidden fields,
9. accessibility smoke checks.

### 41.2 Email template

Minimal tests:

1. subject,
2. HTML body,
3. text body,
4. escaping,
5. absolute HTTPS links,
6. footer/legal block,
7. tenant branding,
8. locale matrix,
9. golden snapshot,
10. MIME composition smoke test.

### 41.3 PDF/document template

Minimal tests:

1. source HTML semantic test,
2. generated PDF smoke test,
3. extracted text assertions,
4. golden HTML snapshot,
5. locale/timezone test,
6. legal footer/signatory block,
7. template version metadata,
8. optional visual regression for critical document.

### 41.4 XML integration template

Minimal tests:

1. well-formed XML,
2. schema validation,
3. escaping special chars,
4. namespace correctness,
5. required elements,
6. golden snapshot,
7. invalid model fails.

### 41.5 CSV/text export template

Minimal tests:

1. header stable,
2. column order stable,
3. escaping comma/quote/newline,
4. formula injection defense,
5. encoding,
6. row count,
7. empty dataset behavior,
8. golden snapshot for representative output.

---

## 42. Java 8–25 Considerations

### 42.1 Java 8 baseline

Available and useful:

1. `java.time.Clock`,
2. `Instant`, `LocalDate`, `ZonedDateTime`,
3. `Locale`,
4. `ResourceBundle`,
5. streams for dynamic tests if using JUnit 5 on Java 8,
6. Bean Validation integration via dependencies.

### 42.2 Java 11+

Useful:

1. `Files.readString` not available in Java 8, so for Java 8 use `Files.readAllBytes`,
2. newer HTTP client can help link checking if needed,
3. better container/runtime support.

### 42.3 Java 17+

Useful:

1. records for immutable ViewModel,
2. sealed classes for render result/failure classification,
3. pattern matching improvements depending on version,
4. modern GC behavior for rendering workloads.

Example record ViewModel:

```java
public record ApprovalEmailViewModel(
        String applicationNo,
        String applicantName,
        Instant approvedAt,
        URI portalUrl
) {}
```

For Java 8 compatibility, use final classes.

### 42.4 Java 21+

Useful:

1. virtual threads for high-concurrency rendering orchestration if rendering waits on I/O,
2. structured concurrency if enabled/available depending on version and project policy,
3. records/patterns mature for clean modeling.

Important:

```text
Virtual threads do not make CPU-heavy rendering faster.
They mainly help when many render tasks block on I/O.
```

### 42.5 Java 25

Use Java 25 docs as upper-bound mental model, but keep source compatibility conscious if your target still includes Java 8/11/17.

---

## 43. Suggested Project Structure

```text
src/main/java/
  com/example/template/
    TemplateRenderer.java
    RenderContext.java
    RenderRequest.java
    RenderedOutput.java
    RenderingException.java
    RenderFailureType.java

src/main/resources/templates/
  email/
    approval.ftlh
  pages/
    application-detail.html
  documents/
    warning-letter.ftlh
  fragments/
    layout.html

src/test/java/
  com/example/template/
    FreeMarkerRendererTest.java
    ThymeleafRendererTest.java
    TemplateContractTest.java
    TemplateSecurityTest.java
    TemplateLocaleTest.java
    TemplateCatalogPreflightTest.java
    TemplateLintTest.java
    EmailTemplateTest.java
    DocumentTemplateTest.java

src/test/resources/
  golden/
    email/
    document/
    xml/
  template-contracts/
    email-approval-v1.yml
  payloads/
    xss-payloads.txt
```

---

## 44. Practical Checklist

Sebelum template dianggap production-ready, cek:

### Correctness

- [ ] Template render dengan canonical model.
- [ ] Required fields divalidasi sebelum render.
- [ ] Optional fields punya fallback eksplisit.
- [ ] Output semantic assertions ada.
- [ ] Golden snapshot ada untuk output penting.

### Security

- [ ] User input di-escape sesuai konteks.
- [ ] URL divalidasi, bukan hanya di-escape.
- [ ] `th:utext`, `?no_esc`, `?api`, `?eval` dicegah atau di-waive.
- [ ] Tidak ada sensitive data di hidden fields.
- [ ] Role-based UI test ada jika tombol/action conditional.
- [ ] Backend authorization test tetap ada.

### Localization

- [ ] Semua supported locale dites.
- [ ] Timezone eksplisit.
- [ ] Message bundle completeness dicek.
- [ ] Formatting number/date/currency dites.

### Integration

- [ ] Template resolver/loader production-like dites.
- [ ] Spring MVC rendering dites untuk page/form penting.
- [ ] Email MIME composition dites.
- [ ] PDF/document generation smoke test ada.

### Governance

- [ ] Template metadata valid.
- [ ] Version change enforced untuk published template.
- [ ] Preflight semua published templates.
- [ ] Lint/static analysis masuk CI.
- [ ] Snapshot diff direview manusia.

---

## 45. Common Anti-Patterns

### 45.1 “Template sudah dilihat manual, jadi aman”

Manual preview hanya menangkap satu path. Ia tidak cukup untuk locale, malicious payload, role, missing field, tenant, dan edge cases.

### 45.2 “Test controller berarti test template”

Controller test sering hanya memastikan view name/model. Ia belum tentu memproses template final.

### 45.3 “Golden snapshot untuk semuanya”

Snapshot terlalu banyak membuat PR noisy. Gunakan untuk output yang memang public/legal/important.

### 45.4 “Assert seluruh HTML dengan string exact”

Rapuh. Gunakan semantic parsing + normalized snapshot.

### 45.5 “Escaping test hanya untuk `<script>`”

XSS context berbeda. Test HTML body, attribute, URL, JS context, dan rich HTML separately.

### 45.6 “Default timezone cukup”

Tidak cukup. Timezone harus eksplisit, terutama untuk email/dokumen/regulatory output.

### 45.7 “th:utext / ?no_esc aman karena datanya dari internal”

Internal data sering berasal dari user input historis, integration input, admin CMS, atau migrated data. Treat as untrusted unless typed as sanitized safe content.

---

## 46. Mental Model Final

Template testing bukan aktivitas tambahan di pinggir. Ia adalah bagian dari contract engineering.

Model akhirnya:

```text
Template System Test Strategy

1. Validate input model
2. Render deterministically
3. Assert semantic output
4. Compare golden output where useful
5. Test escaping and dangerous contexts
6. Test locale/timezone matrix
7. Test resolver/config integration
8. Test governance and versioning
9. Test failure classification
10. Test observability and redaction
```

Jika template menghasilkan output yang dilihat user, dikirim email, menjadi dokumen legal, atau masuk integrasi antar sistem, maka template harus punya test yang sepadan dengan resiko output tersebut.

Top 1% engineer memperlakukan template bukan sebagai file view, tetapi sebagai deterministic, versioned, observable, testable transformation boundary.

---

## 47. Ringkasan

Pada part ini kita telah membahas:

1. Mengapa template output adalah public contract.
2. Perbedaan template test dengan controller test.
3. Template testing pyramid.
4. Invariant correctness, security, compatibility, dan observability.
5. Deterministic rendering harness.
6. Test data factory untuk rendering.
7. FreeMarker renderer test.
8. FreeMarker missing variable dan escaping test.
9. Thymeleaf renderer dan escaping test.
10. HTML semantic testing dengan parser.
11. Golden master/snapshot testing.
12. Contract test antara template dan ViewModel.
13. Model validation before rendering.
14. Locale/timezone/message bundle tests.
15. Link/accessibility/form/CSRF/authorization tests.
16. Fragment/macro library tests.
17. XML/CSV/email/PDF tests.
18. Template linting/static analysis.
19. Security test corpus.
20. Resource exhaustion and output limit tests.
21. Template catalog preflight.
22. CI pipeline untuk template system.
23. Versioned template regression.
24. Error classification and observability tests.
25. Multi-tenant template test.
26. Anti-pattern umum.

---

## 48. Referensi

1. Apache FreeMarker Manual — Template Author's Guide: https://freemarker.apache.org/docs/dgui.html
2. Apache FreeMarker Manual — Error handling: https://freemarker.apache.org/docs/pgui_config_errorhandling.html
3. Apache FreeMarker Manual — Associating output formats with templates: https://freemarker.apache.org/docs/pgui_config_outputformatsautoesc.html
4. Thymeleaf Documentation: https://www.thymeleaf.org/documentation.html
5. Thymeleaf 3.1 Tutorial — Using Thymeleaf: https://www.thymeleaf.org/doc/tutorials/3.1/usingthymeleaf.html
6. Thymeleaf 3.1 Tutorial — Thymeleaf + Spring: https://www.thymeleaf.org/doc/tutorials/3.1/thymeleafspring.html
7. Spring Framework Reference — Integration Testing: https://docs.spring.io/spring-framework/reference/testing/integration.html
8. Spring Framework Reference — Validation, Data Binding, and Type Conversion: https://docs.spring.io/spring-framework/reference/core/validation.html
9. Spring Framework Reference — Spring MVC Validation: https://docs.spring.io/spring-framework/reference/web/webmvc/mvc-controller/ann-validation.html
10. OWASP Cheat Sheet Series — Cross Site Scripting Prevention: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html

---

## 49. Status Seri

Part 25 selesai.

Seri belum selesai.

Berikutnya:

```text
Part 26 — Building a Production Template Rendering Service
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-024.md">⬅️ Part 24 — Template Security Beyond XSS: SSTI, Sandbox, Data Leakage, and Abuse Cases</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-026.md">Part 26 — Building a Production Template Rendering Service ➡️</a>
</div>
