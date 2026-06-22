# learn-java-template-freemarker-thymeleaf-rendering-engineering-part-003

# Part 3 — FreeMarker Fundamental Architecture

## 0. Posisi Part Ini dalam Seri

Pada Part 0 kita membangun mental model bahwa template engine bukan sekadar mekanisme mengganti `${name}` menjadi nilai string. Template engine adalah boundary transformasi dari model aplikasi menjadi output artifact.

Pada Part 1 kita memetakan landscape engine Java: JSP/Jakarta Pages, FreeMarker, Thymeleaf, Mustache, Pebble, Velocity, dan pilihan lain.

Pada Part 2 kita memformalkan model inti:

```text
Template + Data Model + Render Context + Output Policy = Output Artifact
```

Part 3 mulai masuk ke engine pertama secara mendalam: **Apache FreeMarker**.

FreeMarker adalah template engine Java general-purpose untuk menghasilkan output teks seperti HTML, email, konfigurasi, source code, XML, plain text, dan bentuk teks lainnya. Dokumentasi resminya menekankan bahwa template ditulis dalam FreeMarker Template Language atau FTL, sedangkan Java tetap bertanggung jawab menyiapkan data, mengambil data dari database, melakukan kalkulasi bisnis, dan menjaga boundary aplikasi.

Part ini bukan tutorial syntax FTL. Syntax akan dibahas pada Part 4 dan Part 5. Fokus Part 3 adalah memahami **arsitektur runtime FreeMarker**: objek apa saja yang ada, bagaimana mereka bekerja bersama, bagian mana yang thread-safe, bagian mana yang menjadi security boundary, dan seperti apa setup yang sehat untuk production.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan Part 3, kamu diharapkan mampu:

1. Menjelaskan pipeline internal FreeMarker dari template name sampai output selesai ditulis.
2. Memahami peran `Configuration` sebagai pusat konfigurasi, template loading, caching, object wrapping, output format, locale, encoding, dan error handling.
3. Memahami `TemplateLoader` dan implikasi pilihan loader terhadap deployment, caching, hot reload, multi-tenancy, dan security.
4. Memahami bahwa `Template` adalah representasi template yang sudah diparse dan siap diproses.
5. Memahami `ObjectWrapper`, `TemplateModel`, dan kenapa data model bukan sekadar `Map<String, Object>` biasa.
6. Mengetahui boundary antara Java object, FTL object, method exposure, dan risiko keamanan.
7. Memahami shared variables, custom directive, macro, function, dan extension point FreeMarker.
8. Mendesain setup FreeMarker yang production-grade untuk Java 8 sampai Java 25.
9. Menghindari anti-pattern umum seperti membuat `Configuration` per request, mengirim entity langsung ke template, men-disable escaping tanpa policy, atau memakai dynamic templates tanpa sandbox.

---

## 2. FreeMarker dalam Satu Kalimat yang Tepat

Definisi sederhana:

```text
FreeMarker adalah library Java yang membaca template FTL, menggabungkannya dengan data model yang disediakan aplikasi, lalu menulis output teks ke Writer.
```

Definisi yang lebih engineering-oriented:

```text
FreeMarker adalah deterministic text-rendering engine dengan runtime yang terdiri dari template resolution, template parsing/caching, object wrapping, expression evaluation, directive execution, output formatting, escaping, dan output streaming ke Writer.
```

Definisi untuk software architect:

```text
FreeMarker adalah boundary layer yang memisahkan domain/application logic dari representasi output, dengan kontrak eksplisit antara rendering model, template language, security policy, output format, dan operational governance.
```

---

## 3. Mental Model Utama FreeMarker

FreeMarker mudah disalahpahami karena contoh paling sederhana terlihat seperti ini:

```ftl
Hello ${user.name}
```

Lalu Java-nya terlihat seperti ini:

```java
template.process(model, writer);
```

Itu benar, tetapi mental model yang terlalu dangkal akan menyebabkan desain buruk.

Mental model yang lebih tepat:

```text
                ┌─────────────────────┐
                │   Template Name      │
                │   "mail/welcome.ftl"│
                └──────────┬──────────┘
                           │
                           ▼
                ┌─────────────────────┐
                │   Configuration     │
                │ loader/cache/policy │
                └──────────┬──────────┘
                           │
                           ▼
                ┌─────────────────────┐
                │   TemplateLoader    │
                │ classpath/file/db    │
                └──────────┬──────────┘
                           │
                           ▼
                ┌─────────────────────┐
                │ Parsed Template     │
                │ internal structure  │
                └──────────┬──────────┘
                           │
                           ▼
┌──────────────────┐   ┌─────────────────────┐   ┌──────────────────┐
│ Java Data Model  │──▶│ ObjectWrapper       │──▶│ TemplateModel    │
│ DTO/ViewModel    │   │ Java -> FTL types   │   │ FTL-visible view │
└──────────────────┘   └─────────────────────┘   └────────┬─────────┘
                                                           │
                                                           ▼
                                                ┌─────────────────────┐
                                                │ process/evaluate    │
                                                │ directives/expr     │
                                                └──────────┬──────────┘
                                                           │
                                                           ▼
                                                ┌─────────────────────┐
                                                │ OutputFormat +      │
                                                │ escaping/formatting │
                                                └──────────┬──────────┘
                                                           │
                                                           ▼
                                                ┌─────────────────────┐
                                                │ Writer              │
                                                │ HTTP/email/file     │
                                                └─────────────────────┘
```

Kunci berpikirnya:

1. Template tidak langsung membaca Java object mentah.
2. Template melihat data melalui abstraction layer bernama `TemplateModel`.
3. `ObjectWrapper` menentukan bagaimana Java object diekspos ke FTL.
4. `Configuration` mengontrol policy global rendering.
5. Output ditulis ke `Writer`, sehingga FreeMarker pada dasarnya adalah text streaming engine, bukan DOM engine.
6. Security tidak cukup dengan escaping; security juga bergantung pada object exposure, template trust, loader policy, dan directive availability.

---

## 4. Komponen Arsitektur FreeMarker

Secara praktis, ada beberapa komponen penting.

```text
FreeMarker Runtime
├── Configuration
│   ├── Version / incompatible improvements
│   ├── Template loaders
│   ├── Template cache
│   ├── Object wrapper
│   ├── Output format
│   ├── Auto-escaping policy
│   ├── Encoding
│   ├── Locale/timezone settings
│   ├── Exception handler
│   └── Shared variables
│
├── TemplateLoader
│   ├── ClassTemplateLoader
│   ├── FileTemplateLoader
│   ├── WebappTemplateLoader
│   ├── StringTemplateLoader
│   ├── MultiTemplateLoader
│   └── custom loader
│
├── Template
│   ├── parsed FTL
│   ├── template name
│   ├── source name
│   ├── locale variant
│   └── processing logic
│
├── ObjectWrapper
│   ├── DefaultObjectWrapper
│   ├── BeansWrapper
│   ├── SimpleObjectWrapper
│   └── custom wrappers
│
├── TemplateModel
│   ├── TemplateScalarModel
│   ├── TemplateNumberModel
│   ├── TemplateBooleanModel
│   ├── TemplateHashModel
│   ├── TemplateSequenceModel
│   ├── TemplateCollectionModel
│   ├── TemplateDirectiveModel
│   ├── TemplateMethodModelEx
│   └── others
│
├── FTL Language Runtime
│   ├── expressions
│   ├── interpolations
│   ├── directives
│   ├── macros
│   ├── functions
│   └── built-ins
│
└── Output
    ├── Writer
    ├── output format
    ├── escaping
    └── encoding outside Writer boundary
```

Part ini akan membahas tiap komponen dari sudut pandang engineer yang harus membuat sistem production.

---

## 5. `Configuration`: Pusat Kendali FreeMarker

`Configuration` adalah objek terpenting di FreeMarker.

Secara konseptual:

```text
Configuration = runtime policy + loader + cache + type exposure + output settings
```

Contoh minimal:

```java
import freemarker.template.Configuration;
import freemarker.template.TemplateExceptionHandler;

import java.nio.charset.StandardCharsets;
import java.util.Locale;

public final class FreeMarkerFactory {

    private FreeMarkerFactory() {
    }

    public static Configuration createConfiguration() {
        Configuration cfg = new Configuration(Configuration.VERSION_2_3_34);

        cfg.setClassLoaderForTemplateLoading(
                FreeMarkerFactory.class.getClassLoader(),
                "templates"
        );

        cfg.setDefaultEncoding(StandardCharsets.UTF_8.name());
        cfg.setLocale(Locale.US);
        cfg.setTemplateExceptionHandler(TemplateExceptionHandler.RETHROW_HANDLER);
        cfg.setLogTemplateExceptions(false);
        cfg.setWrapUncheckedExceptions(true);
        cfg.setFallbackOnNullLoopVariable(false);

        return cfg;
    }
}
```

Catatan:

- `Configuration` bukan object yang seharusnya dibuat per render.
- `Configuration` biasanya dibuat satu kali per application/module/tenant policy.
- Setelah setup selesai, ia dipakai berulang-ulang untuk mengambil `Template` dan melakukan render.
- Konfigurasi ini menjadi bagian dari security posture aplikasi.

### 5.1 Kenapa `Configuration` Tidak Boleh Dibuat Per Request?

Membuat `Configuration` per request adalah anti-pattern karena:

1. Template cache menjadi tidak efektif.
2. Object wrapper/introspection cache tidak optimal.
3. Konfigurasi bisa tidak konsisten antar request.
4. Performance memburuk karena parsing/reloading berulang.
5. Sulit melakukan observability dan governance.
6. Risiko bug karena satu request memakai setting berbeda dari request lain.

Pola yang benar:

```text
Application startup:
  create Configuration once
  configure loader, cache, wrapper, escaping, exception handler
  register as singleton bean/service

Per render:
  getTemplate(templateName)
  prepare data model
  process(model, writer)
```

### 5.2 `incompatibleImprovements` / Version Setting

Ketika membuat `Configuration`, kita memberikan versi FreeMarker:

```java
Configuration cfg = new Configuration(Configuration.VERSION_2_3_34);
```

Ini bukan sekadar metadata. Version setting memengaruhi beberapa perilaku kompatibilitas. FreeMarker sangat berhati-hati menjaga backward compatibility; karena itu beberapa perilaku baru hanya aktif jika versi konfigurasi dinaikkan.

Prinsip production:

```text
Pin FreeMarker version consciously.
When upgrading library version, explicitly review Configuration.VERSION_x_y_z behavior.
```

Jangan upgrade dependency lalu menganggap semua semantic tetap sama. Template engine adalah execution environment; perubahan kecil dalam escaping, null handling, object wrapping, atau output format bisa berdampak luas.

---

## 6. Template Loading: Dari Nama Template ke Source Text

FreeMarker tidak memaksa template berada di file system. Ia memakai abstraction bernama `TemplateLoader`.

Dokumentasi FreeMarker menjelaskan bahwa template loader memuat raw textual data berdasarkan abstract template path seperti `index.ftl` atau `products/catalog.ftl`. Lokasi fisiknya bisa file, classpath, database, map string, atau sumber lain.

Mental model:

```text
"mail/welcome.ftl"      abstract name
        │
        ▼
TemplateLoader.findTemplateSource(name)
        │
        ▼
Template source object
        │
        ▼
Reader over template text
        │
        ▼
Parser + cache
```

### 6.1 Classpath Template Loading

Classpath loader cocok untuk template yang dibundel bersama aplikasi.

Contoh:

```java
cfg.setClassLoaderForTemplateLoading(
        Thread.currentThread().getContextClassLoader(),
        "templates"
);
```

Struktur:

```text
src/main/resources/
└── templates/
    ├── email/
    │   └── welcome.ftl
    └── document/
        └── approval-letter.ftl
```

Render:

```java
Template template = cfg.getTemplate("email/welcome.ftl");
```

Kelebihan:

1. Immutable bersama release artifact.
2. Cocok untuk container image.
3. Mudah dites di CI.
4. Mudah direview di Git.
5. Tidak butuh runtime file mount.

Kekurangan:

1. Perubahan template membutuhkan deployment ulang.
2. Tidak cocok untuk business-editable template yang sering berubah.
3. Tidak fleksibel untuk multi-tenant template override tanpa strategi tambahan.

Cocok untuk:

- email sistem standar,
- halaman error,
- konfigurasi generator internal,
- template yang dikelola developer,
- template yang harus immutable per release.

### 6.2 File System Template Loading

File loader cocok ketika template disimpan di directory runtime.

Contoh:

```java
import freemarker.cache.FileTemplateLoader;

import java.io.File;

FileTemplateLoader loader = new FileTemplateLoader(new File("/opt/app/templates"));
cfg.setTemplateLoader(loader);
```

Kelebihan:

1. Template bisa diubah tanpa rebuild aplikasi.
2. Cocok untuk on-premise/custom deployment.
3. Cocok untuk admin-managed templates.

Kekurangan:

1. Security surface lebih besar.
2. Harus mengontrol permission file system.
3. Perlu governance perubahan template.
4. Perlu backup/versioning eksternal.
5. Perlu path traversal defense.
6. Bisa berbeda antar node jika tidak disinkronkan.

Cocok untuk:

- enterprise deployment dengan template directory managed,
- non-container legacy system,
- controlled dynamic template repository.

Tidak cocok jika:

- banyak node tanpa shared storage atau sync strategy,
- template editable oleh user tanpa sandbox,
- governance lemah.

### 6.3 Webapp Template Loading

Dalam aplikasi Servlet/Jakarta web tradisional, template bisa dimuat dari web application context.

Konsepnya:

```text
/WEB-INF/templates/*.ftl
```

Ini historically relevan untuk Spring MVC/Servlet app yang masih berbasis WAR.

Kelebihan:

1. Integrasi natural dengan WAR packaging.
2. Template bisa disimpan di area yang tidak langsung public seperti `/WEB-INF`.

Kekurangan:

1. Kurang cocok untuk executable JAR/container modern dibanding classpath.
2. Tergantung servlet context.
3. Less portable untuk non-web rendering service.

### 6.4 StringTemplateLoader

`StringTemplateLoader` menyimpan template dari string dalam memory.

Contoh penggunaan:

```java
import freemarker.cache.StringTemplateLoader;

StringTemplateLoader loader = new StringTemplateLoader();
loader.putTemplate("hello", "Hello ${name}!");
cfg.setTemplateLoader(loader);
```

Cocok untuk:

1. Test.
2. Demo.
3. Runtime-generated template yang sudah divalidasi.
4. Template preview sederhana.

Perlu hati-hati:

1. Jangan menjadikan user input sebagai template executable tanpa sandbox.
2. Jangan memasukkan template tak terbatas ke memory tanpa eviction/governance.
3. Jangan memakai template string dinamis untuk menggantikan parameterization.

### 6.5 MultiTemplateLoader

`MultiTemplateLoader` mencoba beberapa loader secara berurutan.

Contoh:

```java
import freemarker.cache.ClassTemplateLoader;
import freemarker.cache.FileTemplateLoader;
import freemarker.cache.MultiTemplateLoader;
import freemarker.cache.TemplateLoader;

TemplateLoader tenantOverride = new FileTemplateLoader(new File("/opt/app/tenant-templates"));
TemplateLoader defaultTemplates = new ClassTemplateLoader(
        FreeMarkerFactory.class,
        "/templates"
);

cfg.setTemplateLoader(new MultiTemplateLoader(new TemplateLoader[] {
        tenantOverride,
        defaultTemplates
}));
```

Mental model:

```text
getTemplate("email/welcome.ftl")
  try /opt/app/tenant-templates/email/welcome.ftl
  if missing, try classpath:/templates/email/welcome.ftl
```

Kelebihan:

1. Mendukung override.
2. Mendukung fallback.
3. Cocok untuk tenant/agency branding.

Risiko:

1. Sulit melacak template sebenarnya yang dipakai.
2. Bisa muncul shadowing bug.
3. Audit harus mencatat source template.
4. Governance harus mengontrol urutan loader.

Production rule:

```text
Jika memakai MultiTemplateLoader, setiap render record harus bisa menjelaskan template source mana yang dipakai.
```

### 6.6 Custom TemplateLoader

Custom loader dibuat jika template berada di database, S3, Git-backed repository, configuration service, atau CMS internal.

Secara konsep custom loader harus menjawab:

1. Apakah template ada?
2. Bagaimana membaca isi template?
3. Kapan template terakhir berubah?
4. Bagaimana menutup resource?
5. Apa identity template source?

Contoh konseptual:

```java
public final class DatabaseTemplateLoader implements freemarker.cache.TemplateLoader {

    private final TemplateRepository repository;

    public DatabaseTemplateLoader(TemplateRepository repository) {
        this.repository = repository;
    }

    @Override
    public Object findTemplateSource(String name) {
        return repository.findPublishedTemplate(name).orElse(null);
    }

    @Override
    public long getLastModified(Object templateSource) {
        PublishedTemplate template = (PublishedTemplate) templateSource;
        return template.updatedAtMillis();
    }

    @Override
    public java.io.Reader getReader(Object templateSource, String encoding) {
        PublishedTemplate template = (PublishedTemplate) templateSource;
        return new java.io.StringReader(template.body());
    }

    @Override
    public void closeTemplateSource(Object templateSource) {
        // no-op if no external stream/resource is held
    }
}
```

Namun desain production jauh lebih kompleks. Untuk database-backed templates, kamu harus memikirkan:

1. Draft/published status.
2. Versioning.
3. Effective date.
4. Approval workflow.
5. Cache invalidation.
6. Multi-node consistency.
7. Audit trail.
8. Template compatibility check.
9. Sandbox dan security.
10. Rollback.

---

## 7. Template Cache

FreeMarker tidak seharusnya membaca dan mem-parse template dari sumber setiap render.

Pipeline normal:

```text
First request:
  getTemplate(name)
  -> loader reads raw text
  -> parser parses FTL
  -> template cached
  -> process

Next request:
  getTemplate(name)
  -> cache lookup
  -> maybe check last modified after update delay
  -> reuse parsed template
  -> process
```

### 7.1 Apa yang Dicache?

Yang dicache adalah representasi template yang sudah diparse dan siap diproses.

Ini penting karena parse cost bisa mahal, terutama jika:

1. Template besar.
2. Banyak include/import.
3. Loader lambat.
4. Template source remote.
5. Banyak render per detik.

### 7.2 Template Update Delay

FreeMarker memiliki konsep delay untuk mengecek apakah source template berubah.

Dalam development kamu mungkin ingin update cepat:

```java
cfg.setTemplateUpdateDelayMilliseconds(0);
```

Dalam production kamu biasanya ingin nilai lebih besar atau bahkan template immutable.

Prinsip:

```text
DEV  : fast feedback, low cache delay, reload allowed
PROD : stable, predictable, cache-friendly, reload controlled
```

Jangan menyamakan kebutuhan DEV dan PROD.

### 7.3 Cache dan Multi-Node Deployment

Jika template ada di classpath:

```text
Node A template = release artifact version X
Node B template = release artifact version X
```

Ini predictable.

Jika template ada di file system atau database:

```text
Node A cache may still hold old template
Node B may load new template
```

Maka perlu desain cache invalidation.

Pilihan:

1. Restart semua node setelah publish template.
2. Gunakan update delay rendah, tetapi ada overhead check.
3. Kirim invalidation event ke semua node.
4. Gunakan versioned template name.
5. Render berdasarkan immutable template version.

Top 1% approach untuk dokumen penting:

```text
Jangan bergantung pada "latest mutable template" saat render legal/audit artifact.
Render dengan template version eksplisit.
```

Misalnya:

```text
templateId      = NOTICE_OF_NON_COMPLIANCE
templateVersion = 2026.06.19-001
locale          = en-SG
```

Bukan:

```text
templateName = notice.ftl
```

---

## 8. `Template`: Parsed Template yang Siap Diproses

`Template` adalah object hasil `cfg.getTemplate(...)`.

Contoh:

```java
Template template = cfg.getTemplate("email/welcome.ftl");
template.process(model, writer);
```

Secara mental:

```text
Template = parsed FTL + metadata + link to configuration/runtime rules
```

`Template` bukan hasil output. Ia adalah program/template yang bisa diproses berulang kali dengan data model berbeda.

### 8.1 `Template` dan Thread-Safety

Secara praktik, template yang sudah diparse dapat digunakan ulang lintas request. Namun data model dan writer per render harus berbeda.

Pola benar:

```java
Template template = cfg.getTemplate("mail/welcome.ftl");

template.process(modelForUserA, writerA);
template.process(modelForUserB, writerB);
```

Pola salah:

```java
// Salah secara desain jika shared mutable model digunakan lintas request
Map<String, Object> sharedModel = new HashMap<>();
sharedModel.put("user", userA);
template.process(sharedModel, writerA);

sharedModel.put("user", userB);
template.process(sharedModel, writerB);
```

Setiap render harus punya model sendiri atau model immutable.

### 8.2 Template Name vs Source Name

Dalam sistem yang memakai loader kompleks, template name yang diminta tidak selalu sama dengan source aktual.

Contoh:

```text
Requested name : email/welcome.ftl
Actual source  : /opt/app/tenant-templates/email/welcome.ftl
Fallback source: classpath:/templates/email/welcome.ftl
```

Untuk debugging dan audit, catat:

1. requested template name,
2. resolved source,
3. template version jika ada,
4. locale,
5. output format,
6. render timestamp,
7. renderer version/application version.

---

## 9. Data Model: Apa yang Diberikan Java ke Template

Data model FreeMarker sering dimulai dengan `Map<String, Object>`.

Contoh:

```java
Map<String, Object> model = new HashMap<>();
model.put("user", new UserView("Fajar", "fajar@example.com"));
model.put("appName", "ACEAS");
model.put("items", List.of("A", "B", "C"));
```

Template:

```ftl
Hello ${user.name}, welcome to ${appName}.

<#list items as item>
- ${item}
</#list>
```

Tetapi secara internal FreeMarker tidak berpikir hanya dalam `Map`. Ia membungkus Java object menjadi `TemplateModel`.

---

## 10. `TemplateModel`: Dunia yang Dilihat Template

FreeMarker memiliki abstraction bernama `TemplateModel`. Ini adalah representasi nilai yang bisa dipahami FTL.

Beberapa jenis penting:

| TemplateModel | Makna |
|---|---|
| `TemplateScalarModel` | string |
| `TemplateNumberModel` | number |
| `TemplateBooleanModel` | boolean |
| `TemplateDateModel` | date/time |
| `TemplateHashModel` | key-value/hash/object-like |
| `TemplateSequenceModel` | index-based sequence/list |
| `TemplateCollectionModel` | iterable collection |
| `TemplateMethodModelEx` | callable method |
| `TemplateDirectiveModel` | custom directive |
| `TemplateTransformModel` | output transform |

Mental model:

```text
Java object graph
  └── ObjectWrapper
        └── TemplateModel graph
              └── FTL sees this, not raw Java directly
```

### 10.1 Kenapa Ini Penting?

Karena security dan behavior ditentukan oleh wrapping.

Misalnya Java object:

```java
public final class User {
    private final String name;
    private final String email;
    private final String passwordHash;

    public String getName() { return name; }
    public String getEmail() { return email; }
    public String getPasswordHash() { return passwordHash; }
}
```

Jika object ini diekspos langsung, template mungkin bisa mengakses:

```ftl
${user.passwordHash}
```

Walaupun developer template “tidak berniat”, field itu sudah menjadi bagian dari template-visible contract.

Karena itu rule penting:

```text
Template data model harus dibuat sebagai presentation contract, bukan domain/entity object mentah.
```

Gunakan:

```java
public record UserEmailView(
        String displayName,
        String maskedEmail
) {
}
```

Bukan:

```java
UserEntity userEntity
```

---

## 11. `ObjectWrapper`: Boundary Java Object ke FTL

`ObjectWrapper` menentukan bagaimana Java object dibungkus menjadi `TemplateModel`.

Ini salah satu komponen paling penting dan paling sering diabaikan.

Contoh setup:

```java
import freemarker.template.DefaultObjectWrapperBuilder;
import freemarker.template.ObjectWrapper;

DefaultObjectWrapperBuilder wrapperBuilder =
        new DefaultObjectWrapperBuilder(Configuration.VERSION_2_3_34);

ObjectWrapper wrapper = wrapperBuilder.build();
cfg.setObjectWrapper(wrapper);
```

### 11.1 Peran ObjectWrapper

ObjectWrapper menjawab pertanyaan:

1. Java `String` menjadi apa di FTL?
2. Java `List` menjadi sequence atau collection?
3. Java `Map` menjadi hash?
4. JavaBean getter bisa diakses sebagai property?
5. Method Java boleh dipanggil?
6. Static method/class bisa diekspos?
7. `null` ditangani bagaimana?
8. Record Java diperlakukan seperti apa?
9. Date/time object diformat bagaimana?

### 11.2 DefaultObjectWrapper

`DefaultObjectWrapper` umumnya pilihan standar modern.

Ia menangani banyak tipe umum:

1. `String`
2. `Number`
3. `Boolean`
4. `Date`
5. `Map`
6. `List`
7. array
8. JavaBean object
9. custom object

Namun “bisa” bukan berarti “harus”.

Jika object terlalu kaya, template akan melihat terlalu banyak.

### 11.3 BeansWrapper

`BeansWrapper` mengekspos JavaBean-style access dan method invocation dengan lebih kuat. Ini berguna untuk integrasi lama atau kebutuhan tertentu, tetapi harus lebih hati-hati dari sisi security.

Risiko:

1. Template bisa terlalu banyak memanggil method.
2. Business logic pindah ke template.
3. Object graph leakage.
4. Sulit mengontrol field/method yang terlihat.
5. Potensi security issue jika template tidak sepenuhnya trusted.

### 11.4 SimpleObjectWrapper

`SimpleObjectWrapper` lebih restriktif dan dapat dipakai untuk model sederhana.

Cocok saat:

1. Template harus melihat data sederhana saja.
2. Kamu ingin menghindari pemanggilan method Java.
3. Data model berupa map/list/scalar yang eksplisit.

### 11.5 Custom ObjectWrapper

Custom wrapper dipakai ketika kamu ingin kontrol penuh.

Contoh use case:

1. Hide field tertentu.
2. Prevent method invocation.
3. Map domain-specific type ke template-friendly object.
4. Redact sensitive value.
5. Enforce allowlist.
6. Wrap `Money`, `UserDisplayName`, `SafeHtml`, `MaskedIdentifier`.

Prinsip:

```text
ObjectWrapper adalah security boundary dan semantic boundary.
Jangan hanya melihatnya sebagai adapter teknis.
```

---

## 12. `Configuration` + `ObjectWrapper` + Data Model: Kontrak Tersembunyi

Misalnya kamu punya model:

```java
model.put("case", caseEntity);
```

Dan template:

```ftl
Case ID: ${case.id}
Officer: ${case.assignedOfficer.name}
Status: ${case.status}
```

Sekilas mudah. Tapi kontrak tersembunyi yang terbentuk:

```text
Template depends on:
- case.getId()
- case.getAssignedOfficer()
- assignedOfficer.getName()
- case.getStatus()
- object wrapper property exposure semantics
- null behavior
- method naming
```

Jika domain model berubah, template rusak.
Jika lazy-loaded association belum di-load, template bisa trigger database access atau exception.
Jika `assignedOfficer` null, output gagal.
Jika entity punya sensitive getter, template bisa mengaksesnya.

Desain lebih sehat:

```java
public record CaseNoticeView(
        String caseId,
        String assignedOfficerDisplayName,
        String statusLabel
) {
}
```

Template:

```ftl
Case ID: ${notice.caseId}
Officer: ${notice.assignedOfficerDisplayName}
Status: ${notice.statusLabel}
```

Kontrak menjadi jelas.

---

## 13. Output Format dan Auto-Escaping

FreeMarker modern memiliki konsep output format dan auto-escaping.

Untuk HTML:

```java
import freemarker.core.HTMLOutputFormat;

cfg.setOutputFormat(HTMLOutputFormat.INSTANCE);
cfg.setRecognizeStandardFileExtensions(true);
```

Atau melalui extension `.ftlh` untuk HTML templates pada konfigurasi yang mengenali standard extension.

Mental model:

```text
Output format defines how markup output values behave.
Auto-escaping defines whether interpolations are escaped by default.
```

### 13.1 Kenapa Auto-Escaping Penting?

Tanpa auto-escaping:

```ftl
<p>${comment}</p>
```

Jika `comment` berisi:

```html
<script>alert(1)</script>
```

Output bisa menjadi XSS jika tidak di-escape.

Dengan HTML auto-escaping, output menjadi aman secara konteks HTML text:

```html
&lt;script&gt;alert(1)&lt;/script&gt;
```

Namun escaping tidak menyelesaikan semua konteks. HTML text berbeda dari:

1. HTML attribute.
2. JavaScript string.
3. CSS.
4. URL.
5. raw HTML block.

Part 8 akan membahas ini lebih dalam.

### 13.2 `.ftl`, `.ftlh`, `.ftlx`

FreeMarker mendukung file extension standar yang dapat membantu output format:

- `.ftl` sering digunakan generik.
- `.ftlh` untuk HTML-aware template.
- `.ftlx` untuk XML-aware template.

Production recommendation:

```text
Gunakan extension yang menyatakan output format jika memungkinkan.
Untuk HTML: prefer .ftlh.
Untuk XML: prefer .ftlx.
Untuk plain text/email text/config: gunakan policy eksplisit.
```

### 13.3 Jangan Mengandalkan Template Author untuk Selalu Ingat Escape

Pola buruk:

```ftl
${userInput?html}
```

Jika ratusan template dan banyak developer, seseorang akan lupa.

Pola lebih baik:

```text
Aktifkan output format + auto-escaping by default untuk HTML/XML.
Batasi no-escape.
Review penggunaan raw output.
```

---

## 14. Exception Handling

FreeMarker bisa gagal karena berbagai sebab:

1. Template tidak ditemukan.
2. Template gagal diparse.
3. Variable hilang.
4. Method/property tidak tersedia.
5. Null/missing value tidak ditangani.
6. Directive error.
7. Writer error.
8. Encoding/resource error.
9. Custom loader error.
10. Custom directive error.

### 14.1 `TemplateExceptionHandler`

Contoh production-style:

```java
cfg.setTemplateExceptionHandler(TemplateExceptionHandler.RETHROW_HANDLER);
```

Artinya jika render gagal, exception dilempar ke aplikasi.

Kenapa ini baik?

1. Render failure tidak disembunyikan.
2. Caller bisa mengklasifikasikan error.
3. Observability bisa mencatat failure.
4. Output partial tidak diam-diam dianggap sukses.

Untuk development, handler yang menampilkan error di output kadang berguna. Untuk production, hati-hati karena bisa membocorkan template internals atau data.

### 14.2 Fail Fast vs Lenient

Ada dua gaya:

```text
Fail fast:
  missing variable -> render fails

Lenient:
  missing variable -> empty/default output
```

Untuk sistem enterprise, default yang sehat sering kali fail fast, terutama untuk:

1. dokumen legal,
2. approval/rejection letter,
3. regulatory notice,
4. payment/invoice,
5. email penting,
6. audit artifact.

Kenapa?

Karena output yang “berhasil” tetapi tidak lengkap lebih berbahaya daripada gagal terang-terangan.

Contoh buruk:

```text
Dear ,
Your application  has been approved.
```

Ini secara teknis terkirim, tetapi secara bisnis salah.

### 14.3 Error Classification

Saat membuat rendering service, jangan hanya melempar `RuntimeException` generik.

Klasifikasi:

| Error | Contoh | Dampak |
|---|---|---|
| TemplateNotFound | nama template salah | konfigurasi/deployment issue |
| TemplateParseError | syntax FTL invalid | template publish issue |
| TemplateModelError | field model hilang | contract mismatch |
| TemplateSecurityError | forbidden access | security incident/policy violation |
| TemplateRenderError | directive/runtime error | bug di template atau data |
| OutputWriteError | writer/network/file fail | infrastructure/output sink issue |

---

## 15. Shared Variables

`Configuration` dapat memiliki shared variables yang tersedia untuk semua template.

Contoh:

```java
cfg.setSharedVariable("appName", "ACEAS");
```

Template:

```ftl
${appName}
```

Shared variables bisa berguna untuk:

1. app metadata,
2. static constants,
3. reusable directives,
4. formatting helpers,
5. safe utility object.

Namun berbahaya jika dipakai sembarangan.

### 15.1 Risiko Shared Variables

Jika kamu set:

```java
cfg.setSharedVariable("securityService", securityService);
cfg.setSharedVariable("userRepository", userRepository);
cfg.setSharedVariable("applicationContext", springContext);
```

Maka template bisa menjadi execution surface yang terlalu kuat.

Risiko:

1. Template melakukan query.
2. Template memanggil service.
3. Template menjadi business logic layer.
4. Data leakage.
5. Hard-to-test output.
6. Security bypass.

Rule:

```text
Shared variable harus berupa value/helper yang aman, deterministic, dan tidak membuka akses ke infrastructure/service layer.
```

Lebih aman:

```java
cfg.setSharedVariable("format", new SafeFormattingMethods());
```

Daripada:

```java
cfg.setSharedVariable("userService", userService);
```

---

## 16. Custom Methods

FreeMarker memungkinkan Java method-like helper melalui `TemplateMethodModelEx`.

Contoh sederhana:

```java
import freemarker.template.TemplateMethodModelEx;
import freemarker.template.TemplateModelException;

import java.util.List;

public final class MaskEmailMethod implements TemplateMethodModelEx {

    @Override
    public Object exec(List arguments) throws TemplateModelException {
        if (arguments.size() != 1) {
            throw new TemplateModelException("maskEmail expects 1 argument");
        }

        String email = String.valueOf(arguments.get(0));
        int at = email.indexOf('@');
        if (at <= 1) {
            return "***";
        }

        return email.charAt(0) + "***" + email.substring(at);
    }
}
```

Register:

```java
cfg.setSharedVariable("maskEmail", new MaskEmailMethod());
```

Template:

```ftl
Recipient: ${maskEmail(user.email)}
```

### 16.1 Kapan Custom Method Layak?

Layak untuk:

1. formatting kecil,
2. masking deterministic,
3. conversion presentational,
4. lookup dari static table kecil,
5. safe helper yang tidak punya side effect.

Tidak layak untuk:

1. query database,
2. call remote service,
3. authorization decision utama,
4. business workflow,
5. mutation,
6. expensive computation.

Rule:

```text
Custom method harus pure atau mendekati pure.
Input sama -> output sama.
Tidak melakukan I/O.
Tidak mengubah state.
```

---

## 17. Custom Directives

Custom directive lebih powerful daripada custom method karena bisa mengontrol nested content dan output.

Contoh use case:

1. render permission block,
2. render repeated layout,
3. capture nested output,
4. conditional formatting,
5. domain-specific markup,
6. component-like behavior.

Contoh konseptual directive sederhana:

```java
import freemarker.core.Environment;
import freemarker.template.TemplateDirectiveBody;
import freemarker.template.TemplateDirectiveModel;
import freemarker.template.TemplateException;
import freemarker.template.TemplateModel;

import java.io.IOException;
import java.util.Map;

public final class UppercaseDirective implements TemplateDirectiveModel {

    @Override
    public void execute(
            Environment env,
            Map params,
            TemplateModel[] loopVars,
            TemplateDirectiveBody body
    ) throws TemplateException, IOException {
        if (body == null) {
            return;
        }

        java.io.StringWriter buffer = new java.io.StringWriter();
        body.render(buffer);
        env.getOut().write(buffer.toString().toUpperCase(java.util.Locale.ROOT));
    }
}
```

Register:

```java
cfg.setSharedVariable("upper", new UppercaseDirective());
```

Template:

```ftl
<@upper>
hello world
</@upper>
```

Output:

```text
HELLO WORLD
```

### 17.1 Directive Power dan Risiko

Directive bisa:

1. membaca environment,
2. menulis output,
3. membaca parameter,
4. mengevaluasi nested body,
5. melakukan logic kompleks.

Karena itu directive bisa menjadi mini framework di dalam template engine.

Risiko:

1. Directive menjadi terlalu pintar.
2. Template behavior sulit diprediksi.
3. Testing makin sulit.
4. Security bergantung pada directive implementation.
5. Performance bisa memburuk karena buffering nested body.

Rule:

```text
Custom directive harus punya kontrak sempit, dokumentasi jelas, test sendiri, dan tidak mengakses infrastructure sembarangan.
```

---

## 18. Macro dan Function: Reuse di Level Template

Macro dan function bukan fokus detail Part 3, tetapi perlu diposisikan dalam arsitektur.

Macro berada di template layer.

Contoh:

```ftl
<#macro button label href>
  <a class="btn" href="${href}">${label}</a>
</#macro>

<@button label="Open" href="/cases/123" />
```

Function menghasilkan value:

```ftl
<#function statusLabel status>
  <#if status == "APPROVED">
    <#return "Approved">
  <#elseif status == "REJECTED">
    <#return "Rejected">
  <#else>
    <#return "Unknown">
  </#if>
</#function>
```

### 18.1 Macro vs Custom Directive

| Aspek | Macro | Custom Directive |
|---|---|---|
| Ditulis di | FTL | Java |
| Cocok untuk | markup reuse | behavior reusable/controlled |
| Deployment | template deployment | application deployment |
| Test | render/golden test | unit + render test |
| Risiko | template complexity | Java extension complexity |
| Governance | template review | code review |

Rule praktis:

```text
Gunakan macro untuk presentational reuse.
Gunakan Java directive untuk behavior yang perlu type-safety, policy, atau integrasi runtime terbatas.
```

---

## 19. Namespace, Include, Import, dan Template Libraries

FreeMarker mendukung pemecahan template.

Jenis umum:

```ftl
<#include "fragments/header.ftl">
```

`include` memasukkan dan mengeksekusi template lain dalam konteks tertentu.

Untuk macro library:

```ftl
<#import "lib/forms.ftl" as forms>

<@forms.input name="email" label="Email" />
```

Mental model:

```text
include = compose output
import  = load reusable definitions under namespace
```

Production guideline:

1. Pakai `import` untuk macro library.
2. Pakai namespace agar tidak mencemari global scope.
3. Hindari include chain terlalu dalam.
4. Catat dependency antar template jika template editable/versioned.
5. Jangan membuat template library tanpa versioning jika dipakai banyak output penting.

---

## 20. Encoding, Writer, dan Output Boundary

FreeMarker menulis ke `Writer`, bukan langsung ke byte stream.

Artinya:

```text
FreeMarker menghasilkan character stream.
Encoding ke bytes biasanya terjadi di layer luar.
```

Contoh:

```java
StringWriter writer = new StringWriter();
template.process(model, writer);
String output = writer.toString();
```

Untuk file:

```java
try (Writer writer = Files.newBufferedWriter(path, StandardCharsets.UTF_8)) {
    template.process(model, writer);
}
```

Untuk HTTP response, framework biasanya menyediakan writer.

### 20.1 `StringWriter` vs Streaming Writer

`StringWriter` mudah, tetapi menyimpan seluruh output di memory.

Cocok untuk:

1. email body kecil,
2. template test,
3. preview,
4. output kecil/menengah.

Tidak ideal untuk:

1. file besar,
2. batch document generation besar,
3. large CSV/text generation,
4. output multi-MB per render.

Untuk output besar:

```java
try (Writer writer = new BufferedWriter(
        new OutputStreamWriter(outputStream, StandardCharsets.UTF_8))) {
    template.process(model, writer);
}
```

Prinsip:

```text
Jika output kecil dan perlu string: StringWriter OK.
Jika output besar: stream ke Writer yang buffered.
```

### 20.2 Encoding Policy

Set encoding eksplisit:

```java
cfg.setDefaultEncoding("UTF-8");
```

Dan pastikan output sink juga UTF-8:

```java
Files.newBufferedWriter(path, StandardCharsets.UTF_8)
```

Jangan mengandalkan platform default encoding.

Java 18 membuat default charset JDK menjadi UTF-8 melalui JEP 400, tetapi untuk Java 8–17 platform default masih bisa bervariasi. Karena seri ini menargetkan Java 8 sampai Java 25, rule-nya tetap:

```text
Selalu nyatakan encoding secara eksplisit.
```

---

## 21. Locale dan Timezone

FreeMarker dapat memakai locale untuk formatting.

```java
cfg.setLocale(Locale.US);
```

Per render, kamu juga bisa mengambil template berdasarkan locale:

```java
Template template = cfg.getTemplate("email/welcome.ftl", Locale.forLanguageTag("id-ID"));
```

Namun desain yang matang harus membedakan:

1. User locale.
2. Tenant locale.
3. System default locale.
4. Document/legal locale.
5. Timezone event.
6. Timezone user.
7. Timezone organization.

Untuk dokumen penting, jangan biarkan locale/timezone implicit.

Model render sebaiknya eksplisit:

```java
public record RenderContext(
        Locale locale,
        ZoneId zoneId,
        String templateVersion,
        String correlationId
) {
}
```

Lalu rendering service memakai konteks itu.

---

## 22. FreeMarker Thread-Safety Model

Pahami boundary thread-safety:

| Object | Thread-safety guideline |
|---|---|
| `Configuration` | Dikonfigurasi saat startup, lalu dipakai bersama. Jangan diubah dinamis sembarangan. |
| `Template` | Parsed template dapat digunakan ulang. |
| Data model | Per render; jangan shared mutable antar request. |
| `Writer` | Per render; jangan shared antar request. |
| Custom directives/methods | Jika registered shared, implementasinya harus thread-safe. |
| Shared variables | Jika mutable, harus thread-safe atau immutable. |

### 22.1 Anti-Pattern: Mutable Shared Helper

Buruk:

```java
public final class BadCounterMethod implements TemplateMethodModelEx {
    private int counter;

    @Override
    public Object exec(List arguments) {
        counter++;
        return counter;
    }
}
```

Jika diregister sebagai shared variable, ini race condition.

Lebih baik:

1. Hindari state.
2. Gunakan immutable helper.
3. Jika butuh state, state harus per render, bukan singleton shared.

### 22.2 Virtual Threads dan Rendering

Pada Java 21+, virtual threads dapat membantu workload yang blocking I/O, misalnya batch rendering yang menulis file atau memanggil storage. Tetapi FreeMarker rendering itu sendiri umumnya CPU + memory + writer I/O.

Prinsip:

```text
Virtual threads tidak membuat CPU-bound rendering menjadi lebih cepat.
Virtual threads bisa membantu orchestration banyak render yang blocking pada I/O.
```

Untuk batch rendering:

- Jika bottleneck CPU expression/rendering: batasi paralelisme sesuai CPU.
- Jika bottleneck I/O storage/email: virtual threads bisa berguna.
- Jika bottleneck template loader remote/database: caching/invalidation lebih penting.

---

## 23. FreeMarker dalam Java 8 sampai Java 25

FreeMarker biasa dipakai di aplikasi Java lintas versi. Namun desain kamu harus sadar perbedaan runtime.

### 23.1 Java 8

Karakteristik:

1. Banyak enterprise app masih Java 8.
2. `java.time` sudah ada, tetapi banyak legacy masih pakai `Date`/`Calendar`.
3. Tidak ada records.
4. Tidak ada compact immutable collection factory seperti `List.of`.
5. Tidak ada virtual threads.

Design implication:

- DTO biasa/class immutable manual.
- Gunakan `Collections.unmodifiableMap/List` jika perlu.
- Encoding eksplisit.
- Hati-hati dengan legacy date/time formatting.

### 23.2 Java 11/17

Karakteristik:

1. LTS modern enterprise baseline.
2. Banyak Spring Boot 2/3 migration.
3. Java 17 mendukung records.
4. Strong encapsulation module system makin relevan.

Design implication:

- Records cocok untuk view model immutable.
- Hindari reflection assumptions yang rapuh.
- Testing lebih mudah dengan modern APIs.

### 23.3 Java 21

Karakteristik:

1. Virtual threads stable.
2. Pattern matching makin matang.
3. Sequenced collections tersedia.

Design implication:

- Rendering batch bisa diorkestrasi dengan virtual threads jika I/O-bound.
- View model bisa dibuat lebih ringkas dan immutable.
- Structured concurrency dapat membantu pipeline render + store + send, tergantung versi dan policy.

### 23.4 Java 25

Java 25 adalah target modern dalam seri ini. Untuk template engine, hal penting bukan syntax Java terbaru, tetapi discipline runtime:

1. Explicit charset.
2. Immutable model.
3. Safe reflection/object exposure.
4. JFR profiling.
5. GC awareness.
6. Threading policy.
7. Strong encapsulation awareness.
8. Build/deployment reproducibility.

Rule lintas versi:

```text
Jangan mendesain template rendering bergantung pada accidental behavior runtime.
Buat konfigurasi explicit, model explicit, output explicit, dan security explicit.
```

---

## 24. Minimal FreeMarker Rendering Service

Mari buat contoh service kecil tetapi production-minded.

### 24.1 Interface

```java
public interface TemplateRenderer {
    String render(String templateName, Object model);
}
```

Ini terlalu sederhana. Lebih baik:

```java
import java.util.Locale;
import java.util.Map;

public interface TemplateRenderer {

    String renderToString(RenderRequest request);

    void renderToWriter(RenderRequest request, java.io.Writer writer);

    record RenderRequest(
            String templateName,
            Locale locale,
            Map<String, Object> model,
            String correlationId
    ) {
        public RenderRequest {
            if (templateName == null || templateName.isBlank()) {
                throw new IllegalArgumentException("templateName is required");
            }
            if (locale == null) {
                locale = Locale.ROOT;
            }
            if (model == null) {
                model = Map.of();
            }
        }
    }
}
```

Untuk Java 8, record diganti class final biasa.

### 24.2 Implementation

```java
import freemarker.template.Configuration;
import freemarker.template.Template;
import freemarker.template.TemplateException;

import java.io.IOException;
import java.io.StringWriter;
import java.io.Writer;

public final class FreeMarkerTemplateRenderer implements TemplateRenderer {

    private final Configuration configuration;

    public FreeMarkerTemplateRenderer(Configuration configuration) {
        if (configuration == null) {
            throw new IllegalArgumentException("configuration is required");
        }
        this.configuration = configuration;
    }

    @Override
    public String renderToString(RenderRequest request) {
        StringWriter writer = new StringWriter(4096);
        renderToWriter(request, writer);
        return writer.toString();
    }

    @Override
    public void renderToWriter(RenderRequest request, Writer writer) {
        if (request == null) {
            throw new IllegalArgumentException("request is required");
        }
        if (writer == null) {
            throw new IllegalArgumentException("writer is required");
        }

        try {
            Template template = configuration.getTemplate(
                    request.templateName(),
                    request.locale()
            );
            template.process(request.model(), writer);
        } catch (IOException e) {
            throw new TemplateRenderingException(
                    "Failed to load or write template: " + request.templateName(),
                    e
            );
        } catch (TemplateException e) {
            throw new TemplateRenderingException(
                    "Failed to render template: " + request.templateName(),
                    e
            );
        }
    }
}
```

Exception:

```java
public final class TemplateRenderingException extends RuntimeException {
    public TemplateRenderingException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

Untuk production lebih matang, exception harus diklasifikasikan lebih spesifik.

---

## 25. Production-Grade Configuration Example

Contoh untuk classpath template HTML/email:

```java
import freemarker.core.HTMLOutputFormat;
import freemarker.template.Configuration;
import freemarker.template.DefaultObjectWrapperBuilder;
import freemarker.template.TemplateExceptionHandler;

import java.nio.charset.StandardCharsets;
import java.time.ZoneId;
import java.util.Locale;

public final class ProductionFreeMarkerConfiguration {

    private ProductionFreeMarkerConfiguration() {
    }

    public static Configuration create() {
        Configuration cfg = new Configuration(Configuration.VERSION_2_3_34);

        cfg.setClassLoaderForTemplateLoading(
                ProductionFreeMarkerConfiguration.class.getClassLoader(),
                "templates"
        );

        cfg.setDefaultEncoding(StandardCharsets.UTF_8.name());
        cfg.setLocale(Locale.ROOT);
        cfg.setTimeZone(java.util.TimeZone.getTimeZone(ZoneId.of("UTC")));

        cfg.setTemplateExceptionHandler(TemplateExceptionHandler.RETHROW_HANDLER);
        cfg.setLogTemplateExceptions(false);
        cfg.setWrapUncheckedExceptions(true);
        cfg.setFallbackOnNullLoopVariable(false);

        cfg.setRecognizeStandardFileExtensions(true);
        cfg.setOutputFormat(HTMLOutputFormat.INSTANCE);

        DefaultObjectWrapperBuilder wrapperBuilder =
                new DefaultObjectWrapperBuilder(Configuration.VERSION_2_3_34);
        cfg.setObjectWrapper(wrapperBuilder.build());

        // Production: tune this based on deployment model.
        cfg.setTemplateUpdateDelayMilliseconds(60_000);

        return cfg;
    }
}
```

Catatan penting:

1. `Locale.ROOT` sebagai default mencegah locale machine menjadi implicit behavior.
2. UTC sebagai default timezone mencegah perbedaan antar server.
3. Per-render context tetap boleh override locale/timezone jika memang diperlukan.
4. `RETHROW_HANDLER` menjaga render failure tidak disembunyikan.
5. `recognizeStandardFileExtensions` membantu `.ftlh`/`.ftlx` behavior.
6. `setOutputFormat(HTMLOutputFormat.INSTANCE)` harus disesuaikan jika engine dipakai juga untuk plain text. Dalam sistem multi-output, lebih baik pisahkan konfigurasi per output type atau gunakan template extension/output format policy yang jelas.

---

## 26. Multi-Output Architecture: Jangan Satu Config untuk Semua Tanpa Policy

FreeMarker bisa menghasilkan HTML, text, XML, email, config, source code. Tetapi satu `Configuration` yang sama untuk semua output bisa membingungkan jika output format/escaping berbeda.

Contoh masalah:

```text
email-html/welcome.ftlh   needs HTML escaping
email-text/welcome.ftl    needs no HTML escaping
xml/feed.ftlx             needs XML escaping
generator/nginx.conf.ftl  needs plain text semantics
```

Pilihan desain:

### Option A — Satu Configuration, Extension-Based Policy

```text
.ftlh -> HTML
.ftlx -> XML
.ftl  -> configured/default/plain
```

Kelebihan:

- sederhana,
- cache terpusat,
- cocok jika disiplin extension kuat.

Kekurangan:

- kesalahan extension bisa fatal,
- mixed use lebih sulit diaudit,
- shared variable/helper bisa terlalu luas.

### Option B — Configuration per Output Family

```text
htmlFreeMarkerConfig
textFreeMarkerConfig
xmlFreeMarkerConfig
documentFreeMarkerConfig
```

Kelebihan:

- policy jelas,
- shared variables bisa berbeda,
- security boundary lebih tegas.

Kekurangan:

- setup lebih banyak,
- cache terpisah,
- butuh registry.

Untuk enterprise rendering platform, Option B sering lebih defensible.

---

## 27. Template Name as API

Template name sering dianggap detail internal:

```java
render("email/welcome.ftl", model)
```

Namun dalam sistem besar, template name menjadi API. Ia muncul di:

1. controller,
2. service,
3. batch job,
4. BPMN delegate,
5. notification service,
6. audit log,
7. admin UI,
8. test,
9. documentation.

Karena itu jangan biarkan nama template liar.

Pola lebih baik:

```java
public enum SystemTemplate {
    USER_WELCOME("email/user/welcome.ftlh"),
    PASSWORD_RESET("email/security/password-reset.ftlh"),
    CASE_APPROVAL_NOTICE("document/case/approval-notice.ftlh");

    private final String path;

    SystemTemplate(String path) {
        this.path = path;
    }

    public String path() {
        return path;
    }
}
```

Atau untuk platform dinamis:

```java
public record TemplateRef(
        String templateCode,
        String version,
        Locale locale,
        OutputKind outputKind
) {
}
```

Mental model:

```text
TemplateRef is a stable business reference.
Template path is an implementation detail.
```

---

## 28. FreeMarker dan Spring Boot

Spring Framework memiliki integrasi FreeMarker untuk Spring MVC. Namun kamu harus membedakan dua mode penggunaan:

### 28.1 FreeMarker sebagai MVC View Engine

Controller mengembalikan view name:

```java
@GetMapping("/hello")
public String hello(Model model) {
    model.addAttribute("name", "Fajar");
    return "hello";
}
```

FreeMarker view resolver mencari template dan render HTTP response.

Cocok untuk:

1. server-rendered pages,
2. admin portal sederhana,
3. internal tools,
4. transitional architecture.

### 28.2 FreeMarker sebagai Rendering Service

Service memanggil FreeMarker secara eksplisit:

```java
String html = renderer.renderToString(new RenderRequest(
        "email/welcome.ftlh",
        Locale.forLanguageTag("id-ID"),
        model,
        correlationId
));
```

Cocok untuk:

1. email,
2. PDF pre-render HTML,
3. generated XML/text,
4. batch output,
5. message-driven rendering,
6. workflow/case correspondence.

Keduanya bisa ada dalam aplikasi yang sama, tetapi sebaiknya konfigurasi dan policy tidak dicampur sembarangan.

---

## 29. FreeMarker dan Jakarta/Servlet Non-Spring

FreeMarker tidak bergantung pada Spring. Dalam aplikasi Jakarta Servlet biasa, kamu bisa:

1. Setup `Configuration` saat application startup.
2. Simpan di ServletContext atau dependency injection container.
3. Ambil template di servlet/controller.
4. Render ke response writer.

Contoh konseptual:

```java
protected void doGet(HttpServletRequest request, HttpServletResponse response)
        throws IOException {
    response.setContentType("text/html;charset=UTF-8");

    Template template = configuration.getTemplate("pages/home.ftlh", request.getLocale());

    Map<String, Object> model = Map.of(
            "title", "Home",
            "user", buildUserView(request)
    );

    try {
        template.process(model, response.getWriter());
    } catch (TemplateException e) {
        throw new ServletException(e);
    }
}
```

Tetap berlaku rule:

1. `Configuration` singleton.
2. Model per request.
3. Writer per response.
4. Escaping policy explicit.
5. Jangan expose request/session/security context mentah ke template.

---

## 30. Security Boundary FreeMarker

Security FreeMarker punya beberapa lapisan:

```text
┌────────────────────────────────────────┐
│ Template Trust                         │
│ - siapa boleh menulis template?         │
└────────────────────────────────────────┘
                 │
┌────────────────────────────────────────┐
│ Template Loading Policy                │
│ - dari mana template dimuat?            │
│ - bisa override? bisa upload?           │
└────────────────────────────────────────┘
                 │
┌────────────────────────────────────────┐
│ Object Exposure Policy                 │
│ - object apa terlihat di template?      │
│ - method apa bisa dipanggil?            │
└────────────────────────────────────────┘
                 │
┌────────────────────────────────────────┐
│ Output Escaping Policy                 │
│ - HTML/XML/JS/URL context               │
└────────────────────────────────────────┘
                 │
┌────────────────────────────────────────┐
│ Resource Usage Policy                  │
│ - loop besar, recursion, output size    │
└────────────────────────────────────────┘
                 │
┌────────────────────────────────────────┐
│ Audit and Observability                │
│ - siapa render apa, versi mana, gagal?  │
└────────────────────────────────────────┘
```

### 30.1 Trusted Templates vs Untrusted Templates

Jika template ditulis oleh developer dan direview di Git:

```text
Template trust level: high
```

Jika template diedit oleh admin internal non-developer:

```text
Template trust level: medium
```

Jika template bisa diinput customer/user eksternal:

```text
Template trust level: low/untrusted
```

Semakin rendah trust, semakin ketat:

1. loader,
2. object wrapper,
3. method exposure,
4. directive availability,
5. timeout/resource limit,
6. validation,
7. sandbox.

Rule keras:

```text
Jangan menjalankan user-submitted FreeMarker template dengan akses ke object aplikasi tanpa sandbox ketat.
```

### 30.2 Jangan Expose Service Layer

Buruk:

```java
model.put("caseService", caseService);
model.put("userRepository", userRepository);
model.put("securityContext", securityContext);
```

Template seharusnya bukan tempat memanggil service.

Benar:

```java
model.put("notice", noticeView);
model.put("recipient", recipientView);
model.put("renderedAt", renderedAtText);
```

### 30.3 UI Authorization vs Backend Authorization

Jika template menyembunyikan button:

```ftl
<#if canApprove>
  <button>Approve</button>
</#if>
```

Itu hanya rendering decision. Backend tetap wajib enforce authorization.

---

## 31. Observability untuk FreeMarker

Render failure sering sulit dilacak jika tidak ada metadata.

Minimal log context:

1. correlationId,
2. templateName,
3. templateVersion jika ada,
4. locale,
5. outputKind,
6. render duration,
7. failure category,
8. application version,
9. tenant/agency jika relevan,
10. model type/schema version, bukan full model sensitif.

Contoh conceptual log:

```text
render.failed correlationId=abc-123 template=case/approval-notice.ftlh version=2026.06.19-001 locale=en-SG output=HTML category=MODEL_MISSING_FIELD durationMs=18
```

Jangan log seluruh data model karena bisa berisi PII, secret, internal note, atau evidence sensitive.

### 31.1 Metrics

Metrics penting:

| Metric | Makna |
|---|---|
| `template.render.count` | jumlah render |
| `template.render.duration` | latency render |
| `template.render.failure.count` | jumlah gagal |
| `template.render.failure.byTemplate` | template bermasalah |
| `template.cache.hit` | efektivitas cache jika tersedia |
| `template.output.size` | ukuran output |
| `template.model.validation.failure` | mismatch model-template |

### 31.2 Tracing

Untuk sistem besar, rendering bisa menjadi span:

```text
HTTP request / batch job / message consumer
  └── build render model
       └── render template
            └── store/send output
```

Tracing membantu membedakan apakah lambat karena:

1. query data,
2. mapping model,
3. template rendering,
4. PDF conversion,
5. email send,
6. storage write.

---

## 32. Testing Arsitektur FreeMarker

Part testing khusus akan dibahas pada Part 25, tetapi untuk memahami arsitektur, minimal ada beberapa level test.

### 32.1 Configuration Test

Pastikan template bisa dimuat:

```java
Template template = cfg.getTemplate("email/welcome.ftlh");
assertNotNull(template);
```

### 32.2 Render Smoke Test

```java
Map<String, Object> model = Map.of(
        "user", Map.of("name", "Fajar")
);

StringWriter writer = new StringWriter();
template.process(model, writer);

assertTrue(writer.toString().contains("Fajar"));
```

### 32.3 Escaping Test

```java
Map<String, Object> model = Map.of(
        "comment", "<script>alert(1)</script>"
);
```

Expected output should not contain executable script.

### 32.4 Missing Field Test

Intentionally remove required field and verify render fails.

```text
If required field missing -> fail fast
```

### 32.5 Contract Test

Template expects:

```text
notice.caseId
notice.recipientName
notice.approvalDate
```

Renderer must provide exactly the required model contract.

---

## 33. Common Anti-Patterns

### 33.1 Creating `Configuration` per Request

Bad:

```java
public String render(Map<String, Object> model) {
    Configuration cfg = new Configuration(Configuration.VERSION_2_3_34);
    cfg.setClassLoaderForTemplateLoading(...);
    Template template = cfg.getTemplate("x.ftl");
    ...
}
```

Impact:

1. cache ineffective,
2. slow,
3. inconsistent config,
4. operationally messy.

### 33.2 Exposing Entity Directly

Bad:

```java
model.put("user", userEntity);
model.put("case", caseEntity);
```

Impact:

1. sensitive leakage,
2. lazy loading surprises,
3. fragile coupling,
4. template depends on domain internals.

### 33.3 Using Template as Business Logic Layer

Bad:

```ftl
<#if case.status == "A" && case.officer.level gt 3 && case.region == "EAST" && case.riskScore gt 80>
  Escalated
</#if>
```

Better:

```java
model.put("escalationLabel", escalationPolicy.resolveLabel(case));
```

Template:

```ftl
${escalationLabel}
```

### 33.4 No Explicit Encoding

Bad:

```java
new FileWriter(file)
```

Better:

```java
Files.newBufferedWriter(file, StandardCharsets.UTF_8)
```

### 33.5 Disabling Escaping Globally

Bad:

```java
cfg.setAutoEscapingPolicy(Configuration.DISABLE_AUTO_ESCAPING_POLICY);
```

Unless you have a very specific non-HTML output policy, this is dangerous.

### 33.6 Dynamic Templates Without Sandbox

Bad:

```java
loader.putTemplate("user-template", request.getParameter("template"));
template.process(fullApplicationModel, writer);
```

This is server-side template injection waiting to happen.

### 33.7 `StringWriter` for Huge Output

Bad for multi-MB/gigantic output:

```java
String output = renderHugeCsvToString();
```

Better stream to file/output stream.

### 33.8 Shared Mutable Helper

Bad:

```java
cfg.setSharedVariable("helper", new MutableNonThreadSafeHelper());
```

Shared helper must be immutable/thread-safe.

---

## 34. Production Checklist

Sebelum memakai FreeMarker di production, cek ini:

### 34.1 Configuration

- [ ] `Configuration` dibuat sebagai singleton/stable bean.
- [ ] Version/incompatible improvements dipilih eksplisit.
- [ ] Default encoding eksplisit UTF-8.
- [ ] Locale default eksplisit.
- [ ] Timezone default eksplisit.
- [ ] Exception handler production tidak membocorkan data.
- [ ] Template update delay sesuai environment.
- [ ] Output format/auto-escaping jelas.

### 34.2 Template Loading

- [ ] Loader sesuai deployment model.
- [ ] Template path tidak user-controlled secara bebas.
- [ ] File/database template punya governance.
- [ ] Multi-loader punya source tracing.
- [ ] Dynamic templates punya validation/sandbox.

### 34.3 Data Model

- [ ] Tidak expose entity/domain aggregate langsung.
- [ ] Tidak expose service/repository/application context.
- [ ] View model jelas dan immutable jika bisa.
- [ ] Sensitive fields tidak masuk model.
- [ ] Null/missing policy jelas.

### 34.4 Security

- [ ] Auto-escaping aktif untuk HTML/XML.
- [ ] Raw HTML/no-escape direview.
- [ ] Object wrapper tidak terlalu permissive.
- [ ] Custom methods/directives aman dan thread-safe.
- [ ] Template trust level didefinisikan.
- [ ] Untrusted templates tidak dijalankan tanpa sandbox.

### 34.5 Performance

- [ ] Template cache efektif.
- [ ] Tidak parse template per request.
- [ ] Output besar tidak memakai `StringWriter` tanpa alasan.
- [ ] Template tidak melakukan komputasi berat.
- [ ] Loader remote/database punya cache strategy.
- [ ] Render latency dimonitor.

### 34.6 Operations

- [ ] Render failure diklasifikasikan.
- [ ] Log tidak membocorkan full model.
- [ ] Metrics render tersedia.
- [ ] Template version/source tercatat untuk artifact penting.
- [ ] CI punya render smoke/golden tests.

---

## 35. Mental Model Ringkas

Jika harus diringkas:

```text
FreeMarker runtime = Configuration + TemplateLoader + TemplateCache + ObjectWrapper + TemplateModel + FTL evaluator + OutputFormat + Writer.
```

Lebih penting lagi:

```text
FreeMarker bukan hanya syntax.
FreeMarker adalah execution environment.
```

Karena itu engineer top-level harus bertanya:

1. Siapa yang menulis template?
2. Dari mana template dimuat?
3. Kapan template berubah?
4. Versi template apa yang digunakan?
5. Data apa yang terlihat template?
6. Method apa yang bisa dipanggil template?
7. Output format apa yang dihasilkan?
8. Apakah escaping otomatis aktif?
9. Apa yang terjadi jika field hilang?
10. Bagaimana render failure dilacak?
11. Bagaimana output direproduksi nanti?
12. Apakah render deterministik?
13. Apakah template bisa menyentuh service/infrastructure?
14. Apakah rendering bisa menjadi attack surface?
15. Apakah template cache sesuai deployment model?

Jika pertanyaan-pertanyaan itu bisa dijawab, kamu tidak hanya “bisa FreeMarker”, tetapi mulai memahami FreeMarker sebagai production rendering subsystem.

---

## 36. Preview Part Berikutnya

Part berikutnya akan masuk ke bahasa FreeMarker itu sendiri:

```text
Part 4 — FreeMarker Template Language Deep Dive I: Values, Expressions, Interpolation
```

Di Part 4 kita akan membahas:

1. scalar,
2. number,
3. boolean,
4. date/time,
5. sequence,
6. hash,
7. missing value,
8. interpolation,
9. dot access vs bracket access,
10. operators,
11. built-ins,
12. JavaBean property access,
13. method exposure,
14. formatting,
15. dan batas sehat antara expression logic dan Java logic.

---

# Status Seri

```text
Part 3 selesai.
Seri belum selesai.
Berikutnya: Part 4 — FreeMarker Template Language Deep Dive I: Values, Expressions, Interpolation.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-002.md">⬅️ Part 2 — Core Rendering Model: Template + Data Model = Output</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-004.md">Part 4 — FreeMarker Template Language Deep Dive I: Values, Expressions, Interpolation ➡️</a>
</div>
