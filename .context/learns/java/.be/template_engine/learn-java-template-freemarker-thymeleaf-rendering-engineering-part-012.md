# learn-java-template-freemarker-thymeleaf-rendering-engineering — Part 12
# Thymeleaf Fundamental Architecture

> Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`  
> Part: `012`  
> Topik: `Thymeleaf Fundamental Architecture`  
> Target: Java 8 sampai Java 25  
> Fokus: memahami Thymeleaf sebagai rendering engine, bukan sekadar kumpulan atribut `th:*`.

---

## 0. Posisi Part Ini dalam Seri

Pada Part 0 sampai Part 2, kita membangun fondasi bahwa template rendering adalah transformasi deterministik:

```text
Template + Data Model + Render Context + Engine Configuration = Output Artifact
```

Pada Part 3 sampai Part 11, kita masuk cukup dalam ke FreeMarker:

- runtime architecture,
- FTL language,
- macro/directive,
- object wrapping,
- escaping,
- diagnostics,
- performance,
- Spring/Jakarta integration.

Mulai Part 12, kita berpindah ke Thymeleaf.

Namun cara berpikirnya tidak berubah: Thymeleaf tetap harus dipahami sebagai **rendering subsystem**. Yang berubah adalah karakter engine-nya.

FreeMarker cenderung berpikir sebagai **text template engine**.

Thymeleaf cenderung berpikir sebagai **markup-aware template engine**, terutama kuat untuk HTML/XML yang ingin tetap valid, bisa dipreview, dan cocok untuk server-side rendered web pages.

---

## 1. Apa Itu Thymeleaf?

Thymeleaf adalah server-side Java template engine untuk web maupun standalone environment. Thymeleaf bisa memproses HTML, XML, JavaScript, CSS, text, dan raw template mode.

Secara sederhana:

```text
Thymeleaf membaca template markup/text,
mengevaluasi expression dan processor,
lalu menghasilkan output final.
```

Namun secara mental model, Thymeleaf bukan hanya string replacement.

Thymeleaf adalah engine yang memproses template melalui kombinasi:

1. **Template Resolver**  
   Menentukan dari mana template diambil.

2. **Template Mode**  
   Menentukan cara template diparse dan diproses.

3. **Template Engine**  
   Mengorkestrasi proses rendering.

4. **Context**  
   Menyediakan variable, locale, dan data render.

5. **Dialect**  
   Menentukan bahasa/fitur yang tersedia di template.

6. **Processor**  
   Menjalankan transformasi spesifik pada node, attribute, text, comment, dan struktur template.

7. **Expression System**  
   Mengevaluasi `${...}`, `#{...}`, `@{...}`, `*{...}`, `~{...}`.

8. **Cache**  
   Menghindari parsing dan resolving berulang untuk template yang sama.

Thymeleaf paling sering dipakai bersama Spring MVC/Spring Boot, tetapi secara arsitektural ia bukan hanya milik Spring.

---

## 2. Masalah yang Diselesaikan Thymeleaf

Template engine sering muncul karena kebutuhan berikut:

1. menghasilkan HTML dinamis,
2. memisahkan presentation dari controller/service,
3. membuat halaman yang bisa dipreview secara statis,
4. menjaga HTML tetap readable,
5. mendukung i18n,
6. mendukung form binding,
7. menyusun layout/fragments,
8. menghindari string concatenation,
9. mengontrol escaping,
10. mempercepat delivery UI sederhana tanpa SPA kompleks.

Thymeleaf secara khusus kuat ketika output utama adalah **HTML yang tetap ingin terlihat seperti HTML biasa**.

Contoh sederhana:

```html
<p th:text="${user.displayName}">Static Name</p>
```

Saat dibuka langsung di browser sebagai file HTML statis, teks `Static Name` tetap terlihat.

Saat diproses Thymeleaf, isi elemen diganti oleh nilai `user.displayName`.

Inilah ide **natural template**.

---

## 3. Natural Template: Ide Kunci Thymeleaf

Natural template berarti template masih bisa dibuka, dibaca, dan dipreview sebagai dokumen valid bahkan tanpa server.

Bandingkan pendekatan berikut.

### 3.1 Template yang Tidak Natural

```html
<p>Hello ${name}</p>
```

File ini bisa dibuka di browser, tetapi hasilnya terlihat sebagai placeholder mentah:

```text
Hello ${name}
```

Untuk developer, ini bisa diterima. Untuk designer, QA, atau reviewer UI, ini kurang ideal.

### 3.2 Template Natural ala Thymeleaf

```html
<p th:text="${name}">Hello, Static Preview Name</p>
```

Tanpa Thymeleaf:

```html
<p>Hello, Static Preview Name</p>
```

Dengan Thymeleaf:

```html
<p>Fajar</p>
```

Makna pentingnya:

```text
Thymeleaf tidak hanya menaruh placeholder ke markup.
Thymeleaf mendekorasi markup valid dengan instruksi transformasi.
```

Atribut `th:text` adalah instruction untuk runtime. Konten elemen tetap menjadi fallback/prototype.

---

## 4. FreeMarker vs Thymeleaf dari Sudut Arsitektur

FreeMarker dan Thymeleaf sama-sama template engine, tetapi memiliki pusat gravitasi berbeda.

| Aspek | FreeMarker | Thymeleaf |
|---|---|---|
| Mental model utama | Text generation | Markup/DOM-like transformation |
| Format utama | Text, HTML, email, config, source, XML | HTML/XML web page, text, JS, CSS |
| Template natural | Tidak menjadi desain utama | Desain utama |
| Syntax | FTL directive dan interpolation | HTML attributes dan expressions |
| Cocok untuk | Email, document pre-render, config/code generation, generic text | Server-side HTML, form-heavy pages, admin portal, MVC views |
| Composition | Macro/include/import | Fragment/layout/dialect processor |
| Extension point | Directive, method, object wrapper | Dialect, processor, expression object |
| Designer friendliness | Sedang | Tinggi untuk HTML |
| Web MVC integration | Ada | Sangat kuat, terutama Spring ecosystem |

Kesalahan umum adalah menganggap keduanya hanya alternatif syntax.

Lebih tepat:

```text
FreeMarker unggul saat output adalah text artifact general-purpose.
Thymeleaf unggul saat output adalah HTML/markup yang ingin tetap natural dan maintainable.
```

---

## 5. Thymeleaf Rendering Pipeline

Secara konseptual, pipeline Thymeleaf bisa dipahami seperti ini:

```text
Caller
  |
  v
TemplateEngine.process(templateName, context)
  |
  v
Resolve Template
  |
  v
Determine Template Mode
  |
  v
Parse Template
  |
  v
Apply Dialects and Processors
  |
  v
Evaluate Expressions
  |
  v
Produce Output
  |
  v
Writer/String/HTTP Response
```

Untuk sistem production, setiap tahap memiliki konsekuensi.

## 5.1 Caller

Caller bisa berupa:

- Spring MVC view resolver,
- service email renderer,
- document generation worker,
- batch job,
- BPMN delegate,
- REST endpoint yang mengembalikan HTML fragment,
- test harness.

Contoh standalone:

```java
TemplateEngine engine = new TemplateEngine();
Context context = new Context(Locale.ENGLISH);
context.setVariable("name", "Fajar");
String html = engine.process("welcome", context);
```

## 5.2 Resolve Template

Template name seperti `welcome` harus diubah menjadi resource nyata, misalnya:

```text
classpath:/templates/welcome.html
```

Resolver bertanggung jawab menjawab:

1. template ini ada atau tidak,
2. lokasinya di mana,
3. template mode-nya apa,
4. encoding-nya apa,
5. cacheable atau tidak,
6. TTL cache berapa,
7. resolver mana yang menang jika banyak resolver.

## 5.3 Parse Template

Parsing tergantung template mode.

HTML mode berbeda dari XML mode. TEXT mode berbeda dari JAVASCRIPT mode.

## 5.4 Apply Dialect and Processor

Thymeleaf memproses template melalui processor yang disediakan dialect.

Misalnya Standard Dialect menyediakan processor untuk:

- `th:text`,
- `th:each`,
- `th:if`,
- `th:href`,
- `th:insert`,
- `th:replace`,
- dan lain-lain.

## 5.5 Evaluate Expressions

Expression seperti:

```html
<span th:text="${user.name}">Name</span>
```

dievaluasi terhadap context variable.

## 5.6 Produce Output

Output bisa dikembalikan sebagai `String`, ditulis ke `Writer`, atau masuk ke HTTP response melalui view layer.

---

## 6. Komponen Utama Thymeleaf

## 6.1 `TemplateEngine`

`TemplateEngine` adalah objek pusat yang memproses template.

Ia memegang konfigurasi seperti:

- template resolver,
- dialect,
- message resolver,
- link builder,
- cache manager,
- engine context factory.

Mental model:

```text
TemplateEngine adalah runtime renderer.
```

Satu aplikasi biasanya memiliki satu atau beberapa instance `TemplateEngine`, tergantung kebutuhan.

Contoh satu engine umum:

```java
ClassLoaderTemplateResolver resolver = new ClassLoaderTemplateResolver();
resolver.setPrefix("templates/");
resolver.setSuffix(".html");
resolver.setTemplateMode(TemplateMode.HTML);
resolver.setCharacterEncoding(StandardCharsets.UTF_8.name());
resolver.setCacheable(true);

TemplateEngine engine = new TemplateEngine();
engine.setTemplateResolver(resolver);
```

Catatan desain:

```text
TemplateEngine sebaiknya dikonfigurasi sekali saat startup,
lalu dipakai berulang sebagai shared runtime component.
```

Jangan membuat `TemplateEngine` baru per request.

---

## 6.2 `ITemplateResolver`

Template resolver menentukan bagaimana nama template berubah menjadi resource.

Jenis resolver umum:

1. `ClassLoaderTemplateResolver`
2. `FileTemplateResolver`
3. `ServletContextTemplateResolver`
4. `StringTemplateResolver`
5. Spring resource template resolver dalam integrasi Spring

Contoh classpath resolver:

```java
ClassLoaderTemplateResolver resolver = new ClassLoaderTemplateResolver();
resolver.setPrefix("templates/");
resolver.setSuffix(".html");
resolver.setTemplateMode(TemplateMode.HTML);
resolver.setCharacterEncoding("UTF-8");
resolver.setCacheable(true);
```

Jika caller memanggil:

```java
engine.process("email/welcome", context);
```

maka resolver dapat mencari:

```text
classpath:/templates/email/welcome.html
```

### Resolver sebagai Boundary

Resolver adalah boundary penting karena menentukan:

- apakah template bisa diubah runtime,
- apakah template berasal dari artifact immutable,
- apakah template bisa diambil dari filesystem,
- apakah multi-tenant template didukung,
- apakah user bisa mempengaruhi template name,
- apakah template traversal attack mungkin terjadi,
- apakah template cache aman.

Rule production:

```text
Template name dari user input tidak boleh langsung dipakai tanpa validasi/allowlist.
```

Buruk:

```java
String page = request.getParameter("page");
return engine.process(page, context);
```

Lebih aman:

```java
enum TemplateId {
    WELCOME_EMAIL("email/welcome"),
    CASE_APPROVED("case/approved"),
    CASE_REJECTED("case/rejected");

    private final String path;

    TemplateId(String path) {
        this.path = path;
    }

    public String path() {
        return path;
    }
}
```

---

## 6.3 `IContext` dan `Context`

Context adalah container variable untuk render.

Contoh:

```java
Context context = new Context(Locale.forLanguageTag("id-ID"));
context.setVariable("caseNo", "CEA-2026-0001");
context.setVariable("officerName", "Fajar");
context.setVariable("approved", true);
```

Template:

```html
<p th:text="${caseNo}">CASE-NO</p>
<p th:if="${approved}">Approved</p>
```

Context berisi:

- variable map,
- locale,
- terkadang web exchange/request-specific object tergantung integrasi.

Mental model:

```text
Context adalah render-time input envelope.
```

Namun jangan menganggap context sebagai tempat membuang semua object.

Buruk:

```java
context.setVariable("caseEntity", caseEntity);
context.setVariable("userSession", session);
context.setVariable("securityContext", securityContext);
context.setVariable("repository", repository);
```

Lebih baik:

```java
CaseDecisionViewModel vm = CaseDecisionViewModel.from(caseAggregate, permissions);
context.setVariable("case", vm);
```

Template harus menerima **view model**, bukan domain aggregate mentah.

---

## 6.4 Template Mode

Template mode menentukan bagaimana Thymeleaf memahami template.

Mode utama:

| Mode | Digunakan untuk | Karakter |
|---|---|---|
| `HTML` | halaman web HTML | forgiving, HTML-oriented |
| `XML` | XML strict | well-formed XML expectation |
| `TEXT` | plain text email/file | text-oriented |
| `JAVASCRIPT` | JS template | JS-aware output |
| `CSS` | CSS template | CSS-aware output |
| `RAW` | tidak diproses sebagai markup | raw passthrough style |

Pemilihan mode bukan kosmetik.

Ia memengaruhi:

- parsing,
- escaping,
- validitas output,
- processor behavior,
- inline expression handling,
- security context.

Contoh HTML:

```html
<p th:text="${message}">Message</p>
```

Contoh TEXT:

```text
Dear [[${recipientName}]],

Your case [[${caseNo}]] has been approved.
```

Contoh JAVASCRIPT inline perlu sangat hati-hati:

```html
<script th:inline="javascript">
    const username = [[${username}]];
</script>
```

Rule:

```text
Jangan pakai HTML mode untuk semua hal hanya karena familiar.
Pilih template mode sesuai output artifact.
```

---

## 6.5 Dialect

Dialect adalah kumpulan fitur yang membuat Thymeleaf memahami instruksi tertentu.

Dialect bisa berisi:

- processor,
- expression object,
- execution attribute,
- pre-processor,
- post-processor.

Standard Dialect menyediakan prefix `th`.

Contoh:

```html
<span th:text="${user.name}">Name</span>
```

Spring Standard Dialect memperluas kemampuan Thymeleaf untuk integrasi dengan Spring, misalnya:

- Spring Expression Language,
- form binding,
- validation errors,
- Spring conversion service,
- Spring message resolution.

Spring Security dialect menyediakan prefix seperti `sec` untuk rendering berdasarkan authentication/authorization.

Contoh:

```html
<div sec:authorize="hasRole('ADMIN')">
    Admin only
</div>
```

Namun ingat:

```text
Authorization rendering di UI hanya presentation concern.
Backend authorization tetap wajib.
```

---

## 6.6 Processor

Processor adalah unit kerja yang mengubah template.

Misalnya processor untuk `th:text` akan:

1. menemukan attribute `th:text`,
2. mengevaluasi expression,
3. mengganti body elemen dengan hasil escaped,
4. menghapus attribute `th:text` dari output final.

Input:

```html
<p th:text="${user.name}">Static Name</p>
```

Output:

```html
<p>Fajar</p>
```

Processor untuk `th:if` bisa menghapus node dari output.

Input:

```html
<button th:if="${canApprove}">Approve</button>
```

Jika `canApprove=false`, output-nya kosong untuk node itu.

Ini penting:

```text
Thymeleaf bukan hanya mengganti teks.
Thymeleaf bisa mengubah struktur markup.
```

---

## 6.7 Expression Objects

Expression object adalah object khusus yang tersedia di expression.

Contoh utility objects umum:

- `#dates`,
- `#calendars`,
- `#numbers`,
- `#strings`,
- `#lists`,
- `#sets`,
- `#maps`,
- `#arrays`,
- `#messages`,
- `#uris`,
- `#temporals` dalam konteks modern tertentu.

Contoh:

```html
<span th:text="${#strings.toUpperCase(user.name)}">NAME</span>
```

Namun expression object bisa menjadi jebakan jika dipakai untuk terlalu banyak logika.

Buruk:

```html
<span th:text="${#lists.contains(#strings.arraySplit(case.tagsCsv, ','), 'URGENT') ? 'Urgent' : 'Normal'}">
    Status
</span>
```

Lebih baik:

```java
viewModel.setUrgencyLabel(casePolicy.resolveUrgencyLabel(caseAggregate));
```

Template:

```html
<span th:text="${case.urgencyLabel}">Urgency</span>
```

Rule:

```text
Expression object boleh untuk formatting ringan,
bukan untuk business rule composition.
```

---

## 6.8 Message Resolver

Message resolver dipakai untuk i18n.

Contoh template:

```html
<h1 th:text="#{case.approved.title}">Case Approved</h1>
```

Message bundle:

```properties
case.approved.title=Case Approved
```

Untuk Indonesia:

```properties
case.approved.title=Perkara Disetujui
```

Context locale menentukan pesan mana yang dipilih.

Dalam Spring integration, Thymeleaf dapat memakai `MessageSource` Spring.

Mental model:

```text
Template menentukan message key.
Locale + message resolver menentukan text final.
```

---

## 6.9 Link Builder

Thymeleaf memiliki link expression:

```html
<a th:href="@{/cases/{id}(id=${case.id})}">View</a>
```

Output bisa menjadi:

```html
<a href="/cases/123">View</a>
```

Dalam web environment, link builder dapat mempertimbangkan context path dan URL rewriting.

Rule:

```text
Jangan build URL dengan string concatenation di template jika link expression cukup.
```

Buruk:

```html
<a th:href="'/cases/' + ${case.id}">View</a>
```

Lebih baik:

```html
<a th:href="@{/cases/{id}(id=${case.id})}">View</a>
```

---

## 6.10 Cache Manager

Thymeleaf dapat cache parsed template agar tidak parsing ulang setiap request.

Cache penting karena rendering web sering repetitif:

```text
same template + different model = many renders
```

Di production:

```text
cacheable = true
```

Di development:

```text
cacheable = false
```

agar perubahan template langsung terlihat.

Namun dynamic template system harus lebih hati-hati:

- cache invalidation,
- template version,
- tenant-specific cache key,
- published/draft isolation,
- memory bound,
- TTL.

---

## 7. Template Mode Deep Dive Awal

Part ini hanya fundamental architecture, tetapi template mode cukup penting untuk dibahas lebih detail.

## 7.1 HTML Mode

HTML mode adalah mode paling umum untuk Thymeleaf.

Karakter:

- cocok untuk HTML5,
- tidak membutuhkan XML strictness,
- cocok untuk browser-oriented output,
- mendukung natural template,
- ideal untuk MVC pages.

Contoh:

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <title th:text="${pageTitle}">Static Title</title>
</head>
<body>
    <h1 th:text="${heading}">Heading</h1>
</body>
</html>
```

## 7.2 XML Mode

XML mode cocok jika output harus well-formed XML.

Contoh:

```xml
<notice>
    <caseNo th:text="${caseNo}">CASE</caseNo>
</notice>
```

Gunakan ketika output dikonsumsi sistem lain yang butuh XML valid.

## 7.3 TEXT Mode

TEXT mode cocok untuk plain text email atau file text.

Contoh:

```text
Dear [[${name}]],

Your case [[${caseNo}]] is now [[${status}]].
```

## 7.4 JAVASCRIPT Mode

JAVASCRIPT mode berguna untuk template JS, tetapi harus sangat hati-hati.

Masalah utama:

```text
JavaScript context escaping tidak sama dengan HTML escaping.
```

Contoh umum:

```html
<script th:inline="javascript">
    const user = {
        name: [[${user.name}]],
        role: [[${user.role}]]
    };
</script>
```

Rule enterprise:

```text
Lebih aman meletakkan data JSON di endpoint API
atau script block khusus yang benar-benar dikontrol,
daripada menyebarkan inline JS dinamis di banyak template.
```

## 7.5 CSS Mode

CSS mode relatif jarang dipakai, tetapi bisa berguna untuk theming terbatas.

Namun dynamic CSS juga rawan kompleksitas.

Untuk enterprise UI, biasanya lebih baik:

- static CSS,
- design token,
- CSS variables,
- class switching,
- theme bundle.

## 7.6 RAW Mode

RAW mode berarti konten tidak diproses sebagai markup normal.

Gunakan hanya jika benar-benar butuh.

---

## 8. Standard Dialect: Bahasa Default Thymeleaf

Standard Dialect adalah dialect default jika tidak ada dialect eksplisit.

Ia menyediakan banyak attribute `th:*`, misalnya:

| Attribute | Fungsi |
|---|---|
| `th:text` | mengganti text content dengan escaped value |
| `th:utext` | mengganti text content dengan unescaped value |
| `th:if` | conditional rendering |
| `th:unless` | inverse conditional |
| `th:each` | loop |
| `th:href` | set href URL |
| `th:src` | set src URL |
| `th:classappend` | append class |
| `th:object` | selection root/form binding |
| `th:field` | form field binding |
| `th:insert` | insert fragment |
| `th:replace` | replace with fragment |
| `th:fragment` | define fragment |
| `th:inline` | enable inline expression mode |

Part 13 sampai Part 16 akan membahas attribute dan expression secara detail.

Untuk sekarang, yang penting adalah:

```text
Standard Dialect = instruction set default yang membuat Thymeleaf useful.
```

---

## 9. Spring Standard Dialect

Ketika memakai Thymeleaf dengan Spring MVC/Spring Boot, biasanya engine yang dipakai adalah `SpringTemplateEngine`.

Spring integration menambahkan kemampuan penting:

1. Spring Expression Language.
2. Spring `MessageSource` integration.
3. Spring conversion service.
4. Form binding.
5. Validation error rendering.
6. Request/session/application attribute access sesuai konfigurasi.
7. View resolver integration.

Contoh form:

```html
<form th:object="${caseForm}" th:action="@{/cases}" method="post">
    <input th:field="*{caseNo}" />
    <span th:if="${#fields.hasErrors('caseNo')}" th:errors="*{caseNo}"></span>
    <button type="submit">Submit</button>
</form>
```

Ini bukan hanya template syntax. Ini menyambungkan:

```text
HTML form
  -> Spring MVC binding
  -> validation
  -> BindingResult
  -> Thymeleaf error rendering
```

Karena itu, Thymeleaf sangat kuat untuk admin portal, internal tools, CRUD-ish enterprise UI, dan form-heavy workflows.

---

## 10. Decoupled Template Logic

Thymeleaf mendukung pendekatan di mana sebagian logic template bisa diletakkan di file terpisah dari markup.

Ide besarnya:

```text
HTML tetap bersih untuk designer,
sementara instruksi Thymeleaf dapat dipisah.
```

Ini disebut decoupled template logic.

Contoh use case:

- organisasi punya HTML template yang diedit designer,
- tim engineering tidak ingin menaruh terlalu banyak `th:*` ke file HTML,
- ada kebutuhan menjaga markup prototype tetap dekat dengan static HTML.

Namun dalam practice, ini harus dipakai selektif.

Kelebihan:

- HTML lebih bersih,
- separation antara prototype dan runtime instruction,
- cocok untuk workflow designer-heavy.

Risiko:

- logic tersembunyi,
- debugging lebih sulit,
- reviewer harus membuka dua file,
- mismatch markup selector,
- tool support lebih terbatas.

Rule:

```text
Decoupled template logic cocok untuk organisasi yang benar-benar punya workflow designer/developer terpisah.
Untuk kebanyakan backend-rendered enterprise apps, inline th:* lebih eksplisit dan mudah direview.
```

---

## 11. Fragment dan Layout dalam Arsitektur Thymeleaf

Fragment adalah unit reuse.

Contoh fragment:

```html
<header th:fragment="mainHeader(title)">
    <h1 th:text="${title}">Page Title</h1>
</header>
```

Pemakaian:

```html
<div th:replace="~{fragments/header :: mainHeader(${pageTitle})}"></div>
```

Mental model:

```text
Fragment adalah template-level component.
```

Tetapi jangan langsung menyamakannya dengan React/Vue component.

Perbedaan penting:

| Aspek | Thymeleaf Fragment | SPA Component |
|---|---|---|
| Runtime | Server-side render | Client-side/server-side JS runtime |
| State | Dari model server | Component state/store/browser |
| Interactivity | Butuh JS tambahan | Built-in framework behavior |
| Lifecycle | Render sekali per request | Mount/update/unmount |
| Use case | HTML composition | UI application composition |

Fragment kuat untuk:

- layout shell,
- header/footer/sidebar,
- form field snippets,
- alert component,
- table pagination,
- common button groups,
- empty state.

Part 16 akan membahas fragment secara mendalam.

---

## 12. Thymeleaf sebagai MVC View Engine

Dalam Spring MVC, request lifecycle bisa digambarkan:

```text
HTTP Request
  |
  v
Controller
  |
  v
Model attributes
  |
  v
Return view name
  |
  v
ViewResolver
  |
  v
ThymeleafView
  |
  v
TemplateEngine
  |
  v
HTML Response
```

Contoh controller:

```java
@GetMapping("/cases/{id}")
public String detail(@PathVariable long id, Model model) {
    CaseDetailView view = caseQueryService.getDetailView(id);
    model.addAttribute("case", view);
    return "cases/detail";
}
```

Template path:

```text
classpath:/templates/cases/detail.html
```

Template:

```html
<h1 th:text="${case.caseNo}">CASE-NO</h1>
<p th:text="${case.statusLabel}">Status</p>
```

Yang harus diperhatikan:

```text
Controller bertugas memilih view dan menyediakan view model.
Template bertugas menampilkan view model.
Service/domain bertugas menjalankan business rule.
```

Jangan membalik tanggung jawab.

---

## 13. Thymeleaf sebagai Standalone Renderer

Thymeleaf tidak harus dipakai sebagai MVC view.

Ia bisa dipakai untuk:

- email body,
- static report,
- HTML-to-PDF pre-render,
- text notification,
- simple XML generation,
- offline batch rendering.

Contoh service:

```java
public final class ThymeleafEmailRenderer {

    private final TemplateEngine templateEngine;

    public ThymeleafEmailRenderer(TemplateEngine templateEngine) {
        this.templateEngine = templateEngine;
    }

    public String renderWelcomeEmail(WelcomeEmailModel model, Locale locale) {
        Context context = new Context(locale);
        context.setVariable("email", model);
        return templateEngine.process("email/welcome", context);
    }
}
```

Dalam konteks standalone, Anda harus eksplisit mengatur:

- template resolver,
- encoding,
- template mode,
- cache,
- message resolver,
- context variable,
- locale.

---

## 14. Data Model dalam Thymeleaf

Data model di Thymeleaf harus dianggap sebagai public API untuk template.

Misalnya:

```java
public record CaseDetailView(
        String caseNo,
        String statusLabel,
        String applicantName,
        boolean canApprove,
        List<DocumentRow> documents
) {}
```

Template:

```html
<h1 th:text="${case.caseNo}">CASE-NO</h1>
<p th:text="${case.statusLabel}">Status</p>
<button th:if="${case.canApprove}">Approve</button>
```

Jika field diubah, template bisa rusak.

Jadi model harus dikelola seperti contract.

Rule:

```text
Jangan expose JPA entity langsung ke template.
```

Alasannya:

1. lazy loading bisa terjadi saat render,
2. N+1 query tersembunyi,
3. field sensitif bisa bocor,
4. domain model coupling tinggi,
5. template bisa memanggil getter yang mahal,
6. authorization field-level sulit dikontrol,
7. perubahan entity memecahkan UI.

Lebih baik:

```text
Domain Aggregate -> Application Query -> ViewModel -> Template
```

---

## 15. Escaping Default dan `th:text` vs `th:utext`

Salah satu konsep paling penting:

```text
th:text melakukan escaping.
th:utext menghasilkan unescaped text.
```

Contoh:

```html
<p th:text="${comment}">Comment</p>
```

Jika `comment` bernilai:

```html
<script>alert('xss')</script>
```

maka output seharusnya ditampilkan sebagai teks aman, bukan script berjalan.

Sebaliknya:

```html
<p th:utext="${comment}">Comment</p>
```

berarti Anda sengaja memasukkan HTML mentah.

Rule:

```text
Gunakan th:text sebagai default.
Gunakan th:utext hanya untuk HTML yang sudah disanitasi dan dipercaya.
```

Part 17 akan membahas security lebih dalam.

---

## 16. Thymeleaf dan Java 8 sampai Java 25

Karena seri ini mencakup Java 8 sampai Java 25, kita perlu melihat Thymeleaf dari aspek runtime Java.

## 16.1 Java 8 Baseline Thinking

Pada Java 8, Anda punya:

- lambda,
- stream,
- `Optional`,
- `java.time`,
- default methods,
- mature servlet ecosystem.

Untuk Thymeleaf:

- view model bisa memakai POJO atau immutable-style class,
- `java.time` sebaiknya dipakai untuk date/time,
- hindari logic Stream kompleks di template,
- lakukan formatting konsisten.

## 16.2 Java 11/17 Enterprise Baseline

Java 11 dan 17 banyak dipakai sebagai LTS production baseline.

Desain yang lebih baik:

- records pada Java 16+ untuk view model immutable,
- sealed class untuk modelling rendering variant pada Java 17+,
- stronger encapsulation module awareness,
- better GC/runtime observability.

Contoh record view model:

```java
public record CaseSummaryRow(
        String caseNo,
        String applicantName,
        String statusLabel,
        String submittedDateLabel
) {}
```

## 16.3 Java 21/25 Modern Runtime Thinking

Pada Java 21+, virtual threads tersedia sebagai fitur final. Namun ini tidak berarti template rendering otomatis harus memakai virtual threads.

Thymeleaf rendering sendiri umumnya CPU + memory allocation + I/O output ringan/sedang.

Virtual threads lebih relevan jika rendering workflow melibatkan blocking I/O di sekitar proses, misalnya:

- mengambil template dari remote store,
- batch rendering + upload artifact,
- email send blocking,
- document generation pipeline blocking.

Tetapi rule penting:

```text
Jangan lakukan DB/API call dari template.
```

Virtual threads tidak membenarkan hidden I/O di rendering expression.

---

## 17. Production Setup Minimal

Contoh standalone production-ish setup:

```java
public final class ThymeleafFactory {

    public static TemplateEngine createHtmlEngine() {
        ClassLoaderTemplateResolver resolver = new ClassLoaderTemplateResolver();
        resolver.setPrefix("templates/");
        resolver.setSuffix(".html");
        resolver.setTemplateMode(TemplateMode.HTML);
        resolver.setCharacterEncoding(StandardCharsets.UTF_8.name());
        resolver.setCacheable(true);
        resolver.setCheckExistence(true);

        TemplateEngine engine = new TemplateEngine();
        engine.setTemplateResolver(resolver);
        return engine;
    }

    private ThymeleafFactory() {
    }
}
```

Untuk Spring Boot, sering kali cukup:

```properties
spring.thymeleaf.prefix=classpath:/templates/
spring.thymeleaf.suffix=.html
spring.thymeleaf.mode=HTML
spring.thymeleaf.encoding=UTF-8
spring.thymeleaf.cache=true
```

Development:

```properties
spring.thymeleaf.cache=false
```

Production:

```properties
spring.thymeleaf.cache=true
```

---

## 18. Production Architecture Pattern

Untuk sistem enterprise, hindari engine dipakai langsung dari seluruh codebase.

Buruk:

```text
Controller A -> TemplateEngine
Controller B -> TemplateEngine
Batch Job -> TemplateEngine
Email Service -> TemplateEngine
Document Service -> TemplateEngine
```

Lebih baik:

```text
Controller / Batch / Workflow
  |
  v
Rendering Application Service
  |
  v
Template Catalog / Template Id
  |
  v
Model Validator
  |
  v
Thymeleaf Adapter
  |
  v
TemplateEngine
```

Contoh interface:

```java
public interface HtmlRenderer {
    RenderedHtml render(TemplateId templateId, Object model, RenderContext context);
}
```

Render context:

```java
public record RenderContext(
        Locale locale,
        ZoneId zoneId,
        String correlationId,
        String tenantId,
        String templateVersion
) {}
```

Output:

```java
public record RenderedHtml(
        TemplateId templateId,
        String templateVersion,
        String html,
        Instant renderedAt
) {}
```

Manfaat:

- template usage terkontrol,
- logging konsisten,
- metrics konsisten,
- security policy terpusat,
- versioning bisa diterapkan,
- test lebih mudah,
- engine bisa diganti/adapted.

---

## 19. Failure Model Thymeleaf

Rendering bisa gagal karena:

1. template tidak ditemukan,
2. template syntax invalid,
3. expression gagal,
4. variable missing,
5. resolver salah konfigurasi,
6. encoding salah,
7. locale/message missing,
8. fragment tidak ditemukan,
9. form binding mismatch,
10. security dialect expression salah,
11. cache stale,
12. model type tidak sesuai.

Production renderer harus mengklasifikasi error.

Contoh:

```java
public enum RenderFailureType {
    TEMPLATE_NOT_FOUND,
    TEMPLATE_PARSE_ERROR,
    MODEL_CONTRACT_ERROR,
    EXPRESSION_EVALUATION_ERROR,
    MESSAGE_RESOLUTION_ERROR,
    SECURITY_POLICY_VIOLATION,
    OUTPUT_WRITE_ERROR,
    UNKNOWN
}
```

Jangan hanya lempar `RuntimeException` generik.

Rendering failure dalam workflow regulatory/case management punya dampak:

- email tidak terkirim,
- notice tidak dibuat,
- SLA reminder gagal,
- user tidak bisa approve,
- document legal tidak lengkap,
- audit trail kosong.

Karena itu rendering harus observable.

---

## 20. Observability Minimum

Metric yang sebaiknya ada:

1. render count by template id,
2. render latency,
3. render failure count,
4. template not found count,
5. model validation failure,
6. cache hit/miss jika tersedia,
7. output size,
8. tenant/template version dimension,
9. locale dimension bila relevan.

Log minimal:

```text
event=template_render_failed
correlationId=...
templateId=case-approved-letter
templateVersion=2026.06.01
locale=id-ID
failureType=MODEL_CONTRACT_ERROR
exceptionClass=...
```

Jangan log seluruh model jika berisi PII.

Gunakan redaction.

---

## 21. Security Boundary Fundamental

Pada level fundamental architecture, security rule utama Thymeleaf adalah:

```text
Template boleh tahu cara menampilkan data.
Template tidak boleh punya akses bebas ke sistem.
```

Hindari context variable seperti:

```java
context.setVariable("applicationContext", applicationContext);
context.setVariable("dataSource", dataSource);
context.setVariable("repository", repository);
context.setVariable("securityContext", securityContext);
context.setVariable("httpServletRequest", request);
```

Lebih aman:

```java
context.setVariable("case", caseView);
context.setVariable("permissions", permissionView);
context.setVariable("links", linkView);
```

Jika menggunakan Spring MVC, beberapa object web mungkin tersedia melalui integrasi. Tetap jangan menjadikan template sebagai tempat melakukan business/security decision final.

---

## 22. Anti-Pattern Arsitektur Thymeleaf

## 22.1 Fat Template

Template berisi terlalu banyak logic:

```html
<tr th:each="case : ${cases}"
    th:if="${case.status.name() == 'APPROVED' and case.approver != null and #lists.contains(currentUser.roles, 'SUPERVISOR')}">
```

Masalah:

- business rule bocor,
- sulit dites,
- mudah tidak konsisten dengan backend,
- reviewer harus memahami domain rule dari HTML.

Solusi:

```java
caseRow.setVisibleToCurrentUser(policy.canView(row, currentUser));
```

Template:

```html
<tr th:each="case : ${cases}" th:if="${case.visible}">
```

## 22.2 Entity Rendering

Buruk:

```java
model.addAttribute("case", caseJpaEntity);
```

Template:

```html
<span th:text="${case.applicant.profile.identityDocument.number}"></span>
```

Risiko:

- lazy loading,
- N+1,
- sensitive data leak,
- coupling.

## 22.3 Template Name from Request

Buruk:

```java
return request.getParameter("view");
```

Risiko:

- unauthorized template render,
- path traversal style issue,
- information exposure,
- bypass view governance.

## 22.4 `th:utext` Everywhere

Buruk:

```html
<div th:utext="${userInput}"></div>
```

Risiko:

- XSS.

## 22.5 Fragment as Uncontrolled Component Jungle

Jika fragment dibuat tanpa guideline, hasilnya:

- nested fragment berlebihan,
- parameter tidak jelas,
- sulit trace layout,
- circular mental dependency,
- UI inconsistent.

---

## 23. Design Heuristics untuk Top 1% Engineer

## 23.1 Treat Template as a Contract

Template bukan file bebas.

Template memiliki contract:

```text
requires variables X, Y, Z
expects locale L
outputs format F
uses fragments A, B, C
safe under escaping policy P
version V
```

## 23.2 Shape Model Before Rendering

Semua keputusan mahal harus selesai sebelum render:

- permission,
- status label,
- formatting policy,
- link availability,
- button visibility,
- error summary,
- localized labels bila perlu,
- data redaction.

## 23.3 Keep Template Boring

Template yang baik sering terlihat membosankan:

```html
<h1 th:text="${page.title}">Title</h1>
<p th:text="${page.description}">Description</p>
<tr th:each="row : ${page.rows}">
    <td th:text="${row.caseNo}">CASE</td>
    <td th:text="${row.statusLabel}">Status</td>
</tr>
```

Boring berarti:

- mudah direview,
- mudah dites,
- rendah risiko,
- stabil.

## 23.4 Use Fragments as Public UI APIs

Fragment harus punya parameter jelas.

Buruk:

```html
<div th:fragment="statusBadge">
    <span th:text="${case.status}"></span>
</div>
```

Fragment bergantung pada global variable `case`.

Lebih baik:

```html
<span th:fragment="statusBadge(label, cssClass)"
      th:class="${cssClass}"
      th:text="${label}">
    Status
</span>
```

## 23.5 Separate Rendering Decisions from Business Decisions

Business decision:

```text
Can this user approve this case?
```

Rendering decision:

```text
Should the approve button be visible/enabled, and with what tooltip?
```

Backend tetap harus enforce authorization.

Template hanya merefleksikan state presentation.

---

## 24. Thymeleaf dalam Regulatory/Case Management System

Untuk sistem case management, Thymeleaf sering cocok untuk:

1. internal admin portal,
2. officer task pages,
3. review/approval pages,
4. search/list pages,
5. email preview,
6. letter preview sebelum PDF,
7. printable HTML,
8. workflow notification.

Contoh model:

```java
public record CaseDecisionPage(
        String caseNo,
        String title,
        String statusLabel,
        String applicantName,
        boolean canApprove,
        boolean canReject,
        List<ActionView> actions,
        List<DocumentRow> documents,
        AuditSummaryView auditSummary
) {}
```

Template:

```html
<h1 th:text="${page.title}">Case Decision</h1>
<p th:text="${page.caseNo}">CASE-NO</p>
<p th:text="${page.statusLabel}">Status</p>

<form th:if="${page.canApprove}" th:action="@{/cases/{caseNo}/approve(caseNo=${page.caseNo})}" method="post">
    <button type="submit">Approve</button>
</form>
```

Important invariant:

```text
If button is hidden, user experience improves.
If backend authorization is missing, system is insecure.
```

Do both.

---

## 25. Thymeleaf vs SPA in Modern Systems

Thymeleaf bukan selalu pengganti React/Vue.

Pilih Thymeleaf jika:

- UI mostly server-rendered,
- form-heavy,
- SEO/simple HTML penting,
- internal admin portal,
- workflow screens tidak terlalu interactive,
- delivery speed penting,
- team backend-heavy,
- state mostly server-side,
- page reload acceptable.

Pilih SPA jika:

- interactivity tinggi,
- complex client-side state,
- offline-like behavior,
- real-time UI banyak,
- drag-drop intensif,
- frontend team kuat,
- API-first multi-client requirement.

Hybrid juga mungkin:

```text
Thymeleaf for shell/admin/simple workflows.
Vue/React islands for complex widgets.
```

Namun hybrid harus dikelola hati-hati agar tidak menjadi dua architecture yang saling bertabrakan.

---

## 26. Minimal Mental Model yang Harus Dipegang

Setelah Part 12, Anda harus bisa melihat Thymeleaf seperti ini:

```text
TemplateEngine
  = orchestrator rendering

TemplateResolver
  = mapping template name ke template resource

TemplateMode
  = cara parsing dan output semantics

Context
  = render-time variables + locale

Dialect
  = language capability provider

Processor
  = unit transformasi template

Expression
  = akses data model dan utility ringan

Fragment
  = reusable template component

Cache
  = performance layer

ViewModel
  = contract antara application layer dan template
```

Dan invariant production-nya:

```text
No domain entity leakage.
No service/repository in context.
No raw user HTML without sanitization.
No template selected directly from user input.
No business decision hidden in template.
No production rendering without observability.
```

---

## 27. Checklist Review Arsitektur Thymeleaf

Gunakan checklist ini saat review aplikasi.

### 27.1 Engine Configuration

- [ ] `TemplateEngine` dibuat sekali, bukan per request.
- [ ] Template resolver jelas.
- [ ] Prefix/suffix eksplisit.
- [ ] Encoding UTF-8.
- [ ] Template mode sesuai output.
- [ ] Cache aktif di production.
- [ ] Cache nonaktif atau reload-friendly di development.

### 27.2 Template Source

- [ ] Template packaged di artifact untuk production-critical views.
- [ ] Dynamic template punya versioning.
- [ ] Template name tidak langsung dari user input.
- [ ] Multi-tenant template punya resolver governance.

### 27.3 Context and Model

- [ ] Template menerima view model.
- [ ] Tidak expose JPA entity langsung.
- [ ] Tidak expose repository/service.
- [ ] Tidak expose sensitive object mentah.
- [ ] Field-level redaction dilakukan sebelum render.

### 27.4 Security

- [ ] Default pakai `th:text`.
- [ ] `th:utext` sangat terbatas.
- [ ] HTML user-generated disanitasi.
- [ ] UI authorization tidak menggantikan backend authorization.
- [ ] Inline JS dinamis dikontrol.

### 27.5 Performance

- [ ] List besar dipaginasi.
- [ ] Tidak ada lazy loading saat render.
- [ ] Tidak ada remote call dari getter model.
- [ ] Fragment tidak nested berlebihan.
- [ ] Render latency diukur.

### 27.6 Maintainability

- [ ] Fragment punya parameter eksplisit.
- [ ] Template sederhana dan boring.
- [ ] Message key konsisten.
- [ ] Layout tidak circular secara mental.
- [ ] Template punya test minimal.

---

## 28. Kesalahan Mental Model yang Harus Dihindari

## 28.1 “Thymeleaf Itu HTML Plus Variable”

Tidak cukup.

Thymeleaf adalah engine dengan resolver, mode, dialect, processor, expression system, cache, dan integration layer.

## 28.2 “Kalau Button Disembunyikan, Aman”

Salah.

Menyembunyikan button hanya UI concern. Backend tetap harus authorize action.

## 28.3 “Entity Langsung Lebih Cepat karena Tidak Perlu DTO”

Mungkin cepat di awal, mahal kemudian.

Entity langsung menyebabkan coupling, lazy loading, data leak, dan test sulit.

## 28.4 “Template Bisa Dipakai untuk Logic Ringan, Jadi Logic Business Juga Boleh”

Salah batas.

Logic rendering boleh. Business rule harus di application/domain layer.

## 28.5 “Cache Tinggal Dinyalakan”

Cache punya konsekuensi:

- stale template,
- memory pressure,
- tenant/version key,
- invalidation.

---

## 29. Mini Design Exercise

Bayangkan Anda membangun halaman detail case untuk officer.

Kebutuhan:

1. Menampilkan case number.
2. Menampilkan applicant.
3. Menampilkan status.
4. Menampilkan tombol approve/reject sesuai permission.
5. Menampilkan daftar dokumen.
6. Menampilkan warning jika SLA hampir lewat.
7. Mendukung English dan Indonesian.
8. Aman dari XSS.
9. Tidak boleh trigger lazy loading saat render.

Desain buruk:

```java
model.addAttribute("case", caseRepository.findById(id).orElseThrow());
model.addAttribute("currentUser", securityContext.getUser());
return "case/detail";
```

Template buruk:

```html
<button th:if="${case.status.name() == 'PENDING' and #lists.contains(currentUser.roles, 'SUPERVISOR')}">
    Approve
</button>
```

Desain lebih baik:

```java
CaseDecisionPage page = casePageQuery.loadDecisionPage(id, currentUserId);
model.addAttribute("page", page);
return "case/detail";
```

View model:

```java
public record CaseDecisionPage(
        String caseNo,
        String applicantDisplayName,
        String statusLabel,
        boolean canApprove,
        boolean canReject,
        boolean slaWarningVisible,
        String slaWarningMessageKey,
        List<DocumentRow> documents
) {}
```

Template:

```html
<h1 th:text="${page.caseNo}">CASE-NO</h1>
<p th:text="${page.applicantDisplayName}">Applicant</p>
<p th:text="${page.statusLabel}">Status</p>

<div th:if="${page.slaWarningVisible}" class="alert alert-warning">
    <span th:text="#{${page.slaWarningMessageKey}}">SLA warning</span>
</div>

<button th:if="${page.canApprove}" type="submit">Approve</button>
<button th:if="${page.canReject}" type="submit">Reject</button>

<table>
    <tr th:each="doc : ${page.documents}">
        <td th:text="${doc.name}">Document</td>
        <td th:text="${doc.statusLabel}">Status</td>
    </tr>
</table>
```

Mengapa lebih baik?

1. Template lebih sederhana.
2. Permission sudah dihitung application layer.
3. Tidak ada entity traversal.
4. Tidak ada lazy loading.
5. Field yang muncul sudah presentation-safe.
6. Status label bisa dilokalkan.
7. Testing lebih mudah.

---

## 30. Ringkasan Part 12

Thymeleaf harus dipahami sebagai rendering engine dengan arsitektur yang jelas:

```text
Template name
  -> TemplateResolver
  -> Template resource
  -> TemplateMode parser
  -> Dialect processors
  -> Expression evaluation
  -> Output
```

Komponen kuncinya:

- `TemplateEngine`,
- `ITemplateResolver`,
- `Context`,
- `TemplateMode`,
- Dialect,
- Processor,
- Expression object,
- Message resolver,
- Link builder,
- Cache.

Untuk top-tier engineering, yang paling penting bukan hafal atribut `th:*`, melainkan memahami boundary:

```text
Domain -> ViewModel -> Template -> Output
```

Thymeleaf sangat kuat untuk:

- server-side rendered web pages,
- Spring MVC forms,
- admin portal,
- case management screens,
- email/document preview,
- natural HTML template collaboration.

Namun Thymeleaf harus dijaga agar tidak menjadi tempat:

- business logic,
- authorization final,
- entity traversal,
- raw HTML injection,
- hidden I/O,
- dynamic ungoverned templates.

---

## 31. Referensi

Referensi yang relevan untuk Part 12:

1. Thymeleaf Official Documentation — Using Thymeleaf 3.1.
2. Thymeleaf Official Documentation — Thymeleaf + Spring 3.1.
3. Thymeleaf API Documentation — `TemplateEngine`.
4. Spring Framework Reference — Thymeleaf MVC integration.
5. Thymeleaf article — Page Layouts and fragment/layout mechanism.
6. Thymeleaf Spring Security integration modules.
7. Java SE/JDK documentation untuk runtime Java modern.

---

## 32. Status Seri

Part 12 selesai.

Seri belum selesai.

Berikutnya:

```text
Part 13 — Thymeleaf Standard Expressions Deep Dive
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-011.md">⬅️ Part 11 — FreeMarker in Spring Boot and Jakarta Applications</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-013.md">Part 13 — Thymeleaf Standard Expressions Deep Dive ➡️</a>
</div>
