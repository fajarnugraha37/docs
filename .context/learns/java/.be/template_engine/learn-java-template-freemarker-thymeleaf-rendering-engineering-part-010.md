# learn-java-template-freemarker-thymeleaf-rendering-engineering-part-010

# Part 10 — FreeMarker Performance Engineering

## 0. Posisi Part Ini Dalam Series

Kita sudah membahas FreeMarker dari sisi arsitektur, bahasa template, directive, macro, object wrapping, security boundary, output format, auto-escaping, dan diagnostics. Sekarang kita masuk ke sisi yang sering terlambat dipikirkan di sistem enterprise: **performance engineering**.

Part ini tidak membahas “bagaimana membuat template tampil”. Part ini membahas bagaimana membuat FreeMarker:

- cepat,
- stabil,
- predictable,
- aman terhadap beban tinggi,
- observable,
- tidak boros memory,
- tidak menjadi bottleneck batch/email/document generation,
- dan tidak menciptakan failure mode yang tersembunyi.

Dalam sistem real-world, FreeMarker sering dipakai untuk:

- email notification,
- correspondence letter,
- HTML page rendering,
- PDF pre-render HTML,
- generated config,
- generated SQL/script,
- generated code,
- text report,
- workflow/case-management document output.

Kebanyakan tim hanya fokus pada syntax FTL. Engineer yang lebih matang akan melihat FreeMarker sebagai **runtime transformation engine**:

```text
Template Source + Runtime Configuration + Data Model + Locale + Output Format + Writer
= Deterministic Output Artifact
```

Performance berarti mengontrol semua bagian pipeline tersebut.

---

## 1. Mental Model: FreeMarker Performance Bukan Satu Hal

Ketika orang berkata “FreeMarker lambat”, biasanya akar masalahnya bukan FreeMarker semata. Bisa jadi salah satu dari ini:

```text
1. Template terlalu sering diparse ulang.
2. Template loader lambat.
3. Template cache salah konfigurasi.
4. Data model terlalu besar.
5. Getter di model melakukan query/IO.
6. Template melakukan logic terlalu kompleks.
7. Macro/fragment composition terlalu dalam.
8. Output dibangun sebagai String besar di memory.
9. Escaping/formatting dilakukan berlebihan.
10. Banyak missing variable exception di production.
11. Object wrapper terlalu permissive dan mahal.
12. Thread-safety salah: shared mutable data model.
13. Batch rendering tidak dibatasi concurrency-nya.
14. PDF/email pipeline lambat tapi disalahkan ke FreeMarker.
15. Observability tidak memisahkan parse/load/render/write/send.
```

Mental model yang benar:

```text
FreeMarker performance =
  template lookup cost
+ template load cost
+ template parse cost
+ template cache behavior
+ expression evaluation cost
+ object wrapping/access cost
+ formatting/escaping cost
+ macro/directive cost
+ output writing cost
+ surrounding pipeline cost
```

Jadi jangan benchmark FreeMarker hanya dengan “render satu template kecil”. Benchmark harus menjawab workload nyata.

---

## 2. FreeMarker Rendering Pipeline Dari Perspektif Performance

Secara konseptual, pipeline render adalah:

```text
Client/Application Request
        |
        v
Resolve template name
        |
        v
TemplateLoader finds raw source
        |
        v
Template cache checks existing parsed template
        |
        +-- cache hit --> use parsed Template
        |
        +-- cache miss/stale --> read source + parse template
        |
        v
Build/receive data model
        |
        v
ObjectWrapper adapts Java objects into TemplateModel view
        |
        v
Evaluate FTL nodes, directives, expressions, macros
        |
        v
Apply formatting and escaping
        |
        v
Write output to Writer
        |
        v
Return/send/store output
```

Dari sini, kita bisa membagi biaya menjadi dua kelompok:

### 2.1 One-time / amortized cost

Biasanya bisa di-cache:

- resolving template path,
- loading source,
- parsing FTL,
- building internal representation,
- introspection metadata untuk object wrapper.

### 2.2 Per-render cost

Terjadi setiap render:

- membuat data model,
- wrapping object,
- evaluating expressions,
- executing loops/macros,
- formatting values,
- escaping output,
- writing output,
- allocating strings/temporary objects.

Engineering goal:

```text
Minimize repeated fixed cost.
Bound per-render dynamic cost.
Make large-output rendering streaming-friendly.
Keep data access predictable.
```

---

## 3. Configuration Lifecycle: Satu Configuration, Immutable Setelah Setup

FreeMarker `Configuration` adalah pusat runtime. Ia menyimpan setting penting seperti:

- template loader,
- object wrapper,
- encoding,
- locale,
- output format,
- exception handler,
- template cache behavior,
- shared variables.

Untuk aplikasi multithreaded, pattern yang benar:

```java
Configuration cfg = new Configuration(Configuration.VERSION_2_3_34);
cfg.setClassLoaderForTemplateLoading(appClassLoader, "/templates");
cfg.setDefaultEncoding("UTF-8");
cfg.setLogTemplateExceptions(false);
cfg.setWrapUncheckedExceptions(true);
cfg.setFallbackOnNullLoopVariable(false);

// Set semua setting di awal.
// Setelah itu publish sebagai singleton dan jangan diubah lagi.
```

Invariant production:

```text
Configuration dibuat sekali.
Configuration dikonfigurasi penuh saat startup.
Configuration dipublish secara aman.
Configuration tidak dimodifikasi saat request berjalan.
```

Kenapa penting?

- Menghindari race condition.
- Menghindari cache behavior yang berubah saat runtime.
- Menghindari synchronization cost yang tidak perlu.
- Membuat render behavior deterministic.

Anti-pattern:

```java
// Buruk: membuat Configuration per request
public String render(Map<String, Object> model) {
    Configuration cfg = new Configuration(Configuration.VERSION_2_3_34);
    cfg.setClassLoaderForTemplateLoading(getClass().getClassLoader(), "/templates");
    Template t = cfg.getTemplate("mail.ftlh");
    ...
}
```

Masalah:

- template cache tidak efektif,
- object wrapper metadata tidak reusable,
- startup-like cost terjadi tiap request,
- beban GC meningkat,
- konfigurasi rentan tidak konsisten.

Pattern benar:

```java
public final class FreeMarkerRenderer {
    private final Configuration configuration;

    public FreeMarkerRenderer(Configuration configuration) {
        this.configuration = Objects.requireNonNull(configuration);
    }

    public void render(String templateName, Object model, Writer writer) throws IOException, TemplateException {
        Template template = configuration.getTemplate(templateName);
        template.process(model, writer);
    }
}
```

---

## 4. Template dan Thread-Safety

FreeMarker `Template` yang sudah diparse dapat digunakan oleh banyak thread selama tidak ada mutable shared data yang disalahgunakan. Dalam praktik, template object sebaiknya dianggap immutable.

Rule:

```text
Configuration: shared singleton, immutable after setup.
Template: cached, reusable, read-only.
Data model: per-render or immutable.
Writer: per-render, never shared.
Shared variables: immutable/thread-safe only.
```

Bahaya paling sering bukan pada `Template`, tetapi pada model:

```java
Map<String, Object> sharedModel = new HashMap<>();

// Thread A
sharedModel.put("user", userA);
template.process(sharedModel, writerA);

// Thread B
sharedModel.put("user", userB);
template.process(sharedModel, writerB);
```

Ini race condition. Output bisa tercampur.

Pattern aman:

```java
Map<String, Object> model = new HashMap<>();
model.put("user", userView);
model.put("items", items);
template.process(model, writer);
```

Atau gunakan immutable model:

```java
Map<String, Object> model = Map.of(
    "user", userView,
    "items", List.copyOf(items)
);
```

Namun hati-hati Java 8 belum punya `Map.of`; untuk Java 8 bisa pakai `Collections.unmodifiableMap` atau builder internal.

---

## 5. Template Loading Cost

Template source bisa berasal dari:

- classpath,
- filesystem,
- servlet context,
- database,
- remote repository,
- in-memory map,
- multi-template loader.

TemplateLoader menentukan biaya lookup dan read source.

### 5.1 Classpath template loader

Cocok untuk:

- templates packaged dalam JAR,
- immutable application templates,
- CI/CD controlled templates,
- high-performance production.

Kelebihan:

- predictable,
- cepat,
- mudah di-containerize,
- cache-friendly,
- cocok untuk template yang berubah lewat deployment.

Kekurangan:

- perubahan template butuh release.

### 5.2 Filesystem template loader

Cocok untuk:

- development hot reload,
- server-managed template directory,
- operations-driven templates.

Risiko:

- path traversal jika template name tidak dikontrol,
- filesystem latency,
- inconsistent template state saat file diganti live,
- permission/volume issue di container.

### 5.3 Database template loader

Cocok untuk:

- business-editable templates,
- multi-tenant templates,
- versioned correspondence platform,
- approval workflow.

Risiko besar:

- DB lookup di hot path,
- template source ikut transaksi bisnis,
- cache invalidation kompleks,
- stale template,
- partial publish,
- editor bisa membuat template lambat/berbahaya.

Pattern yang lebih baik:

```text
DB template repository
        |
        | publish approved template
        v
Template artifact/cache layer
        |
        | render by templateId + version
        v
FreeMarker TemplateLoader
```

Jangan jadikan DB query sebagai cost wajib untuk setiap render.

### 5.4 Remote template loader

Biasanya buruk untuk hot path.

Contoh:

- template dari HTTP service,
- S3/object storage langsung saat render,
- config server langsung saat render.

Masalah:

- network latency,
- timeout,
- retry amplification,
- partial outage,
- nondeterministic render latency,
- cache invalidation rumit.

Jika harus memakai remote source:

```text
Remote repository --> local materialized cache --> FreeMarker render
```

Template harus sudah tersedia lokal saat render production.

---

## 6. Template Cache: Salah Satu Performance Lever Terbesar

FreeMarker dapat menyimpan parsed template dalam cache. Cache membuat source tidak perlu dibaca dan diparse ulang setiap render.

Tanpa cache:

```text
request 1 -> load + parse + render
request 2 -> load + parse + render
request 3 -> load + parse + render
```

Dengan cache:

```text
request 1 -> load + parse + render
request 2 -> cache hit + render
request 3 -> cache hit + render
```

### 6.1 Apa yang dicache?

Secara praktis, cache menyimpan template yang sudah diproses ke bentuk internal FreeMarker, bukan sekadar string source.

Cache key biasanya dipengaruhi oleh:

- template name,
- locale,
- encoding,
- custom lookup condition/output format tertentu tergantung setup.

Jadi template yang sama dengan locale berbeda bisa menghasilkan lookup/cache entry berbeda bila localized lookup aktif.

### 6.2 Template update delay

`template_update_delay` menentukan seberapa sering FreeMarker mengecek apakah template source berubah.

Untuk development:

```text
template_update_delay kecil
```

Agar perubahan cepat terlihat.

Untuk production packaged templates:

```text
template_update_delay besar atau cache stabil
```

Karena template berubah lewat deployment, bukan edit live.

Trade-off:

```text
update delay kecil:
  + hot reload nyaman
  - lebih sering check source
  - filesystem/loader overhead meningkat

update delay besar:
  + render lebih stabil
  + lookup overhead kecil
  - perubahan template tidak langsung terlihat
```

### 6.3 Localized lookup cost

FreeMarker bisa mencari variasi template berdasarkan locale.

Misalnya request:

```text
invoice.ftlh + locale en_US
```

Engine bisa mencoba variasi seperti:

```text
invoice_en_US.ftlh
invoice_en.ftlh
invoice.ftlh
```

Ini berguna, tetapi punya biaya lookup tambahan. Jika sistem Anda tidak memakai localized template file, matikan localized lookup atau gunakan strategy eksplisit.

Decision:

```text
Jika locale diselesaikan lewat message bundle:
  localized template lookup bisa dimatikan.

Jika setiap locale punya template berbeda:
  localized lookup berguna, tapi ukur lookup cost dan cache behavior.
```

### 6.4 Cache invalidation

Untuk static packaged templates:

```text
invalidate by deployment
```

Untuk dynamic/business templates:

```text
invalidate by template version publication
```

Jangan gunakan invalidation global sembarangan:

```java
configuration.clearTemplateCache();
```

Itu bisa menyebabkan thundering herd:

```text
cache cleared
1000 requests masuk
semua reload/parse template
CPU spike
latency spike
```

Lebih baik:

```text
remove specific template/version from cache
warm up new template
switch active version atomically
```

---

## 7. Warm-Up Strategy

Template cache yang dingin bisa menyebabkan latency spike pada request pertama.

Untuk sistem critical, warm-up template saat startup atau deployment.

Contoh:

```java
public void warmUpTemplates(Configuration cfg, List<String> templateNames) {
    for (String name : templateNames) {
        try {
            cfg.getTemplate(name);
        } catch (IOException e) {
            throw new IllegalStateException("Failed to warm up template: " + name, e);
        }
    }
}
```

Untuk lebih baik, lakukan preflight render dengan sample model:

```java
public void preflightRender(
    Configuration cfg,
    String templateName,
    Object sampleModel
) {
    try (Writer out = new NullWriter()) {
        Template template = cfg.getTemplate(templateName);
        template.process(sampleModel, out);
    } catch (IOException | TemplateException e) {
        throw new IllegalStateException("Template preflight failed: " + templateName, e);
    }
}
```

`NullWriter` sederhana:

```java
public final class NullWriter extends Writer {
    @Override public void write(char[] cbuf, int off, int len) {}
    @Override public void flush() {}
    @Override public void close() {}
}
```

Warm-up bisa menemukan:

- missing template,
- parse error,
- missing macro import,
- incompatible syntax,
- model contract mismatch,
- output format misconfiguration.

Namun jangan warm-up semua kombinasi secara brutal bila jumlah template/tenant/locale sangat besar.

Gunakan prioritas:

```text
Tier 1: high-traffic templates
Tier 2: critical legal/email templates
Tier 3: rarely used templates on-demand
```

---

## 8. Data Model Size: Musuh Tersembunyi

FreeMarker tidak membutuhkan seluruh domain graph. Ia butuh presentation data.

Anti-pattern:

```java
model.put("case", caseAggregate);
model.put("user", currentUserEntity);
model.put("application", applicationEntity);
model.put("securityContext", securityContext);
```

Masalah:

- template bisa mengakses terlalu banyak data,
- getter bisa lazy-load database,
- object wrapper harus expose struktur besar,
- security boundary melemah,
- rendering cost tidak predictable,
- template menjadi tergantung domain model internal.

Pattern benar:

```java
public record CaseLetterView(
    String caseNumber,
    String applicantName,
    String formattedSubmissionDate,
    String decisionLabel,
    List<RequirementLineView> requirements
) {}
```

Kemudian:

```java
model.put("letter", caseLetterView);
```

### 8.1 Rule of thumb

```text
Template data model harus sekecil mungkin, spesifik, immutable, dan sudah siap render.
```

### 8.2 Jangan biarkan getter melakukan IO

Buruk:

```java
public class CaseEntity {
    public List<Document> getDocuments() {
        return documentRepository.findByCaseId(id); // IO tersembunyi
    }
}
```

Dari template:

```ftl
<#list case.documents as doc>
  ${doc.name}
</#list>
```

Kelihatannya sederhana, tetapi bisa memicu query.

Invariant:

```text
Rendering must not trigger hidden database/network IO.
```

Semua data harus disiapkan sebelum render.

---

## 9. Object Wrapping and Reflection Cost

ObjectWrapper mengubah Java object menjadi representasi yang bisa dilihat FTL.

Cost yang bisa muncul:

- introspection JavaBean property,
- method resolution,
- adapter creation,
- type conversion,
- collection/map access,
- exposing methods yang tidak perlu.

FreeMarker punya caching internal untuk introspection, tetapi desain model tetap penting.

### 9.1 Map vs POJO vs record

`Map<String, Object>`:

- fleksibel,
- mudah untuk dynamic model,
- kurang type-safe,
- typo baru ketahuan runtime,
- cocok untuk simple template.

POJO/ViewModel:

- lebih type-safe,
- contract lebih jelas,
- bisa dites,
- mudah refactor dengan IDE,
- getter harus murni dan murah.

Java record:

- immutable,
- jelas sebagai data carrier,
- bagus untuk Java 16+,
- tidak tersedia di Java 8.

Untuk Java 8–15, pakai final class immutable.

Contoh Java 8-compatible:

```java
public final class InvoiceView {
    private final String invoiceNumber;
    private final String customerName;
    private final List<InvoiceLineView> lines;

    public InvoiceView(String invoiceNumber, String customerName, List<InvoiceLineView> lines) {
        this.invoiceNumber = invoiceNumber;
        this.customerName = customerName;
        this.lines = Collections.unmodifiableList(new ArrayList<>(lines));
    }

    public String getInvoiceNumber() { return invoiceNumber; }
    public String getCustomerName() { return customerName; }
    public List<InvoiceLineView> getLines() { return lines; }
}
```

Java 16+:

```java
public record InvoiceView(
    String invoiceNumber,
    String customerName,
    List<InvoiceLineView> lines
) {}
```

### 9.2 Jangan expose service object

Buruk:

```java
model.put("caseService", caseService);
```

Template:

```ftl
${caseService.findCase(caseId).applicant.name}
```

Ini menghancurkan performance boundary:

- query di template,
- no transaction clarity,
- no caching clarity,
- difficult profiling,
- security risk.

Rule:

```text
Template receives data, not capability.
```

---

## 10. Expression Evaluation Cost

FTL expression terlihat murah, tapi jika diulang ribuan kali dalam loop, cost bisa signifikan.

Contoh:

```ftl
<#list rows as row>
  ${row.customer.account.owner.organization.displayName}
</#list>
```

Masalah:

- deep property chain,
- repeated hash/property access,
- possible missing checks,
- possible method/property resolution,
- difficult null behavior.

Lebih baik siapkan model:

```java
public record RowView(
    String organizationDisplayName,
    String statusLabel,
    String formattedAmount
) {}
```

Template:

```ftl
<#list rows as row>
  ${row.organizationDisplayName}
</#list>
```

Performance dan readability naik.

### 10.1 Precompute repeated values

Buruk:

```ftl
<#list items as item>
  ${item.price * item.quantity}
</#list>
```

Tidak selalu buruk untuk kecil, tetapi untuk currency/legal output, lebih baik precompute:

```java
public record LineView(
    String name,
    String formattedUnitPrice,
    String formattedQuantity,
    String formattedLineTotal
) {}
```

Template:

```ftl
${line.formattedLineTotal}
```

Terutama jika:

- rounding penting,
- locale/currency penting,
- hasil harus audit-friendly,
- calculation bukan concern template.

---

## 11. Loops and Large Output

Loop adalah sumber cost paling umum.

```ftl
<#list rows as row>
  <tr>
    <td>${row.a}</td>
    <td>${row.b}</td>
    <td>${row.c}</td>
  </tr>
</#list>
```

Jika `rows` berisi 50, ini normal. Jika 100.000, ini masalah.

### 11.1 Jangan render huge list ke HTML page

Untuk web UI:

```text
Use pagination.
Use server-side filtering.
Use server-side sorting.
Never render massive table into one HTML response.
```

### 11.2 Untuk export/report

Jika output memang besar:

- gunakan streaming Writer,
- hindari StringWriter besar,
- batasi concurrency,
- ukur memory,
- consider format khusus seperti CSV streaming, bukan HTML table besar.

### 11.3 Loop body complexity

Buruk:

```ftl
<#list rows as row>
  <#if row.status == "A" && row.owner?? && row.owner.roles?seq_contains("APPROVER")>
    <@complexComponent row=row />
  <#elseif row.status == "B">
    ...
  <#else>
    ...
  </#if>
</#list>
```

Lebih baik:

```java
public record RowView(
    String renderMode,
    boolean showApprovalBadge,
    String statusLabel,
    String ownerLabel
) {}
```

Template:

```ftl
<#list rows as row>
  <@rowComponent row=row />
</#list>
```

Atau pre-split collection:

```java
model.put("approvalRows", approvalRows);
model.put("normalRows", normalRows);
```

---

## 12. Macro and Directive Performance

Macro sangat berguna untuk reuse. Tetapi macro juga bisa menjadi abstraction layer yang terlalu mahal dan sulit dipahami.

### 12.1 Macro call overhead

Untuk normal UI/email, macro overhead biasanya bukan bottleneck utama. Masalah muncul jika:

- macro dipanggil ratusan ribu kali,
- macro melakukan banyak conditional,
- macro nested terlalu dalam,
- macro menggunakan dynamic include/import,
- macro menghasilkan whitespace besar,
- macro memanggil custom Java method yang mahal.

Contoh buruk:

```ftl
<#list rows as row>
  <@tableCell value=row.a />
  <@tableCell value=row.b />
  <@tableCell value=row.c />
  <@tableCell value=row.d />
  <@tableCell value=row.e />
</#list>
```

Jika `rows` 100.000, macro call menjadi 500.000.

Untuk volume besar, boleh inline bagian sederhana:

```ftl
<#list rows as row>
  <td>${row.a}</td>
  <td>${row.b}</td>
  <td>${row.c}</td>
</#list>
```

Rule:

```text
Use macro for semantic reuse.
Avoid macro for microscopic repeated cells in massive exports.
```

### 12.2 Custom directive

Custom directive dari Java bisa cepat jika pure dan ringan, tetapi bisa sangat buruk jika directive melakukan:

- DB query,
- network call,
- heavy formatting,
- file IO,
- synchronization global,
- mutation shared state.

Rule:

```text
Custom directive must be deterministic, side-effect-free, bounded, and observable.
```

---

## 13. Include, Import, and Template Composition Cost

`#include` menyisipkan template lain saat runtime. `#import` membuat namespace macro library.

Composition bagus untuk maintainability, tetapi perlu disiplin.

### 13.1 Static include/import

Baik:

```ftl
<#import "/lib/components.ftl" as c>
<#include "/layout/header.ftl">
```

Path jelas, cache efektif, dependency bisa dilacak.

### 13.2 Dynamic include

Berisiko:

```ftl
<#include userSelectedTemplate>
```

Masalah:

- template path injection,
- cache key explosion,
- sulit preflight,
- sulit audit dependency,
- unpredictable cache miss.

Jika perlu dynamic selection, lakukan di Java:

```java
TemplateId selected = templateSelector.select(caseState, locale, tenant);
renderer.render(selected.name(), model, writer);
```

Atau whitelist:

```java
private static final Map<String, String> ALLOWED_PARTIALS = Map.of(
    "APPROVED", "/partials/approved.ftlh",
    "REJECTED", "/partials/rejected.ftlh"
);
```

Java 8 variant pakai unmodifiable map manual.

### 13.3 Dependency graph

Untuk platform template enterprise, simpan dependency graph:

```text
template: letter-decision-v3.ftlh
imports:
  /lib/layout.ftl
  /lib/formatting.ftl
includes:
  /partials/signatory.ftlh
  /partials/footer.ftlh
```

Gunanya:

- preflight dependency,
- cache warm-up,
- impact analysis,
- template approval,
- safe rollback.

---

## 14. Escaping and Formatting Cost

Escaping adalah security requirement. Jangan mematikan escaping demi performance tanpa bukti.

Cost escaping biasanya jauh lebih murah dibanding:

- DB query,
- network call,
- PDF generation,
- SMTP send,
- object graph traversal besar,
- repeated template parsing.

Namun tetap perlu desain.

### 14.1 Jangan escape berkali-kali secara manual

Buruk:

```ftl
${user.name?html}
```

Di template `.ftlh` dengan auto-escaping HTML aktif, ini bisa menyebabkan double escaping atau confusion tergantung bentuk value.

Lebih baik:

```ftl
${user.name}
```

Biarkan output format mengatur escaping.

### 14.2 Preformatted string vs raw value

Untuk number/date, ada trade-off:

Pilihan A: format di template

```ftl
${invoice.amount?string.currency}
```

Pilihan B: format di Java

```ftl
${invoice.formattedAmount}
```

Untuk enterprise/legal output, sering lebih baik preformat di Java karena:

- aturan rounding eksplisit,
- locale/timezone jelas,
- test lebih mudah,
- audit lebih kuat,
- template lebih sederhana.

Tapi untuk generic UI sederhana, template formatting boleh dipakai.

Rule:

```text
Formatting yang domain/legal-sensitive sebaiknya di Java.
Formatting yang purely presentational boleh di template.
```

---

## 15. Writer Strategy: StringWriter vs Streaming Writer

Banyak contoh memakai `StringWriter`:

```java
StringWriter out = new StringWriter();
template.process(model, out);
return out.toString();
```

Ini nyaman, tetapi untuk output besar bisa mahal.

### 15.1 StringWriter cost

`StringWriter` menyimpan output dalam memory.

Masalah:

- output besar membuat heap naik,
- copy saat `toString`,
- batch render banyak dokumen bisa meledakkan memory,
- GC pressure meningkat.

Cocok untuk:

- email kecil,
- HTML page kecil/menengah,
- tests,
- preview.

Tidak ideal untuk:

- massive report,
- generated CSV besar,
- ribuan PDF pre-render paralel,
- export batch.

### 15.2 Streaming writer

Untuk HTTP response:

```java
try (Writer writer = response.getWriter()) {
    template.process(model, writer);
}
```

Untuk file:

```java
try (Writer writer = Files.newBufferedWriter(path, StandardCharsets.UTF_8)) {
    template.process(model, writer);
}
```

Untuk Java 8 compatible:

```java
try (Writer writer = new BufferedWriter(
        new OutputStreamWriter(new FileOutputStream(file), StandardCharsets.UTF_8))) {
    template.process(model, writer);
}
```

### 15.3 Buffering

Writer harus buffered jika sink mahal.

Buruk:

```java
Writer writer = new OutputStreamWriter(socketOutputStream, StandardCharsets.UTF_8);
template.process(model, writer);
```

Lebih baik:

```java
Writer writer = new BufferedWriter(
    new OutputStreamWriter(outputStream, StandardCharsets.UTF_8),
    64 * 1024
);
```

Jangan terlalu besar tanpa ukur. Buffer besar x concurrency tinggi bisa meningkatkan memory.

---

## 16. Encoding Cost and Correctness

Selalu tetapkan encoding.

```java
cfg.setDefaultEncoding("UTF-8");
```

Untuk template source:

```java
Template template = cfg.getTemplate("mail.ftlh", Locale.US, "UTF-8");
```

Untuk output:

```java
Files.newBufferedWriter(path, StandardCharsets.UTF_8)
```

Masalah encoding bisa terlihat seperti bug performance karena:

- retry render,
- failed email send,
- PDF font fallback,
- corrupted character,
- reprocessing.

Invariant:

```text
Template source encoding and output encoding must be explicit.
```

---

## 17. Batch Rendering and Concurrency Control

Batch rendering sering muncul pada:

- mass email,
- daily correspondence generation,
- statement/report generation,
- case reminder generation,
- PDF bundle generation.

Kesalahan umum:

```java
items.parallelStream().forEach(item -> render(item));
```

Masalah:

- memakai common ForkJoinPool,
- concurrency tidak sesuai resource,
- memory spike,
- SMTP/PDF/storage bottleneck,
- sulit observability,
- error handling lemah.

### 17.1 Gunakan bounded executor

Java 8:

```java
ExecutorService executor = Executors.newFixedThreadPool(8);

List<Future<RenderResult>> futures = new ArrayList<>();
for (RenderJob job : jobs) {
    futures.add(executor.submit(() -> renderJob(job)));
}

for (Future<RenderResult> future : futures) {
    RenderResult result = future.get();
    // handle result
}
```

Lebih baik lagi dengan queue/backpressure.

### 17.2 Java 21+ virtual threads

Virtual threads bisa membantu jika rendering pipeline banyak blocking IO, misalnya:

- load data,
- write file,
- call storage,
- send email.

Namun FreeMarker expression evaluation sendiri adalah CPU-bound. Virtual threads tidak membuat CPU-bound render menjadi lebih cepat secara ajaib.

Decision:

```text
CPU-bound rendering:
  limit concurrency roughly around CPU cores.

IO-bound surrounding pipeline:
  virtual threads can simplify concurrency.

Large output memory-bound rendering:
  limit concurrency based on heap/output size, not thread count only.
```

Java 21+ example:

```java
try (ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor()) {
    List<Future<RenderResult>> futures = new ArrayList<>();
    for (RenderJob job : jobs) {
        futures.add(executor.submit(() -> renderAndStore(job)));
    }
    for (Future<RenderResult> f : futures) {
        f.get();
    }
}
```

Tetap butuh limiter:

```java
Semaphore renderLimiter = new Semaphore(8);

RenderResult renderAndStore(RenderJob job) throws Exception {
    renderLimiter.acquire();
    try {
        return renderJob(job);
    } finally {
        renderLimiter.release();
    }
}
```

Virtual thread tanpa limiter bisa membuat ribuan render besar berjalan bersamaan dan menghabiskan heap.

---

## 18. Memory Engineering

Sumber memory allocation dalam rendering:

- data model object,
- wrapper/adapters,
- temporary strings,
- formatted number/date strings,
- escaped strings,
- macro local variables,
- StringWriter buffer,
- output artifact bytes,
- PDF/email downstream buffers.

### 18.1 Estimate output size

Sebelum batch, buat estimasi:

```text
jobs = 10,000
average HTML output = 80 KB
if using StringWriter and 20 concurrent renders:
  80 KB char payload ~= 160 KB char[] minimum per output
  + growth overhead
  + model
  + downstream PDF/email buffers
```

Jangan lupa Java `String`/char/byte internal representation berubah antar versi, tetapi prinsipnya tetap: output besar + concurrency tinggi = heap pressure.

### 18.2 Avoid retaining output too long

Buruk:

```java
List<String> outputs = new ArrayList<>();
for (Job job : jobs) {
    outputs.add(renderToString(job));
}
for (String output : outputs) {
    send(output);
}
```

Lebih baik:

```java
for (Job job : jobs) {
    String output = renderToString(job);
    send(output);
}
```

Atau streaming pipeline.

### 18.3 Avoid model over-retention

Jangan simpan model besar di result object/log/error object.

Buruk:

```java
catch (TemplateException e) {
    throw new RenderException(templateName, model, e);
}
```

Ini bisa menahan seluruh object graph di memory.

Lebih baik:

```java
catch (TemplateException e) {
    throw new RenderException(templateName, renderId, safeModelSummary(model), e);
}
```

---

## 19. Whitespace and Output Size

Whitespace bukan hanya estetika. Untuk email/PDF/large report, whitespace bisa menambah ukuran output.

FTL punya fitur whitespace stripping/trimming, tetapi gunakan dengan hati-hati karena output HTML/text tertentu bisa berubah.

Contoh kontrol sederhana:

```ftl
<#list items as item>
${item.name}
</#list>
```

Bisa menghasilkan newline/spasi yang tidak diinginkan. Untuk text output, ini harus deliberate.

Rule:

```text
For HTML pages: whitespace usually minor.
For plain text/email/fixed-width: whitespace is semantic.
For huge generated artifacts: whitespace affects size and downstream processing.
```

---

## 20. Measuring Correctly: Jangan Menebak

Performance engineering tanpa measurement adalah spekulasi.

Ukur minimal:

```text
template.load.latency
render.latency
render.output.bytes
render.model.size.approx
render.failure.count
render.cache.hit/miss if available
render.template.name
render.template.version
render.locale
render.output.format
```

Pisahkan tahap:

```text
prepare model
get template
render template
write/store output
send/convert downstream
```

Contoh wrapper timing:

```java
public RenderMetrics render(RenderRequest request, Writer writer) {
    long t0 = System.nanoTime();
    Object model = modelFactory.create(request);
    long t1 = System.nanoTime();

    Template template = configuration.getTemplate(request.templateName(), request.locale());
    long t2 = System.nanoTime();

    template.process(model, writer);
    long t3 = System.nanoTime();

    return new RenderMetrics(
        request.templateName(),
        t1 - t0,
        t2 - t1,
        t3 - t2
    );
}
```

Jangan hanya ukur total email send, lalu menyalahkan FreeMarker.

---

## 21. JMH Benchmarking FreeMarker

Gunakan JMH untuk microbenchmark rendering. Jangan pakai loop manual dengan `System.currentTimeMillis`.

### 21.1 Apa yang di-benchmark?

Minimal skenario:

1. cached template render small model,
2. cached template render large list,
3. cache miss parse + render,
4. macro-heavy render,
5. HTML auto-escape render,
6. StringWriter vs NullWriter,
7. map model vs POJO model,
8. preformatted values vs template formatting.

### 21.2 Contoh JMH skeleton

```java
@State(Scope.Benchmark)
public class FreeMarkerRenderBenchmark {

    private Configuration cfg;
    private Template template;
    private Map<String, Object> model;

    @Setup(Level.Trial)
    public void setup() throws Exception {
        cfg = new Configuration(Configuration.VERSION_2_3_34);
        cfg.setClassLoaderForTemplateLoading(
            Thread.currentThread().getContextClassLoader(),
            "/templates"
        );
        cfg.setDefaultEncoding("UTF-8");
        cfg.setLogTemplateExceptions(false);
        cfg.setWrapUncheckedExceptions(true);

        template = cfg.getTemplate("benchmark/invoice.ftlh");
        model = BenchmarkModels.invoiceModel(100);
    }

    @Benchmark
    public String renderToString() throws Exception {
        StringWriter out = new StringWriter(16 * 1024);
        template.process(model, out);
        return out.toString();
    }

    @Benchmark
    public void renderToNullWriter() throws Exception {
        template.process(model, NullWriter.INSTANCE);
    }
}
```

`renderToNullWriter` membantu memisahkan cost evaluation dari cost string allocation/output retention.

### 21.3 JMH pitfalls

Jangan:

- membuat Configuration di method `@Benchmark` kecuali memang mengukur startup/config cost,
- membaca template dari filesystem setiap iteration kecuali mengukur loader/cache miss,
- memakai model random yang berubah ekstrem tanpa tujuan,
- mengabaikan warmup,
- membandingkan engine tanpa output yang ekuivalen,
- mengukur PDF/email send sebagai “FreeMarker benchmark”.

---

## 22. JFR Profiling

Java Flight Recorder berguna untuk melihat:

- allocation hotspots,
- CPU hotspots,
- blocked threads,
- file IO,
- socket IO,
- GC pause,
- lock contention,
- exception rate.

Untuk render workload, cari:

```text
High allocation in String/char[]/byte[]
Frequent TemplateException
Expensive getter/method calls
Unexpected database/network IO
Huge StringWriter growth
Excessive formatter creation
Synchronization contention in custom directive/helper
```

JFR bisa membuktikan apakah bottleneck benar di FreeMarker atau di:

- model preparation,
- repository query,
- PDF conversion,
- SMTP,
- storage upload,
- logging.

---

## 23. Logging and Exceptions Can Destroy Performance

Template exception mahal jika terjadi sering.

Buruk:

```text
Missing variable happens on 20% requests.
Exception thrown.
Stack trace logged.
Fallback rendered.
```

Ini menyebabkan:

- CPU overhead,
- log volume besar,
- disk IO,
- noisy alert,
- hidden latency.

Rule:

```text
Missing variable in production is a contract failure, not normal control flow.
```

Gunakan:

- preflight validation,
- model contract test,
- required field checker,
- safe defaults hanya untuk optional field.

Jangan mengandalkan exception sebagai branching.

---

## 24. Output Format and Auto-Escaping Performance Decision

Auto-escaping harus dianggap default untuk HTML/XML output.

Optimasi yang benar:

```text
Reduce unnecessary rendering volume.
Reduce repeated formatting.
Use correct model.
Cache templates.
Stream output.
```

Optimasi yang salah:

```text
Disable auto-escaping globally to save CPU.
Use ?no_esc everywhere.
Store raw trusted-looking HTML without sanitizer.
```

Security regression biasanya jauh lebih mahal daripada sedikit overhead escaping.

---

## 25. Dynamic Templates: Performance + Security Double Risk

Jika template bisa diedit user/admin/business, performance risk meningkat:

- template dengan loop besar,
- recursive macro,
- dynamic include banyak,
- expensive built-ins,
- output sangat besar,
- missing variable storm,
- malicious template injection.

Governance harus mencakup performance budget:

```text
Max template source size
Max output size
Max render time
Max include depth
Max macro recursion/dependency depth
Allowed directives/built-ins
No dynamic eval/interpret for untrusted templates
Preflight with sample data
Approval before publish
Canary publish
Rollback
```

Template publishing pipeline:

```text
Draft
  -> syntax validation
  -> dependency validation
  -> security lint
  -> model contract validation
  -> sample render
  -> performance smoke test
  -> approval
  -> publish immutable version
  -> cache warm-up
```

---

## 26. Performance Budgeting

Setiap template penting harus punya budget.

Contoh untuk web page:

```text
Template render p95 <= 20 ms
Model preparation p95 <= 80 ms
Total controller p95 <= 200 ms
Output size <= 300 KB
Rows rendered <= 100 per page
```

Contoh untuk email:

```text
Render p95 <= 15 ms
Output HTML <= 150 KB
Plain text alternative required
No DB access during render
Template version immutable
```

Contoh untuk PDF pre-render:

```text
HTML render p95 <= 50 ms
PDF conversion p95 <= 2 s
Output HTML <= 1 MB
Images/fonts resolved locally/cache
No external network during conversion
```

Contoh untuk batch:

```text
Max concurrent renders = 8
Max concurrent PDF conversions = 2
Max output retained in memory = bounded
Failed render goes to dead-letter/manual review
No infinite retry on template failure
```

---

## 27. Practical Production Configuration Baseline

Contoh baseline:

```java
public final class FreeMarkerConfigurationFactory {

    public static Configuration create(ClassLoader classLoader) {
        Configuration cfg = new Configuration(Configuration.VERSION_2_3_34);

        cfg.setClassLoaderForTemplateLoading(classLoader, "/templates");
        cfg.setDefaultEncoding("UTF-8");
        cfg.setLocalizedLookup(false);

        cfg.setTemplateExceptionHandler(TemplateExceptionHandler.RETHROW_HANDLER);
        cfg.setLogTemplateExceptions(false);
        cfg.setWrapUncheckedExceptions(true);
        cfg.setFallbackOnNullLoopVariable(false);

        cfg.setOutputFormat(HTMLOutputFormat.INSTANCE);
        cfg.setRecognizeStandardFileExtensions(true);

        return cfg;
    }

    private FreeMarkerConfigurationFactory() {}
}
```

Catatan:

- `setLocalizedLookup(false)` hanya jika tidak memakai localized template file.
- `HTMLOutputFormat` cocok jika default output adalah HTML. Untuk mixed output, gunakan extension `.ftlh`, `.ftlx`, `.ftl` dengan recognition yang benar.
- Jangan ubah `cfg` setelah dipublish.

---

## 28. Renderer Interface Yang Performance-Aware

```java
public interface TemplateRenderer {
    RenderResult render(RenderRequest request) throws RenderException;

    void renderTo(RenderRequest request, Writer writer) throws RenderException;
}
```

```java
public final class RenderRequest {
    private final String templateName;
    private final String templateVersion;
    private final Locale locale;
    private final ZoneId zoneId;
    private final Object model;
    private final String renderId;

    // constructor + getters
}
```

```java
public final class RenderResult {
    private final String renderId;
    private final String templateName;
    private final String templateVersion;
    private final long renderNanos;
    private final int outputChars;
    private final String output;

    // constructor + getters
}
```

Untuk output besar, jangan return `String`; gunakan `renderTo`.

```java
renderer.renderTo(request, writer);
```

---

## 29. Failure Model For Performance

Performance problem sering muncul sebagai failure:

| Failure | Penyebab | Dampak | Mitigasi |
|---|---|---|---|
| Cold cache latency spike | template belum diparse | p95/p99 tinggi | warm-up |
| Cache miss storm | clear cache global | CPU spike | targeted invalidation |
| Memory spike | StringWriter besar + concurrency | OOM/GC pause | streaming + limiter |
| Hidden DB calls | entity getter lazy-load | slow render/N+1 | view model |
| Template exception storm | missing variable | CPU/log overhead | contract test |
| Remote loader timeout | template via network | render fail/slow | local materialized cache |
| Dynamic include explosion | user-driven path | cache miss/security risk | whitelist |
| Macro recursion | bad template | CPU runaway | lint + preflight |
| PDF blamed on template | downstream converter slow | wrong optimization | staged metrics |

---

## 30. Java 8–25 Considerations

### Java 8

- No records.
- Use immutable final classes for view model.
- No virtual threads.
- Use bounded ExecutorService.
- `java.time` available and should be used for date/time model.

### Java 11/17

- Better runtime baseline for server apps.
- Use modern GC options depending workload.
- Still use bounded executor for batch rendering.

### Java 21

- Virtual threads available.
- Useful for IO-heavy pipelines.
- Still bound CPU/render/PDF concurrency.
- Records/sealed classes useful for render model hierarchy.

### Java 25

- Treat as modern long-forward baseline for language/runtime ergonomics.
- Same fundamental FreeMarker principles apply:
  - immutable config,
  - cached templates,
  - bounded rendering,
  - explicit model,
  - streaming large outputs.

Important:

```text
Newer Java can improve runtime ergonomics and allocation behavior,
but it does not fix bad template architecture.
```

---

## 31. Case Study: Correspondence Rendering Platform

Scenario:

```text
A regulatory case-management platform generates notices, warning letters,
approval/rejection letters, reminders, and escalation correspondence.
```

Naive design:

```text
Controller/BPMN task loads CaseEntity.
Puts entity into FreeMarker model.
Uses DB template loader on every render.
Renders to StringWriter.
Converts to PDF.
Sends email.
Logs full model on failure.
```

Problems:

- hidden lazy loading,
- DB template lookup per render,
- no template version immutability,
- memory spike during batch,
- no separation render/PDF/send latency,
- audit not reproducible,
- security risk from entity exposure.

Better design:

```text
1. Workflow emits GenerateCorrespondence command.
2. Application service loads required data explicitly.
3. Presenter maps data to CorrespondenceViewModel.
4. Template selector chooses templateId + immutable version.
5. Template source already published/materialized locally.
6. FreeMarker renders HTML/text using cached parsed template.
7. Output streamed to document pipeline/storage.
8. Audit stores renderId, templateId, version, locale, data snapshot hash.
9. Metrics separate model preparation, render, PDF conversion, send/store.
```

Performance invariant:

```text
During FreeMarker rendering, there is no DB/network IO.
```

---

## 32. Checklist: FreeMarker Performance Review

Use this checklist in design/code review.

### Configuration

- [ ] `Configuration` is singleton/shared.
- [ ] Configuration is not modified after startup.
- [ ] Default encoding is explicit.
- [ ] Exception handler is production-safe.
- [ ] Output format/auto-escaping is configured deliberately.
- [ ] Localized lookup is enabled only if needed.

### Template loading/cache

- [ ] Template source is local/predictable in hot path.
- [ ] Template cache is enabled/effective.
- [ ] Warm-up exists for critical templates.
- [ ] Dynamic templates have versioning and invalidation strategy.
- [ ] No remote template fetch in request path.

### Data model

- [ ] Template receives view model, not entity graph.
- [ ] Getter methods are pure and cheap.
- [ ] No service/repository/security capability exposed.
- [ ] Model is immutable or per-render.
- [ ] Large collection rendering is bounded/paginated.

### Template design

- [ ] Loops are bounded.
- [ ] Macro usage is appropriate.
- [ ] No dynamic include without whitelist.
- [ ] No business computation in template.
- [ ] No exception-driven control flow.
- [ ] Formatting location is deliberate.

### Output

- [ ] StringWriter is only used for small/medium output.
- [ ] Large output streams to Writer.
- [ ] Writer is buffered.
- [ ] Output size is measured.
- [ ] Batch rendering has concurrency limit.

### Observability

- [ ] Model preparation, template get, render, downstream steps are timed separately.
- [ ] Template name/version/locale are in metrics.
- [ ] Failures are classified.
- [ ] Logs do not contain full sensitive model.
- [ ] JFR/JMH used for serious bottlenecks.

---

## 33. Key Takeaways

1. FreeMarker performance is mostly about architecture, not syntax tricks.
2. `Configuration` should be created once, fully configured, safely published, and treated as immutable.
3. Parsed templates should be cached; repeated parsing is a major avoidable cost.
4. Template loaders must not make hot-path rendering dependent on slow remote/DB calls.
5. Data model design is often the biggest performance lever.
6. Template rendering must not trigger hidden DB/network IO through getters or services.
7. `StringWriter` is convenient but dangerous for large/batch output.
8. Macro/component reuse is good, but excessive abstraction in massive loops can be costly.
9. Auto-escaping should not be disabled for performance without strong evidence.
10. Batch rendering needs bounded concurrency even with Java 21+ virtual threads.
11. Observability must separate model preparation, template lookup, rendering, and downstream output handling.
12. Production template platforms need performance budget, governance, preflight validation, and safe cache invalidation.

---

## 34. Practical Mental Model For Top 1% Engineers

A top-level engineer does not ask only:

```text
Can FreeMarker render this template?
```

They ask:

```text
Can this rendering pipeline remain deterministic, safe, fast, observable,
and reproducible under production load, version changes, tenant customization,
large output, failure, and future maintenance?
```

The final model:

```text
FreeMarker is not just a template syntax.
FreeMarker is a transformation runtime.

Performance engineering means controlling:
  input size,
  data access,
  template complexity,
  cache behavior,
  output strategy,
  concurrency,
  failure handling,
  and observability.
```

If those are controlled, FreeMarker can be extremely effective for HTML, email, legal correspondence, text generation, and enterprise document pre-rendering.

If those are uncontrolled, even a simple `${name}` template can become part of a slow, unsafe, non-deterministic system.

---

## 35. References

- Apache FreeMarker Manual — Template loading
- Apache FreeMarker Manual/API — TemplateCache
- Apache FreeMarker Manual — Multithreading
- Apache FreeMarker API — Configuration
- Apache FreeMarker Manual — Object wrappers
- Apache FreeMarker API — BeansWrapper
- Apache FreeMarker Manual — Auto-escaping and output formats
- Apache FreeMarker Manual — Shared variables
- Apache FreeMarker Manual — Expert built-ins
- OpenJDK / Oracle Java documentation for Java 8–25 runtime considerations
- JMH project documentation for Java microbenchmark methodology
- Java Flight Recorder documentation for profiling and production diagnostics

---

## Status

```text
Part 10 selesai.
Seri belum selesai.
Berikutnya: Part 11 — FreeMarker in Spring Boot and Jakarta Applications.
```
