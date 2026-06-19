# learn-java-template-freemarker-thymeleaf-rendering-engineering-part-011

# Part 11 — FreeMarker in Spring Boot and Jakarta Applications

> Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`  
> Part: `011`  
> Topik: Integrasi FreeMarker pada Spring Boot, Spring MVC, Spring WebFlux, dan Jakarta/Servlet runtime  
> Target: Java 8 sampai Java 25  
> Fokus: production-grade integration, bukan sekadar `return "view"`

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membahas FreeMarker dari sisi engine:

- `Configuration`
- `TemplateLoader`
- template cache
- object wrapper
- data model
- directives/macros
- output format
- escaping
- error handling
- performance

Bagian ini memindahkan pembahasan dari **engine-level** ke **application-integration-level**.

Pertanyaan utama part ini:

> Bagaimana FreeMarker ditempatkan secara benar di dalam aplikasi Spring Boot, Spring MVC, WebFlux, atau Jakarta/Servlet application sehingga aman, testable, observable, reusable, dan cocok untuk production?

Kita tidak akan mengulang dasar Servlet, Spring MVC, dependency injection, HTTP, build, atau deployment yang sudah dibahas di seri lain. Yang dibahas di sini adalah titik temu antara FreeMarker dan runtime aplikasi Java.

---

## 1. Mental Model Integrasi FreeMarker

FreeMarker dapat digunakan dalam dua mode besar:

```text
Mode A — MVC View Rendering
Controller -> Model -> ViewResolver -> FreeMarker template -> HTTP response

Mode B — Application Rendering Service
Application/service/batch/workflow -> RenderRequest -> FreeMarker renderer -> String/Writer/File/Email/PDF pre-HTML
```

Keduanya memakai engine yang sama, tetapi constraint-nya berbeda.

### 1.1 MVC View Rendering

MVC rendering cocok saat FreeMarker digunakan sebagai server-side HTML view.

Contoh alur:

```text
HTTP request
  -> Controller
  -> prepare model
  -> return logical view name
  -> ViewResolver resolves .ftlh template
  -> FreeMarker renders HTML
  -> HTTP response
```

Karakteristik:

- request-bound
- response-bound
- biasanya HTML
- bergantung pada locale, request context, CSRF, URL building, session/security context
- error-nya langsung berdampak pada user page
- latency budget ketat

### 1.2 Rendering Service

Rendering service cocok saat FreeMarker digunakan untuk email, PDF pre-render HTML, generated text, generated XML, notification, correspondence, atau document artifact.

Contoh alur:

```text
Case event / workflow transition / batch job
  -> RenderRequest(templateId, templateVersion, locale, timezone, model)
  -> TemplateRenderingService
  -> FreeMarker Configuration
  -> Template.process(model, writer)
  -> output artifact
```

Karakteristik:

- tidak selalu terikat HTTP
- bisa sync atau async
- bisa batch
- output bisa HTML, text, XML, config, source code, email body, atau PDF input
- butuh versioning dan audit trail
- sering membutuhkan reproducibility
- failure handling lebih kompleks

### 1.3 Kesalahan paling umum

Kesalahan paling umum adalah menganggap keduanya sama.

```text
MVC view rendering       : cocok untuk page response
Rendering service        : cocok untuk artifact generation
```

Jika semua template diletakkan langsung di MVC layer, maka email/document/workflow rendering ikut bergantung pada Servlet request. Ini membuat sistem sulit dites, sulit dipakai dari batch, dan rawan coupling.

Jika semua rendering dipaksa menjadi generic rendering service, maka server-side HTML page bisa kehilangan integrasi natural dengan ViewResolver, request context, dan web framework.

Arsitektur yang baik biasanya memisahkan:

```text
web-view rendering pipeline
non-web artifact rendering pipeline
```

Tetapi keduanya boleh berbagi:

- template naming convention
- configuration baseline
- object wrapper policy
- escaping policy
- observability policy
- template validation tool
- model contract discipline

---

## 2. FreeMarker di Spring Boot: Apa yang Boot Bantu?

Spring Boot menyediakan auto-configuration untuk FreeMarker jika dependency yang tepat tersedia dan aplikasi memakai web stack yang mendukung view rendering.

Secara konsep, Boot membantu menyiapkan:

- `FreeMarkerConfigurer` / FreeMarker `Configuration`
- template loader path
- view resolver
- suffix view template
- cache configuration
- charset
- content type
- expose request/session attributes jika dikonfigurasi
- pass-through FreeMarker settings via application properties

Namun, auto-configuration bukan berarti desain integration sudah selesai.

Boot hanya menyelesaikan wiring default. Engineering production tetap harus memutuskan:

- template digunakan untuk MVC saja atau rendering service juga?
- apakah satu `Configuration` cukup?
- apakah perlu konfigurasi terpisah untuk HTML, email, XML, dan text?
- apakah template boleh reload di production?
- apakah template berasal dari classpath, filesystem, database, atau object storage?
- bagaimana error handling?
- bagaimana model contract divalidasi?
- bagaimana template versioning?
- bagaimana observability?

---

## 3. Dependency dan Kompatibilitas Java 8–25

### 3.1 Java 8

Pada aplikasi Java 8, Anda biasanya berada di salah satu kombinasi:

```text
Java 8 + Spring Framework 5.x + Spring Boot 2.x + javax.servlet
```

atau aplikasi Servlet/Jakarta legacy yang masih memakai namespace `javax.*`.

FreeMarker sendiri sebagai library dapat dipakai di Java 8 tergantung versi library yang dipilih. Namun integrasi Spring Boot/Spring Framework harus mengikuti support matrix Spring.

### 3.2 Java 17+

Spring Boot 3.x membutuhkan Java 17+ dan berpindah ke Jakarta EE namespace `jakarta.*`.

Kombinasi umum:

```text
Java 17/21/25 + Spring Boot 3.x/4.x + Spring Framework 6/7 + jakarta.servlet
```

Untuk aplikasi modern, ini lebih relevan:

- Java 17 sebagai baseline enterprise modern
- Java 21 sebagai LTS populer dengan virtual threads
- Java 25 sebagai batas seri ini untuk API/JDK modern

### 3.3 Rule of thumb kompatibilitas

```text
Jika aplikasi masih Java 8:
  gunakan Spring Boot 2.x/Spring Framework 5.x stack yang sesuai.

Jika aplikasi Java 17+:
  gunakan Spring Boot 3.x/4.x sesuai lifecycle dan Spring Framework 6/7.

Jika aplikasi manual Servlet:
  perhatikan namespace javax.servlet vs jakarta.servlet.
```

Yang tidak boleh dilakukan:

- mencampur dependency `javax.servlet` dan `jakarta.servlet` sembarangan
- upgrade FreeMarker/Spring tanpa memeriksa support framework
- memakai snippet Spring Boot 3 untuk aplikasi Boot 2 tanpa adaptasi
- memakai snippet Boot 2 untuk Boot 3 tanpa mengganti namespace

---

## 4. Struktur Template di Spring Boot

Default umum Spring Boot untuk FreeMarker adalah template berada di classpath `templates`.

Contoh struktur:

```text
src/main/resources/
  templates/
    pages/
      dashboard.ftlh
      cases/
        detail.ftlh
    fragments/
      layout.ftlh
      form.ftlh
    email/
      case-assigned-html.ftlh
      case-assigned-text.ftl
    document/
      notice-of-action-html.ftlh
```

Rekomendasi naming:

```text
.ftlh  -> HTML output with HTML escaping expectation
.ftlx  -> XML output
.ftl   -> generic text output
```

FreeMarker tidak hanya untuk HTML, jadi suffix sebaiknya memberi sinyal output format.

### 4.1 Jangan campur semua template dalam satu folder datar

Buruk:

```text
src/main/resources/templates/
  dashboard.ftl
  header.ftl
  footer.ftl
  notice.ftl
  email.ftl
  table.ftl
  report.ftl
```

Lebih baik:

```text
src/main/resources/templates/
  pages/
  fragments/
  email/
  documents/
  text/
  xml/
  macros/
```

Kenapa?

Karena template mempunyai lifecycle berbeda:

| Kategori | Output | Lifecycle | Risiko |
|---|---:|---:|---:|
| Page template | HTTP HTML | mengikuti release aplikasi | XSS, auth rendering, UX |
| Email template | HTML/text MIME | mengikuti komunikasi bisnis | PII leak, broken email client |
| Document template | HTML/PDF/XML | legal/regulatory lifecycle | reproducibility, audit |
| Macro library | reusable fragment | dependency internal | breaking change |
| Text/config template | text | operational/tooling | invalid syntax output |

Folder structure harus membantu governance.

---

## 5. Spring Boot Configuration via `application.yml`

Contoh minimal:

```yaml
spring:
  freemarker:
    template-loader-path: classpath:/templates/
    suffix: .ftlh
    charset: UTF-8
    content-type: text/html;charset=UTF-8
    cache: true
    expose-request-attributes: false
    expose-session-attributes: false
    expose-spring-macro-helpers: true
    settings:
      template_exception_handler: rethrow
      log_template_exceptions: false
      wrap_unchecked_exceptions: true
      localized_lookup: true
      output_format: HTML
      auto_escaping_policy: enable_if_default
```

Catatan:

- property names dapat berbeda detail antar versi Spring Boot; selalu cek dokumentasi versi yang dipakai.
- `settings.*` meneruskan konfigurasi ke FreeMarker `Configuration`.
- `cache: true` sebaiknya default production.
- `expose-session-attributes` sebaiknya tidak diaktifkan tanpa alasan kuat.
- `expose-request-attributes` juga harus selektif.

### 5.1 Development profile

```yaml
spring:
  config:
    activate:
      on-profile: dev
  freemarker:
    cache: false
    settings:
      template_update_delay: 0
      template_exception_handler: html_debug
```

### 5.2 Production profile

```yaml
spring:
  config:
    activate:
      on-profile: prod
  freemarker:
    cache: true
    settings:
      template_update_delay: 3600
      template_exception_handler: rethrow
      log_template_exceptions: false
      wrap_unchecked_exceptions: true
```

Production tidak seharusnya menampilkan stack trace atau template internals ke output user.

---

## 6. MVC View Rendering dengan FreeMarker

### 6.1 Controller sederhana

```java
@Controller
@RequestMapping("/cases")
public class CasePageController {

    private final CaseQueryService caseQueryService;

    public CasePageController(CaseQueryService caseQueryService) {
        this.caseQueryService = caseQueryService;
    }

    @GetMapping("/{caseId}")
    public String detail(@PathVariable String caseId, Model model, Locale locale) {
        CaseDetailViewModel vm = caseQueryService.getCaseDetailView(caseId, locale);

        model.addAttribute("case", vm);
        model.addAttribute("pageTitle", "Case Detail");

        return "pages/cases/detail";
    }
}
```

Dengan suffix `.ftlh`, logical view:

```text
pages/cases/detail
```

akan diarahkan ke:

```text
classpath:/templates/pages/cases/detail.ftlh
```

### 6.2 Prinsip controller untuk template

Controller tidak boleh mengirim entity mentah.

Buruk:

```java
model.addAttribute("case", caseEntity);
```

Lebih baik:

```java
model.addAttribute("case", caseDetailViewModel);
```

Kenapa?

Entity sering mengandung:

- lazy-loaded associations
- field internal
- audit metadata
- status teknis
- relation yang tidak perlu
- method yang bisa terpanggil dari template
- data sensitif

ViewModel lebih aman karena merepresentasikan kontrak rendering.

### 6.3 ViewModel contoh

```java
public record CaseDetailViewModel(
        String caseId,
        String displayCaseNo,
        String statusLabel,
        String applicantName,
        String submittedAtText,
        List<ActionViewModel> availableActions,
        List<TimelineItemViewModel> timeline
) {}

public record ActionViewModel(
        String code,
        String label,
        String href,
        boolean primary
) {}
```

Template menjadi sederhana:

```ftl
<h1>${case.displayCaseNo}</h1>
<p>Status: ${case.statusLabel}</p>
<p>Applicant: ${case.applicantName}</p>
<p>Submitted: ${case.submittedAtText}</p>

<#if case.availableActions?has_content>
  <div class="actions">
    <#list case.availableActions as action>
      <a href="${action.href}" class="btn <#if action.primary>btn-primary</#if>">
        ${action.label}
      </a>
    </#list>
  </div>
</#if>
```

Template tidak perlu tahu:

- bagaimana status dihitung
- bagaimana authorization action dihitung
- bagaimana tanggal diformat
- bagaimana link dibangun
- bagaimana case relation diload

---

## 7. MVC ViewResolver vs Direct Rendering

Ada dua cara memakai FreeMarker di Spring:

```text
A. MVC ViewResolver
   return "pages/cases/detail";

B. Direct rendering service
   template.process(model, writer);
```

### 7.1 MVC ViewResolver cocok untuk

- normal page response
- server-side rendered admin portal
- web form
- page fragment
- request-bound locale/request context

### 7.2 Direct rendering cocok untuk

- email
- PDF pre-render
- document generation
- batch notification
- asynchronous workflow output
- template preview API
- testing renderer secara isolated

### 7.3 Jangan melakukan direct rendering di controller tanpa alasan

Kurang baik:

```java
@GetMapping("/cases/{id}")
@ResponseBody
public String page(@PathVariable String id) {
    Map<String, Object> model = Map.of("case", service.getCase(id));
    return freemarkerRenderService.render("pages/cases/detail.ftlh", model);
}
```

Masalah:

- bypass ViewResolver
- content negotiation/manual content type
- error mapping lebih manual
- request context tidak natural
- sulit konsisten dengan MVC conventions

Lebih baik gunakan MVC ViewResolver untuk page biasa.

---

## 8. Rendering Service untuk Non-Web Use Case

### 8.1 Interface minimal

```java
public interface TemplateRenderer {
    RenderedTemplate render(RenderRequest request);
}
```

```java
public record RenderRequest(
        String templateName,
        Locale locale,
        ZoneId zoneId,
        OutputKind outputKind,
        Map<String, Object> model
) {}

public enum OutputKind {
    HTML,
    TEXT,
    XML,
    JSON_TEXT,
    CSV,
    PDF_HTML
}

public record RenderedTemplate(
        String templateName,
        OutputKind outputKind,
        String content,
        Charset charset
) {}
```

### 8.2 Implementasi dasar

```java
@Service
public class FreeMarkerTemplateRenderer implements TemplateRenderer {

    private final freemarker.template.Configuration configuration;

    public FreeMarkerTemplateRenderer(freemarker.template.Configuration configuration) {
        this.configuration = configuration;
    }

    @Override
    public RenderedTemplate render(RenderRequest request) {
        try {
            Template template = configuration.getTemplate(
                    request.templateName(),
                    request.locale(),
                    StandardCharsets.UTF_8.name()
            );

            StringWriter writer = new StringWriter(4096);
            template.process(request.model(), writer);

            return new RenderedTemplate(
                    request.templateName(),
                    request.outputKind(),
                    writer.toString(),
                    StandardCharsets.UTF_8
            );
        } catch (IOException e) {
            throw new TemplateLoadFailedException(request.templateName(), e);
        } catch (TemplateException e) {
            throw new TemplateRenderFailedException(request.templateName(), e);
        }
    }
}
```

### 8.3 Production improvement

Minimal implementation di atas belum cukup untuk enterprise. Tambahkan:

- model validation
- template id vs physical path separation
- template version
- output size limit
- render timeout policy untuk untrusted/dynamic templates
- render metrics
- error classification
- logging dengan correlation id
- model redaction
- locale/timezone validation
- writer streaming option
- template dependency tracking

---

## 9. Pisahkan Template Identifier dari Physical Path

Buruk:

```java
renderer.render("email/case-assigned-html.ftlh", model);
```

Lebih baik:

```java
renderer.render(new RenderRequest(
    TemplateRef.of("CASE_ASSIGNED_EMAIL", "v3"),
    locale,
    zoneId,
    model
));
```

Lalu mapping:

```text
CASE_ASSIGNED_EMAIL:v3:html -> email/case-assigned/v3/body-html.ftlh
CASE_ASSIGNED_EMAIL:v3:text -> email/case-assigned/v3/body-text.ftl
```

Kenapa?

Karena physical path adalah implementation detail. Business/workflow code sebaiknya tidak tahu lokasi file template.

Ini penting untuk:

- versioning
- migration
- multi-tenant override
- audit trail
- backward compatibility
- template catalog
- published/draft lifecycle

---

## 10. Multiple FreeMarker Configurations

Sering kali satu `Configuration` cukup untuk aplikasi kecil. Namun enterprise system kadang butuh beberapa konfigurasi.

Contoh:

```text
mvcFreeMarkerConfiguration
  - HTML output
  - classpath templates/pages
  - Spring MVC view resolver
  - request context integration

emailFreeMarkerConfiguration
  - HTML + text email templates
  - strict missing variable
  - no request/session exposure
  - email macro library

documentFreeMarkerConfiguration
  - HTML/XML/text document templates
  - versioned template loader
  - immutable template version policy
  - stricter audit and validation
```

### 10.1 Kapan satu configuration cukup?

Satu configuration cukup jika:

- template semua dari classpath
- output mostly HTML
- template author semua developer internal
- tidak ada dynamic template storage
- security policy sama
- error policy sama
- tidak ada template versioning kompleks

### 10.2 Kapan perlu multiple configurations?

Pertimbangkan multiple configurations jika:

- MVC dan email/document punya lifecycle berbeda
- dynamic templates disimpan di database/object storage
- sebagian template diedit business user
- output format berbeda signifikan
- escaping policy berbeda
- security exposure berbeda
- template cache/reload policy berbeda
- audit requirement berbeda

---

## 11. Custom Configuration Bean di Spring

Contoh manual configuration:

```java
@Configuration
public class FreeMarkerRenderingConfig {

    @Bean
    public freemarker.template.Configuration documentFreeMarkerConfiguration() throws IOException {
        freemarker.template.Configuration cfg =
                new freemarker.template.Configuration(Configuration.VERSION_2_3_34);

        cfg.setDefaultEncoding(StandardCharsets.UTF_8.name());
        cfg.setLocale(Locale.ENGLISH);
        cfg.setTimeZone(TimeZone.getTimeZone("UTC"));

        cfg.setTemplateExceptionHandler(TemplateExceptionHandler.RETHROW_HANDLER);
        cfg.setLogTemplateExceptions(false);
        cfg.setWrapUncheckedExceptions(true);

        cfg.setOutputFormat(HTMLOutputFormat.INSTANCE);
        cfg.setRecognizeStandardFileExtensions(true);

        cfg.setTemplateLoader(new ClassTemplateLoader(
                getClass(),
                "/templates/document"
        ));

        return cfg;
    }
}
```

Catatan penting:

- jangan mengubah `Configuration` setelah aktif dipakai oleh thread request/job.
- treat `Configuration` as immutable after startup.
- jangan inject mutable shared variables sembarangan.
- jangan expose Spring `ApplicationContext` ke template.

---

## 12. TemplateLoader Strategy di Spring/Jakarta

FreeMarker memakai virtual template loading, bukan harus filesystem langsung.

### 12.1 Classpath template loader

Cocok untuk:

- templates packaged with application
- immutable release artifact
- container image deployment
- predictable behavior

```java
cfg.setTemplateLoader(new ClassTemplateLoader(getClass(), "/templates"));
```

Kelebihan:

- reproducible
- secure
- cocok dengan CI/CD
- tidak tergantung external volume

Kekurangan:

- perubahan template butuh redeploy

### 12.2 File template loader

Cocok untuk:

- development
- local preview
- controlled external template directory

```java
cfg.setDirectoryForTemplateLoading(Path.of("/opt/app/templates").toFile());
```

Risiko:

- path management
- permission
- drift antar server
- deployment inconsistency
- template tampering jika filesystem tidak aman

### 12.3 Database template loader

Cocok untuk:

- business-editable template
- template versioning
- tenant override
- approval workflow

Namun butuh desain kuat:

- cache strategy
- version selection
- draft/published state
- validation before publish
- rollback
- security sandbox
- audit trail

### 12.4 MultiTemplateLoader

Cocok untuk fallback chain:

```text
tenant override
  -> agency override
  -> default product template
```

Contoh mental model:

```text
Template lookup: email/case-assigned/body-html.ftlh

1. db://tenant/acme/email/case-assigned/body-html.ftlh
2. db://agency/default/email/case-assigned/body-html.ftlh
3. classpath:/templates/email/case-assigned/body-html.ftlh
```

Penting: fallback harus deterministic. Jangan sampai template yang dipakai berubah diam-diam tanpa versioning/audit.

---

## 13. Jakarta Servlet Integration tanpa Spring Boot

Pada aplikasi Jakarta/Servlet manual, Anda bisa memakai FreeMarker langsung.

### 13.1 ServletContext template loading

Dalam web app tradisional, template bisa disimpan di bawah web resource path.

Contoh conceptual setup:

```java
public final class FreeMarkerProvider {

    private final Configuration configuration;

    public FreeMarkerProvider(ServletContext servletContext) {
        this.configuration = new Configuration(Configuration.VERSION_2_3_34);
        this.configuration.setDefaultEncoding("UTF-8");
        this.configuration.setTemplateExceptionHandler(TemplateExceptionHandler.RETHROW_HANDLER);
        this.configuration.setLogTemplateExceptions(false);
        this.configuration.setWrapUncheckedExceptions(true);
        this.configuration.setServletContextForTemplateLoading(servletContext, "/WEB-INF/templates");
    }

    public Configuration configuration() {
        return configuration;
    }
}
```

Template diletakkan di:

```text
src/main/webapp/WEB-INF/templates/
  pages/
    home.ftlh
```

`WEB-INF` mencegah template diakses langsung sebagai static file.

### 13.2 Manual servlet render

```java
public class CaseDetailServlet extends HttpServlet {

    private FreeMarkerProvider freeMarkerProvider;
    private CaseQueryService caseQueryService;

    @Override
    public void init() {
        ServletContext ctx = getServletContext();
        this.freeMarkerProvider = (FreeMarkerProvider) ctx.getAttribute("freeMarkerProvider");
        this.caseQueryService = (CaseQueryService) ctx.getAttribute("caseQueryService");
    }

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws IOException {

        String caseId = req.getParameter("id");
        CaseDetailViewModel vm = caseQueryService.getCaseDetailView(caseId, req.getLocale());

        Map<String, Object> model = new HashMap<>();
        model.put("case", vm);

        resp.setCharacterEncoding("UTF-8");
        resp.setContentType("text/html;charset=UTF-8");

        try {
            Template template = freeMarkerProvider.configuration()
                    .getTemplate("pages/case-detail.ftlh", req.getLocale());
            template.process(model, resp.getWriter());
        } catch (TemplateException e) {
            throw new ServletException("Failed to render case detail", e);
        }
    }
}
```

Manual integration memberi kontrol penuh, tetapi Anda harus mengurus sendiri:

- lifecycle configuration
- error mapping
- request context
- locale
- security context
- CSRF token
- URL building
- caching
- observability

Spring Boot/Spring MVC mengurangi banyak boilerplate ini.

---

## 14. FreeMarker dan Spring MVC Request Context

Dalam MVC, template kadang butuh:

- URL context path
- request locale
- CSRF token
- message source
- form macros
- request attributes tertentu

Spring menyediakan helper dan macro support, tetapi Anda harus hati-hati agar tidak membuka terlalu banyak state.

### 14.1 Jangan expose session attributes default

Session sering berisi:

- user identity
- security context
- flags internal
- temporary workflow data
- PII

Jika template bisa membaca session secara luas, risiko data leak meningkat.

Lebih baik:

```java
model.addAttribute("currentUser", currentUserViewModel);
model.addAttribute("csrf", csrfViewModel);
model.addAttribute("navigation", navigationViewModel);
```

Bukan:

```yaml
spring:
  freemarker:
    expose-session-attributes: true
```

### 14.2 Security context juga harus diproyeksikan

Buruk:

```java
model.addAttribute("authentication", SecurityContextHolder.getContext().getAuthentication());
```

Lebih baik:

```java
model.addAttribute("viewer", new ViewerViewModel(
    userId,
    displayName,
    permissionsForThisPage
));
```

Template cukup tahu:

```text
viewer.canApprove
viewer.canAssign
viewer.canDownloadPdf
```

Bukan seluruh `Authentication` object.

---

## 15. Internationalization dan MessageSource Integration

Pada Spring MVC, i18n biasanya dikelola oleh `MessageSource`.

Ada dua strategi:

### 15.1 Formatting di Java, template hanya render text

```java
String submittedAtText = dateFormatter.format(caseEntity.submittedAt(), locale, zoneId);
model.addAttribute("case", new CaseDetailViewModel(..., submittedAtText));
```

Template:

```ftl
${case.submittedAtText}
```

Kelebihan:

- output deterministic
- formatting centralized
- mudah dites
- template sederhana

Kekurangan:

- model lebih verbose

### 15.2 Formatting di template

Template:

```ftl
${case.submittedAt?datetime}
```

atau memakai helper custom.

Kelebihan:

- model lebih raw
- template fleksibel

Kekurangan:

- formatting tersebar
- locale/timezone policy bisa tidak konsisten
- test matrix lebih besar

### 15.3 Rekomendasi enterprise

Untuk dokumen legal/email/regulatory:

```text
pre-format critical values in Java
```

Untuk page UI yang fleksibel:

```text
format sederhana boleh di template, tetapi policy tetap centralized
```

---

## 16. Locale dan Timezone sebagai Rendering Input

Jangan mengandalkan default JVM timezone/locale.

Buruk:

```java
LocalDateTime.now()
NumberFormat.getInstance()
```

Lebih baik:

```java
public record RenderContext(
        Locale locale,
        ZoneId zoneId,
        Clock clock,
        String tenantId,
        String correlationId
) {}
```

Untuk rendering service:

```java
RenderRequest request = new RenderRequest(
    templateRef,
    Locale.forLanguageTag("en-SG"),
    ZoneId.of("Asia/Singapore"),
    model
);
```

Kenapa?

Karena output harus bisa direproduksi.

Untuk audit/legal document, perbedaan timezone bisa mengubah meaning:

```text
Submitted at: 2026-06-19 00:30 UTC
Asia/Singapore: 2026-06-19 08:30
America/Los_Angeles: 2026-06-18 17:30
```

Tanggal yang berbeda bisa punya implikasi SLA.

---

## 17. Email Rendering di Spring Boot

FreeMarker sering digunakan untuk email.

### 17.1 Email renderer design

```java
public interface EmailTemplateRenderer {
    RenderedEmail render(EmailRenderRequest request);
}

public record EmailRenderRequest(
        String templateCode,
        String templateVersion,
        Locale locale,
        ZoneId zoneId,
        Map<String, Object> model
) {}

public record RenderedEmail(
        String subject,
        String htmlBody,
        String textBody
) {}
```

Subject juga template.

```text
email/case-assigned/v1/subject.ftl
email/case-assigned/v1/body-html.ftlh
email/case-assigned/v1/body-text.ftl
```

### 17.2 Jangan render hanya HTML

Production email sebaiknya punya:

```text
multipart/alternative
  text/plain
  text/html
```

Alasan:

- email client compatibility
- accessibility
- security policy
- plain text fallback
- deliverability

### 17.3 Email model harus minimal

Buruk:

```java
model.put("case", caseEntity);
model.put("user", userEntity);
model.put("application", applicationEntity);
```

Lebih baik:

```java
model.put("email", new CaseAssignedEmailViewModel(
    displayCaseNo,
    assigneeName,
    assignedAtText,
    caseUrl,
    helpdeskEmail
));
```

Email adalah output yang bisa keluar dari sistem. Jangan kirim data yang tidak perlu ke template.

---

## 18. Document Rendering di Spring Boot

Untuk PDF/document generation, FreeMarker sering digunakan sebagai HTML pre-renderer.

Pipeline:

```text
Domain data
  -> DocumentViewModel
  -> FreeMarker HTML template
  -> HTML string/file
  -> HTML-to-PDF engine
  -> PDF bytes
  -> storage/audit/download
```

### 18.1 Render first, convert second

Pisahkan:

```java
String html = templateRenderer.renderHtml(templateRef, model);
byte[] pdf = pdfGenerator.generate(html);
```

Jangan campur FreeMarker rendering dan PDF conversion dalam satu method besar.

### 18.2 Immutable render record

Untuk dokumen penting, simpan metadata:

```text
renderId
caseId
templateCode
templateVersion
modelVersion
locale
timezone
renderedAt
rendererVersion
contentHash
pdfHash
renderStatus
```

Jika suatu saat user bertanya “kenapa surat ini berisi X?”, sistem harus bisa menjawab berdasarkan snapshot, bukan berdasarkan data terbaru.

### 18.3 Data snapshot vs live data

Buruk:

```text
download letter -> re-query current case data -> render again
```

Masalah:

- output berubah
- audit sulit
- legal defensibility lemah

Lebih baik:

```text
at transition time -> snapshot data -> render -> store output/hash
```

---

## 19. Template Versioning di Spring Application

Untuk template classpath sederhana:

```text
application release version == template version
```

Untuk enterprise correspondence:

```text
template has independent lifecycle
```

Contoh:

```text
Template: CASE_REJECTION_NOTICE
Version: 2026.06.01
State: APPROVED
Effective from: 2026-06-01T00:00:00+08:00
Effective to: null
```

### 19.1 Version selection

```java
TemplateVersion version = templateCatalog.resolve(
    TemplateCode.CASE_REJECTION_NOTICE,
    caseType,
    agency,
    eventTime
);
```

Bukan:

```java
String template = "case-rejection-latest.ftlh";
```

`latest` adalah musuh audit.

### 19.2 Template catalog

```java
public interface TemplateCatalog {
    ResolvedTemplate resolve(TemplateLookup lookup);
}

public record TemplateLookup(
        String templateCode,
        String tenantId,
        Locale locale,
        Instant effectiveAt,
        OutputKind outputKind
) {}

public record ResolvedTemplate(
        String templateCode,
        String version,
        String physicalName,
        OutputKind outputKind
) {}
```

---

## 20. Packaging Templates in JAR and Container Image

### 20.1 Classpath packaging

Recommended untuk templates developer-owned:

```text
src/main/resources/templates/**
```

Build menghasilkan:

```text
BOOT-INF/classes/templates/**
```

di Spring Boot executable JAR.

### 20.2 Container image

Classpath templates immutable dalam image.

Kelebihan:

- environment consistent
- canary/rollback mudah
- template change tracked in Git
- no runtime tampering

Kekurangan:

- business user tidak bisa edit tanpa release

### 20.3 External mounted templates

External template directory cocok jika:

- ada CMS/template management process
- approval workflow kuat
- runtime reload memang requirement
- filesystem access secured

Jika tidak, external template sering menambah risiko lebih besar daripada manfaat.

---

## 21. Runtime Reload Strategy: DEV vs PROD

### 21.1 DEV

Tujuan DEV:

- cepat iterasi
- template reload cepat
- error detail jelas

Policy:

```text
cache=false
template_update_delay=0
HTML debug handler boleh untuk local only
```

### 21.2 PROD

Tujuan PROD:

- stabil
- predictable
- cepat
- tidak leak error detail

Policy:

```text
cache=true
template_update_delay high or irrelevant for classpath templates
RETHROW_HANDLER
no debug output
immutable template release
```

### 21.3 Dynamic template production

Jika template disimpan di DB/object storage:

- jangan reload sembarangan setiap request
- gunakan published version cache
- invalidate cache by version/event
- compile/validate before publish
- use staged rollout
- log template version per render

---

## 22. Error Mapping in Spring MVC

FreeMarker error bisa muncul dari:

- template not found
- parse error
- missing variable
- type mismatch
- method call failure
- macro failure
- output writer failure

### 22.1 MVC error strategy

Untuk page rendering:

```text
Template missing     -> 500 internal error / deployment issue
Template parse error -> 500 internal error / release issue
Missing model field  -> 500 internal error / contract issue
```

Jangan tampilkan FreeMarker stack trace ke user.

### 22.2 Non-web rendering error strategy

Untuk email/document:

```text
TemplateLoadFailed
TemplateRenderFailed
TemplateModelInvalid
TemplateSecurityViolation
TemplateOutputTooLarge
TemplateVersionNotFound
```

Klasifikasi error penting karena retry policy berbeda.

| Error | Retry? | Catatan |
|---|---:|---|
| Template not found | No | deployment/catalog bug |
| Parse error | No | template invalid |
| Missing model field | No, unless upstream data delayed | contract bug |
| Output writer I/O fail | Maybe | storage/network issue |
| Temporary template store unavailable | Yes | infra issue |
| PDF conversion fail | Maybe/No | tergantung cause |

---

## 23. Observability Integration

Rendering harus bisa diobservasi.

### 23.1 Minimum logging fields

```text
correlationId
renderId
templateCode
templateVersion
physicalTemplateName
outputKind
locale
timezone
renderDurationMs
renderStatus
errorCategory
```

Jangan log full model karena bisa mengandung PII.

### 23.2 Metrics

```text
template.render.count{templateCode, outputKind, status}
template.render.duration{templateCode, outputKind}
template.render.failure.count{templateCode, errorCategory}
template.cache.hit.count
template.cache.miss.count
template.output.size.bytes{outputKind}
```

### 23.3 Tracing

Dalam distributed system:

```text
workflow event -> render email -> enqueue email -> send email
```

Rendering harus berada dalam trace agar failure bisa ditelusuri.

### 23.4 Audit vs observability

Observability menjawab:

```text
apakah sistem sehat?
kenapa render lambat?
berapa failure rate?
```

Audit menjawab:

```text
siapa membuat output apa?
kapan?
dengan template versi apa?
dengan data versi apa?
apakah output berubah?
```

Jangan campur keduanya.

---

## 24. Testing Spring Boot FreeMarker Integration

### 24.1 MVC test

```java
@WebMvcTest(CasePageController.class)
class CasePageControllerTest {

    @Autowired
    MockMvc mockMvc;

    @MockBean
    CaseQueryService caseQueryService;

    @Test
    void rendersCaseDetailPage() throws Exception {
        when(caseQueryService.getCaseDetailView(eq("CASE-1"), any()))
                .thenReturn(new CaseDetailViewModel(
                        "CASE-1",
                        "CASE/2026/0001",
                        "Pending Review",
                        "Alice Tan",
                        "19 Jun 2026 10:00",
                        List.of(),
                        List.of()
                ));

        mockMvc.perform(get("/cases/CASE-1"))
                .andExpect(status().isOk())
                .andExpect(content().string(containsString("CASE/2026/0001")))
                .andExpect(content().string(containsString("Pending Review")));
    }
}
```

### 24.2 Renderer unit test

```java
class FreeMarkerTemplateRendererTest {

    private TemplateRenderer renderer;

    @BeforeEach
    void setUp() throws IOException {
        Configuration cfg = new Configuration(Configuration.VERSION_2_3_34);
        cfg.setDefaultEncoding("UTF-8");
        cfg.setTemplateLoader(new ClassTemplateLoader(getClass(), "/templates-test"));
        cfg.setTemplateExceptionHandler(TemplateExceptionHandler.RETHROW_HANDLER);
        cfg.setLogTemplateExceptions(false);
        cfg.setWrapUncheckedExceptions(true);
        cfg.setOutputFormat(HTMLOutputFormat.INSTANCE);
        cfg.setRecognizeStandardFileExtensions(true);

        renderer = new FreeMarkerTemplateRenderer(cfg);
    }

    @Test
    void rendersEmailHtml() {
        Map<String, Object> model = Map.of(
                "email", new CaseAssignedEmailViewModel(
                        "CASE/2026/0001",
                        "Fajar",
                        "19 Jun 2026",
                        "https://example.test/cases/1"
                )
        );

        RenderedTemplate output = renderer.render(new RenderRequest(
                "email/case-assigned/body-html.ftlh",
                Locale.ENGLISH,
                ZoneId.of("Asia/Singapore"),
                OutputKind.HTML,
                model
        ));

        assertThat(output.content()).contains("CASE/2026/0001");
    }
}
```

### 24.3 Golden output test

Golden output cocok untuk document/email yang harus stabil.

```text
render model fixture
  -> normalize whitespace if appropriate
  -> compare with approved output file
```

Hati-hati: golden test yang terlalu brittle bisa menghambat refactor HTML. Gunakan untuk output yang memang kontraktual.

---

## 25. Avoiding N+1 and Lazy Loading from Templates

Template tidak boleh memicu database query.

Buruk:

```ftl
<#list case.applications as app>
  ${app.owner.name}
</#list>
```

Jika `app.owner` lazy-loaded, template bisa memicu query per row.

Lebih baik:

```java
List<ApplicationRowViewModel> rows = queryService.getApplicationRows(caseId);
model.addAttribute("applications", rows);
```

Template:

```ftl
<#list applications as app>
  ${app.ownerName}
</#list>
```

Rule:

```text
All data loading must happen before rendering.
Template rendering must be side-effect-free.
```

---

## 26. Security Boundary in Spring Integration

### 26.1 Never expose powerful beans

Jangan pernah:

```java
model.addAttribute("applicationContext", applicationContext);
model.addAttribute("userService", userService);
model.addAttribute("repository", repository);
model.addAttribute("environment", environment);
model.addAttribute("system", System.class);
```

Template bukan tempat service invocation.

### 26.2 Avoid broad request/session exposure

```yaml
spring:
  freemarker:
    expose-request-attributes: false
    expose-session-attributes: false
```

Jika template butuh sesuatu, proyeksikan secara eksplisit.

### 26.3 CSRF

Untuk form MVC, CSRF token harus tersedia dengan cara yang framework-supported.

Namun prinsipnya:

```text
Template may render CSRF token.
Template must not decide CSRF policy.
```

### 26.4 Authorization rendering

Template boleh hide/show button, tetapi backend tetap harus enforce.

```ftl
<#if viewer.canApprove>
  <button>Approve</button>
</#if>
```

Tetapi endpoint approve tetap harus mengecek permission.

UI authorization bukan security boundary final.

---

## 27. Spring WebFlux Considerations

Spring WebFlux juga memiliki FreeMarker view integration.

Namun perlu hati-hati:

- FreeMarker rendering sendiri bersifat blocking CPU work.
- Template loading bisa blocking tergantung loader.
- Jika data model disiapkan dari reactive sources, kumpulkan model sebelum rendering.
- Jangan melakukan blocking DB/file/network call dari template.

Mental model:

```text
Reactive pipeline prepares model
  -> render template at view layer
  -> write response
```

Jika render berat, pertimbangkan scheduler/worker boundary sesuai desain WebFlux, bukan menjalankan pekerjaan berat sembarangan di event loop.

Untuk aplikasi MVC tradisional, isu ini tidak sama karena request thread memang blocking.

---

## 28. Virtual Threads and FreeMarker Rendering

Pada Java 21+, virtual threads dapat membantu request-per-task atau job-per-task workload yang banyak blocking I/O.

Namun FreeMarker rendering biasanya dominan:

- CPU evaluation
- memory allocation
- writer output
- template lookup/cache

Virtual threads tidak membuat CPU-bound rendering menjadi lebih cepat. Mereka membantu jika rendering pipeline juga melakukan blocking I/O, misalnya:

- loading dynamic template dari DB/object storage
- writing generated output ke remote storage
- calling document service
- sending email

Tetapi template sebaiknya tidak melakukan I/O langsung.

Rule:

```text
Use virtual threads to simplify blocking orchestration around rendering.
Do not use templates as a place to perform blocking operations.
```

---

## 29. Production Configuration Checklist

### 29.1 Spring Boot MVC FreeMarker

```text
[ ] templates stored under classpath:/templates or controlled location
[ ] suffix uses .ftlh for HTML
[ ] UTF-8 configured
[ ] cache enabled in production
[ ] debug exception handler disabled in production
[ ] request/session exposure disabled unless explicitly justified
[ ] output format/auto-escaping policy reviewed
[ ] controllers pass ViewModel, not entity
[ ] no service/repository objects in model
[ ] error page configured
[ ] render latency monitored
```

### 29.2 Rendering service

```text
[ ] template code separated from physical path
[ ] template version supported where needed
[ ] model validation before rendering
[ ] locale/timezone explicit
[ ] output kind explicit
[ ] render failure classified
[ ] full model not logged
[ ] render metrics emitted
[ ] audit metadata recorded for important outputs
[ ] template source secured
[ ] dynamic templates validated before publish
[ ] golden tests for critical templates
```

### 29.3 Security

```text
[ ] no broad session/request exposure
[ ] no Spring ApplicationContext in model
[ ] no service/repository in model
[ ] no domain aggregate directly exposed for sensitive views
[ ] no ?api unless explicitly reviewed
[ ] no unsafe custom directives from untrusted templates
[ ] no raw HTML without sanitization
[ ] no debug output in production
```

---

## 30. Recommended Package Structure

```text
com.example.app.rendering
  TemplateRenderer.java
  RenderRequest.java
  RenderedTemplate.java
  OutputKind.java
  TemplateRef.java
  TemplateCatalog.java
  TemplateRenderException.java
  TemplateLoadFailedException.java
  TemplateModelInvalidException.java

com.example.app.rendering.freemarker
  FreeMarkerTemplateRenderer.java
  FreeMarkerRenderingConfiguration.java
  SecureObjectWrapperFactory.java
  TemplateLoaderFactory.java
  FreeMarkerMetricsInterceptor.java

com.example.app.web.cases
  CasePageController.java
  CaseDetailViewModel.java
  CaseActionViewModel.java

com.example.app.email
  EmailTemplateRenderer.java
  RenderedEmail.java
  CaseAssignedEmailViewModel.java

com.example.app.document
  DocumentGenerationService.java
  DocumentRenderRecord.java
  NoticeDocumentViewModel.java
```

Template files:

```text
src/main/resources/templates/
  pages/
    cases/
      detail.ftlh
  fragments/
    layout.ftlh
    pagination.ftlh
  macros/
    forms.ftlh
    tables.ftlh
  email/
    case-assigned/
      v1/
        subject.ftl
        body-html.ftlh
        body-text.ftl
  document/
    notice-of-action/
      v1/
        body-html.ftlh
```

---

## 31. Common Anti-Patterns

### 31.1 Template reaches into domain model too deeply

```ftl
${case.application.owner.profile.legalName.value}
```

Template knows too much. Create a ViewModel.

### 31.2 Template performs business decision

```ftl
<#if case.status == "SUBMITTED" && case.daysSinceSubmitted > 14 && case.assignee??>
```

This belongs in application logic.

Template should receive:

```java
boolean showEscalationWarning
String escalationWarningText
```

### 31.3 Controller builds huge Map manually

```java
Map<String, Object> model = new HashMap<>();
model.put("a", ...);
model.put("b", ...);
model.put("c", ...);
```

For critical templates, use typed ViewModel.

### 31.4 One FreeMarker configuration for everything

This is not always wrong, but it becomes wrong when MVC, email, document, and dynamic tenant templates have different security/cache/versioning needs.

### 31.5 Runtime editable templates without governance

If business users can edit templates, you need:

- validation
- preview
- approval
- versioning
- rollback
- sandbox
- audit

Without those, dynamic templates are production risk.

### 31.6 Logging rendered output blindly

Rendered output can contain PII, secrets, tokens, or legal content. Log metadata and hashes, not full content, unless you have explicit compliant storage.

---

## 32. Architecture Decision Matrix

| Decision | Option A | Option B | Recommended default |
|---|---|---|---|
| MVC templates | FreeMarker ViewResolver | manual render in controller | ViewResolver |
| Email templates | MVC ViewResolver | rendering service | rendering service |
| Template storage | classpath | external DB/file | classpath unless dynamic editing required |
| Model type | entity | ViewModel | ViewModel |
| Session exposure | broad | explicit projection | explicit projection |
| Error handler PROD | debug output | rethrow | rethrow |
| Template version | latest path | explicit version | explicit for email/document |
| Dynamic template reload | per request | cache by version | cache by version |
| Locale/timezone | JVM default | explicit render context | explicit |
| Output record | not stored | metadata/hash/snapshot | store for important artifacts |

---

## 33. Minimal Production Blueprint

```text
Spring Boot Application

Web Layer
  CasePageController
    -> CaseQueryService returns CaseDetailViewModel
    -> returns logical view name
    -> FreeMarkerViewResolver renders pages/*.ftlh

Rendering Layer
  TemplateRenderingService
    -> resolves TemplateRef via TemplateCatalog
    -> validates model
    -> FreeMarkerTemplateRenderer
    -> emits metrics/logs

Email Layer
  NotificationService
    -> builds EmailViewModel
    -> renders subject/html/text
    -> sends via mail adapter
    -> records communication event

Document Layer
  DocumentGenerationService
    -> builds DocumentViewModel snapshot
    -> renders HTML
    -> converts to PDF
    -> stores PDF + metadata + hash

Template Governance
  classpath templates for developer-owned views
  optional DB-backed versioned templates for business-owned correspondence
  validation before publish
  preview with sample data
  rollback by version
```

---

## 34. What Top 1% Engineers Notice

A surface-level engineer asks:

> How do I configure FreeMarker in Spring Boot?

A strong engineer asks:

> Which rendering pipeline is this: MVC page, email, document, or workflow artifact?

A top-level engineer asks:

> What is the rendering contract, trust boundary, template lifecycle, versioning model, failure mode, observability strategy, and audit requirement?

The key difference is not syntax. It is system design.

FreeMarker integration is not complete when the page renders successfully. It is complete when:

- the template source is controlled
- the data model contract is stable
- the output is escaped correctly
- the model does not expose dangerous objects
- failures are classified
- production errors do not leak internals
- metrics show latency/failure trends
- critical outputs are reproducible
- template changes can be tested and rolled back
- MVC rendering and artifact rendering are not accidentally coupled

---

## 35. Practical Exercise

Design a FreeMarker integration for this scenario:

```text
A case-management system must render:
1. internal case detail web pages
2. email notification when a case is assigned
3. PDF notice when a case is rejected
4. tenant-specific footer text
5. agency-specific branding
6. audit trail for every generated PDF
```

Answer these questions:

1. Which templates are classpath templates?
2. Which templates need versioning?
3. Which outputs need audit records?
4. Which model classes are needed?
5. Is one FreeMarker Configuration enough?
6. Which data can be exposed to templates?
7. How do you prevent session/security object leakage?
8. How do you test missing fields?
9. How do you rollback a broken email template?
10. How do you reproduce a PDF generated three months ago?

Recommended answer direction:

```text
Internal pages:
  classpath templates, MVC ViewResolver, ViewModel, no versioning beyond app release.

Email notification:
  rendering service, subject/html/text templates, explicit template version, preview test, communication audit.

PDF notice:
  rendering service, versioned template, immutable data snapshot, stored output/hash, render metadata.

Tenant footer/branding:
  catalog/fallback mechanism, controlled override, validation before publish.

Configuration:
  at least separate MVC and artifact-rendering policies if document/email governance differs.
```

---

## 36. Summary

FreeMarker integration in Spring Boot/Jakarta applications is not just dependency + template folder.

The correct mental model is:

```text
FreeMarker engine
  + runtime configuration
  + template loader strategy
  + view resolver or rendering service
  + model contract
  + security boundary
  + error policy
  + observability
  + versioning/governance when needed
```

Key takeaways:

1. Separate MVC page rendering from non-web artifact rendering.
2. Use ViewModel, not entity, as template data model.
3. Keep `Configuration` immutable after startup.
4. Prefer classpath templates for developer-owned templates.
5. Use explicit versioning for email/document/regulatory output.
6. Do not expose session/request/security context broadly.
7. Treat locale/timezone as explicit rendering input.
8. Render email as subject + HTML + text.
9. Store metadata/hash/snapshot for important generated documents.
10. Design observability and audit separately.

---

## 37. References

- Apache FreeMarker Manual — Template loading: `https://freemarker.apache.org/docs/pgui_config_templateloading.html`
- Apache FreeMarker Manual — Object wrappers: `https://freemarker.apache.org/docs/pgui_datamodel_objectWrapper.html`
- Apache FreeMarker Manual — Multithreading: `https://freemarker.apache.org/docs/pgui_misc_multithreading.html`
- Apache FreeMarker Manual — Error handling: `https://freemarker.apache.org/docs/pgui_config_errorhandling.html`
- Apache FreeMarker API — `TemplateLoader`: `https://freemarker.apache.org/docs/api/freemarker/cache/TemplateLoader.html`
- Spring Boot Common Application Properties — FreeMarker properties: `https://docs.spring.io/spring-boot/appendix/application-properties/index.html`
- Spring Framework Javadoc — `FreeMarkerViewResolver`: `https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/web/servlet/view/freemarker/FreeMarkerViewResolver.html`
- Spring Framework Javadoc — `FreeMarkerConfigurationFactory`: `https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/ui/freemarker/FreeMarkerConfigurationFactory.html`
- Spring Framework Reference — View technologies / FreeMarker: `https://docs.spring.io/spring-framework/reference/web/webflux-view.html`

---

## 38. Status Seri

```text
Part 11 selesai.
Seri belum selesai.
Berikutnya: Part 12 — Thymeleaf Fundamental Architecture.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-010.md">⬅️ Part 10 — FreeMarker Performance Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-012.md">Part 12 — Thymeleaf Fundamental Architecture ➡️</a>
</div>
