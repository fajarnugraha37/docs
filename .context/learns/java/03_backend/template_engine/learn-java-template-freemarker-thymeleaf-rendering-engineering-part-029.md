# learn-java-template-freemarker-thymeleaf-rendering-engineering-part-029

# Part 29 — Template Engine Internals and Extensibility

> Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`  
> Bagian: 29 dari 35  
> Topik: Template engine internals, parser/evaluator/cache mental model, FreeMarker extension points, Thymeleaf dialects/processors/expression objects, dan risiko membangun domain-specific template extension.  
> Target Java: Java 8 sampai Java 25  
> Fokus engine: Apache FreeMarker 2.3.x dan Thymeleaf 3.1.x

---

## 0. Tujuan Bagian Ini

Sampai Part 28, kita sudah membahas template engine dari sudut pandang penggunaan, security, testing, governance, email/document generation, migration, dan integration pattern. Part 29 naik satu lapis lebih dalam: **bagaimana template engine bekerja secara internal dan bagaimana kita memperluasnya tanpa merusak safety, maintainability, dan performance**.

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Memahami pipeline internal template engine dari template source sampai output final.
2. Melihat FreeMarker dan Thymeleaf sebagai kombinasi parser, resolver, evaluator, cache, output writer, dan extension system.
3. Mendesain extension yang punya boundary jelas.
4. Membuat FreeMarker custom directive, method, wrapper, loader, dan shared extension dengan mental model production.
5. Membuat Thymeleaf dialect, processor, dan expression object secara aman.
6. Menentukan kapan extension diperlukan dan kapan sebaiknya cukup memakai helper Java biasa.
7. Mencegah template engine berubah menjadi scripting platform liar.
8. Memahami konsekuensi maintenance saat membuat DSL template sendiri.

Bagian ini penting untuk level top engineer karena banyak bug template production tidak muncul dari syntax template biasa, tetapi dari **custom extension yang terlalu kuat, terlalu leaky, tidak terdokumentasi, tidak dites, dan tidak punya security model**.

---

## 1. Mental Model Internal Template Engine

Secara konseptual, template engine adalah mesin transformasi:

```text
Template Source + Template Configuration + Data Model + Render Context
        |
        v
Parsing / Loading / Resolving / Evaluating / Escaping / Writing
        |
        v
Output Artifact
```

Tetapi secara internal, pipeline-nya lebih detail:

```text
1. Template identity
   - name/path/id/version

2. Template lookup
   - resolver/loader mencari source template

3. Template source read
   - bytes/string dibaca dari classpath, filesystem, database, remote store, etc.

4. Character decoding
   - bytes -> characters dengan encoding tertentu

5. Lexing/parsing
   - source template dipecah menjadi token dan struktur internal

6. Internal representation
   - AST, parse tree, DOM-like tree, event model, atau compiled representation

7. Cache decision
   - hasil parse disimpan atau tidak

8. Render context creation
   - variables, locale, timezone, message resolver, security context, output mode

9. Expression evaluation
   - variable access, property access, method/function/directive call

10. Structural processing
    - conditionals, loops, includes, fragments, macros, processors

11. Escaping/output format
    - HTML, XML, TEXT, JS, CSS, RAW, custom format

12. Writer output
    - StringWriter, response writer, buffered writer, file writer, stream bridge

13. Error handling and diagnostics
    - parse error, missing value, forbidden access, output exception
```

Top engineer tidak hanya menghafal API. Ia bertanya:

- Di titik mana template source dipercaya?
- Di titik mana data model dipercaya?
- Di titik mana expression dapat mengakses Java object?
- Di titik mana output harus di-escape?
- Di titik mana cache dapat stale?
- Di titik mana extension dapat melakukan I/O?
- Di titik mana exception harus diklasifikasi?
- Di titik mana observability harus ditempel?

---

## 2. Tiga Lapisan Template Engine

Secara praktis, FreeMarker dan Thymeleaf dapat dipahami sebagai tiga lapisan.

```text
+---------------------------------------------------------+
| Authoring Layer                                          |
| - syntax template                                        |
| - macro/fragment                                         |
| - expression                                             |
| - directive/attribute                                    |
+---------------------------------------------------------+
| Runtime Engine Layer                                     |
| - loader/resolver                                        |
| - parser                                                 |
| - evaluator                                              |
| - cache                                                  |
| - escaping                                               |
| - writer                                                 |
+---------------------------------------------------------+
| Host Application Layer                                   |
| - Java model                                             |
| - service boundary                                       |
| - security policy                                        |
| - i18n/timezone                                          |
| - audit/metrics                                          |
| - template registry/versioning                           |
+---------------------------------------------------------+
```

Extension biasanya masuk di perbatasan runtime engine dan host application:

- FreeMarker custom directive memperbolehkan template memanggil logic Java tertentu.
- FreeMarker object wrapper menentukan bagaimana Java object terlihat dari FTL.
- Thymeleaf dialect menambah attribute/tag/expression behavior baru.
- Thymeleaf expression object memberi function-like helper di template.
- Custom loader/resolver menghubungkan template engine dengan classpath, filesystem, database, tenant repository, atau storage eksternal.

Karena extension berada di boundary, extension harus dirancang seperti API publik kecil, bukan sekadar utility class.

---

## 3. Parser dan Internal Representation: Yang Perlu Dipahami Tanpa Menjadi Compiler Engineer

Kita tidak perlu mengimplementasikan compiler untuk memakai FreeMarker/Thymeleaf. Tetapi kita perlu memahami mental model parser agar tidak membuat keputusan buruk.

Template source biasanya berisi campuran:

1. Literal text.
2. Expression.
3. Directive/attribute instruction.
4. Include/import/fragment reference.
5. Macro/function definition.
6. Comment.
7. Escaping/output mode marker.

Contoh FreeMarker:

```ftl
<h1>${title}</h1>
<#if user??>
  Hello ${user.displayName}
</#if>
```

Secara internal, engine perlu membedakan:

```text
Literal("<h1>")
Interpolation(Expression("title"))
Literal("</h1>")
If(Expression("user??"), body=[...])
```

Contoh Thymeleaf:

```html
<h1 th:text="${title}">Static title</h1>
<div th:if="${user != null}">Hello</div>
```

Thymeleaf bekerja lebih DOM/markup-oriented. Ia membaca markup, memahami elemen dan attribute, lalu processor pada attribute tertentu mengubah node/attribute/output.

Konsekuensi penting:

- FreeMarker cocok untuk banyak output teks karena FTL mengontrol text stream.
- Thymeleaf sangat kuat untuk HTML/XML karena processor bekerja pada struktur markup.
- FreeMarker macro/directive terasa seperti bahasa template.
- Thymeleaf fragment/attribute terasa seperti transformasi markup.
- Extension FreeMarker biasanya terlihat sebagai function/directive.
- Extension Thymeleaf biasanya terlihat sebagai dialect attribute/tag/expression object.

---

## 4. AST, DOM, Event Model, dan Kenapa Ini Penting

Kita bisa memakai istilah sederhana:

| Model | Gagasan | Cocok untuk |
|---|---|---|
| Text stream template | Template sebagai urutan literal + directive + expression | Email, text, config, source code, HTML sederhana |
| AST/template tree | Template diparse menjadi node instruksi | Macro, loops, includes, conditionals |
| DOM/markup tree | Template dipahami sebagai struktur elemen/attribute | HTML/XML SSR |
| Event/processor model | Engine memproses event/node dengan processor chain | Dialect/attribute extensibility |

FreeMarker lebih dekat ke text stream + parsed instruction tree. Thymeleaf lebih dekat ke markup parser + processor model.

Implikasinya:

1. **FreeMarker custom directive** cocok saat kita ingin mengontrol nested content, transformasi text, atau reusable rendering primitive.
2. **Thymeleaf custom processor** cocok saat kita ingin menambahkan semantic attribute/tag di HTML.
3. **Thymeleaf expression object** cocok untuk helper yang mengembalikan value, bukan mengubah struktur markup langsung.
4. **FreeMarker object wrapper** adalah extension yang sangat powerful tetapi berbahaya karena mengubah seluruh cara Java object diekspos.
5. **Custom loader/resolver** memengaruhi availability, stale cache, tenant isolation, dan security.

---

## 5. Resolver Chain dan Template Lookup

Sebelum engine bisa parse template, engine harus tahu template mana yang dimaksud.

```text
render("email/case-approved", version=3, locale=id_ID, tenant=cea)
        |
        v
Template lookup policy
        |
        +-- tenant-specific override?
        +-- locale-specific variant?
        +-- published effective version?
        +-- classpath fallback?
        +-- default template?
        v
Resolved template source
```

Pada FreeMarker, abstraction utama untuk source adalah `TemplateLoader`. Dokumentasi FreeMarker menjelaskan bahwa template loader memuat raw textual data berdasarkan abstract template path seperti `index.ftl` atau `products/catalog.ftl`; implementasinya bisa membaca dari file, database, string map, dan sumber lain.

Pada Thymeleaf, abstraction utamanya adalah template resolver. Resolver menentukan bagaimana template name diterjemahkan menjadi resource yang dapat diproses, termasuk mode, cacheability, prefix/suffix, dan resolution policy.

### 5.1 Chain yang Biasa Dibutuhkan di Enterprise

```text
1. Tenant published template store
2. Tenant locale fallback
3. Global published template store
4. Application classpath fallback
5. Emergency built-in fallback
```

Contoh lookup:

```text
notice/suspension
tenant = agency-a
locale = id-ID
version policy = active at eventTime

Try:
1. db:/agency-a/id-ID/notice/suspension@activeAt(eventTime)
2. db:/agency-a/en/notice/suspension@activeAt(eventTime)
3. db:/global/id-ID/notice/suspension@activeAt(eventTime)
4. classpath:/templates/notice/suspension.ftlh
```

### 5.2 Invariant Resolver

Resolver harus memiliki invariant:

1. Template identity harus canonical.
2. Path traversal tidak boleh mungkin.
3. Tenant tidak boleh membaca template tenant lain.
4. Draft template tidak boleh dipakai production kecuali explicit preview mode.
5. Published version harus immutable.
6. Lookup harus observable.
7. Cache key harus memasukkan dimension penting: name, version, locale, tenant, mode.

Kesalahan umum:

```text
Cache key = templateName only
```

Padahal template output tergantung:

```text
templateName + tenant + locale + version + outputMode + engine + resolver profile
```

---

## 6. Expression Evaluation: Titik Paling Sensitif

Expression evaluation adalah proses mengubah expression template menjadi value.

Contoh:

```ftl
${case.officer.displayName}
```

atau:

```html
<span th:text="${case.officer.displayName}"></span>
```

Engine perlu menjawab:

1. Apa itu `case`?
2. Apakah field/property `officer` boleh dibaca?
3. Apakah `displayName` property atau method?
4. Bagaimana jika null/missing?
5. Apakah value harus di-convert ke string?
6. Apakah hasil perlu escaping?

Expression evaluator adalah tempat banyak risiko terjadi:

- accidental method exposure
- lazy loading trigger
- null explosion
- sensitive field leak
- reflection overhead
- expression injection
- unpredictable helper call
- inconsistent formatting

### 6.1 Design Rule

Template expression harus melihat **presentation model**, bukan domain model.

Buruk:

```html
<span th:text="${case.assignedOfficer.department.organization.parent.name}"></span>
```

Lebih baik:

```html
<span th:text="${vm.assignedOfficerDepartmentName}"></span>
```

Buruk:

```ftl
${invoice.calculateOutstandingAmount()}
```

Lebih baik:

```ftl
${invoice.outstandingAmountDisplay}
```

Kenapa?

Karena expression evaluator seharusnya melakukan presentation binding, bukan business computation.

---

## 7. Cache Strategy Internal

Template engine biasanya punya cache untuk hasil parsing.

```text
Template source string
      |
      v
Parsed template representation
      |
      v
Cache
      |
      v
Reuse during render
```

FreeMarker `Configuration` adalah central settings object dan juga menangani pembuatan serta caching pre-parsed template objects. Thymeleaf `TemplateEngine` dapat dikonfigurasi dengan cache manager; cache manager menyediakan cache setidaknya untuk parsed templates dan parsed expressions.

### 7.1 Cache yang Perlu Dipikirkan

| Cache | Isi | Risiko |
|---|---|---|
| Template source cache | raw template content | stale draft/published state |
| Parsed template cache | parsed representation | memory growth, invalidation |
| Expression cache | parsed expression | stale expression policy |
| Fragment/macro cache | reusable parsed section | dependency invalidation |
| Model/preview sample cache | sample data | PII leak |
| Render output cache | final output | personalization leak |

### 7.2 Cache Key yang Salah

```java
String key = templateName;
```

Ini biasanya terlalu lemah.

Cache key yang lebih benar:

```java
record TemplateCacheKey(
    String engine,
    String templateName,
    String templateVersion,
    String tenantId,
    Locale locale,
    String outputMode,
    String resolverProfile
) {}
```

### 7.3 Invalidation

Dalam platform template dinamis:

```text
Draft updated       -> invalidate preview cache only
Published new v4    -> production lookup points to v4 for new events
Old v3 output       -> must remain reproducible
Retired template    -> not used for new events, but old render records remain valid
```

Jangan menghapus template versi lama jika ada kebutuhan audit/re-render.

---

## 8. FreeMarker Extension Model

FreeMarker dapat diperluas melalui beberapa extension point utama:

1. `TemplateLoader`
2. `ObjectWrapper`
3. `TemplateModel` implementation
4. `TemplateDirectiveModel`
5. `TemplateMethodModelEx`
6. shared variables
7. custom output format
8. custom exception handler
9. custom template configuration factory
10. custom number/date formatting policy melalui settings/wrapper/context

Secara mental:

```text
FreeMarker extension = memberi FTL vocabulary baru atau exposure policy baru
```

Karena itu, setiap extension harus didesain sebagai public API.

---

## 9. FreeMarker Custom Method

Custom method cocok untuk helper kecil yang menerima argument dan mengembalikan value.

Contoh use case:

- format tracking number
- mask identifier
- normalize display label
- generate deterministic URL path
- convert code to label

Contoh sederhana:

```java
import freemarker.template.TemplateMethodModelEx;
import freemarker.template.TemplateModelException;
import freemarker.template.TemplateScalarModel;

import java.util.List;

public final class MaskIdentifierMethod implements TemplateMethodModelEx {
    @Override
    public Object exec(List arguments) throws TemplateModelException {
        if (arguments.size() != 1) {
            throw new TemplateModelException("maskIdentifier expects exactly 1 argument");
        }

        Object arg = arguments.get(0);
        if (!(arg instanceof TemplateScalarModel scalar)) {
            throw new TemplateModelException("maskIdentifier argument must be string");
        }

        String value = scalar.getAsString();
        if (value == null || value.length() <= 4) {
            return "****";
        }
        return "****" + value.substring(value.length() - 4);
    }
}
```

Registration:

```java
Configuration cfg = new Configuration(Configuration.VERSION_2_3_34);
cfg.setSharedVariable("maskIdentifier", new MaskIdentifierMethod());
```

Template:

```ftl
Applicant ID: ${maskIdentifier(applicant.identifier)}
```

### 9.1 Custom Method Design Rules

Custom method harus:

1. Pure atau hampir pure.
2. Tidak melakukan DB call.
3. Tidak melakukan network call.
4. Tidak membaca file sistem.
5. Tidak mengambil current user dari thread-local secara diam-diam.
6. Memiliki argument validation ketat.
7. Mengembalikan value sederhana.
8. Tidak mengembalikan domain object besar.
9. Dites sebagai Java unit test dan template integration test.
10. Punya nama yang domain-safe.

Buruk:

```ftl
${caseService.findCase(caseId).owner.department.director.email}
```

Baik:

```ftl
${case.ownerDepartmentDirectorEmailDisplay}
```

Atau jika helper memang perlu:

```ftl
${maskEmail(case.ownerEmail)}
```

---

## 10. FreeMarker Custom Directive

Custom directive cocok saat helper perlu:

1. Menulis output langsung.
2. Menerima nested content.
3. Mengontrol body rendering.
4. Mengulang body dengan loop variable.
5. Membungkus output dengan policy tertentu.
6. Menerapkan guard/authorization/presentation rule.

FreeMarker dokumentasi menyebut Java programmer dapat mengimplementasikan user-defined directive dengan `TemplateDirectiveModel`.

Contoh directive sederhana untuk conditional permission rendering:

```java
import freemarker.core.Environment;
import freemarker.template.TemplateDirectiveBody;
import freemarker.template.TemplateDirectiveModel;
import freemarker.template.TemplateException;
import freemarker.template.TemplateModel;
import freemarker.template.TemplateModelException;
import freemarker.template.TemplateScalarModel;

import java.io.IOException;
import java.util.Map;
import java.util.Set;

public final class HasPermissionDirective implements TemplateDirectiveModel {
    private final Set<String> grantedPermissions;

    public HasPermissionDirective(Set<String> grantedPermissions) {
        this.grantedPermissions = Set.copyOf(grantedPermissions);
    }

    @Override
    public void execute(
            Environment env,
            Map params,
            TemplateModel[] loopVars,
            TemplateDirectiveBody body
    ) throws TemplateException, IOException {

        Object permissionParam = params.get("permission");
        if (!(permissionParam instanceof TemplateScalarModel scalar)) {
            throw new TemplateModelException("permission parameter is required and must be string");
        }

        String permission = scalar.getAsString();
        if (permission == null || permission.isBlank()) {
            throw new TemplateModelException("permission must not be blank");
        }

        if (grantedPermissions.contains(permission) && body != null) {
            body.render(env.getOut());
        }
    }
}
```

Template:

```ftl
<@hasPermission permission="CASE_APPROVE">
  <button>Approve</button>
</@hasPermission>
```

### 10.1 Apa yang Berbahaya dari Directive?

Directive bisa:

- menulis output langsung
- memanggil nested body berulang kali
- melakukan I/O
- menyembunyikan control flow
- mengubah output context
- menyamarkan authorization logic sebagai UI logic

Karena itu, directive harus punya scope jelas.

### 10.2 Kapan Directive Tidak Perlu

Jangan membuat directive jika cukup dengan ViewModel.

Berlebihan:

```ftl
<@caseStatusBadge case=case />
```

Padahal cukup:

```ftl
<span class="badge ${case.statusCssClass}">${case.statusLabel}</span>
```

Directive masuk akal jika ada pattern yang banyak, kompleks, dan perlu governance.

---

## 11. FreeMarker ObjectWrapper Internals

`ObjectWrapper` adalah salah satu extension paling penting dan paling berisiko. Tugasnya memetakan Java object ke type system FreeMarker.

Contoh:

```java
record ApplicantView(String name, String email) {}
```

Template:

```ftl
${applicant.name}
${applicant.email}
```

Agar ini bisa terjadi, wrapper harus menentukan:

- apakah record property terbaca
- apakah getter method exposed
- bagaimana `List` terlihat
- bagaimana `Map` terlihat
- bagaimana `Optional` terlihat
- bagaimana date/time terlihat
- apakah method invocation boleh
- apakah `?api` boleh

### 11.1 ObjectWrapper sebagai Security Policy

Object wrapper bukan hanya mapping teknis. Ia adalah **security boundary**.

Pertanyaan desain:

1. Apakah template boleh memanggil method public?
2. Apakah template boleh melihat semua getter?
3. Apakah template boleh memakai Java API langsung?
4. Apakah template boleh mengakses class/static method?
5. Apakah entity/domain object boleh diekspos?
6. Apakah lazy collection boleh dibaca?
7. Apakah method yang mahal boleh dipanggil dari template?

### 11.2 Safe Wrapper Strategy

Pola aman:

```text
Domain Entity -> Presenter/Mapper -> Immutable ViewModel -> FreeMarker data model
```

Lalu konfigurasi wrapper dibuat konservatif.

Contoh prinsip:

- disable `?api` kecuali sangat terkontrol
- jangan expose service object
- jangan expose repository object
- jangan expose servlet request/session langsung
- jangan expose Spring application context
- jangan expose arbitrary map dari user input sebagai root tanpa sanitasi
- gunakan DTO immutable
- gunakan string/number/boolean/date/list/map sederhana

---

## 12. FreeMarker TemplateModel: Membuat Model Khusus

Kadang kita perlu representasi khusus yang bukan Java object biasa.

FreeMarker memiliki keluarga interface `TemplateModel`, misalnya secara konseptual:

- scalar model
- number model
- boolean model
- date model
- sequence model
- hash model
- method model
- directive model

Kapan membuat `TemplateModel` custom?

1. Kita ingin lazy-but-controlled access.
2. Kita ingin expose hanya subset field.
3. Kita ingin wrapping domain object dengan allowlist.
4. Kita ingin mengontrol null/missing behavior.
5. Kita ingin object tampak seperti hash/sequence khusus.

Contoh ide:

```java
public final class SafeCaseTemplateModel implements TemplateHashModel {
    private final CaseSnapshot snapshot;

    public TemplateModel get(String key) throws TemplateModelException {
        return switch (key) {
            case "referenceNo" -> new SimpleScalar(snapshot.referenceNo());
            case "statusLabel" -> new SimpleScalar(snapshot.statusLabel());
            case "createdDate" -> new SimpleDate(snapshot.createdDate(), TemplateDateModel.DATETIME);
            default -> null;
        };
    }

    public boolean isEmpty() {
        return false;
    }
}
```

Keuntungan:

- field exposure eksplisit
- domain internals tidak bocor
- template contract bisa dikontrol

Kerugian:

- lebih banyak kode
- perlu test ketat
- bisa menjadi mini binding framework sendiri jika over-engineered

---

## 13. FreeMarker Custom TemplateLoader

Custom loader dibutuhkan jika template tidak berada di classpath/filesystem sederhana.

Use case:

1. Template disimpan di database.
2. Template disimpan di object storage.
3. Template ditentukan per tenant.
4. Template punya version/effective date.
5. Template direplikasi dari CMS internal.
6. Template perlu fallback chain.

Pseudo-design:

```java
public final class VersionedDatabaseTemplateLoader implements TemplateLoader {
    private final TemplateRepository repository;
    private final TemplateLookupContextProvider contextProvider;

    @Override
    public Object findTemplateSource(String name) throws IOException {
        TemplateLookupContext ctx = contextProvider.current();
        return repository.findPublished(
            ctx.tenantId(),
            ctx.locale(),
            name,
            ctx.effectiveAt()
        ).orElse(null);
    }

    @Override
    public long getLastModified(Object templateSource) {
        return ((TemplateRecord) templateSource).lastModifiedEpochMillis();
    }

    @Override
    public Reader getReader(Object templateSource, String encoding) {
        return new StringReader(((TemplateRecord) templateSource).content());
    }

    @Override
    public void closeTemplateSource(Object templateSource) {
        // no-op if no resource to close
    }
}
```

### 13.1 Loader Pitfalls

1. DB call setiap render karena cache salah konfigurasi.
2. Cache stale karena `lastModified` salah.
3. Template name berisi path traversal.
4. Tenant isolation bocor.
5. Draft template terbaca production.
6. Loader melakukan heavy network call tanpa timeout.
7. Loader tidak punya metric.
8. Loader tidak membedakan preview dan production.
9. Loader tidak memasukkan version ke lookup.
10. Loader mengubah content untuk template name yang sama sehingga reproducibility rusak.

### 13.2 Recommended Production Pattern

```text
Template publishing pipeline:
Draft -> validate -> approve -> publish immutable version

Runtime rendering:
resolve immutable version -> cache parsed version -> render
```

Jangan membuat runtime loader membaca draft mutable untuk production output.

---

## 14. FreeMarker Custom Output Format

FreeMarker mendukung output format seperti HTML/XML/plain text dan markup output values. Custom output format jarang diperlukan, tetapi bisa berguna untuk domain output khusus.

Use case potensial:

- custom XML-like regulatory markup
- safe markdown subset
- proprietary document markup
- HTML email with constrained safe output type

Namun custom output format sangat berisiko jika tujuannya “membuat escaping sendiri”. Untuk XSS/security, gunakan format yang sudah jelas dan testing ketat.

Design checklist:

1. Apa escaping semantics-nya?
2. Apakah context-sensitive atau single escaping?
3. Bagaimana markup output value diperlakukan?
4. Bagaimana interop dengan string biasa?
5. Bagaimana test malicious input?
6. Bagaimana dokumentasi untuk template author?
7. Apakah output format ini benar-benar perlu?

---

## 15. Thymeleaf Extension Model

Thymeleaf extension model berpusat pada **dialect**.

Dialect adalah paket fitur yang bisa menambah:

1. Processor attribute.
2. Processor element/tag.
3. Expression object.
4. Execution attribute.
5. Pre/post processor.
6. Template mode specific behavior.

Dokumentasi Thymeleaf menyebut dialect sebagai kumpulan fitur yang dapat dipakai di template, termasuk processing logic melalui processor yang diterapkan pada attribute atau tag.

Secara mental:

```text
Thymeleaf extension = menambah vocabulary HTML/XML/text processing
```

Contoh:

```html
<button app:ifPermission="CASE_APPROVE">Approve</button>
```

Di sini `app:*` adalah namespace dialect custom.

---

## 16. Thymeleaf Dialect: Kapan Perlu?

Custom dialect perlu jika:

1. Ada semantic UI pattern yang sangat sering.
2. Kita ingin attribute/tag custom yang readable oleh template author.
3. Kita perlu behavior yang tidak bisa dicapai dengan fragment biasa.
4. Kita ingin enforce policy lintas template.
5. Kita membangun design system server-side.
6. Kita ingin integrasi domain-specific tetapi tetap aman.

Tidak perlu custom dialect jika:

1. Cukup dengan fragment.
2. Cukup dengan expression object/helper.
3. Cukup dengan ViewModel property.
4. Hanya dipakai 1–2 kali.
5. Logic-nya business-heavy.
6. Membutuhkan DB/network call.

Decision:

```text
Need reusable HTML shape?        -> fragment/layout
Need small value helper?         -> expression object
Need custom attribute behavior?  -> processor/dialect
Need full domain workflow?       -> Java service before rendering
```

---

## 17. Thymeleaf Custom Dialect Skeleton

Contoh konseptual dialect:

```java
import org.thymeleaf.dialect.AbstractProcessorDialect;
import org.thymeleaf.processor.IProcessor;
import org.thymeleaf.templatemode.TemplateMode;

import java.util.Set;

public final class ApplicationDialect extends AbstractProcessorDialect {
    private static final String NAME = "Application Dialect";
    private static final String PREFIX = "app";
    private static final int PRECEDENCE = 1000;

    private final PermissionEvaluator permissionEvaluator;

    public ApplicationDialect(PermissionEvaluator permissionEvaluator) {
        super(NAME, PREFIX, PRECEDENCE);
        this.permissionEvaluator = permissionEvaluator;
    }

    @Override
    public Set<IProcessor> getProcessors(String dialectPrefix) {
        return Set.of(
            new IfPermissionAttributeProcessor(
                TemplateMode.HTML,
                dialectPrefix,
                permissionEvaluator
            )
        );
    }
}
```

Template usage:

```html
<button app:ifPermission="CASE_APPROVE">Approve</button>
```

Registering in Spring:

```java
@Bean
public ApplicationDialect applicationDialect(PermissionEvaluator permissionEvaluator) {
    return new ApplicationDialect(permissionEvaluator);
}
```

Dengan Spring Boot + Thymeleaf, dialect bean biasanya dapat ditemukan dan dipakai oleh template engine, tergantung konfigurasi aplikasi.

---

## 18. Thymeleaf Attribute Processor

Attribute processor membaca attribute custom dan memodifikasi node.

Pseudo-code:

```java
import org.thymeleaf.context.ITemplateContext;
import org.thymeleaf.model.IProcessableElementTag;
import org.thymeleaf.processor.element.AbstractAttributeTagProcessor;
import org.thymeleaf.processor.element.IElementTagStructureHandler;
import org.thymeleaf.templatemode.TemplateMode;

public final class IfPermissionAttributeProcessor extends AbstractAttributeTagProcessor {
    private static final String ATTR_NAME = "ifPermission";
    private static final int PRECEDENCE = 1000;
    private final PermissionEvaluator permissionEvaluator;

    public IfPermissionAttributeProcessor(
            TemplateMode templateMode,
            String dialectPrefix,
            PermissionEvaluator permissionEvaluator
    ) {
        super(templateMode, dialectPrefix, null, false, ATTR_NAME, true, PRECEDENCE, true);
        this.permissionEvaluator = permissionEvaluator;
    }

    @Override
    protected void doProcess(
            ITemplateContext context,
            IProcessableElementTag tag,
            org.thymeleaf.engine.AttributeName attributeName,
            String attributeValue,
            IElementTagStructureHandler structureHandler
    ) {
        String permission = attributeValue == null ? "" : attributeValue.trim();
        boolean allowed = permissionEvaluator.hasPermission(permission);

        if (!allowed) {
            structureHandler.removeElement();
        }
    }
}
```

Template:

```html
<button app:ifPermission="CASE_APPROVE">Approve</button>
```

Rendered if allowed:

```html
<button>Approve</button>
```

Removed if not allowed.

### 18.1 Warning

UI authorization is not backend authorization. Processor ini hanya presentation rule. Endpoint tetap harus melakukan authorization server-side.

---

## 19. Thymeleaf Expression Object

Expression object cocok untuk helper value-level.

Template:

```html
<span th:text="${#caseLabels.status(case.status)}"></span>
```

Expression object factory menyediakan object bernama `caseLabels`.

Pseudo-code:

```java
public final class CaseLabels {
    public String status(String statusCode) {
        return switch (statusCode) {
            case "PENDING" -> "Pending Review";
            case "APPROVED" -> "Approved";
            case "REJECTED" -> "Rejected";
            default -> "Unknown";
        };
    }
}
```

Kapan cocok:

- label formatting
- safe masking
- simple display conversion
- reusable pure helper

Kapan tidak cocok:

- lookup database
- calling remote service
- loading user permissions repeatedly
- accessing transaction/session
- doing workflow decision

---

## 20. Processor Precedence

Thymeleaf attribute order di HTML tidak menentukan urutan processing. Thymeleaf memiliki precedence sendiri agar processor tertentu berjalan sebelum yang lain.

Ini penting saat membuat custom processor. Misalnya:

```html
<tr app:ifPermission="CASE_VIEW" th:each="case : ${cases}">
```

Pertanyaan:

- Apakah permission dievaluasi sebelum loop?
- Apakah processor berjalan per row atau sebelum row digandakan?
- Apakah attribute custom harus melihat variable loop?

Jika `app:ifPermission` butuh variable `case`, ia harus berjalan setelah `th:each` menyediakan local variable. Jika ia hanya butuh global permission, ia bisa berjalan sebelum.

Top engineer selalu mendesain processor dengan pertanyaan:

```text
Processor ini butuh context variable apa?
Variable itu tersedia pada fase processing mana?
Apa efeknya jika processor berjalan sebelum/after th:each/th:if/th:replace?
```

---

## 21. Thymeleaf Structural Handler: Operasi yang Bisa Dilakukan Processor

Processor dapat mengubah struktur template, misalnya secara konseptual:

1. Remove element.
2. Remove body.
3. Set body.
4. Replace element.
5. Set attribute.
6. Remove attribute.
7. Insert before/after.
8. Change local variables.

Karena processor bisa mengubah DOM output, ia powerful.

Contoh use case:

```html
<div app:alert="warning">...</div>
```

Processor dapat menambahkan class, role, aria attribute, icon, atau wrapper.

Tapi hati-hati: semakin banyak processor mengubah struktur, semakin sulit template diprediksi.

---

## 22. Custom Dialect vs Fragment Library

Seringkali engineer terlalu cepat membuat custom dialect. Banyak kebutuhan cukup dengan fragment library.

### 22.1 Fragment Lebih Cocok Jika

```html
<th:block th:replace="~{fragments/components :: statusBadge(${case.statusLabel}, ${case.statusClass})}"></th:block>
```

Cocok untuk:

- UI component reusable
- markup eksplisit
- tidak perlu mengubah semantics engine
- mudah dipahami designer
- mudah diuji sebagai rendered HTML

### 22.2 Dialect Lebih Cocok Jika

```html
<span app:statusBadge="${case.status}"></span>
```

Cocok untuk:

- attribute semantic sangat sering
- markup detail ingin disembunyikan
- ada policy cross-cutting
- perlu enforce attribute contract
- extension akan dipakai puluhan/ratusan template

### 22.3 Trade-Off

| Aspek | Fragment | Custom Dialect |
|---|---|---|
| Complexity | rendah | tinggi |
| Discoverability | tinggi di template | perlu dokumentasi |
| Testability | mudah via render | perlu unit + integration |
| Power | sedang | tinggi |
| Risk | rendah-sedang | tinggi |
| Maintenance | relatif mudah | harus dijaga sebagai API |

---

## 23. Building Domain-Specific Template DSL

Template DSL adalah vocabulary khusus domain yang bisa dipakai template author.

Contoh correspondence platform:

```ftl
<@field label="Applicant Name" value=applicant.name />
<@caseStatus status=case.status />
<@signature officer=signatory />
```

Contoh Thymeleaf:

```html
<div app:field="applicant.name" app:label="Applicant Name"></div>
<span app:caseStatus="${case.status}"></span>
<div app:signature="${signatory}"></div>
```

DSL berguna jika:

1. Banyak template business-owned.
2. Kita ingin template author memakai vocabulary domain, bukan HTML mentah.
3. Ada design system dan legal formatting ketat.
4. Ada governance output.
5. Ada audit/reproducibility requirement.

DSL berbahaya jika:

1. Tidak punya versi.
2. Tidak punya dokumentasi.
3. Tidak punya compatibility tests.
4. Terlalu expressive sampai menjadi programming language.
5. Menyembunyikan business decision di template.
6. Bisa mengakses service/repository.

### 23.1 DSL Versioning

```text
app-dialect-v1:
  app:statusBadge
  app:field
  app:signature

app-dialect-v2:
  app:statusBadge adds tone mapping
  app:field supports required marker
  app:signature supports roleLabel
```

Template harus menyatakan DSL version atau resolver harus tahu compatibility.

---

## 24. Extension API Design Principles

Extension adalah API. Desainnya harus mengikuti prinsip API.

### 24.1 Small Surface Area

Buruk:

```ftl
${caseUtils.doAnything(case, user, tenant, request, mode)}
```

Baik:

```ftl
${mask(case.ownerEmail)}
${label.caseStatus(case.status)}
<@signatureBlock signatory=letter.signatory />
```

### 24.2 Explicit Input

Buruk:

```java
String currentTenant = TenantContext.get();
```

Baik:

```java
renderContext.tenantId()
```

Tetapi untuk template extension, sering lebih baik input sudah dimasukkan dalam ViewModel daripada extension membaca context tersembunyi.

### 24.3 No Hidden I/O

Extension seharusnya tidak:

- query database
- call HTTP service
- publish message
- mutate state
- write audit event langsung
- read filesystem dynamic data

Rendering sebaiknya pure transformation.

### 24.4 Deterministic

Buruk:

```ftl
Generated at ${now()}
```

Lebih baik:

```ftl
Generated at ${render.generatedAtDisplay}
```

`generatedAt` berasal dari render context yang deterministic/testable.

### 24.5 Fail Predictably

Extension harus membedakan:

- invalid argument
- missing required parameter
- forbidden access
- unsupported template mode
- internal bug

Jangan swallow error dan menghasilkan output setengah benar untuk dokumen legal/regulatory.

---

## 25. Extension Security Model

Security extension model harus menjawab empat pertanyaan:

```text
Who writes the template?
Who controls the data?
What Java capabilities are exposed?
What output context is generated?
```

### 25.1 Template Author Trust Level

| Trust Level | Contoh | Extension Policy |
|---|---|---|
| Fully trusted developer | source-controlled app template | macro/helper boleh lebih luas tapi tetap governable |
| Internal admin semi-trusted | template editor business user | sandbox ketat, no Java method exposure |
| Tenant admin | multi-tenant template customization | strict allowlist, preview-only validation, no dynamic eval |
| External user | user-submitted template | sebaiknya hindari general-purpose template engine |

### 25.2 Data Trust Level

| Data | Contoh | Treatment |
|---|---|---|
| System trusted | enum status internal | safe but still escaped |
| User input | name, comment, description | escaped/sanitized |
| Rich text user input | HTML description | sanitize before mark-safe |
| Secret/sensitive | token, password, ID number | never expose unless explicit redacted field |
| Cross-tenant data | other tenant info | must never be in model |

### 25.3 Java Capability Exposure

Dangerous capabilities:

- reflection
- class loading
- runtime/process execution
- file/network I/O
- environment variables
- system properties
- Spring context access
- servlet request/session broad access
- repository/service beans
- arbitrary method invocation

Extension should expose narrow capabilities only.

---

## 26. Maintenance Risk of Extension

Custom extension is not free.

It creates:

1. API compatibility burden.
2. Documentation burden.
3. Test burden.
4. Security review burden.
5. Upgrade burden when FreeMarker/Thymeleaf changes.
6. Onboarding burden for new engineers/template authors.
7. Debugging burden because behavior is no longer standard engine behavior.

### 26.1 Extension Complexity Budget

Before adding extension, answer:

```text
Can this be a ViewModel field?
Can this be a fragment/macro?
Can this be a Java mapper before render?
Will this be used in at least 5-10 templates?
Is the behavior stable enough to become API?
Can we test it independently?
Can we document it in one page?
Can we prevent abuse?
```

If mostly “no”, don't create extension.

---

## 27. Observability for Extensions

Template engine observability is not enough if extension does hidden work.

Metrics to consider:

```text
render.extension.invocations{engine="thymeleaf", extension="app:ifPermission"}
render.extension.failures{extension="maskIdentifier", reason="invalid_argument"}
render.extension.latency{extension="statusBadge"}
render.template.cache.hit{engine="freemarker"}
render.template.cache.miss{engine="thymeleaf"}
render.template.resolution.latency{resolver="database"}
```

But do not over-instrument per variable access unless debugging a severe issue.

For production, useful logs:

```text
renderId
correlationId
templateId
templateVersion
engine
locale
tenant
extensionName
errorCategory
line/column if available
```

Never log full data model in production.

---

## 28. Testing Extensions

Extension test strategy:

```text
1. Pure Java unit test
2. Engine integration test
3. Template golden output test
4. Security negative test
5. Locale/timezone test if formatting involved
6. Concurrent render test
7. Cache/reload test if loader/resolver involved
8. Upgrade compatibility test
```

### 28.1 FreeMarker Method Test

```java
@Test
void maskIdentifierMasksAllButLastFourCharacters() throws Exception {
    MaskIdentifierMethod method = new MaskIdentifierMethod();

    Object result = method.exec(List.of(new SimpleScalar("ABCDEF123456")));

    assertEquals("****3456", result);
}
```

### 28.2 FreeMarker Integration Test

```java
@Test
void templateCanCallMaskIdentifier() throws Exception {
    Configuration cfg = new Configuration(Configuration.VERSION_2_3_34);
    cfg.setTemplateLoader(new StringTemplateLoader() {{
        putTemplate("t.ftlh", "${maskIdentifier(id)}");
    }});
    cfg.setSharedVariable("maskIdentifier", new MaskIdentifierMethod());

    Template template = cfg.getTemplate("t.ftlh");
    StringWriter out = new StringWriter();
    template.process(Map.of("id", "ABCDEF123456"), out);

    assertEquals("****3456", out.toString());
}
```

### 28.3 Thymeleaf Dialect Integration Test

```java
@Test
void ifPermissionRemovesElementWhenNotAllowed() {
    TemplateEngine engine = new TemplateEngine();
    StringTemplateResolver resolver = new StringTemplateResolver();
    resolver.setTemplateMode(TemplateMode.HTML);
    engine.setTemplateResolver(resolver);
    engine.addDialect(new ApplicationDialect(permission -> false));

    Context context = new Context(Locale.ENGLISH);
    String result = engine.process(
        "<button app:ifPermission=\"CASE_APPROVE\">Approve</button>",
        context
    );

    assertFalse(result.contains("Approve"));
}
```

### 28.4 Security Negative Test

Test malicious values:

```text
<script>alert(1)</script>
"><img src=x onerror=alert(1)>
${"freemarker"?new()}
__${T(java.lang.Runtime).getRuntime()}__
../../secret
```

Expected behavior:

- escaped output
- rejected expression
- rejected template path
- forbidden object/class access
- no sensitive leak
- no server-side code execution

---

## 29. Java 8–25 Considerations

Extension code should be aware of Java version capabilities.

### 29.1 Java 8 Baseline

If supporting Java 8:

- no records
- no switch expressions
- no var
- no text blocks
- older date/time still available via `java.time`
- more verbose DTOs
- use builders/classes for immutable view model

### 29.2 Java 11/17

Good enterprise baseline:

- better runtime performance
- stronger TLS/runtime ecosystem
- var local inference if style allows
- Java 17 sealed classes possible for model hierarchy if supported

### 29.3 Java 21/25

Modern options:

- records for view models
- sealed interfaces for output types
- pattern matching in extension code
- virtual threads for concurrent rendering workloads around blocking I/O, not as excuse for template extension I/O
- better GC/runtime ergonomics

Example modern ViewModel:

```java
public record CaseNoticeView(
    String caseReferenceNo,
    String applicantName,
    String statusLabel,
    String issuedAtDisplay,
    List<FieldRow> fields
) {}

public record FieldRow(
    String label,
    String value
) {}
```

But if Java 8 support is required, provide equivalent immutable classes.

---

## 30. Anti-Patterns in Template Engine Extensibility

### 30.1 The Service Locator Template

```ftl
${spring.getBean("caseService").findById(id).approve()}
```

This is catastrophic. Template becomes an execution environment.

### 30.2 The DB Query Helper

```html
<span th:text="${#caseService.findStatus(caseId)}"></span>
```

This hides N+1 query and makes rendering non-deterministic.

### 30.3 The God Utility Object

```ftl
${utils.format(case, user, tenant, locale, request, session, mode)}
```

No one knows what it does.

### 30.4 The Silent Fallback Extension

```java
catch (Exception e) {
    return "";
}
```

This creates legally dangerous output omissions.

### 30.5 The Business Rule Dialect

```html
<div app:ifCaseCanBeApproved="${case}">...</div>
```

UI can hide button, but actual approval rule belongs in domain/application service.

### 30.6 Dynamic Eval for Convenience

```ftl
${userSuppliedExpression?eval}
```

Almost always a bad idea in business-editable templates.

### 30.7 Template Extension with Hidden Time

```ftl
${deadline.daysUntilNow()}
```

Use explicit render clock.

### 30.8 Exposing Domain Entity Graph

```html
<span th:text="${case.application.applicant.identities[0].rawValue}"></span>
```

Use redacted, flattened ViewModel.

---

## 31. Recommended Extension Architecture

A production-grade extension architecture can look like this:

```text
application-rendering/
  api/
    TemplateRenderer.java
    RenderRequest.java
    RenderResult.java
    RenderContext.java
    TemplateId.java
    TemplateVersion.java

  model/
    CaseNoticeView.java
    EmailView.java
    DocumentView.java

  freemarker/
    FreeMarkerRenderer.java
    FreeMarkerConfigurationFactory.java
    SafeObjectWrapperFactory.java
    directives/
      FieldDirective.java
      SignatureBlockDirective.java
    methods/
      MaskIdentifierMethod.java
      LabelMethod.java
    loader/
      VersionedTemplateLoader.java

  thymeleaf/
    ThymeleafRenderer.java
    ThymeleafEngineFactory.java
    dialect/
      ApplicationDialect.java
      IfPermissionAttributeProcessor.java
      StatusBadgeAttributeProcessor.java
      CaseExpressionObjectFactory.java

  registry/
    TemplateRegistry.java
    TemplateResolver.java
    TemplateCompatibilityValidator.java

  security/
    TemplateSecurityPolicy.java
    TemplatePathValidator.java
    HtmlSanitizer.java

  observability/
    RenderMetrics.java
    RenderLogger.java

  testing/
    GoldenOutputTestSupport.java
    MaliciousInputFixtures.java
```

Key idea:

```text
Engine-specific extension is isolated.
Application-facing renderer API is engine-neutral.
```

Jangan biarkan controller/domain service bergantung langsung pada FreeMarker/Thymeleaf internals kecuali di adapter layer.

---

## 32. Extension Design Review Checklist

Sebelum merge extension baru, review:

### 32.1 Purpose

- Apa problem nyata yang diselesaikan?
- Kenapa ViewModel/fragment/macro tidak cukup?
- Template siapa yang akan memakai?

### 32.2 API

- Nama jelas?
- Input eksplisit?
- Output jelas?
- Null/missing policy jelas?
- Locale/timezone policy jelas?

### 32.3 Security

- Bisa akses Java API berbahaya?
- Bisa melakukan I/O?
- Bisa membocorkan sensitive data?
- Bisa memproses untrusted expression?
- Escaping tetap benar?

### 32.4 Performance

- Complexity per invocation?
- Dipanggil dalam loop besar?
- Ada allocation besar?
- Ada reflection berat?
- Ada cache yang aman?

### 32.5 Observability

- Error bisa didiagnosis?
- Template name/line tersedia?
- Failure category jelas?
- Tidak log PII?

### 32.6 Testing

- Unit test?
- Integration render test?
- Security negative test?
- Locale test?
- Concurrent test?
- Upgrade compatibility test?

### 32.7 Governance

- Dokumentasi untuk template author?
- Versioning?
- Deprecation path?
- Ownership jelas?

---

## 33. Worked Example: Status Badge Extension Decision

Kebutuhan:

> Banyak halaman Thymeleaf dan email FreeMarker perlu menampilkan status case dengan label, CSS class, dan optional tooltip. Status mapping harus konsisten.

### Option A — Semua di ViewModel

```java
record CaseView(String statusLabel, String statusCssClass, String statusTooltip) {}
```

Template:

```html
<span th:class="${case.statusCssClass}" th:text="${case.statusLabel}" th:title="${case.statusTooltip}"></span>
```

Kelebihan:

- simple
- explicit
- engine-independent
- easy to test

Kekurangan:

- markup duplicated

### Option B — Thymeleaf Fragment

```html
<span th:fragment="statusBadge(label, cssClass, tooltip)"
      th:class="${cssClass}"
      th:text="${label}"
      th:title="${tooltip}">
</span>
```

Kelebihan:

- reusable UI shape
- no Java extension
- designer-friendly

Kekurangan:

- still Thymeleaf-specific

### Option C — Thymeleaf Dialect

```html
<span app:statusBadge="${case.status}"></span>
```

Kelebihan:

- very concise
- centralized behavior
- can enforce design system

Kekurangan:

- hidden behavior
- custom processor maintenance
- harder debug

### Option D — FreeMarker Macro

```ftl
<@statusBadge status=case.status />
```

Kelebihan:

- good for FreeMarker email/doc template
- no Java needed if mapping passed in model

Kekurangan:

- duplicated between engines unless architecture designed

### Recommended

Use domain presenter in Java:

```java
record StatusPresentation(String label, String cssClass, String tooltip) {}
```

Use fragment/macro for markup shape:

```html
<th:block th:replace="~{fragments/status :: badge(${case.statusPresentation})}"></th:block>
```

```ftl
<@status.badge status=case.statusPresentation />
```

Only create dialect if status badge is part of a broad server-side design system with many semantic components.

---

## 34. Worked Example: Permission Rendering Extension

Kebutuhan:

> UI harus menyembunyikan tombol berdasarkan permission.

### Bad Design

```html
<button th:if="${#authz.canApprove(case)}">Approve</button>
```

Jika `canApprove` menjalankan business rule penuh, template menjadi domain rule executor.

### Better Design

Application layer menentukan action availability:

```java
record CaseActionsView(
    boolean canView,
    boolean canApprove,
    boolean canReject,
    boolean canRequestInfo
) {}
```

Template:

```html
<button th:if="${case.actions.canApprove}">Approve</button>
```

Atau jika UI permission global:

```html
<button app:ifPermission="CASE_APPROVE">Approve</button>
```

Tetapi backend endpoint tetap:

```java
@PreAuthorize("hasAuthority('CASE_APPROVE')")
@PostMapping("/cases/{id}/approve")
public String approve(@PathVariable Long id) { ... }
```

Rule:

```text
Template may decide presentation visibility.
Application/domain layer decides actual permission and transition validity.
```

---

## 35. Worked Example: Template Loader for Multi-Tenant Published Templates

Problem:

- Admin bisa edit template.
- Template punya draft/published state.
- Tenant bisa override global template.
- Published output harus reproducible.

### Template Record

```java
record TemplateRecord(
    String id,
    String name,
    String tenantId,
    Locale locale,
    int version,
    TemplateState state,
    Instant effectiveFrom,
    Instant effectiveTo,
    String engine,
    String outputMode,
    String content,
    Instant updatedAt
) {}
```

### Runtime Policy

```text
Production render:
  only state=PUBLISHED
  effectiveAt based on business event time
  version resolved once and stored in render record

Preview render:
  state=DRAFT allowed
  sample data only
  watermark output
  no send/archive side effect
```

### Render Record

```java
record RenderRecord(
    UUID renderId,
    String templateName,
    int templateVersion,
    String templateHash,
    String engine,
    Locale locale,
    String tenantId,
    Instant renderedAt,
    String dataSnapshotHash,
    String outputHash
) {}
```

This is what makes rendering defensible.

---

## 36. Practical Implementation Sequence

If building template extension platform from scratch, do not start with custom dialect.

Recommended sequence:

```text
1. Define renderer API
2. Define render context
3. Define immutable ViewModel contracts
4. Configure FreeMarker/Thymeleaf safely
5. Add template loader/resolver strategy
6. Add output format/escaping defaults
7. Add error taxonomy
8. Add metrics/logging
9. Add macro/fragment libraries
10. Add only necessary Java extension methods/directives
11. Add dialect only after repeated fragment/macro patterns stabilize
12. Add governance/versioning
13. Add CI template validation
14. Add security review for every extension
```

This prevents premature DSL explosion.

---

## 37. Common Interview/Architecture Questions

### 37.1 Why not expose service beans to templates?

Because rendering should be deterministic transformation. Service beans introduce hidden I/O, side effects, authorization bypass risk, N+1 query risk, and business logic leakage.

### 37.2 When should we create a custom Thymeleaf dialect?

When repeated semantic markup behavior is stable, cross-cutting, hard to express safely with fragments, and worth maintaining as a versioned API.

### 37.3 Is FreeMarker custom directive safer than Thymeleaf dialect?

Neither is automatically safer. Safety depends on exposed capability, trust model, escaping behavior, and whether extension does hidden I/O or exposes dangerous Java objects.

### 37.4 Should template extensions throw exception or silently omit output?

For required contractual/legal output, fail fast. For optional cosmetic component, controlled omission may be acceptable, but should still be observable.

### 37.5 Can template engine be used for user-editable templates?

Yes only with strict sandboxing, allowlisted model, no dangerous Java exposure, preview validation, resource limits, versioning, and security review. For external untrusted users, avoid general-purpose engines if possible.

---

## 38. Summary Mental Model

A template engine is not just a syntax renderer. It is a runtime with:

```text
loader/resolver + parser + internal representation + evaluator + cache + escaping + writer + extension points
```

Extension points are powerful because they let template authors use vocabulary beyond the standard engine. But every extension is a new API and a new risk surface.

FreeMarker extension tends to be function/directive/wrapper/loader-oriented. Thymeleaf extension tends to be dialect/processor/expression-object-oriented. FreeMarker is strong for text-output DSLs. Thymeleaf is strong for markup-semantic DSLs.

The top 1% design principle:

```text
Keep templates expressive enough for presentation,
but not powerful enough to become uncontrolled application logic.
```

Design extensions as narrow, deterministic, documented, tested, observable, and secure APIs.

---

## 39. Practical Checklist

Sebelum membuat extension baru:

```text
[ ] Bisa diselesaikan dengan ViewModel field?
[ ] Bisa diselesaikan dengan macro/fragment?
[ ] Dipakai cukup sering?
[ ] Nama dan contract jelas?
[ ] Tidak ada DB/network/file I/O?
[ ] Tidak expose service/repository/domain graph?
[ ] Escape semantics jelas?
[ ] Null/missing policy jelas?
[ ] Locale/timezone policy jelas?
[ ] Error taxonomy jelas?
[ ] Unit test ada?
[ ] Integration render test ada?
[ ] Security negative test ada?
[ ] Concurrent render test ada jika shared state?
[ ] Dokumentasi template author ada?
[ ] Versioning/deprecation path ada?
```

---

## 40. Referensi

- Apache FreeMarker Manual — Directives and `TemplateDirectiveModel`.
- Apache FreeMarker Manual — User-defined directives.
- Apache FreeMarker Manual — Configuration and template cache.
- Apache FreeMarker Manual — Template loading.
- Apache FreeMarker Manual — Object wrappers.
- Apache FreeMarker Manual — Data model creation.
- Thymeleaf 3.1 Tutorial — Using Thymeleaf.
- Thymeleaf 3.1 API — `TemplateEngine`, cache manager, parsed templates, parsed expressions.
- Thymeleaf 3.1 API — `StandardDialect`.
- Thymeleaf article — Extending Thymeleaf in 5 minutes.
- Thymeleaf + Spring tutorial.
- OWASP Web Security Testing Guide — Server-Side Template Injection.
- OWASP XSS Prevention Cheat Sheet.

---

## 41. Status Seri

```text
Part 29 selesai.
Seri belum selesai.
Berikutnya: Part 30 — Performance Lab: Benchmarking FreeMarker vs Thymeleaf.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-028.md">⬅️ Part 28 — Migration Engineering: JSP to Thymeleaf/FreeMarker, Legacy Templates, and Modernization</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-030.md">Part 30 — Performance Lab: Benchmarking FreeMarker vs Thymeleaf ➡️</a>
</div>
