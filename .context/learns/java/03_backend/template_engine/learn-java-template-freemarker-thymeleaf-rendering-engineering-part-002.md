# learn-java-template-freemarker-thymeleaf-rendering-engineering-part-002

# Part 2 — Core Rendering Model: Template + Data Model = Output

> Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`  
> Level: Advanced / Engineering-grade  
> Scope Java: Java 8 sampai Java 25  
> Fokus: mental model rendering pipeline, kontrak data model, context, escaping, formatting, determinism, output sink, failure model, dan batas tanggung jawab template engine.

---

## 0. Posisi Part Ini Dalam Seri

Pada Part 0 kita membangun orientasi: template engine bukan sekadar cara menaruh `${name}` di HTML, melainkan boundary transformasi antara data aplikasi dan artifact yang dibaca manusia/sistem lain.

Pada Part 1 kita membandingkan landscape engine Java: JSP/Jakarta Pages, FreeMarker, Thymeleaf, Mustache, Pebble, Velocity, dan kapan masing-masing masuk akal.

Part 2 ini adalah fondasi teknis yang akan dipakai berulang di seluruh seri:

```text
Template + Data Model + Render Context + Engine Configuration = Output Artifact
```

Atau lebih lengkap:

```text
Template Source
  + Template Resolver/Loader
  + Parser/Compiler/Internal Representation
  + Data Model
  + Render Context
  + Expression Evaluation
  + Formatting
  + Escaping
  + Output Writer/Sink
  = Rendered Output
```

Kalau model ini dipahami dengan baik, FreeMarker dan Thymeleaf tidak akan terlihat seperti kumpulan syntax acak. Keduanya hanya variasi implementasi dari proses transformasi yang sama.

---

## 1. Core Mental Model: Rendering Adalah Transformasi Terkontrol

Template rendering adalah proses mengubah data terstruktur menjadi output tekstual atau markup melalui aturan yang dinyatakan dalam template.

Bentuk paling sederhana:

```text
input:
  template: "Hello ${user.name}"
  model: { user.name = "Fajar" }

process:
  evaluate ${user.name}

output:
  "Hello Fajar"
```

Tetapi dalam sistem production, bentuk aktualnya jauh lebih kompleks:

```text
input:
  templateId: "case.notice.warning.v3"
  templateVersion: "3.2.1"
  locale: "en-SG"
  timezone: "Asia/Singapore"
  outputFormat: "HTML"
  model:
    caseNo: "CEA/ENF/2026/000123"
    respondentName: "..."
    allegedBreaches: [...]
    deadline: 2026-07-31T17:00:00+08:00
    officer: {...}

process:
  resolve template
  validate model contract
  parse/load cached template
  evaluate expressions
  format date/currency/number
  apply HTML escaping
  write output
  record audit metadata

output:
  immutable HTML/PDF/email artifact
```

Top 1% engineer melihat rendering bukan sebagai `replace string`, tetapi sebagai controlled transformation dengan invariant:

1. **Input harus eksplisit.**  
   Template tidak boleh diam-diam mengambil data dari database, service, session global, repository, atau static singleton.

2. **Transformasi harus deterministik.**  
   Input yang sama, template versi yang sama, locale/timezone yang sama, dan engine configuration yang sama harus menghasilkan output yang sama.

3. **Output harus sesuai context.**  
   HTML, XML, plain text, JavaScript, CSS, URL, CSV, dan PDF pre-render HTML punya aturan escaping/formatting berbeda.

4. **Template adalah kontrak.**  
   Template mengharapkan field tertentu. Renderer wajib menyediakan field tersebut dengan tipe dan makna yang stabil.

5. **Template bukan domain layer.**  
   Template boleh memilih cara menyajikan data, tetapi tidak boleh memutuskan aturan bisnis inti.

---

## 2. Formula Dasar: Template + Data Model = Output

Secara konseptual:

```text
render(template, model) -> output
```

Namun formula itu terlalu miskin untuk sistem nyata. Formula yang lebih benar:

```text
render(
  TemplateIdentity template,
  TemplateVersion version,
  RenderModel model,
  RenderContext context,
  RenderPolicy policy,
  OutputSink sink
) -> RenderResult
```

### 2.1 Template

Template adalah resep output.

Contoh FreeMarker:

```ftl
Dear ${recipient.displayName},

Your application ${application.referenceNo} has been ${decision.label}.
```

Contoh Thymeleaf:

```html
<p>Dear <span th:text="${recipient.displayName}">Recipient Name</span>,</p>
<p>
  Your application
  <strong th:text="${application.referenceNo}">APP-000</strong>
  has been
  <span th:text="${decision.label}">approved</span>.
</p>
```

Template menyatakan struktur output, bukan sumber kebenaran domain.

### 2.2 Data Model

Data model adalah graph data yang diberikan kepada template.

Contoh:

```java
public record NoticeModel(
    RecipientView recipient,
    ApplicationView application,
    DecisionView decision
) {}

public record RecipientView(
    String displayName,
    String maskedIdentifier
) {}

public record ApplicationView(
    String referenceNo,
    String typeLabel
) {}

public record DecisionView(
    String label,
    String reasonSummary
) {}
```

Data model yang baik:

- kecil tetapi lengkap;
- hanya berisi data yang boleh dilihat output;
- tidak expose entity persistence mentah;
- tidak expose service;
- stabil terhadap perubahan domain internal;
- mudah dites;
- jelas null policy-nya;
- aman dari data leak.

### 2.3 Render Context

Render context adalah metadata yang mempengaruhi rendering.

Contoh:

```java
public record RenderContext(
    Locale locale,
    ZoneId zoneId,
    Instant renderTime,
    String tenantId,
    String actorId,
    String correlationId,
    OutputKind outputKind
) {}
```

`RenderContext` tidak sama dengan data model.

Data model menjawab:

```text
Apa yang ingin ditampilkan?
```

Render context menjawab:

```text
Dengan aturan rendering apa output dibuat?
```

Contoh perbedaan:

| Elemen | Data Model | Render Context |
|---|---:|---:|
| Nama penerima | Ya | Tidak |
| Nomor kasus | Ya | Tidak |
| Locale | Kadang, tapi idealnya context | Ya |
| Timezone | Kadang, tapi idealnya context | Ya |
| Template version | Tidak | Ya |
| Correlation ID | Tidak | Ya |
| Actor yang melakukan preview | Tidak, kecuali ditampilkan | Ya |
| Render timestamp | Jika ditampilkan, bisa turunan dari context | Ya |

### 2.4 Render Policy

Render policy mengatur perilaku engine.

Contoh:

```java
public record RenderPolicy(
    MissingVariableMode missingVariableMode,
    EscapingMode escapingMode,
    boolean allowRawHtml,
    int maxOutputChars,
    Duration timeout,
    boolean auditEnabled
) {}
```

Policy menjawab:

- kalau variable hilang, fail atau kosong?
- raw HTML boleh atau tidak?
- output terlalu besar harus dihentikan atau tidak?
- template dynamic boleh akses helper apa saja?
- error ditampilkan atau disembunyikan?

### 2.5 Output Sink

Output sink adalah tempat output ditulis.

Contoh sink:

- `StringWriter` untuk output kecil;
- `HttpServletResponse.getWriter()` untuk HTML page;
- file writer untuk generated artifact;
- byte stream untuk PDF pipeline;
- email body builder;
- message payload untuk queue;
- object storage upload stream.

Dalam sistem kecil, orang sering melakukan ini:

```java
String html = renderToString(template, model);
```

Dalam sistem besar, lebih aman berpikir:

```java
renderer.render(template, model, context, writer);
```

Karena output mungkin besar, dan membuat satu `String` raksasa bisa membebani heap.

---

## 3. Rendering Pipeline: Dari Template Source Sampai Output

Pipeline umum:

```text
[1] Template Identity
    ↓
[2] Template Resolution / Loading
    ↓
[3] Parsing / Internal Representation
    ↓
[4] Cache Lookup / Cache Store
    ↓
[5] Data Model Binding
    ↓
[6] Expression Evaluation
    ↓
[7] Control Flow / Fragment / Macro Evaluation
    ↓
[8] Formatting
    ↓
[9] Escaping / Output Format Handling
    ↓
[10] Writing to Output Sink
    ↓
[11] Render Result / Audit / Metrics
```

Mari kita pecah.

---

## 4. Step 1 — Template Identity

Template tidak sebaiknya direferensikan hanya dengan path string acak seperti:

```java
"emails/welcome.ftl"
```

Untuk production, lebih baik bedakan:

```text
template family:     "case.notice"
template type:       "warning-letter"
version:             "3.1.0"
locale:              "en-SG"
output format:       "HTML"
tenant/agency:       "CEA"
```

Contoh object:

```java
public record TemplateRef(
    String family,
    String name,
    String version,
    Locale locale,
    OutputKind outputKind,
    Optional<String> tenantId
) {}
```

Kenapa penting?

Karena enterprise rendering sering punya variasi:

- template email versi lama masih harus bisa dipakai untuk audit;
- template PDF punya versi legal yang berbeda;
- tenant A dan tenant B punya wording berbeda;
- locale en-SG dan id-ID punya template berbeda;
- draft/preview tidak boleh menggunakan template production tanpa label;
- output yang pernah dikirim tidak boleh berubah diam-diam ketika template diupdate.

Top 1% rule:

```text
Do not identify important templates only by physical file path.
Identify them by domain meaning, version, locale, tenant, and output kind.
```

Path file tetap ada, tetapi path adalah detail resolusi, bukan identitas bisnis.

---

## 5. Step 2 — Template Resolution / Loading

Template resolver/loader menjawab:

```text
Dari mana source template diambil?
```

Sumber umum:

1. classpath/JAR;
2. filesystem;
3. servlet context;
4. database;
5. object storage;
6. Git-backed repository;
7. CMS/internal admin platform;
8. string literal untuk testing atau ad-hoc rendering.

### 5.1 Classpath Template

Umum untuk aplikasi yang template-nya developer-owned.

Kelebihan:

- immutable bersama artifact aplikasi;
- mudah dites di CI;
- versioning ikut Git;
- aman untuk production;
- cocok untuk page SSR dan email stabil.

Kekurangan:

- perubahan template perlu redeploy;
- business user tidak bisa update sendiri;
- multi-tenant dynamic wording lebih sulit.

### 5.2 Filesystem Template

Cocok untuk deployment tertentu atau externalized config.

Risiko:

- drift antar node;
- permission salah;
- update tidak terkontrol;
- cache invalidation perlu disiplin;
- container image immutable bisa bertentangan dengan filesystem mutable.

### 5.3 Database Template

Cocok untuk business-editable template platform.

Risiko:

- template bisa berubah tanpa deployment;
- perlu approval workflow;
- perlu sandboxing;
- perlu versioning immutable;
- perlu validation sebelum publish;
- perlu audit siapa mengubah apa;
- cache invalidation lebih kompleks.

### 5.4 Object Storage Template

Cocok untuk template besar dan versioned artifact.

Risiko:

- latency network;
- consistency/caching;
- access control;
- template source integrity;
- rollback.

### 5.5 Resolver Chain

Dalam sistem besar, resolver bisa berlapis:

```text
1. tenant-specific published template
2. agency-specific template
3. locale-specific default template
4. global default template
5. fail
```

Contoh:

```text
case.notice.warning / v3 / en-SG / tenant=agency-a
  -> db:tenant/agency-a/en-SG/case.notice.warning/v3
  -> db:global/en-SG/case.notice.warning/v3
  -> classpath:/templates/en-SG/case/notice/warning.ftlh
  -> fail TemplateNotFound
```

Penting: fallback tidak boleh terlalu diam-diam.

Kalau tenant-specific template tidak ditemukan dan sistem otomatis memakai global template, output bisa legal/branding-nya salah.

Rule:

```text
Fallback must be explicit, observable, and auditable.
```

---

## 6. Step 3 — Parsing dan Internal Representation

Template source biasanya tidak dievaluasi langsung karakter demi karakter setiap render. Engine akan parse source menjadi struktur internal.

Konsep umum:

```text
raw template text
  -> tokens
  -> syntax tree / internal representation
  -> executable/evaluable template object
```

Contoh source:

```ftl
<#if items?has_content>
  <#list items as item>${item.name}</#list>
</#if>
```

Secara mental menjadi struktur:

```text
IfNode
  condition: items?has_content
  body:
    ListNode
      source: items
      variable: item
      body:
        InterpolationNode(item.name)
```

Di Thymeleaf, modelnya lebih dekat ke parsing markup/DOM-like events:

```html
<tr th:each="item : ${items}">
  <td th:text="${item.name}">Sample</td>
</tr>
```

Secara mental:

```text
ElementNode(tr)
  processor: th:each
  child: ElementNode(td)
    processor: th:text
```

Kenapa ini penting?

Karena performa rendering sangat dipengaruhi oleh:

- apakah template diparse ulang tiap request;
- apakah template cache aktif;
- apakah template resolver punya update check;
- apakah template dynamic dari DB bisa di-cache;
- apakah macro/fragment dependency ikut cache;
- apakah template source berubah tetapi cache masih lama.

Rule:

```text
Parsing belongs to startup/cache path as much as possible.
Rendering belongs to request/job path.
```

---

## 7. Step 4 — Template Cache

Template cache menyimpan hasil parsing/internal representation.

Tanpa cache:

```text
request 1 -> load template -> parse -> render
request 2 -> load template -> parse -> render
request 3 -> load template -> parse -> render
```

Dengan cache:

```text
request 1 -> load template -> parse -> cache -> render
request 2 -> cache hit -> render
request 3 -> cache hit -> render
```

### 7.1 Apa yang Di-cache?

Biasanya:

- template source metadata;
- parsed template;
- dependency/include/macro references;
- resolver result;
- sometimes expression/preprocessing structures.

Tidak boleh di-cache sebagai global mutable object:

- per-request data model;
- user-specific context;
- security principal;
- writer/output;
- locale-specific mutable state, kecuali cache key jelas.

### 7.2 Cache Key

Cache key tidak boleh hanya nama file jika output dipengaruhi oleh hal lain.

Contoh cache key buruk:

```text
"notice.ftlh"
```

Contoh lebih baik:

```text
engine=freemarker
name=case.notice.warning
version=3.1.0
locale=en-SG
output=HTML
tenant=agency-a
```

### 7.3 Dev vs Prod

Development:

- reload cepat;
- cache disabled/short;
- error verbose;
- template bisa diedit langsung.

Production:

- cache enabled;
- reload controlled;
- error sanitized;
- version immutable;
- publish/rollback terkontrol.

Anti-pattern:

```text
Mengaktifkan hot reload template production tanpa approval, versioning, audit, dan compatibility check.
```

---

## 8. Step 5 — Data Model Binding

Data model binding adalah proses membuat data aplikasi dapat dibaca oleh template.

Contoh Java object:

```java
public class UserView {
    private final String displayName;

    public UserView(String displayName) {
        this.displayName = displayName;
    }

    public String getDisplayName() {
        return displayName;
    }
}
```

Di template:

```ftl
${user.displayName}
```

atau:

```html
<span th:text="${user.displayName}">User</span>
```

Engine harus menjawab:

```text
Apa arti user.displayName?
```

Biasanya:

- cari key `user` di model;
- ambil object `UserView`;
- akses property `displayName` melalui getter/record accessor/map key;
- konversi hasil ke template value;
- format/escape saat output.

### 8.1 Map Model

Contoh:

```java
Map<String, Object> model = new HashMap<>();
model.put("user", new UserView("Fajar"));
model.put("caseNo", "CEA/ENF/2026/000123");
```

Kelebihan:

- sederhana;
- fleksibel;
- umum di Spring MVC;
- cocok untuk template kecil.

Kekurangan:

- tidak type-safe;
- typo baru ketahuan runtime;
- contract tidak eksplisit;
- mudah memasukkan terlalu banyak data.

### 8.2 Typed ViewModel

Contoh:

```java
public record WarningNoticeView(
    String caseNo,
    RecipientView recipient,
    List<BreachView> breaches,
    DeadlineView deadline
) {}
```

Kelebihan:

- kontrak jelas;
- mudah dites;
- lebih aman;
- mudah didokumentasikan;
- bisa divalidasi sebelum render.

Kekurangan:

- butuh mapping layer;
- lebih banyak class;
- untuk template kecil terasa berat.

### 8.3 Hybrid

Praktis untuk enterprise:

```java
Map<String, Object> root = Map.of(
    "notice", warningNoticeView,
    "meta", renderMeta,
    "links", linkView,
    "messages", messageBundleFacade
);
```

Template tidak melihat 50 top-level variable, tetapi beberapa namespace jelas:

```text
notice.caseNo
notice.recipient.name
notice.deadline.label
meta.renderedAt
links.portalUrl
```

Rule:

```text
Prefer few stable top-level namespaces over many loose variables.
```

---

## 9. Template Data Model Bukan Domain Model

Kesalahan umum:

```java
model.put("case", caseEntity);
model.put("applicant", applicantEntity);
model.put("officer", officerEntity);
```

Lalu template:

```ftl
${case.application.person.identity.documents[0].number}
```

Masalahnya banyak:

1. Template tergantung struktur entity internal.
2. Lazy loading bisa terjadi saat render.
3. Data sensitif bisa bocor.
4. Perubahan schema/domain memecahkan template.
5. Template menjadi tempat navigasi graph yang kompleks.
6. Authorization field-level sulit dikendalikan.
7. N+1 query bisa muncul dari rendering.
8. Testing output menjadi susah.

Pendekatan yang benar:

```java
public record CaseNoticeView(
    String caseNo,
    String respondentDisplayName,
    String maskedIdentifier,
    List<AllegationLine> allegationLines,
    String responseDeadlineLabel
) {}
```

Template:

```ftl
Case No: ${notice.caseNo}
Respondent: ${notice.respondentDisplayName}
Deadline: ${notice.responseDeadlineLabel}
```

Ini bukan sekadar “lebih rapi”. Ini adalah security dan maintainability boundary.

Top 1% rule:

```text
The template model is a public API from application code to rendering code.
Treat it like an API contract, not a random bag of objects.
```

---

## 10. Expression Evaluation

Expression evaluation adalah proses menghitung nilai dari ekspresi template.

Contoh sederhana:

```ftl
${user.name}
```

Contoh lebih kompleks:

```ftl
${order.total?string.currency}
```

Contoh Thymeleaf:

```html
<span th:text="${#numbers.formatDecimal(invoice.total, 1, 2)}">0.00</span>
```

Expression evaluation biasanya melibatkan:

- variable lookup;
- property access;
- method call/helper call;
- operator;
- collection indexing;
- null/missing handling;
- type conversion;
- formatting;
- escaping.

### 10.1 Expression Power Harus Dibatasi

Semakin powerful expression language, semakin besar risiko:

- business logic pindah ke template;
- template susah dites;
- performance tidak terduga;
- security surface membesar;
- object/service internal bisa terakses;
- template author bisa membuat query-like logic.

Bandingkan dua template:

Buruk:

```ftl
<#if case.status == "PENDING" && case.breaches?size > 0 && case.respondent.type == "SALESPERSON">
  You must respond within ${case.policyService.computeDeadline(case).days} days.
</#if>
```

Lebih baik:

```ftl
<#if notice.showResponseDeadline>
  You must respond by ${notice.responseDeadlineLabel}.
</#if>
```

Logic deadline dihitung di Java, bukan template.

### 10.2 Apa yang Boleh Ada di Template?

Aman/normal:

- memilih menampilkan section atau tidak;
- looping list yang sudah disiapkan;
- memilih label presentasi;
- formatting ringan;
- fragment/macro reusable;
- link rendering;
- conditional UI state.

Harus di Java:

- authorization final;
- workflow decision;
- SLA calculation;
- monetary calculation;
- filtering kompleks;
- database lookup;
- remote service call;
- mutation;
- state transition;
- audit decision;
- legal wording selection yang memerlukan business rule kompleks.

Rule:

```text
Template may decide presentation shape.
Application code decides business meaning.
```

---

## 11. Control Flow: Conditional dan Loop

Template engine hampir selalu menyediakan conditional dan loop.

Contoh:

```ftl
<#if breaches?has_content>
  <ul>
    <#list breaches as breach>
      <li>${breach.label}</li>
    </#list>
  </ul>
</#if>
```

Contoh Thymeleaf:

```html
<ul th:if="${!#lists.isEmpty(breaches)}">
  <li th:each="breach : ${breaches}" th:text="${breach.label}">Breach</li>
</ul>
```

Control flow di template adalah pedang bermata dua.

### 11.1 Good Control Flow

Baik:

```text
Jika ada attachments, tampilkan section attachments.
Jika list kosong, tampilkan empty state.
Jika user boleh melihat tombol, tampilkan tombol.
```

### 11.2 Bad Control Flow

Buruk:

```text
Jika case status A, role B, breach type C, deadline lebih dari D,
kemudian hitung policy exception,
kemudian tentukan wording legal,
kemudian panggil service.
```

Ini bukan rendering. Ini business decision engine yang menyamar sebagai template.

### 11.3 Complexity Budget

Gunakan rule praktis:

```text
Jika conditional membutuhkan lebih dari 2-3 konsep domain,
kemungkinan besar logic harus dipindah ke Java ViewModel.
```

Buruk:

```ftl
<#if case.status == "PENDING" && user.role == "OFFICER" && case.deadline?date gt .now?date && case.flags?seq_contains("REOPENED")>
```

Lebih baik:

```ftl
<#if notice.showReopenedPendingOfficerMessage>
```

---

## 12. Formatting: Human Output vs Machine Output

Formatting adalah konversi nilai menjadi representasi yang sesuai untuk manusia atau sistem lain.

Contoh nilai internal:

```java
BigDecimal amount = new BigDecimal("1234567.5");
LocalDate deadline = LocalDate.of(2026, 7, 31);
```

Output human en-SG:

```text
S$1,234,567.50
31 July 2026
```

Output machine:

```text
1234567.50
2026-07-31
```

Jangan campur.

### 12.1 Human Formatting

Dipakai untuk:

- email;
- PDF;
- HTML page;
- notice;
- letter;
- dashboard;
- printed artifact.

Karakteristik:

- locale-aware;
- timezone-aware;
- readable;
- kadang mengikuti legal wording;
- bisa mengandung label.

### 12.2 Machine Formatting

Dipakai untuk:

- XML payload;
- CSV interchange;
- generated config;
- API-like artifact;
- source code generation;
- fixed-width integration.

Karakteristik:

- strict;
- stable;
- often locale-independent;
- harus mengikuti schema/protocol.

### 12.3 Preformatted vs Template-Formatted

Ada dua pendekatan.

#### Pendekatan A — Format di Template

```html
<span th:text="${#temporals.format(notice.deadline, 'dd MMMM yyyy')}">31 July 2026</span>
```

Kelebihan:

- template fleksibel;
- locale integration mudah;
- cocok untuk UI.

Kekurangan:

- format tersebar di banyak template;
- perubahan wording sulit dikontrol;
- test perlu render template.

#### Pendekatan B — Format di ViewModel

```java
public record DeadlineView(
    LocalDate rawDate,
    String displayLabel,
    String isoDate
) {}
```

Template:

```ftl
${notice.deadline.displayLabel}
```

Kelebihan:

- legal/regulatory wording lebih terkendali;
- output stabil;
- mudah dites di Java;
- template lebih sederhana.

Kekurangan:

- kurang fleksibel untuk designer;
- ViewModel lebih banyak field.

Rule praktis:

```text
For casual UI formatting, template formatting is acceptable.
For legal, financial, audit-sensitive, or multi-channel output, prefer explicit formatted fields in ViewModel.
```

---

## 13. Escaping: Masalah Output Context, Bukan Masalah String

Escaping sering disederhanakan menjadi “HTML escape”. Itu salah.

Escaping adalah proses mengubah karakter agar aman dalam konteks output tertentu.

Input:

```text
Alice <script>alert(1)</script>
```

HTML text context output:

```html
Alice &lt;script&gt;alert(1)&lt;/script&gt;
```

HTML attribute context:

```html
<input value="Alice &lt;script&gt;alert(1)&lt;/script&gt;">
```

JavaScript string context:

```js
const name = "Alice \u003Cscript\u003Ealert(1)\u003C/script\u003E";
```

URL context:

```text
Alice%20%3Cscript%3Ealert%281%29%3C%2Fscript%3E
```

CSS context berbeda lagi.

### 13.1 Output Context Utama

| Context | Contoh | Risiko |
|---|---|---|
| HTML text | `<p>${name}</p>` | XSS kalau raw |
| HTML attribute | `<input value="${name}">` | attribute injection |
| URL | `<a href="${url}">` | javascript: URL, broken link |
| JavaScript string | `<script>var x='${name}'</script>` | script injection |
| CSS | `<style>.x{background:${color}}</style>` | CSS injection |
| XML text | `<name>${name}</name>` | malformed XML/injection |
| CSV | `${field},${field2}` | formula injection, delimiter issue |
| Plain text email | raw text | less XSS, but phishing/log concerns |

### 13.2 Auto-Escaping

Auto-escaping adalah engine otomatis menerapkan escaping sesuai output format.

FreeMarker punya konsep output format dan auto-escaping. Template bisa diasosiasikan dengan HTML/XML output format, misalnya melalui ekstensi `.ftlh` dan `.ftlx` pada konfigurasi modern.

Thymeleaf secara default membedakan output escaped seperti `th:text` dan unescaped seperti `th:utext`.

Mental model:

```text
Escaped output should be default.
Raw output should be exceptional, reviewed, and justified.
```

### 13.3 Escaping Bukan Sanitization

Escaping:

```text
Membuat data aman untuk context output tertentu.
```

Sanitization:

```text
Membersihkan/menyaring markup atau content agar hanya bagian aman yang tersisa.
```

Jika user boleh input rich HTML seperti:

```html
<p>Hello <strong>world</strong></p>
```

Escaping akan membuatnya tampil sebagai teks:

```html
&lt;p&gt;Hello &lt;strong&gt;world&lt;/strong&gt;&lt;/p&gt;
```

Jika ingin rich HTML tetap dirender, perlu sanitizer allowlist sebelum output raw.

Rule:

```text
Never use raw/unescaped output merely because “we want the HTML to work”.
Raw output requires trusted source or sanitized content.
```

---

## 14. Output Sink: String, Writer, Stream, HTTP, Email, File

Rendering selalu berakhir di sink.

### 14.1 Render to String

```java
String html = renderer.renderToString(template, model, context);
```

Kelebihan:

- mudah;
- cocok untuk email kecil;
- mudah dites;
- bisa disimpan atau dikirim.

Kekurangan:

- output besar menjadi satu object di heap;
- double buffering jika kemudian ditulis ke stream;
- sulit untuk backpressure.

### 14.2 Render to Writer

```java
renderer.render(template, model, context, writer);
```

Kelebihan:

- lebih memory-friendly;
- cocok output besar;
- bisa langsung ke response/file.

Kekurangan:

- error di tengah render bisa menghasilkan partial output;
- testing perlu capture writer;
- transactional behavior perlu dipikirkan.

### 14.3 Render to HTTP Response

Untuk SSR page:

```text
controller -> model -> view resolver -> template engine -> servlet response writer
```

Risiko:

- jika response sudah committed lalu render gagal, error page sulit dikirim;
- model terlalu besar meningkatkan latency;
- rendering page bisa memicu lazy loading;
- security header dan cache header harus benar.

### 14.4 Render to Email

Untuk email:

```text
render subject
render plain text body
render HTML body
assemble MIME
send via SMTP/provider
record communication/audit
```

Risiko:

- subject juga template;
- HTML dan text body bisa tidak sinkron;
- template render sukses tapi send gagal;
- send sukses tapi audit gagal;
- retry bisa mengirim dobel jika idempotency buruk.

### 14.5 Render to PDF Pipeline

Biasanya:

```text
template -> HTML -> PDF renderer -> byte[]/file/object storage
```

Risiko:

- HTML valid belum tentu PDF bagus;
- font missing;
- page break salah;
- image path tidak resolve;
- CSS unsupported;
- output berbeda antar version renderer;
- large document memory pressure.

---

## 15. Determinism: Output Harus Bisa Diulang

Untuk UI biasa, determinism kadang tidak terlalu terasa. Untuk notice, PDF, email legal, audit, dan regulatory correspondence, determinism sangat penting.

Output deterministik berarti:

```text
Same template version + same model + same context + same config = same output
```

Hal-hal yang merusak determinism:

1. Template memanggil `.now` atau waktu sistem langsung.
2. Template membaca random UUID.
3. Template mengakses database/service.
4. Template menggunakan map tanpa urutan stabil lalu merender list.
5. Locale/timezone default dari OS berubah.
6. Template berubah tanpa versioning.
7. Formatting bergantung default JVM locale.
8. External asset berubah tanpa versioning.
9. HTML-to-PDF engine version berubah.
10. Macro library berubah tanpa template version bump.

### 15.1 Deterministic Clock

Buruk:

```ftl
Rendered at ${.now}
```

Lebih baik:

```java
RenderContext context = new RenderContext(
    locale,
    zoneId,
    fixedRenderTime,
    tenantId,
    actorId,
    correlationId,
    outputKind
);
```

Template:

```ftl
Rendered at ${meta.renderedAtLabel}
```

### 15.2 Stable Ordering

Buruk:

```java
Set<BreachView> breaches = new HashSet<>();
```

Lalu template render list.

Lebih baik:

```java
List<BreachView> breaches = breachService.find(...)
    .stream()
    .sorted(comparing(BreachView::sequenceNo))
    .toList();
```

### 15.3 Versioned Template

Untuk output legal:

```text
Do not store only final PDF.
Store enough metadata to explain how it was produced.
```

Minimal audit metadata:

```text
templateId
templateVersion
modelVersion
locale
timezone
renderedAt
renderedBy/correlationId
engineName
engineVersion/applicationVersion
outputHash
```

---

## 16. Idempotency dan Retry Rendering

Rendering sering menjadi bagian dari proses lebih besar:

```text
case approved -> generate approval letter -> email applicant -> audit communication
```

Pertanyaan penting:

```text
Jika proses gagal di tengah, apakah aman diulang?
```

### 16.1 Rendering Murni Biasanya Idempotent

Jika render hanya transformasi:

```text
same input -> same output
```

maka retry aman.

### 16.2 Sending Email Tidak Selalu Idempotent

```text
render success -> send success -> audit fail
```

Jika job diulang, email bisa terkirim dua kali.

Solusi:

- outbox pattern;
- communication idempotency key;
- send status state machine;
- store rendered artifact before send;
- store provider message id;
- make retry resume-aware.

### 16.3 Render Artifact Identity

Contoh:

```text
artifactKey = hash(templateId + templateVersion + modelSnapshotHash + locale + timezone + outputKind)
```

Jika artifact dengan key sama sudah ada, tidak perlu render ulang kecuali policy memperbolehkan.

---

## 17. Missing Value, Null, Empty, dan Optional Field

Ini salah satu sumber bug template paling umum.

Bedakan:

| Kondisi | Makna |
|---|---|
| Missing | Field tidak ada di model |
| Null | Field ada tapi nilainya tidak ada |
| Empty string | Field ada dan kosong |
| Empty list | Field ada, tidak ada item |
| Redacted | Field sengaja disembunyikan |
| Not applicable | Field tidak relevan untuk case ini |
| Unknown | Sistem tidak tahu nilainya |

Jangan gabungkan semuanya menjadi `""`.

### 17.1 Model Buruk

```java
public record PersonView(
    String name,
    String phone,
    String email
) {}
```

Kalau `phone == null`, template tidak tahu:

- memang tidak ada?
- belum diisi?
- disembunyikan?
- tidak relevan?

### 17.2 Model Lebih Baik

```java
public record OptionalDisplayField(
    boolean visible,
    String label,
    String value,
    String absenceReason
) {}
```

Atau untuk sederhana:

```java
public record PersonView(
    String name,
    DisplayValue phone,
    DisplayValue email
) {}

public sealed interface DisplayValue {
    record Present(String value) implements DisplayValue {}
    record Hidden(String reason) implements DisplayValue {}
    record NotProvided() implements DisplayValue {}
    record NotApplicable() implements DisplayValue {}
}
```

Untuk Java 8, gunakan class/interface biasa tanpa sealed/record.

### 17.3 Fail-fast vs Lenient

Ada dua mode:

#### Fail-fast

Jika field hilang, render gagal.

Cocok untuk:

- legal document;
- email resmi;
- PDF;
- contract-sensitive output;
- CI template test;
- production notification penting.

#### Lenient

Jika field hilang, output kosong/default.

Cocok untuk:

- prototype;
- optional UI;
- internal dashboard non-critical;
- dev preview.

Rule:

```text
Critical generated artifact should fail fast on missing required data.
```

---

## 18. Template Contract: Required Fields dan Model Validation

Template secara implisit punya kebutuhan field.

Contoh:

```ftl
${notice.caseNo}
${notice.respondent.name}
${notice.deadline.label}
```

Berarti kontraknya:

```text
notice.caseNo: required string
notice.respondent.name: required string
notice.deadline.label: required string
```

Jika kontrak tidak dikelola, bug muncul saat runtime.

### 18.1 Kontrak Implisit

Umum tetapi berisiko:

```text
Template author tahu field apa yang tersedia dari ingatan/dokumentasi informal.
```

Masalah:

- typo runtime;
- field dihapus tanpa tahu template terpengaruh;
- dependency antar team tidak jelas;
- dynamic template sulit divalidasi.

### 18.2 Kontrak Eksplisit

Bisa dibuat dengan:

1. typed ViewModel;
2. generated schema;
3. JSON Schema untuk dynamic template;
4. template metadata;
5. static analyzer;
6. preview sample model;
7. contract test.

Contoh metadata:

```yaml
template: case.notice.warning
version: 3.1.0
model:
  notice.caseNo:
    type: string
    required: true
  notice.respondent.displayName:
    type: string
    required: true
  notice.breaches:
    type: list
    required: true
  notice.deadline.label:
    type: string
    required: true
```

### 18.3 Contract Test

Pseudocode:

```java
@Test
void warningNoticeTemplateRendersWithMinimumValidModel() {
    WarningNoticeView model = WarningNoticeFixtures.minimumValid();

    RenderResult result = renderer.render(
        TemplateRef.of("case.notice.warning", "3.1.0"),
        model,
        RenderContext.test()
    );

    assertThat(result.output()).contains("Case No:");
    assertThat(result.output()).doesNotContain("${");
}
```

### 18.4 Negative Contract Test

```java
@Test
void warningNoticeTemplateFailsWhenRequiredCaseNoMissing() {
    WarningNoticeView model = WarningNoticeFixtures.withMissingCaseNo();

    assertThrows(RenderModelValidationException.class, () ->
        renderer.render(template, model, context)
    );
}
```

Top 1% rule:

```text
A template without a tested model contract is a runtime incident waiting to happen.
```

---

## 19. Separation of Concerns: Controller, Service, Presenter, Template

Untuk SSR/web:

```text
Controller
  -> Application Service / Query Service
  -> Presenter / ViewModel Mapper
  -> Template Engine
  -> Response
```

Untuk email/document:

```text
Workflow Event / Command
  -> Application Service
  -> Data Aggregator
  -> Presenter / Render Model Builder
  -> Template Engine
  -> Artifact Store / Email Sender
```

### 19.1 Controller Tidak Boleh Menjadi Template Assembler Berantakan

Buruk:

```java
@GetMapping("/case/{id}")
public String viewCase(@PathVariable Long id, Model model) {
    Case c = caseRepository.findById(id).orElseThrow();
    model.addAttribute("case", c);
    model.addAttribute("breaches", breachRepository.findByCaseId(id));
    model.addAttribute("showApprove", securityService.hasRole("APPROVER") && c.isPending());
    model.addAttribute("deadline", deadlineService.compute(c));
    model.addAttribute("officer", userRepository.findById(c.getOfficerId()));
    return "case/view";
}
```

Lebih baik:

```java
@GetMapping("/case/{id}")
public String viewCase(@PathVariable Long id, Model model) {
    CasePageView page = casePageQuery.load(id, CurrentUser.required());
    model.addAttribute("page", page);
    return "case/view";
}
```

### 19.2 Presenter/ViewModel Mapper

```java
public final class CaseNoticePresenter {

    public CaseNoticeView present(CaseSnapshot snapshot, RenderContext context) {
        return new CaseNoticeView(
            snapshot.caseNo(),
            presentRespondent(snapshot.respondent()),
            presentBreaches(snapshot.breaches()),
            presentDeadline(snapshot.deadline(), context.locale(), context.zoneId())
        );
    }
}
```

Presenter adalah tempat:

- memilih label;
- membentuk display field;
- masking;
- sorting;
- grouping;
- formatting penting;
- field-level visibility;
- membuat model template stabil.

Template hanya membaca model.

---

## 20. Rendering sebagai Boundary Keamanan

Template engine duduk di perbatasan:

```text
internal application data -> external/human-visible output
```

Itu artinya rendering adalah security boundary.

### 20.1 Risiko Data Leakage

Jika template menerima object terlalu besar:

```java
model.put("user", userEntity);
```

Template mungkin bisa mengakses:

```text
user.passwordHash
user.resetToken
user.internalNotes
user.permissions
user.auditFlags
```

Walau template awalnya tidak memakai field itu, future template author bisa menemukannya.

Rule:

```text
Never give template more data than it needs.
```

### 20.2 Risiko SSTI

Server-Side Template Injection terjadi ketika attacker bisa mempengaruhi template source atau expression yang dievaluasi engine.

Contoh bahaya konseptual:

```text
User input dianggap sebagai template, bukan sebagai data.
```

Salah:

```java
String template = "Hello " + userInput;
engine.process(template, context);
```

Jika `userInput` berisi syntax template, bisa dieksekusi.

Benar:

```java
model.put("message", userInput);
engine.process("safe-template", model);
```

Template source harus trusted atau disandbox/diapprove. User input harus data, bukan template code.

### 20.3 Risiko Raw Output

Raw output adalah bypass escaping.

Contoh Thymeleaf raw:

```html
<div th:utext="${content}"></div>
```

Contoh FreeMarker raw/no escape:

```ftl
${content?no_esc}
```

Gunakan hanya jika:

- content trusted; atau
- content sudah disanitasi; dan
- context output benar; dan
- ada test security; dan
- reviewer paham alasan raw output.

---

## 21. Rendering Failure Model

Template rendering bisa gagal di banyak titik.

### 21.1 Failure Taxonomy

| Failure | Contoh | Waktu Terjadi |
|---|---|---|
| Template not found | path salah | resolution |
| Template parse error | syntax invalid | parse/load |
| Missing required variable | `${notice.caseNo}` tidak ada | render |
| Type mismatch | list diharapkan, string diberikan | render |
| Formatting error | date null/invalid pattern | render |
| Escaping/output error | unsafe raw policy violation | render/preflight |
| Writer I/O error | client disconnect/file error | write |
| Timeout/resource error | loop besar/output besar | render/write |
| Dependency missing | macro/include hilang | parse/render |
| Locale missing | bundle tidak ada | render |

### 21.2 Error Classification

Jangan hanya lempar `RuntimeException`.

Buat klasifikasi:

```java
sealed interface RenderFailure permits
    TemplateNotFound,
    TemplateParseFailure,
    ModelValidationFailure,
    TemplateEvaluationFailure,
    OutputWriteFailure,
    RenderTimeoutFailure,
    SecurityPolicyFailure {
}
```

Untuk Java 8, gunakan interface/class hierarchy biasa.

### 21.3 User-Facing vs Operator-Facing Error

Untuk user:

```text
Unable to generate the document. Please contact support with reference ID ABC-123.
```

Untuk log internal:

```text
template=case.notice.warning
version=3.1.0
locale=en-SG
correlationId=ABC-123
failure=MissingRequiredVariable
path=notice.deadline.label
line=42
column=17
```

Jangan log seluruh model jika mengandung PII.

---

## 22. Observability Rendering

Rendering subsystem perlu metric dan log.

### 22.1 Metrics

Minimal:

```text
render.request.count
template.render.duration
template.render.failure.count
template.cache.hit.count
template.cache.miss.count
template.output.size
template.validation.failure.count
```

Dimensi/tag hati-hati:

```text
templateId
templateFamily
outputKind
locale
tenant maybe, if cardinality controlled
failureType
```

Jangan jadikan `caseNo` atau `userId` sebagai metric tag karena cardinality tinggi.

### 22.2 Logs

Log yang berguna:

```text
INFO render completed template=case.notice.warning version=3.1.0 output=HTML durationMs=18 outputBytes=12450 correlationId=...
WARN render failed template=... failure=ModelValidationFailure field=notice.deadline.label correlationId=...
```

### 22.3 Audit

Audit berbeda dari log.

Log untuk operator/debugging.

Audit untuk menjawab:

```text
Apa yang dibuat, kapan, oleh siapa/sistem apa, dari template versi apa, untuk kasus apa, dan output hash apa?
```

Audit record contoh:

```json
{
  "artifactId": "doc-2026-000123",
  "caseNo": "CEA/ENF/2026/000123",
  "templateId": "case.notice.warning",
  "templateVersion": "3.1.0",
  "modelSnapshotHash": "sha256:...",
  "outputHash": "sha256:...",
  "locale": "en-SG",
  "timezone": "Asia/Singapore",
  "renderedAt": "2026-06-19T05:00:00Z",
  "renderedBy": "system:case-workflow",
  "correlationId": "..."
}
```

---

## 23. Performance Mental Model

Rendering cost berasal dari beberapa sumber:

```text
T_total = T_resolve + T_parse/cache + T_bind + T_eval + T_format + T_escape + T_write
```

Dengan cache baik:

```text
T_total ≈ T_bind + T_eval + T_format + T_escape + T_write
```

### 23.1 Expensive Things

- parse template tiap request;
- remote template load tiap render;
- reflection-heavy object access;
- model graph besar;
- lazy loading dari template;
- nested loops besar;
- string concatenation besar;
- render-to-string untuk output besar;
- formatting mahal berulang;
- include/macro terlalu granular;
- escaping raw lalu sanitize per field secara mahal;
- PDF generation setelah HTML render.

### 23.2 Performance Rule

```text
Do expensive data preparation once in Java.
Do simple presentation traversal in template.
Cache parsed templates.
Stream large output when possible.
Measure with realistic model size.
```

### 23.3 Virtual Threads?

Java 21+ virtual threads bisa membantu jika rendering task banyak menunggu I/O, misalnya:

- load template dari remote storage;
- fetch assets;
- write to network/file;
- call email provider setelah render.

Namun pure CPU rendering tidak menjadi lebih cepat hanya karena virtual threads. Jika render CPU-bound, bottleneck tetap CPU.

Rule:

```text
Virtual threads improve concurrency for blocking workloads, not CPU cost of expression evaluation.
```

---

## 24. Java 8 sampai Java 25: Pengaruh ke Template Engineering

Template engine bisa dipakai di Java 8 sampai Java modern, tetapi desain model bisa berbeda.

### 24.1 Java 8 Baseline

Fitur relevan:

- lambda/stream;
- `java.time`;
- default methods;
- `Optional`;
- CompletableFuture;
- type annotations.

Model bisa dibuat dengan class immutable manual:

```java
public final class NoticeView {
    private final String caseNo;

    public NoticeView(String caseNo) {
        this.caseNo = Objects.requireNonNull(caseNo);
    }

    public String getCaseNo() {
        return caseNo;
    }
}
```

### 24.2 Java 16+ Records

Records cocok untuk ViewModel immutable:

```java
public record NoticeView(String caseNo, RecipientView recipient) {}
```

Kelebihan:

- ringkas;
- immutable by convention;
- contract jelas;
- cocok untuk tests.

Catatan:

- pastikan engine/object wrapper bisa membaca accessor record pada versi library yang dipakai;
- jangan jadikan record alasan untuk expose domain data mentah.

### 24.3 Java 17+ Sealed Types

Cocok untuk representasi display state:

```java
public sealed interface DisplayValue {
    record Present(String value) implements DisplayValue {}
    record Hidden(String reason) implements DisplayValue {}
    record NotApplicable() implements DisplayValue {}
}
```

Template bisa menerima model yang sudah dipresentasikan, bukan memutuskan semuanya sendiri.

### 24.4 Java 21+ Virtual Threads

Cocok untuk batch rendering orchestration yang I/O-heavy:

```text
render many documents -> store to object storage -> send notifications
```

Tetap perlu:

- rate limiting;
- bounded queue;
- memory budget;
- output size limit;
- failure isolation.

### 24.5 Java 25

Untuk Java 25, prinsip tetap sama: manfaatkan runtime modern, tetapi jangan membuat template engine menjadi tempat business logic. Semakin modern Java-nya, semakin mudah membuat model immutable, explicit, dan testable.

---

## 25. Good vs Bad Architecture Examples

### 25.1 Bad: Template Pulls From Everything

```text
Template
  -> entity graph
  -> service method
  -> repository
  -> security session
  -> system clock
  -> random helper
  -> raw HTML
```

Gejala:

- template sulit dites;
- rendering bisa query DB;
- output tidak deterministik;
- security boundary bocor;
- error runtime sulit dipahami;
- performance buruk;
- template author perlu paham domain internal.

### 25.2 Good: Application Pushes Prepared Model

```text
Application Service
  -> Query/Aggregation
  -> Authorization/Redaction
  -> Presenter/ViewModel
  -> Renderer
  -> Output Sink
```

Template hanya:

```text
read stable fields
loop prepared lists
render fragments
format simple values
escape output
```

---

## 26. Rendering Pipeline Blueprint

Contoh desain interface:

```java
public interface TemplateRenderer {
    RenderResult render(RenderRequest request, Writer writer);
}

public record RenderRequest(
    TemplateRef template,
    Object model,
    RenderContext context,
    RenderPolicy policy
) {}

public record RenderResult(
    TemplateRef template,
    int outputChars,
    Duration duration,
    String outputHash
) {}
```

Untuk Java 8:

```java
public final class RenderRequest {
    private final TemplateRef template;
    private final Object model;
    private final RenderContext context;
    private final RenderPolicy policy;

    // constructor, getters, validation
}
```

### 26.1 Flow

```text
render(request, writer):
  validate request
  resolve template metadata
  validate model contract
  select engine adapter
  get cached parsed template
  create engine context
  apply locale/timezone/output policy
  render to counting/hash writer
  collect metrics
  return result
```

### 26.2 Counting/Hashing Writer

Untuk audit, kita bisa wrap writer:

```text
Template Engine -> CountingHashingWriter -> Actual Writer
```

Manfaat:

- tahu output size;
- hitung hash output;
- enforce max chars;
- collect metric.

---

## 27. Practical Rulebook: Boundary Yang Harus Dijaga

### 27.1 Jangan Expose Ini ke Template

- JPA Entity langsung;
- Hibernate lazy proxy;
- repository;
- service;
- security context penuh;
- request/session mentah;
- database connection;
- file system helper;
- runtime/classloader helper;
- secrets/config penuh;
- raw user HTML tanpa sanitizer;
- object dengan method mutasi.

### 27.2 Boleh Expose Ini ke Template

- immutable ViewModel;
- map kecil dengan namespace stabil;
- display-specific DTO;
- precomputed permission flags;
- preformatted legal labels;
- safe URL/link object;
- safe enum label;
- localization/message helper terbatas;
- asset URL helper terbatas;
- fragment/macro library resmi.

### 27.3 Template Logic Budget

Boleh:

```text
if showSection
for item in preparedItems
display value/default
include fragment
format simple date/number
```

Hindari:

```text
if complex domain state
sort/filter domain collection
compute deadline
call service
load data
authorize action
mutate state
construct SQL/API payload dynamically from user input
```

---

## 28. Case Study Mini: Warning Notice Rendering

### 28.1 Requirement

Sistem enforcement perlu membuat warning notice saat case masuk state `WARNING_ISSUED`.

Output:

- HTML preview untuk officer;
- PDF final untuk record;
- email body untuk respondent;
- audit trail.

### 28.2 Bad Approach

```java
model.put("case", caseEntity);
model.put("respondent", respondentEntity);
model.put("breaches", breachRepository.findByCase(caseId));
model.put("user", securityContext.getCurrentUser());
```

Template:

```ftl
<#if case.status == "WARNING_ISSUED">
Dear ${respondent.fullName},

You have breached:
<#list breaches as b>
- ${b.legislation.section}: ${b.description}
</#list>

Please respond by ${deadlineService.compute(case)}.
</#if>
```

Masalah:

- template tahu status workflow;
- deadline service dipakai dari template;
- entity expose;
- authorization tidak jelas;
- audit sulit;
- output tidak stabil.

### 28.3 Better Approach

```java
public record WarningNoticeModel(
    String caseNo,
    RecipientBlock recipient,
    List<BreachLine> breachLines,
    String responseDeadlineLabel,
    String officerDisplayName,
    String agencyFooter,
    boolean showPortalLink,
    String portalUrl
) {}
```

Template:

```ftl
Dear ${notice.recipient.displayName},

This notice relates to case ${notice.caseNo}.

The following matters require your attention:
<#list notice.breachLines as breach>
- ${breach.label}
</#list>

Please respond by ${notice.responseDeadlineLabel}.

<#if notice.showPortalLink>
You may access the portal at ${notice.portalUrl}.
</#if>

${notice.agencyFooter}
```

### 28.4 Rendering Flow

```text
Case state transition committed
  -> outbox event WarningNoticeRequested
  -> worker loads case snapshot
  -> presenter builds WarningNoticeModel
  -> renderer validates model
  -> renderer uses template case.warning.notice v3.1.0
  -> render HTML
  -> generate PDF
  -> store artifact
  -> send email
  -> audit communication
```

### 28.5 Invariant

```text
The template is not allowed to decide whether warning should be issued.
The workflow already decided that.
The template only renders the warning notice.
```

---

## 29. Testing Mental Model

Template test bukan hanya “output contains text”.

Test layers:

### 29.1 Renderer Unit Test

```text
Given valid model, render succeeds.
```

### 29.2 Contract Test

```text
Template required fields match ViewModel fields.
```

### 29.3 Escaping Test

Input:

```text
<script>alert(1)</script>
```

Expected output:

```text
escaped, not executable
```

### 29.4 Locale Test

```text
en-SG output date: 31 July 2026
id-ID output date: 31 Juli 2026
```

### 29.5 Golden Master Test

Render known model and compare against approved output snapshot.

Caution:

- avoid brittle whitespace-only failure;
- normalize dynamic values;
- fix clock/timezone;
- version snapshots.

### 29.6 Negative Test

```text
missing required variable -> fail with clear error
unsafe raw field -> fail policy
unsupported locale -> fallback or fail according to policy
```

---

## 30. Common Anti-Patterns

### 30.1 Template as Business Logic Engine

Gejala:

- nested `if` besar;
- rules tersebar di template;
- perubahan policy butuh edit template;
- hasil beda antar template.

Perbaikan:

- pindahkan rule ke Java;
- berikan boolean/label siap pakai ke template.

### 30.2 Entity Dumping

Gejala:

```java
model.put("case", caseEntity)
```

Perbaikan:

- gunakan ViewModel;
- whitelist field;
- redaction before render.

### 30.3 Raw HTML Everywhere

Gejala:

```html
<div th:utext="${html}"></div>
```

Perbaikan:

- escaped by default;
- sanitizer;
- trusted content boundary;
- explicit review.

### 30.4 No Versioning

Gejala:

- template berubah, output lama tidak bisa dijelaskan;
- audit hanya simpan file final tanpa metadata;
- re-render menghasilkan wording berbeda.

Perbaikan:

- template version;
- output hash;
- model snapshot hash;
- immutable artifact storage.

### 30.5 Default Locale/Timezone

Gejala:

- output berubah saat server pindah region;
- test flakey;
- date salah untuk user.

Perbaikan:

- locale/timezone explicit dalam RenderContext.

### 30.6 Rendering Inside Transaction Too Long

Gejala:

```text
open DB transaction -> load data -> render PDF -> send email -> commit
```

Masalah:

- lock lama;
- rollback sulit;
- side effect external dalam transaction;
- timeout.

Perbaikan:

- commit state;
- emit outbox event;
- render/send async dengan idempotency.

---

## 31. Decision Checklist Sebelum Membuat Template Baru

Sebelum membuat template, jawab:

1. Output-nya untuk apa?
   - page?
   - email?
   - PDF?
   - text?
   - XML?
   - generated config/code?

2. Siapa pemilik template?
   - developer?
   - business user?
   - tenant?
   - agency?

3. Apakah template harus versioned?

4. Apakah output legal/audit-sensitive?

5. Apakah data model sudah eksplisit?

6. Apakah field sensitif sudah diredact?

7. Apa locale/timezone-nya?

8. Apa escaping context-nya?

9. Apa yang terjadi jika variable hilang?

10. Apakah render harus deterministic?

11. Apakah output harus disimpan?

12. Apakah perlu hash/audit?

13. Apakah template bisa berubah tanpa redeploy?

14. Jika bisa, bagaimana approval dan rollback?

15. Bagaimana test-nya?

16. Bagaimana observability-nya?

17. Bagaimana failure handling-nya?

---

## 32. Ringkasan Mental Model

Template rendering bukan:

```text
string replace yang lebih nyaman
```

Template rendering adalah:

```text
controlled, context-aware, secure, deterministic transformation
from prepared application data into a human/system-readable artifact.
```

Formula penting:

```text
Template + Data Model + Render Context + Render Policy + Output Sink = Render Result
```

Boundary penting:

```text
Domain Model != Template Model
Business Logic != Presentation Logic
Escaping != Sanitization
Logs != Audit
Template Path != Template Identity
Rendering != Sending
Render Success != Workflow Success
```

Top 1% engineer tidak hanya bertanya:

```text
Bagaimana cara menampilkan variable di template?
```

Tetapi bertanya:

```text
Apa kontrak data model-nya?
Apakah output deterministic?
Apa context escaping-nya?
Apa failure model-nya?
Bagaimana audit-nya?
Apakah template bisa berubah tanpa merusak output lama?
Apa security boundary-nya?
Apa performance budget-nya?
Bagaimana test-nya?
```

---

## 33. Mini Exercise

Desain rendering untuk `Application Rejection Email`.

Buat jawaban untuk:

1. Template identity.
2. Template versioning strategy.
3. Data model fields.
4. Render context fields.
5. Required vs optional fields.
6. Escaping strategy.
7. Locale/timezone handling.
8. Failure handling.
9. Audit metadata.
10. Test cases.

Contoh awal:

```text
templateId: application.rejection.email
version: 1.0.0
outputKind: EMAIL_HTML + EMAIL_TEXT
locale: en-SG
```

Model:

```java
public record ApplicationRejectionEmailModel(
    String applicantDisplayName,
    String applicationReferenceNo,
    String applicationTypeLabel,
    String decisionDateLabel,
    List<String> rejectionReasonLines,
    boolean showAppealInstruction,
    String appealDeadlineLabel,
    String portalUrl,
    String agencyFooter
) {}
```

Tests:

```text
- valid model renders HTML and text
- applicant name is escaped
- reason list empty fails or shows configured message
- appeal section hidden when showAppealInstruction=false
- locale en-SG and id-ID produce expected date labels
- output hash stable for fixed context
```

---

## 34. Apa Yang Akan Dipakai Di Part Berikutnya

Part 3 akan masuk ke FreeMarker fundamental architecture.

Dari Part 2 ini, konsep yang akan langsung dipakai:

- `Configuration` sebagai engine-level configuration;
- template loader/resolver;
- template cache;
- data model dan object wrapper;
- expression evaluation;
- output format;
- auto-escaping;
- render-to-writer;
- failure handling;
- thread-safety.

Jika Part 2 sudah dipahami, FreeMarker tidak lagi terlihat sebagai syntax `${...}`, tetapi sebagai engine dengan pipeline:

```text
Configuration -> TemplateLoader -> Template Cache -> ObjectWrapper -> Template.process(model, writer)
```

Dan Thymeleaf nanti akan terlihat sebagai pipeline:

```text
TemplateEngine -> TemplateResolver -> Context -> Dialect/Processor -> process(template, context, writer)
```

---

## 35. Referensi Resmi dan Bacaan Lanjutan

- Apache FreeMarker Manual — Template Author's Guide, data model, output formats, auto-escaping, configuration, object wrapping.
- Thymeleaf 3.1 Documentation — Using Thymeleaf, TemplateEngine API, template modes, natural templates, Spring integration.
- Spring Framework Reference — View technologies and Thymeleaf integration.
- Jakarta Pages Specification — Jakarta Pages/JSP as template engine for web applications compiled into Jakarta Servlet.
- OWASP XSS Prevention Cheat Sheet — output encoding by context.
- OWASP Server-Side Template Injection references — threat model for dynamic/untrusted template source.
- Java SE 8–25 documentation — `java.time`, records, sealed classes, virtual threads, modern runtime behavior.

---

# Status

```text
Part 2 selesai.
Seri belum selesai.
Berikutnya: Part 3 — FreeMarker Fundamental Architecture.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-001.md">⬅️ Part 1 — Template Engine Landscape di Java: JSP, FreeMarker, Thymeleaf, Mustache, Pebble, Velocity</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-003.md">Part 3 — FreeMarker Fundamental Architecture ➡️</a>
</div>
