# learn-java-template-freemarker-thymeleaf-rendering-engineering-part-006

# Part 6 — FreeMarker Macros, Functions, Custom Directives, and Reusable Template APIs

> Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`  
> Bagian: `006 / 034`  
> Topik utama: FreeMarker macro system, function, nested content, namespace, custom Java directive, custom Java method, reusable template API design  
> Target: Java 8 sampai Java 25  
> Status: Lanjutan dari Part 5. Seri belum selesai.

---

## 0. Tujuan Pembelajaran

Pada bagian sebelumnya kita sudah membahas directive, conditional, loop, include, import, dan scope. Bagian ini naik satu tingkat: bagaimana membangun **abstraksi reusable** di dalam FreeMarker.

Setelah menyelesaikan bagian ini, tujuan utamanya bukan hanya bisa menulis:

```ftl
<@button label="Save" />
```

atau:

```ftl
${formatCurrency(invoice.total)}
```

Tetapi memahami desain di baliknya:

1. Kapan logic cukup menjadi **macro**.
2. Kapan harus menjadi **function**.
3. Kapan harus pindah ke **Java custom directive**.
4. Kapan harus pindah ke **Java custom method**.
5. Bagaimana mendesain reusable template API yang stabil.
6. Bagaimana mencegah macro library berubah menjadi framework liar.
7. Bagaimana membuat template tetap readable, secure, testable, dan governable.
8. Bagaimana membangun component library untuk HTML/email/document rendering.

Mental model terpenting:

> Macro dan directive bukan sekadar fitur sintaks. Mereka adalah cara membuat **template-level API**.

Begitu sebuah macro dipakai oleh banyak template, macro itu bukan lagi “potongan HTML”. Ia menjadi kontrak. Kontrak itu harus punya desain, naming, compatibility, error handling, security boundary, dan lifecycle.

---

## 1. Posisi Macro, Function, dan Custom Directive dalam FreeMarker

FreeMarker punya beberapa level reuse:

| Level | Lokasi implementasi | Dipanggil dari template sebagai | Cocok untuk |
|---|---|---|---|
| `#include` | FTL template | memasukkan output template lain | fragment statis atau semi-dinamis sederhana |
| `#import` + macro | FTL template | `<@lib.component ... />` | reusable UI/email/document component |
| FTL function | FTL template | `${lib.formatX(...)}` | kalkulasi/pemformatan ringan yang menghasilkan value |
| Java method model | Java | `${slugify(title)}` | helper yang butuh Java, library, validasi, atau type handling |
| Java directive model | Java | `<@securePanel ...>...</@securePanel>` | kontrol rendering kompleks, nested body, streaming output, security wrapper |
| ObjectWrapper / TemplateModel | Java | akses object sebagai FTL type | kontrol cara Java object terlihat oleh template |

Pemisahan ini penting karena setiap level punya konsekuensi:

- macro mudah dibuat, tetapi mudah juga tumbuh liar;
- function mudah dipakai, tetapi bisa mendorong logic bisnis masuk template;
- Java directive powerful, tetapi menambah coupling engine-level;
- custom method reusable, tetapi bisa membuka attack surface kalau helper terlalu luas;
- object wrapper paling fundamental, tetapi paling sensitif terhadap security dan maintainability.

Rule awal:

> Gunakan abstraksi paling sederhana yang cukup, tetapi jangan biarkan abstraksi template menjadi tempat business decision.

---

## 2. Macro sebagai Template-Level Component

Macro adalah mekanisme untuk mendefinisikan reusable directive di FTL.

Contoh paling dasar:

```ftl
<#macro badge text type="info">
  <span class="badge badge-${type}">${text}</span>
</#macro>

<@badge text="Approved" type="success" />
```

Macro di atas melakukan tiga hal:

1. menerima parameter;
2. menghasilkan output;
3. menyembunyikan struktur HTML internal.

Secara mental model, macro mirip function, tetapi orientasinya **output**, bukan value.

Macro cocok untuk:

- HTML component;
- email block;
- table row;
- reusable alert;
- document section;
- legal footer;
- notification layout;
- repeated XML fragment;
- field rendering;
- error rendering;
- small presentation pattern.

Macro tidak cocok untuk:

- query database;
- memanggil service;
- authorization final;
- workflow decision;
- heavy calculation;
- mutasi state aplikasi;
- mapping entity ke DTO;
- decision yang harus diaudit sebagai business rule.

---

## 3. Macro vs Function: Perbedaan yang Sering Diremehkan

Perbedaan utama:

| Aspek | Macro | Function |
|---|---|---|
| Bentuk panggilan | `<@name ... />` | `${name(...)}` atau dipakai dalam expression |
| Orientasi | menghasilkan output | menghasilkan value |
| Cocok untuk | component/block/fragment | transformasi ringan |
| Bisa punya nested body | ya | tidak dalam pola normal |
| Dipakai di expression | tidak | ya |
| Risiko abuse | template component terlalu pintar | business calculation masuk template |

Contoh macro:

```ftl
<#macro alert type title>
  <div class="alert alert-${type}">
    <strong>${title}</strong>
    <#nested>
  </div>
</#macro>

<@alert type="warning" title="Pending Review">
  This case requires supervisor approval.
</@alert>
```

Contoh function:

```ftl
<#function severityClass severity>
  <#switch severity>
    <#case "HIGH"><#return "danger">
    <#case "MEDIUM"><#return "warning">
    <#default><#return "info">
  </#switch>
</#function>

<span class="badge badge-${severityClass(case.severity)}">
  ${case.severity}
</span>
```

Tetapi contoh function di atas perlu hati-hati. Kalau mapping `HIGH -> danger` adalah purely visual, boleh. Kalau mapping itu punya makna bisnis, seharusnya dilakukan di Java view model:

```java
public final class CaseViewModel {
    private final String severityLabel;
    private final String severityCssClass;
}
```

Lalu template hanya memakai:

```ftl
<span class="badge badge-${case.severityCssClass}">${case.severityLabel}</span>
```

Top 1% engineer tidak bertanya “bisa ditulis di template atau tidak?”, tetapi:

> Siapa pemilik logic ini? Apakah logic ini presentation-only, atau business/domain rule?

---

## 4. Parameter Macro: Positional, Named, Default, dan Contract Clarity

FreeMarker macro mendukung parameter.

```ftl
<#macro button label type="button" variant="primary" disabled=false>
  <button type="${type}" class="btn btn-${variant}" <#if disabled>disabled</#if>>
    ${label}
  </button>
</#macro>
```

Panggilan:

```ftl
<@button label="Save" />
<@button label="Delete" variant="danger" />
<@button label="Continue" disabled=true />
```

Gunakan named argument untuk macro publik.

Buruk:

```ftl
<@button "Save" "submit" "primary" false />
```

Lebih baik:

```ftl
<@button label="Save" type="submit" variant="primary" disabled=false />
```

Alasannya:

1. Lebih readable.
2. Lebih tahan perubahan urutan parameter.
3. Lebih jelas untuk template reviewer.
4. Lebih mudah di-grep.
5. Lebih aman saat macro punya banyak opsi.

Rule:

> Macro yang dipakai lintas banyak template harus dianggap seperti public API. Named argument adalah dokumentasi inline.

---

## 5. Default Parameter: Useful, tetapi Bisa Menyembunyikan Bug

Default parameter membuat macro nyaman:

```ftl
<#macro statusBadge label variant="secondary">
  <span class="badge badge-${variant}">${label}</span>
</#macro>
```

Tetapi default value juga bisa berbahaya kalau menyembunyikan missing data:

```ftl
<#macro userName name="Unknown">
  ${name}
</#macro>
```

Kalau `name` wajib, jangan default-kan ke `Unknown` tanpa alasan jelas. Lebih baik fail-fast atau pakai explicit fallback dari caller.

Buruk:

```ftl
<@userName name=user.fullName!"Unknown" />
```

Lebih baik jika memang business fallback:

```java
UserViewModel user = new UserViewModel(displayName);
```

```ftl
<@userName name=user.displayName />
```

Untuk rendering legal/email/regulatory, fallback diam-diam bisa fatal. Misalnya surat resmi menghasilkan:

```text
Dear Unknown,
```

Lebih baik render gagal saat data wajib hilang daripada output salah terkirim.

---

## 6. Nested Content dengan `#nested`

Macro menjadi sangat powerful saat menerima body.

```ftl
<#macro panel title>
  <section class="panel">
    <header class="panel__header">
      <h2>${title}</h2>
    </header>
    <div class="panel__body">
      <#nested>
    </div>
  </section>
</#macro>

<@panel title="Application Details">
  <p>Reference No: ${application.referenceNo}</p>
  <p>Status: ${application.statusLabel}</p>
</@panel>
```

Maknanya:

- macro mengontrol shell/structure;
- caller mengisi content;
- composition tetap explicit.

Ini mirip slot/component composition di UI framework, tetapi tetap server-side dan template-level.

Nested content cocok untuk:

- layout shell;
- card/panel/modal;
- email section;
- document clause wrapper;
- table wrapper;
- conditional container;
- security/visibility wrapper;
- typography block.

---

## 7. Nested Content dengan Parameter Balik ke Caller

Macro bisa memberi loop variable ke nested body.

Contoh konseptual:

```ftl
<#macro repeat count>
  <#list 1..count as i>
    <#nested i>
  </#list>
</#macro>

<@repeat count=3 ; index>
  <p>Item ${index}</p>
</@repeat>
```

Output:

```html
<p>Item 1</p>
<p>Item 2</p>
<p>Item 3</p>
```

Pattern ini powerful untuk component yang mengontrol iteration tetapi memberi caller akses ke item/context.

Contoh lebih realistis:

```ftl
<#macro dataTable rows>
  <table class="table">
    <thead>
      <tr>
        <#nested "header" rows?size>
      </tr>
    </thead>
    <tbody>
      <#list rows as row>
        <tr>
          <#nested "row" row>
        </tr>
      </#list>
    </tbody>
  </table>
</#macro>

<@dataTable rows=cases ; section, value>
  <#if section == "header">
    <th>Reference</th>
    <th>Status</th>
  <#elseif section == "row">
    <td>${value.referenceNo}</td>
    <td>${value.statusLabel}</td>
  </#if>
</@dataTable>
```

Namun pattern ini harus digunakan hati-hati. Kalau nested callback terlalu kompleks, readability turun.

Rule:

> Nested parameter cocok untuk library internal yang matang, bukan untuk semua component kecil.

---

## 8. Macro Scope: Parameter, Local, Global, dan Namespace

Macro punya scope. Ini penting untuk mencegah bug halus.

Contoh:

```ftl
<#assign label = "Outer">

<#macro demo label>
  <#local normalized = label?upper_case>
  ${normalized}
</#macro>

<@demo label="Inner" />
```

Di sini:

- parameter `label` hanya berlaku di macro;
- `normalized` local ke macro;
- `label` luar tidak berubah.

Jangan menggunakan `#global` dari macro kecuali benar-benar sadar efeknya.

Buruk:

```ftl
<#macro setPageTitle title>
  <#global pageTitle = title>
</#macro>
```

Ini membuat macro punya side effect global. Kadang berguna untuk layout lama, tetapi secara desain lebih rapuh.

Lebih baik:

```ftl
<@layout.page title="Dashboard">
  ...
</@layout.page>
```

Dengan begitu title menjadi parameter, bukan mutable global state.

---

## 9. Namespace dan `#import`: Macro Library yang Sehat

Macro library biasanya dibuat dalam file `.ftl` lalu di-import.

Misalnya:

```text
/templates/lib/ui.ftl
/templates/lib/email.ftl
/templates/lib/document.ftl
```

Isi `ui.ftl`:

```ftl
<#macro badge label variant="secondary">
  <span class="badge badge-${variant}">${label}</span>
</#macro>

<#macro button label type="button" variant="primary">
  <button type="${type}" class="btn btn-${variant}">${label}</button>
</#macro>
```

Pemakaian:

```ftl
<#import "/lib/ui.ftl" as ui>

<@ui.badge label="Approved" variant="success" />
<@ui.button label="Submit" type="submit" />
```

Namespace memberi beberapa keuntungan:

1. Menghindari bentrok nama.
2. Membuat asal component jelas.
3. Memudahkan evolusi library.
4. Memudahkan review.
5. Membuat template API eksplisit.

Buruk:

```ftl
<#include "/lib/ui.ftl">
<@badge label="Approved" />
```

Masalahnya asal `badge` tidak jelas dan bisa bentrok.

Lebih baik:

```ftl
<#import "/lib/ui.ftl" as ui>
<@ui.badge label="Approved" />
```

Rule:

> Untuk library reusable, lebih pilih `#import` daripada `#include`.

---

## 10. Include vs Import vs Macro: Decision Rule

| Kebutuhan | Gunakan |
|---|---|
| Memasukkan fragment output sederhana | `#include` |
| Menggunakan kumpulan macro/function reusable | `#import` |
| Membuat reusable output component | `#macro` |
| Membuat reusable value calculation | `#function` |
| Membuat helper yang butuh Java library/type/validasi | Java method model |
| Membuat directive dengan nested body dan kontrol output dari Java | Java directive model |

Contoh penggunaan `#include` yang sehat:

```ftl
<#include "/partials/legal-footer.ftl">
```

Karena legal footer mungkin memang fixed output.

Contoh penggunaan `#import` yang sehat:

```ftl
<#import "/lib/email-components.ftl" as email>

<@email.header brand=brand />
<@email.section title="Case Update">
  ...
</@email.section>
<@email.footer contact=contact />
```

---

## 11. Macro Library sebagai Public API

Begitu macro dipakai banyak template, perubahan kecil bisa berdampak luas.

Contoh macro:

```ftl
<#macro addressBlock address>
  <div class="address">
    <div>${address.line1}</div>
    <#if address.line2??><div>${address.line2}</div></#if>
    <div>${address.postalCode}</div>
  </div>
</#macro>
```

Jika suatu hari parameter berubah dari `address` menjadi `recipientAddress`, semua caller rusak.

Karena itu macro publik perlu prinsip API:

1. Nama stabil.
2. Parameter stabil.
3. Default value jelas.
4. Backward compatibility dijaga.
5. Breaking change diberi versi baru.
6. Behavior terdokumentasi.
7. Missing input policy jelas.
8. Output format jelas.
9. Escaping policy jelas.
10. Test snapshot tersedia.

Contoh versi:

```text
/lib/ui/v1.ftl
/lib/ui/v2.ftl
/lib/email/v1.ftl
/lib/document/v1.ftl
```

Atau:

```ftl
<#import "/lib/ui-1.0.ftl" as ui>
<#import "/lib/ui-2.0.ftl" as ui2>
```

Jangan versioning berlebihan untuk template kecil. Tetapi untuk correspondence platform, regulated letters, atau multi-tenant template system, versioning menjadi penting.

---

## 12. Function di FreeMarker

Function menghasilkan value.

```ftl
<#function initials fullName>
  <#local parts = fullName?split(" ")>
  <#local result = "">
  <#list parts as part>
    <#if part?has_content>
      <#local result = result + part[0]?upper_case>
    </#if>
  </#list>
  <#return result>
</#function>

${initials("Fajar Abdi Nugraha")}
```

Function cocok untuk:

- presentation-only transformation;
- memilih CSS class berdasarkan visual state;
- format label ringan;
- string helper ringan;
- small reusable expression.

Function tidak cocok untuk:

- hitung invoice total;
- hitung SLA business deadline;
- cek eligibility;
- menentukan workflow state;
- mengambil permission final;
- memanggil service;
- parsing kompleks;
- validasi domain.

Rule:

> Kalau function perlu test bisnis serius, pindahkan ke Java/domain/application layer.

---

## 13. Function vs Precomputed ViewModel

Misalnya ingin menampilkan jumlah hari tersisa:

```ftl
${daysBetween(.now, case.dueDate)} days left
```

Ini terlihat praktis, tetapi bermasalah:

1. `.now` membuat output tidak deterministik.
2. Timezone bisa ambigu.
3. Definisi “hari tersisa” bisa business-specific.
4. Test snapshot menjadi rapuh.
5. Audit ulang output menjadi sulit.

Lebih baik:

```java
public final class CaseDeadlineViewModel {
    private final String dueDateLabel;
    private final int daysRemaining;
    private final String urgencyCssClass;
}
```

Template:

```ftl
<span class="deadline ${deadline.urgencyCssClass}">
  ${deadline.dueDateLabel} (${deadline.daysRemaining} days left)
</span>
```

Untuk top 1% engineering, template function bukan tempat “pintar”. Yang pintar adalah desain boundary-nya.

---

## 14. Macro Composition Pattern

Macro bisa disusun dari macro lain.

```ftl
<#macro field label error="">
  <div class="form-field <#if error?has_content>form-field--error</#if>">
    <label>${label}</label>
    <#nested>
    <#if error?has_content>
      <div class="form-error">${error}</div>
    </#if>
  </div>
</#macro>

<#macro textInput name value="" label error="">
  <@field label=label error=error>
    <input type="text" name="${name}" value="${value}" />
  </@field>
</#macro>
```

Pemakaian:

```ftl
<@textInput
  name="applicantName"
  label="Applicant Name"
  value=form.applicantName
  error=form.errors.applicantName!""
/>
```

Composition membuat konsistensi UI. Tetapi ada bahaya:

- terlalu banyak layer macro;
- output HTML sulit dipahami;
- debug line error makin sulit;
- component terlalu generik;
- parameter explosion.

Rule:

> Macro composition harus mengurangi cognitive load, bukan menyembunyikan output sampai tidak bisa direview.

---

## 15. Parameter Explosion dan Cara Menghindarinya

Buruk:

```ftl
<#macro button label type variant size icon disabled loading block href target confirmText tooltip analyticsId permission>
  ...
</#macro>
```

Ini tanda macro mulai menjadi framework.

Alternatif:

### 15.1 Pecah menjadi macro lebih spesifik

```ftl
<@ui.primaryButton label="Save" />
<@ui.dangerButton label="Delete" />
<@ui.linkButton label="Open" href=url />
```

### 15.2 Gunakan option hash dengan hati-hati

```ftl
<@ui.button label="Save" options={
  "variant": "primary",
  "size": "sm",
  "loading": false
} />
```

Kelebihan option hash:

- caller lebih fleksibel;
- parameter macro tidak terlalu panjang.

Kekurangan:

- kontrak kurang eksplisit;
- typo sulit terdeteksi;
- documentation lebih penting;
- defaulting makin kompleks.

### 15.3 Pindahkan variasi ke ViewModel

```java
ButtonViewModel saveButton = ButtonViewModel.primarySubmit("Save");
```

```ftl
<@ui.button model=saveButton />
```

Ini cocok jika button muncul dari state/workflow/action model.

---

## 16. Macro Naming: Jangan Remehkan Nama

Nama macro adalah API.

Buruk:

```ftl
<#macro render thing>
<#macro box x>
<#macro row data>
<#macro component model>
```

Lebih baik:

```ftl
<#macro statusBadge status>
<#macro correspondenceFooter contact>
<#macro caseSummaryCard case>
<#macro validationErrorList errors>
<#macro documentSignatureBlock signatory>
```

Naming guideline:

1. Gunakan domain output, bukan implementasi internal.
2. Hindari nama terlalu generik.
3. Bedakan HTML/email/document macro.
4. Konsisten dengan design system.
5. Gunakan suffix bila membantu: `Badge`, `Card`, `Section`, `Block`, `Table`, `Row`, `Field`.
6. Jangan encode framework detail di nama.

Contoh struktur:

```text
/lib/html/form.ftl
/lib/html/table.ftl
/lib/email/layout.ftl
/lib/email/components.ftl
/lib/document/legal.ftl
/lib/document/signature.ftl
```

---

## 17. Macro Documentation

Macro publik butuh dokumentasi minimal.

Contoh di FTL:

```ftl
<#--
  Renders a status badge for case/application status.

  Parameters:
  - label: required, already localized display label
  - variant: optional, visual variant: success | warning | danger | info | secondary

  Escaping:
  - label is escaped by current output format
  - variant must come from trusted ViewModel, not user input

  Example:
  <@ui.statusBadge label=case.statusLabel variant=case.statusVariant />
-->
<#macro statusBadge label variant="secondary">
  <span class="badge badge-${variant}">${label}</span>
</#macro>
```

Dokumentasi bukan formalitas. Ia menjawab:

- parameter mana required;
- siapa yang menyiapkan value;
- value boleh dari user input atau tidak;
- escaping policy;
- contoh penggunaan;
- compatibility notes;
- expected output.

Untuk library besar, lebih baik generate katalog macro dari convention atau tulis manual reference.

---

## 18. Escaping dalam Macro: Jangan Merusak Boundary

Macro harus menghormati output format dan auto-escaping.

Contoh:

```ftl
<#macro alert title message>
  <div class="alert">
    <strong>${title}</strong>
    <p>${message}</p>
  </div>
</#macro>
```

Jika auto-escaping aktif untuk HTML, `title` dan `message` akan aman untuk text node.

Bahaya:

```ftl
<#macro alert title htmlMessage>
  <div class="alert">
    <strong>${title}</strong>
    <p>${htmlMessage?no_esc}</p>
  </div>
</#macro>
```

`?no_esc` harus dianggap sangat berbahaya. Kalau macro menerima HTML trusted, namanya harus jelas:

```ftl
<#macro richTextBlock trustedHtml>
  <div class="rich-text">
    ${trustedHtml?no_esc}
  </div>
</#macro>
```

Tetapi lebih baik input `trustedHtml` berasal dari sanitization pipeline di Java, bukan raw user input.

Guideline:

1. Macro default harus escaped.
2. Jangan menerima raw HTML kecuali explicit.
3. Nama parameter harus menunjukkan trust level: `trustedHtml`, bukan `content`.
4. Jangan pakai `?no_esc` sebagai shortcut layout.
5. Jangan escape dua kali.
6. Jangan memasukkan untrusted value ke class/style/script tanpa validasi konteks.

---

## 19. Attribute Context Problem

Text node berbeda dari attribute.

```ftl
<a href="${url}">${label}</a>
```

Meskipun HTML escaping aktif, URL punya aturan security sendiri. Value seperti `javascript:alert(1)` bisa tetap berbahaya kalau tidak divalidasi.

Macro link yang lebih sehat:

```ftl
<#macro safeLink href label external=false>
  <a href="${href}" <#if external>target="_blank" rel="noopener noreferrer"</#if>>
    ${label}
  </a>
</#macro>
```

Tetapi validasi `href` sebaiknya di Java:

```java
public final class LinkViewModel {
    private final String href;       // already validated relative or allowed absolute URL
    private final String label;
    private final boolean external;
}
```

```ftl
<@ui.safeLink href=link.href label=link.label external=link.external />
```

Macro tidak boleh menjadi tempat utama URL allowlist. Macro hanya boundary presentation.

---

## 20. Java Custom Method: Ketika FTL Function Tidak Cukup

FreeMarker memungkinkan aplikasi menyediakan method object yang bisa dipanggil dari template.

Konsepnya:

```ftl
${slugify(article.title)}
${maskNric(person.idNo)}
${formatPostalAddress(address)}
```

Di Java, custom method biasanya diimplementasikan menggunakan `TemplateMethodModelEx` agar argumen bisa berupa model FreeMarker, bukan hanya string.

Contoh sederhana:

```java
import freemarker.template.TemplateMethodModelEx;
import freemarker.template.TemplateModelException;

import java.util.List;
import java.util.Locale;

public final class SlugifyMethod implements TemplateMethodModelEx {
    @Override
    public Object exec(List arguments) throws TemplateModelException {
        if (arguments.size() != 1) {
            throw new TemplateModelException("slugify expects exactly 1 argument");
        }

        String input = String.valueOf(arguments.get(0));
        return input
                .toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("(^-|-$)", "");
    }
}
```

Registration:

```java
Configuration cfg = new Configuration(Configuration.VERSION_2_3_34);
cfg.setSharedVariable("slugify", new SlugifyMethod());
```

Template:

```ftl
${slugify("Hello FreeMarker World")}
```

Namun contoh di atas disederhanakan. Di production, argumen `TemplateModel` perlu di-unwrapper dengan benar, terutama jika ingin mendukung string/number/date/list/hash secara aman.

---

## 21. Custom Method Design Rules

Custom method harus kecil dan deterministic.

Cocok:

- `slugify(text)`;
- `maskIdentifier(text)`;
- `formatFileSize(bytes)`;
- `normalizeCssClass(text)`;
- `toJsonForInlineScript(value)` dengan escaping kuat;
- `formatAddress(addressViewModel)` jika purely presentation.

Tidak cocok:

- `getUserFromDatabase(id)`;
- `checkPermission(action)` sebagai final authority;
- `sendEmail(...)`;
- `createAuditTrail(...)`;
- `calculatePenalty(case)`;
- `callApi(...)`;
- `loadAttachment(...)`.

Rule:

> Custom method boleh membantu rendering, tetapi tidak boleh mengubah dunia.

Custom method sebaiknya:

1. Pure function.
2. Deterministic.
3. Tidak melakukan I/O.
4. Tidak mutate state.
5. Tidak membaca request/session secara diam-diam.
6. Validasi jumlah argumen.
7. Validasi tipe argumen.
8. Punya error message jelas.
9. Punya unit test.
10. Tidak mengekspos object internal.

---

## 22. Java Custom Directive: Ketika Macro Tidak Cukup

Custom directive adalah directive yang diimplementasikan di Java.

FreeMarker API `TemplateDirectiveModel` memungkinkan directive:

- menerima parameter;
- menulis output;
- memanggil nested body;
- memanggil nested body lebih dari sekali;
- memberi loop variable;
- mengakses environment rendering.

Template:

```ftl
<@uppercase>
  hello world
</@uppercase>
```

Java directive konseptual:

```java
import freemarker.core.Environment;
import freemarker.template.TemplateDirectiveBody;
import freemarker.template.TemplateDirectiveModel;
import freemarker.template.TemplateException;
import freemarker.template.TemplateModel;
import freemarker.template.TemplateModelException;

import java.io.IOException;
import java.io.StringWriter;
import java.util.Map;

public final class UppercaseDirective implements TemplateDirectiveModel {
    @Override
    public void execute(
            Environment env,
            Map params,
            TemplateModel[] loopVars,
            TemplateDirectiveBody body
    ) throws TemplateException, IOException {
        if (!params.isEmpty()) {
            throw new TemplateModelException("uppercase does not accept parameters");
        }
        if (body == null) {
            return;
        }

        StringWriter writer = new StringWriter();
        body.render(writer);
        env.getOut().write(writer.toString().toUpperCase(java.util.Locale.ROOT));
    }
}
```

Registration:

```java
cfg.setSharedVariable("uppercase", new UppercaseDirective());
```

Template:

```ftl
<@uppercase>Hello</@uppercase>
```

Output:

```text
HELLO
```

Custom directive lebih powerful daripada macro, tetapi power ini harus dibayar dengan complexity.

---

## 23. Custom Directive Use Cases yang Masuk Akal

Custom directive cocok saat membutuhkan:

### 23.1 Streaming output control

Misalnya directive menulis output besar tanpa membangun string besar di memory.

### 23.2 Integration dengan sanitization library

```ftl
<@sanitizeHtml policy="richText">
  ${content?no_esc}
</@sanitizeHtml>
```

Namun desain ini harus hati-hati karena body raw HTML bisa berbahaya.

### 23.3 Authorization display wrapper

```ftl
<@can action="CASE_APPROVE" resource=casePermissionView>
  <button>Approve</button>
</@can>
```

Tetapi ini hanya UI visibility. Backend tetap wajib enforce authorization.

### 23.4 Feature flag / tenant flag wrapper

```ftl
<@feature name="newCorrespondenceLayout">
  ...
</@feature>
```

### 23.5 Repeated rendering dengan loop variable

```ftl
<@paginate page=casePage ; item>
  <li>${item.referenceNo}</li>
</@paginate>
```

### 23.6 Domain-specific output policy

Misalnya directive untuk redaction:

```ftl
<@redact level="MASKED">${person.identifier}</@redact>
```

Tetapi redaction final idealnya dilakukan di ViewModel juga. Directive bisa menjadi defense-in-depth.

---

## 24. Custom Directive yang Sebaiknya Dihindari

Hindari custom directive yang:

1. Melakukan database access.
2. Memanggil HTTP API.
3. Membaca file dinamis sembarang.
4. Mengirim email.
5. Membuat audit trail final.
6. Mengubah session.
7. Mengubah security context.
8. Menghasilkan output non-deterministik tanpa input jelas.
9. Menangkap semua exception dan diam.
10. Mengakses service locator global.
11. Mengeksekusi template path dari user input tanpa validasi.
12. Mengimplementasikan business workflow.

Buruk:

```ftl
<@loadCase id=request.caseId ; case>
  ${case.referenceNo}
</@loadCase>
```

Ini membuat template melakukan data loading. Akibatnya:

- sulit dites;
- N+1 query;
- security kabur;
- transaction boundary kabur;
- rendering menjadi unpredictable;
- template author bisa memicu beban backend.

---

## 25. Macro vs Java Directive: Decision Framework

| Pertanyaan | Jika ya | Pilihan |
|---|---|---|
| Output bisa dibuat murni FTL? | ya | macro |
| Butuh nested body? | ya | macro atau directive |
| Butuh Java library khusus? | ya | custom method/directive |
| Butuh streaming output besar? | ya | custom directive |
| Butuh akses Environment? | ya | custom directive |
| Butuh loopVars dari Java? | ya | custom directive |
| Logic presentation-only dan kecil? | ya | macro/function |
| Logic business/domain? | ya | Java service/ViewModel, bukan template |
| Butuh security-sensitive enforcement? | ya | Java layer, mungkin directive hanya UI helper |
| Dipakai oleh untrusted template? | ya | hindari powerful directive; sandbox ketat |

Default:

> Mulai dari macro. Naik ke custom directive hanya kalau ada alasan teknis yang jelas.

---

## 26. Designing Reusable Template API

Reusable template API harus punya prinsip yang mirip public library.

### 26.1 Explicit input

Buruk:

```ftl
<#macro caseHeader>
  ${case.referenceNo}
</#macro>
```

Macro membaca variable global `case` secara implisit.

Lebih baik:

```ftl
<#macro caseHeader case>
  ${case.referenceNo}
</#macro>
```

Atau lebih ketat:

```ftl
<#macro caseHeader referenceNo statusLabel>
  ...
</#macro>
```

Implicit dependency membuat macro sulit dites dan dipindahkan.

### 26.2 Narrow model

Jangan selalu pass object besar.

Buruk:

```ftl
<@caseHeader case=caseEntity />
```

Lebih baik:

```ftl
<@caseHeader model=case.header />
```

Dengan ViewModel:

```java
public final class CaseHeaderViewModel {
    private final String referenceNo;
    private final String statusLabel;
    private final String statusVariant;
}
```

### 26.3 Stable output contract

Jika macro menghasilkan class CSS tertentu yang dipakai test/e2e, itu kontrak.

```html
<span class="case-status case-status--approved">Approved</span>
```

Mengubah class bisa memecahkan:

- CSS;
- JS;
- test;
- screenshot comparison;
- downstream email parser;
- document automation.

### 26.4 No hidden service dependency

Macro tidak boleh diam-diam bergantung pada shared variable seperti `currentUser`, `permissionService`, `request`, kecuali itu memang bagian eksplisit dari rendering platform dan terdokumentasi.

---

## 27. Template Component Taxonomy

Dalam sistem besar, macro library perlu taksonomi.

### 27.1 Primitive component

Komponen kecil:

```ftl
<@ui.icon name="check" />
<@ui.badge label="Active" variant="success" />
<@ui.button label="Save" />
```

### 27.2 Composite component

Gabungan primitive:

```ftl
<@case.caseSummaryCard case=case.summary />
```

### 27.3 Layout component

Mengatur struktur besar:

```ftl
<@layout.page title="Dashboard">
  ...
</@layout.page>
```

### 27.4 Domain component

Mewakili konsep domain presentation:

```ftl
<@application.eligibilityResult model=result />
<@case.escalationBanner model=case.escalation />
```

### 27.5 Document component

Untuk surat/dokumen:

```ftl
<@doc.letterhead agency=agency />
<@doc.signatureBlock signatory=signatory />
<@doc.legalClause clause=clause />
```

### 27.6 Email component

Untuk HTML email:

```ftl
<@email.preheader text=preheader />
<@email.callout title="Action Required">
  ...
</@email.callout>
```

Taksonomi membantu ownership dan dependency.

---

## 28. Enterprise Macro Library Structure

Contoh struktur:

```text
templates/
  pages/
    case-detail.ftl
    application-list.ftl
  email/
    case-assigned.ftl
    approval-notice.ftl
  document/
    warning-letter.ftl
    closure-letter.ftl
  lib/
    html/
      layout.ftl
      form.ftl
      table.ftl
      feedback.ftl
    email/
      layout.ftl
      components.ftl
    document/
      letter.ftl
      clauses.ftl
      signature.ftl
    domain/
      case.ftl
      application.ftl
```

Template page:

```ftl
<#import "/lib/html/layout.ftl" as layout>
<#import "/lib/html/table.ftl" as table>
<#import "/lib/domain/case.ftl" as caseUi>

<@layout.page title=page.title>
  <@caseUi.caseSummaryCard model=case.summary />
  <@table.standard rows=case.events ; event>
    ...
  </@table.standard>
</@layout.page>
```

Email template:

```ftl
<#import "/lib/email/layout.ftl" as layout>
<#import "/lib/email/components.ftl" as email>

<@layout.email subject=subject brand=brand>
  <@email.callout title="Case Assigned">
    Case ${case.referenceNo} has been assigned to you.
  </@email.callout>
</@layout.email>
```

Document template:

```ftl
<#import "/lib/document/letter.ftl" as letter>
<#import "/lib/document/signature.ftl" as signature>

<@letter.officialLetter model=letterModel>
  <p>${body.paragraph1}</p>
  <@signature.block signatory=signatory />
</@letter.officialLetter>
```

---

## 29. Designing Macro Dependency Direction

Dependency direction harus jelas.

Baik:

```text
pages -> lib/domain -> lib/html -> lib/core
email -> lib/email -> lib/core
ocument -> lib/document -> lib/core
```

Buruk:

```text
lib/core -> lib/domain
lib/html -> pages
lib/email -> html/page-specific macros
```

Macro library dependency harus seperti software module dependency.

Rules:

1. Core tidak boleh bergantung domain.
2. Generic UI tidak boleh bergantung page tertentu.
3. Email library tidak boleh memakai HTML web component yang mengandalkan CSS/JS web.
4. Document library tidak boleh bergantung pada email layout.
5. Domain macro boleh memakai generic macro.
6. Page template boleh import banyak library, tetapi library bawah jangan import page.

---

## 30. Macro Compatibility Strategy

Perubahan macro ada dua jenis:

### 30.1 Backward-compatible

Contoh:

```ftl
<#macro badge label variant="secondary" size="md">
```

Menambah parameter dengan default biasanya kompatibel.

### 30.2 Breaking change

Contoh:

```ftl
<#macro badge status>
```

Mengubah `label` dan `variant` menjadi `status` memecahkan caller lama.

Cara aman:

```ftl
<#macro badge label variant="secondary">
  ...
</#macro>

<#macro statusBadge status>
  <@badge label=status.label variant=status.variant />
</#macro>
```

Deprecation comment:

```ftl
<#-- Deprecated: use statusBadge(status) for new templates. -->
<#macro badge label variant="secondary">
  ...
</#macro>
```

Untuk template platform serius:

- track usage;
- lint deprecated macro;
- migration script;
- versioned library;
- compatibility test.

---

## 31. Macro Testing

Macro harus dites.

Jenis test:

### 31.1 Unit rendering test

Render macro dengan sample data dan assert output.

### 31.2 Golden snapshot test

Bandingkan output dengan expected file.

### 31.3 Escaping test

Input:

```text
<script>alert(1)</script>
```

Expected:

```html
&lt;script&gt;alert(1)&lt;/script&gt;
```

### 31.4 Missing parameter test

Macro required parameter harus gagal jelas.

### 31.5 Variant matrix test

Render `success`, `warning`, `danger`, `info`, invalid variant.

### 31.6 Accessibility test

Untuk HTML component:

- label ada;
- ARIA tepat;
- heading order;
- table header;
- alt text.

### 31.7 Email client snapshot

Email macro diuji dengan HTML email constraints.

### 31.8 PDF pre-render snapshot

Document macro diuji sebelum HTML-to-PDF pipeline.

---

## 32. Example: Testing Macro Library from Java

Contoh pendek:

```java
import freemarker.template.Configuration;
import freemarker.template.Template;

import java.io.StringWriter;
import java.util.HashMap;
import java.util.Map;

public final class FreemarkerRenderTestSupport {
    private final Configuration cfg;

    public FreemarkerRenderTestSupport(Configuration cfg) {
        this.cfg = cfg;
    }

    public String render(String templateName, Map<String, Object> model) throws Exception {
        Template template = cfg.getTemplate(templateName);
        StringWriter out = new StringWriter();
        template.process(model, out);
        return out.toString();
    }
}
```

Test template:

```ftl
<#import "/lib/html/feedback.ftl" as feedback>
<@feedback.alert title=title type=type>
  ${message}
</@feedback.alert>
```

Test:

```java
Map<String, Object> model = new HashMap<>();
model.put("title", "Warning");
model.put("type", "warning");
model.put("message", "Check input");

String html = renderer.render("test/alert-test.ftl", model);

assertThat(html).contains("alert-warning");
assertThat(html).contains("Warning");
assertThat(html).contains("Check input");
```

Escaping test:

```java
model.put("message", "<script>alert(1)</script>");
String html = renderer.render("test/alert-test.ftl", model);

assertThat(html).doesNotContain("<script>");
assertThat(html).contains("&lt;script&gt;");
```

---

## 33. Custom Method Testing

Custom method harus dites seperti Java unit biasa.

```java
public final class MaskIdentifierMethod implements TemplateMethodModelEx {
    @Override
    public Object exec(List arguments) throws TemplateModelException {
        if (arguments.size() != 1) {
            throw new TemplateModelException("maskIdentifier expects exactly 1 argument");
        }
        String value = arguments.get(0).toString();
        if (value.length() <= 4) {
            return "****";
        }
        return "****" + value.substring(value.length() - 4);
    }
}
```

Test cases:

| Input | Expected |
|---|---|
| `S1234567A` | `****567A` |
| `1234` | `****` |
| empty | `****` |
| too many args | exception |
| null/missing | exception or explicit fallback |

Hal penting: jangan hanya test happy path.

---

## 34. Custom Directive Testing

Directive test harus mencakup:

1. Parameter valid.
2. Parameter invalid.
3. Missing body.
4. Nested body rendered once/multiple times sesuai desain.
5. Output escaping interaction.
6. Exception message.
7. Thread-safety.

Thread-safety penting karena shared directive object bisa dipakai banyak render concurrently.

Jangan simpan mutable per-render state sebagai field:

Buruk:

```java
public final class BadDirective implements TemplateDirectiveModel {
    private String currentUser;

    @Override
    public void execute(...) {
        this.currentUser = ...;
    }
}
```

Baik:

```java
public final class GoodDirective implements TemplateDirectiveModel {
    @Override
    public void execute(...) {
        String currentUser = ...; // local variable
    }
}
```

Rule:

> Custom directive harus stateless atau thread-safe.

---

## 35. Macro Anti-Patterns

### 35.1 God macro

```ftl
<#macro renderPage page user tenant permissions features errors messages locale timezone>
  ... 500 lines ...
</#macro>
```

Masalah:

- terlalu banyak tanggung jawab;
- sulit dites;
- sulit direview;
- semua halaman tergantung satu macro;
- perubahan kecil berdampak besar.

### 35.2 Business rule macro

```ftl
<#macro calculatePenalty case>
  ...
</#macro>
```

Penalty adalah domain/business rule, bukan rendering.

### 35.3 Hidden global dependency

```ftl
<#macro approveButton>
  <#if currentUser.roles?seq_contains("APPROVER")>
    <button>Approve</button>
  </#if>
</#macro>
```

Lebih baik pass explicit model:

```ftl
<@caseActions.approveButton visible=actions.canApprove />
```

### 35.4 Raw HTML shortcut

```ftl
<#macro block content>
  ${content?no_esc}
</#macro>
```

Dangerous unless content is explicitly sanitized trusted HTML.

### 35.5 Template doing data loading

```ftl
${caseService.findById(id).referenceNo}
```

Ini harus dilarang.

### 35.6 Macro parameter soup

Macro terlalu banyak opsi berarti butuh model object atau component split.

### 35.7 Over-generalized component

```ftl
<#macro render type model options>
```

Ini membuat static reasoning sulit.

---

## 36. Template API Governance

Untuk sistem enterprise, terutama yang punya banyak template dan banyak author, butuh governance.

Governance minimal:

1. Macro library owner.
2. Review process untuk perubahan macro publik.
3. Compatibility policy.
4. Deprecated macro policy.
5. Security review untuk macro yang pakai raw HTML/URL/script.
6. Test suite wajib.
7. Documentation wajib.
8. Naming convention.
9. Import convention.
10. Directory structure convention.
11. Forbidden constructs list.
12. Template linting.
13. Versioning untuk document/email legal template.
14. Snapshot regression.
15. Release notes untuk macro library.

Tanpa governance, template library akan menjadi “second codebase” yang tidak punya discipline.

---

## 37. Macro Library untuk Email

Email berbeda dari web HTML.

Email macro harus memperhatikan:

- inline CSS;
- table-based layout jika perlu;
- limited CSS support;
- dark mode behavior;
- plain text alternative;
- image absolute URL;
- unsubscribe/legal footer;
- preheader;
- email-safe button;
- width constraints;
- accessibility;
- Outlook quirks;
- no JavaScript.

Contoh:

```ftl
<#macro emailButton href label>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td class="button-cell">
        <a href="${href}" class="button-link">${label}</a>
      </td>
    </tr>
  </table>
</#macro>
```

Jangan reuse web button macro untuk email tanpa validasi.

Buruk:

```ftl
<@ui.button label="Open Case" href=url />
```

Lebih baik:

```ftl
<@email.button label="Open Case" href=validatedActionUrl />
```

---

## 38. Macro Library untuk Document/PDF

Document macro berbeda dari web dan email.

Perlu memperhatikan:

- page break;
- printable CSS;
- font embedding;
- fixed header/footer;
- signature block;
- clause numbering;
- table split;
- long text wrapping;
- locale/legal language;
- immutable template version;
- rendering timestamp;
- effective date;
- signatory;
- document reference number.

Contoh:

```ftl
<#macro clause number title>
  <section class="clause">
    <h3>${number}. ${title}</h3>
    <div class="clause-body">
      <#nested>
    </div>
  </section>
</#macro>
```

Pemakaian:

```ftl
<@doc.clause number="1" title="Requirement to Respond">
  <p>${letter.requirementText}</p>
</@doc.clause>
```

Untuk document legal/regulatory, jangan biarkan template menghitung nomor clause kompleks jika numbering punya makna legal. Siapkan numbering model dari Java.

---

## 39. Macro Library untuk Case/Workflow System

Dalam sistem case management, reusable macro sering muncul untuk:

- case header;
- status badge;
- timeline;
- assignment panel;
- SLA warning;
- escalation banner;
- action buttons;
- decision summary;
- document checklist;
- evidence list;
- audit snapshot.

Contoh:

```ftl
<#macro escalationBanner escalation>
  <#if escalation.active>
    <div class="banner banner-warning">
      <strong>${escalation.title}</strong>
      <p>${escalation.message}</p>
    </div>
  </#if>
</#macro>
```

Catatan penting:

- `escalation.active` sebaiknya hasil decision dari Java/workflow layer.
- Template hanya memutuskan visibility presentation.
- Jangan menghitung escalation condition di macro.

Buruk:

```ftl
<#if case.status == "PENDING" && case.daysOpen > 14 && !case.hasSupervisorReview>
```

Lebih baik:

```ftl
<@caseUi.escalationBanner escalation=case.escalation />
```

---

## 40. Security: Template Author Trust Model

Macro dan directive harus didesain berdasarkan siapa yang boleh menulis template.

### 40.1 Trusted developer templates

Template ditulis developer internal, masuk Git, lewat review, test, CI.

Boleh:

- macro cukup expressive;
- Java helper terbatas;
- import library internal;
- template fail-fast.

Tetap tidak boleh:

- expose service/repository;
- raw request/session bebas;
- unsafe object wrapper;
- `?api` sembarangan;
- unreviewed raw HTML.

### 40.2 Semi-trusted admin templates

Template diedit admin/business user dari UI.

Harus lebih ketat:

- sandbox;
- limited directives;
- no arbitrary Java method;
- limited macro library;
- model allowlist;
- render timeout/size limit;
- preview only before publish;
- approval workflow;
- audit log.

### 40.3 Untrusted external templates

Hindari FreeMarker expressive template untuk untrusted external author kecuali sandbox sangat kuat.

Alternatif:

- logic-less template;
- placeholder-only syntax;
- custom simple renderer;
- restricted DSL;
- pre-approved variables.

Rule:

> Semakin tidak dipercaya template author, semakin sedikit power yang boleh diberikan.

---

## 41. Resource Exhaustion: Macro dan Directive Bisa Menjadi DoS

Template bisa menyebabkan resource exhaustion:

```ftl
<#list 1..100000000 as i>
  ${i}
</#list>
```

Atau recursive macro:

```ftl
<#macro recurse>
  <@recurse />
</#macro>
<@recurse />
```

Atau output besar:

```ftl
<#list rows as row>
  ... huge nested output ...
</#list>
```

Mitigasi:

1. Template author trust boundary.
2. Data model size limit.
3. Pagination before rendering.
4. Output size monitoring.
5. Render timeout di orchestration layer.
6. Separate worker pool untuk batch rendering.
7. Circuit breaker untuk dynamic template platform.
8. Reject recursive macro pattern dalam lint bila memungkinkan.
9. Avoid user-defined arbitrary template for external users.
10. Monitor render latency and memory.

FreeMarker sendiri adalah library; resource governance sering harus dibuat di layer aplikasi.

---

## 42. Error Handling in Macro API

Macro error harus jelas.

Buruk:

```ftl
${model.value}
```

Jika `model` missing, error mungkin muncul jauh dari caller.

Lebih baik untuk macro critical:

```ftl
<#macro requiredField label value>
  <#if !value?? || !value?has_content>
    <#stop "requiredField: value is required for label='${label}'">
  </#if>
  <div><strong>${label}</strong>: ${value}</div>
</#macro>
```

Tetapi jangan terlalu banyak `#stop` untuk field optional.

Policy:

| Data type | Missing behavior |
|---|---|
| Required legal field | fail-fast |
| Optional display field | omit block or show explicit fallback |
| Debug-only field | omit in production |
| Security-sensitive field | fail or redact, never leak |
| User-facing label | fallback to message key? depends on i18n policy |

---

## 43. Designing Macro for Accessibility

Top engineer tidak hanya membuat output “tampil”. Output harus usable.

Contoh button/link:

```ftl
<#macro actionLink href label ariaLabel="">
  <a href="${href}" <#if ariaLabel?has_content>aria-label="${ariaLabel}"</#if>>
    ${label}
  </a>
</#macro>
```

Form field:

```ftl
<#macro textField id name label value="" error="">
  <div class="form-field <#if error?has_content>has-error</#if>">
    <label for="${id}">${label}</label>
    <input id="${id}" name="${name}" value="${value}" <#if error?has_content>aria-invalid="true" aria-describedby="${id}-error"</#if> />
    <#if error?has_content>
      <div id="${id}-error" class="error">${error}</div>
    </#if>
  </div>
</#macro>
```

Accessibility sebaiknya built-in ke component macro, bukan dikerjakan ulang per halaman.

---

## 44. Macro and CSS Contract

Macro sering menghasilkan class CSS. Itu juga kontrak.

```ftl
<#macro statusBadge label variant>
  <span class="status-badge status-badge--${variant}">${label}</span>
</#macro>
```

`variant` harus controlled value. Jangan biarkan user input masuk langsung ke class name.

Buruk:

```ftl
<@statusBadge label=status.label variant=request.variant />
```

Lebih baik:

```java
StatusBadgeViewModel badge = new StatusBadgeViewModel("Approved", "approved");
```

```ftl
<@statusBadge label=badge.label variant=badge.variant />
```

Untuk safety, macro bisa guard:

```ftl
<#macro statusBadge label variant="secondary">
  <#local allowed = ["success", "warning", "danger", "info", "secondary"]>
  <#if !allowed?seq_contains(variant)>
    <#local variant = "secondary">
  </#if>
  <span class="status-badge status-badge--${variant}">${label}</span>
</#macro>
```

Tetapi guard ini presentation-level fallback, bukan pengganti validasi model.

---

## 45. Macro and Java 8–25 Considerations

FreeMarker usage pattern relatif stabil lintas Java 8 sampai 25, tetapi desain aplikasi di sekitarnya berubah.

### 45.1 Java 8 baseline

- Gunakan immutable DTO manual.
- `java.time` sudah tersedia.
- Hindari API Java modern jika library harus kompatibel Java 8.
- Custom method/directive memakai class final dan constructor injection manual.

### 45.2 Java 11/17 baseline

- Lebih umum untuk enterprise modern.
- Bisa gunakan `var` di local variable Java.
- Java 17 sering menjadi LTS baseline production.
- Records belum bisa jika target Java 8/11, tetapi bisa jika baseline 16+.

### 45.3 Java 21/25 style

- Records sangat cocok untuk immutable ViewModel.
- Sealed types bisa membantu modeling template variants.
- Pattern matching membantu mapping domain ke view model.
- Virtual threads bisa berguna untuk batch rendering orchestration yang I/O-bound, tetapi rendering CPU-bound tetap perlu capacity planning.

Contoh Java 21+ ViewModel:

```java
public record StatusBadgeViewModel(
        String label,
        String variant
) {}
```

Untuk kompatibilitas Java 8:

```java
public final class StatusBadgeViewModel {
    private final String label;
    private final String variant;

    public StatusBadgeViewModel(String label, String variant) {
        this.label = label;
        this.variant = variant;
    }

    public String getLabel() {
        return label;
    }

    public String getVariant() {
        return variant;
    }
}
```

Template tetap sama:

```ftl
<@ui.statusBadge label=status.label variant=status.variant />
```

Itulah nilai ViewModel contract: template tidak perlu tahu apakah Java memakai class biasa atau record.

---

## 46. Example: Mini UI Macro Library

File: `/lib/html/ui.ftl`

```ftl
<#--
  UI macro library.
  Assumes HTML output format and auto-escaping enabled.
-->

<#macro badge label variant="secondary">
  <#local allowedVariants = ["success", "warning", "danger", "info", "secondary"]>
  <#if !allowedVariants?seq_contains(variant)>
    <#local variant = "secondary">
  </#if>
  <span class="badge badge-${variant}">${label}</span>
</#macro>

<#macro alert type title>
  <#local allowedTypes = ["success", "warning", "danger", "info"]>
  <#if !allowedTypes?seq_contains(type)>
    <#local type = "info">
  </#if>
  <div class="alert alert-${type}" role="alert">
    <strong>${title}</strong>
    <div class="alert__content">
      <#nested>
    </div>
  </div>
</#macro>

<#macro field id label error="">
  <div class="form-field <#if error?has_content>form-field--error</#if>">
    <label for="${id}">${label}</label>
    <#nested>
    <#if error?has_content>
      <div id="${id}-error" class="form-error">${error}</div>
    </#if>
  </div>
</#macro>

<#macro textInput id name label value="" error="">
  <@field id=id label=label error=error>
    <input
      id="${id}"
      name="${name}"
      type="text"
      value="${value}"
      <#if error?has_content>aria-invalid="true" aria-describedby="${id}-error"</#if>
    />
  </@field>
</#macro>
```

Pemakaian:

```ftl
<#import "/lib/html/ui.ftl" as ui>

<@ui.alert type="warning" title="Pending Review">
  This case requires supervisor approval.
</@ui.alert>

<@ui.badge label=case.statusLabel variant=case.statusVariant />

<@ui.textInput
  id="applicantName"
  name="applicantName"
  label="Applicant Name"
  value=form.applicantName
  error=form.errors.applicantName!""
/>
```

---

## 47. Example: Mini Email Macro Library

File: `/lib/email/components.ftl`

```ftl
<#macro preheader text>
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
    ${text}
  </div>
</#macro>

<#macro section title>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td>
        <h2>${title}</h2>
        <#nested>
      </td>
    </tr>
  </table>
</#macro>

<#macro button href label>
  <table role="presentation" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td>
        <a href="${href}" class="email-button">${label}</a>
      </td>
    </tr>
  </table>
</#macro>
```

Pemakaian:

```ftl
<#import "/lib/email/components.ftl" as email>

<@email.preheader text=message.preheader />

<@email.section title="Case Assigned">
  <p>Case ${case.referenceNo} has been assigned to you.</p>
  <@email.button href=case.actionUrl label="Open Case" />
</@email.section>
```

Catatan:

- `case.actionUrl` harus divalidasi di Java.
- Jangan masukkan URL mentah dari request.
- Jangan pakai JavaScript.
- Plain text alternative tetap perlu template terpisah.

---

## 48. Example: Mini Document Macro Library

File: `/lib/document/letter.ftl`

```ftl
<#macro officialLetter model>
  <article class="letter">
    <header class="letterhead">
      <h1>${model.agencyName}</h1>
      <p>${model.agencyAddress}</p>
    </header>

    <section class="letter-meta">
      <p>Reference: ${model.referenceNo}</p>
      <p>Date: ${model.issueDateLabel}</p>
    </section>

    <section class="letter-recipient">
      <p>${model.recipientName}</p>
      <p>${model.recipientAddress}</p>
    </section>

    <main class="letter-body">
      <#nested>
    </main>
  </article>
</#macro>

<#macro signatureBlock signatory>
  <section class="signature-block">
    <p>Yours sincerely,</p>
    <p class="signature-name">${signatory.name}</p>
    <p>${signatory.title}</p>
    <p>${signatory.organization}</p>
  </section>
</#macro>
```

Pemakaian:

```ftl
<#import "/lib/document/letter.ftl" as letter>

<@letter.officialLetter model=document>
  <p>${document.openingParagraph}</p>
  <p>${document.mainParagraph}</p>
  <@letter.signatureBlock signatory=document.signatory />
</@letter.officialLetter>
```

Untuk dokumen resmi, `document.issueDateLabel`, `referenceNo`, dan `signatory` harus immutable snapshot dari Java/application layer.

---

## 49. Example: Java Registration of Macro-Aware Configuration

```java
import freemarker.cache.ClassTemplateLoader;
import freemarker.template.Configuration;
import freemarker.template.TemplateExceptionHandler;

import java.nio.charset.StandardCharsets;
import java.util.Locale;

public final class FreemarkerConfigurationFactory {
    public Configuration create() throws Exception {
        Configuration cfg = new Configuration(Configuration.VERSION_2_3_34);

        cfg.setTemplateLoader(new ClassTemplateLoader(
                FreemarkerConfigurationFactory.class,
                "/templates"
        ));

        cfg.setDefaultEncoding(StandardCharsets.UTF_8.name());
        cfg.setLocale(Locale.ROOT);
        cfg.setTemplateExceptionHandler(TemplateExceptionHandler.RETHROW_HANDLER);
        cfg.setLogTemplateExceptions(false);
        cfg.setWrapUncheckedExceptions(true);
        cfg.setFallbackOnNullLoopVariable(false);

        cfg.setSharedVariable("slugify", new SlugifyMethod());
        cfg.setSharedVariable("maskIdentifier", new MaskIdentifierMethod());
        cfg.setSharedVariable("uppercase", new UppercaseDirective());

        return cfg;
    }
}
```

Catatan:

- Shared variable global harus sedikit.
- Jangan register terlalu banyak helper tanpa governance.
- Jangan register service object mentah.
- Jangan register Spring ApplicationContext.
- Jangan register repository.
- Jangan register object yang memberi akses classloader/runtime.

---

## 50. Render Context vs Shared Variable

Shared variable menggoda karena praktis:

```java
cfg.setSharedVariable("appName", "ACEAS");
```

Tetapi terlalu banyak shared variable membuat template bergantung pada global environment.

Lebih baik bedakan:

### 50.1 Global stable helper

Cocok sebagai shared variable:

- pure helper;
- macro-independent function;
- utility directive;
- static app metadata yang benar-benar global.

### 50.2 Per-render context

Harus masuk model render:

- current user display;
- locale;
- tenant;
- feature flags;
- permissions;
- request-specific data;
- document data;
- case data.

Contoh model:

```java
Map<String, Object> model = new HashMap<>();
model.put("page", pageModel);
model.put("user", userView);
model.put("tenant", tenantView);
model.put("case", caseView);
```

Template:

```ftl
<@layout.page title=page.title tenant=tenant>
  ...
</@layout.page>
```

Rule:

> Global helper boleh global. Render-specific data jangan global.

---

## 51. Template API Review Checklist

Gunakan checklist ini saat membuat macro/function/directive baru.

### 51.1 Purpose

- Apakah abstraction ini benar-benar mengurangi duplikasi?
- Apakah namanya jelas?
- Apakah terlalu generik?
- Apakah punya satu tanggung jawab?

### 51.2 Contract

- Parameter required jelas?
- Parameter optional punya default masuk akal?
- Tipe input jelas?
- Output format jelas?
- Apakah ada backward compatibility risk?

### 51.3 Security

- Apakah menerima raw HTML?
- Apakah memasukkan value ke URL/class/style/script context?
- Apakah escaping benar?
- Apakah ada `?no_esc`?
- Apakah input berasal dari trusted source?
- Apakah helper mengekspos Java object berbahaya?

### 51.4 Logic boundary

- Apakah business rule masuk template?
- Apakah data loading terjadi di template?
- Apakah authorization final terjadi di template?
- Apakah calculation harus dipindah ke ViewModel?

### 51.5 Testability

- Bisa dirender dengan sample model kecil?
- Ada snapshot test?
- Ada escaping test?
- Ada invalid input test?
- Ada locale test jika format text/date/number?

### 51.6 Operations

- Apakah macro bisa menyebabkan output sangat besar?
- Apakah bisa loop besar?
- Apakah custom directive stateless?
- Apakah error message jelas?
- Apakah observability cukup saat render gagal?

---

## 52. Practical Design Exercise

Bayangkan ada kebutuhan membuat notification email untuk case assignment:

Data:

```text
caseReferenceNo
caseTitle
assignedOfficerName
dueDateLabel
actionUrl
agencyBrand
```

Naive template:

```ftl
<html>
<body>
  <h1>${agencyBrand.name}</h1>
  <p>Dear ${assignedOfficerName},</p>
  <p>Case ${caseReferenceNo} - ${caseTitle} has been assigned to you.</p>
  <p>Due date: ${dueDateLabel}</p>
  <a href="${actionUrl}">Open Case</a>
</body>
</html>
```

Better with macro library:

```ftl
<#import "/lib/email/layout.ftl" as layout>
<#import "/lib/email/components.ftl" as email>

<@layout.email brand=agencyBrand subject=subject>
  <@email.section title="Case Assigned">
    <p>Dear ${assignedOfficerName},</p>
    <p>
      Case <strong>${caseReferenceNo}</strong> - ${caseTitle}
      has been assigned to you.
    </p>
    <p>Due date: ${dueDateLabel}</p>
    <@email.button href=actionUrl label="Open Case" />
  </@email.section>
</@layout.email>
```

Even better ViewModel:

```java
public final class CaseAssignedEmailViewModel {
    private final String subject;
    private final BrandViewModel brand;
    private final String officerName;
    private final CaseSummaryViewModel caseSummary;
    private final String dueDateLabel;
    private final LinkViewModel actionLink;
}
```

Template:

```ftl
<#import "/lib/email/layout.ftl" as layout>
<#import "/lib/email/components.ftl" as email>
<#import "/lib/domain/case.ftl" as caseUi>

<@layout.email brand=emailModel.brand subject=emailModel.subject>
  <@email.section title="Case Assigned">
    <p>Dear ${emailModel.officerName},</p>
    <@caseUi.caseSummaryInline model=emailModel.caseSummary />
    <p>Due date: ${emailModel.dueDateLabel}</p>
    <@email.button href=emailModel.actionLink.href label=emailModel.actionLink.label />
  </@email.section>
</@layout.email>
```

Why better?

1. Layout reusable.
2. Email button reusable.
3. Case summary reusable.
4. URL already validated in LinkViewModel.
5. Template expresses presentation, not data construction.
6. Easier to test.
7. Easier to evolve branding.
8. Easier to support plain text alternative with same model.

---

## 53. What Top 1% Engineers Internalize

Top 1% understanding di area FreeMarker macro/directive bukan berarti hafal semua syntax. Yang lebih penting:

1. Bisa membedakan output composition dari business logic.
2. Mendesain macro sebagai API, bukan snippet.
3. Memahami escaping context.
4. Tidak mengekspos object Java sembarangan.
5. Menjaga template deterministic.
6. Membuat reusable component tanpa overengineering.
7. Bisa membuat custom directive saat memang perlu, tetapi tidak tergoda memakainya untuk semua hal.
8. Bisa menguji template library.
9. Bisa membuat governance untuk template platform.
10. Bisa menjelaskan failure mode template rendering secara operasional.

Template engine tampak sederhana karena outputnya teks. Namun dalam sistem enterprise, template bisa menghasilkan:

- email yang dikirim ke publik;
- surat resmi;
- PDF legal;
- notification workflow;
- UI admin;
- konfigurasi;
- source code;
- audit-visible output.

Karena itu macro dan directive harus diperlakukan seperti software production.

---

## 54. Ringkasan Part 6

Kita sudah membahas:

1. Macro sebagai template-level component.
2. Function sebagai value-level helper.
3. Nested content dengan `#nested`.
4. Macro parameters, default values, named arguments.
5. Scope dan namespace.
6. `#import` sebagai mekanisme macro library.
7. Macro library sebagai public API.
8. Custom Java method dengan `TemplateMethodModelEx`.
9. Custom Java directive dengan `TemplateDirectiveModel`.
10. Kapan memakai macro vs function vs Java directive.
11. Desain reusable template API.
12. Macro governance.
13. Macro testing.
14. Security dan escaping dalam macro.
15. Email/document/domain macro library.
16. Java 8–25 considerations.
17. Checklist review macro/function/directive.

Kesimpulan utama:

> Macro, function, dan custom directive adalah alat untuk membuat abstraksi rendering. Tetapi abstraksi rendering yang baik harus menjaga boundary: presentation boleh di template, business decision tetap di Java/domain/application layer.

---

## 55. Latihan Mandiri

### Latihan 1 — Refactor Duplicate HTML

Ambil tiga template yang punya alert/banner mirip. Buat macro:

```ftl
<@ui.alert type="warning" title="...">
  ...
</@ui.alert>
```

Pastikan:

- escaping aman;
- `type` allowlisted;
- nested content bekerja;
- output bisa dites.

### Latihan 2 — Buat Email Button Macro

Buat macro email-safe button yang menerima:

```text
href
label
variant
```

Lalu validasi di Java bahwa `href` hanya relative URL atau domain allowlist.

### Latihan 3 — Buat Custom Method

Implementasikan `maskIdentifier(value)` sebagai Java method model.

Test:

- normal ID;
- short ID;
- empty;
- wrong argument count;
- non-string argument.

### Latihan 4 — Desain Macro API untuk Case Summary

Buat macro:

```ftl
<@case.caseSummaryCard model=caseSummary />
```

Tentukan ViewModel minimal:

```text
referenceNo
statusLabel
statusVariant
title
assignedOfficerLabel
lastUpdatedLabel
```

Pastikan macro tidak membaca global `case`.

### Latihan 5 — Review Anti-Pattern

Cari template yang punya logic seperti:

```ftl
<#if case.status == "PENDING" && case.daysOpen > 14>
```

Refactor menjadi ViewModel:

```text
case.escalation.active
case.escalation.title
case.escalation.message
```

Template cukup render.

---

## 56. Preview Part Berikutnya

Part berikutnya:

```text
Part 7 — FreeMarker Object Wrapping, Type Exposure, and Security Boundary
```

Kita akan membahas bagian yang lebih dalam dan lebih berbahaya: bagaimana Java object terlihat oleh FreeMarker, bagaimana `ObjectWrapper` mengubah Java object menjadi `TemplateModel`, apa risiko exposing JavaBean/method/API ke template, dan bagaimana mendesain data model allowlist yang aman untuk production.

Ini penting karena macro/directive yang baik tetap bisa menjadi tidak aman kalau data model dan object exposure-nya salah.

---

## 57. Referensi

Referensi utama yang relevan untuk bagian ini:

1. Apache FreeMarker Manual — Defining your own directives.  
   `https://freemarker.apache.org/docs/dgui_misc_userdefdir.html`

2. Apache FreeMarker Manual — Directives.  
   `https://freemarker.apache.org/docs/dgui_template_directives.html`

3. Apache FreeMarker Manual — Methods.  
   `https://freemarker.apache.org/docs/pgui_datamodel_method.html`

4. Apache FreeMarker API — `TemplateDirectiveModel`.  
   `https://freemarker.apache.org/docs/api/freemarker/template/TemplateDirectiveModel.html`

5. Apache FreeMarker API — `TemplateMethodModelEx`.  
   `https://freemarker.apache.org/docs/api/freemarker/template/TemplateMethodModelEx.html`

6. Apache FreeMarker API — `Template`.  
   `https://freemarker.apache.org/docs/api/freemarker/template/Template.html`

7. Apache FreeMarker Manual — Expert built-ins.  
   `https://freemarker.apache.org/docs/ref_builtins_expert.html`

8. Apache FreeMarker Manual — Auto-escaping and output formats.  
   `https://freemarker.apache.org/docs/dgui_misc_autoescaping.html`

