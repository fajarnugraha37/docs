# learn-java-template-freemarker-thymeleaf-rendering-engineering-part-005

# Part 5 — FreeMarker Template Language Deep Dive II: Directives, Conditionals, Loops, Includes

> Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`  
> Bagian: `005 / 034`  
> Fokus: control flow, composition, include/import, variable scope, dan desain template FreeMarker yang maintainable  
> Target Java: 8 sampai 25  
> Engine utama: Apache FreeMarker 2.3.x family

---

## 0. Tujuan Bagian Ini

Pada Part 4 kita sudah membahas nilai, tipe, ekspresi, interpolation, default value, missing value, dan akses data model. Bagian ini naik satu level: bukan lagi `apa nilai dari ekspresi ini?`, tetapi:

> bagaimana template mengatur alur output tanpa berubah menjadi tempat business logic.

FreeMarker Template Language atau FTL punya directive seperti `#if`, `#list`, `#include`, `#import`, `#assign`, `#switch`, `#attempt`, dan lain-lain. Directive ini memberi kemampuan besar untuk membuat output dinamis. Tetapi kemampuan itu juga membuka risiko:

1. template menjadi terlalu pintar;
2. business rule tersembunyi di `.ftl`;
3. output sulit dites;
4. kondisi HTML menjadi bercabang terlalu dalam;
5. variable scope bocor;
6. include/import tidak terkendali;
7. fragment template berubah menjadi dependency graph yang rapuh;
8. rendering failure baru muncul di production.

Tujuan bagian ini adalah membangun penguasaan directive FreeMarker dengan mental model engineer, bukan hanya hafalan syntax.

Setelah bagian ini, kamu harus mampu:

1. membaca template FreeMarker kompleks secara sistematis;
2. merancang template yang modular dan maintainable;
3. memakai conditional dan loop tanpa mencampur business logic;
4. membedakan `include`, `import`, macro, layout, dan partial;
5. memahami scoping `assign`, `local`, `global`, namespace, dan loop variable;
6. membuat aturan desain agar template aman, deterministic, dan mudah dites;
7. menilai kapan logic harus tetap di template dan kapan wajib dipindah ke Java.

---

## 1. Mental Model: Directive Adalah Instruksi Rendering, Bukan Business Logic

FreeMarker template secara konseptual adalah program kecil yang menghasilkan teks. Ia bukan general-purpose application program seperti Java. Directive adalah instruksi kepada renderer untuk mengontrol output.

Contoh sederhana:

```ftl
<#if user.active>
  Welcome, ${user.displayName}!
<#else>
  Your account is inactive.
</#if>
```

Secara teknis ini adalah branching. Secara desain, ini boleh saja karena template memang perlu menentukan output berdasarkan state presentational.

Tetapi lihat contoh berikut:

```ftl
<#if case.status == "PENDING_REVIEW" && case.daysSinceSubmission gt 14 && officer.grade == "SENIOR" && !case.hasOpenAppeal>
  Escalate to senior review queue
</#if>
```

Ini bukan sekadar rendering. Ini sudah mendekati workflow/business rule. Template sekarang memutuskan sesuatu yang seharusnya diputuskan domain/application layer.

Rule praktis:

> Template boleh memilih bagaimana sesuatu ditampilkan. Template tidak boleh menjadi sumber kebenaran tentang apa keputusan bisnisnya.

Jadi Java seharusnya menyiapkan model seperti:

```java
public record CaseNotificationView(
    String caseReference,
    String applicantName,
    boolean showEscalationNotice,
    String escalationMessage
) {}
```

Lalu template cukup:

```ftl
<#if showEscalationNotice>
  <p class="notice">${escalationMessage}</p>
</#if>
```

Perbedaannya besar:

| Aspek | Logic di Template | Logic di Java/ViewModel |
|---|---|---|
| Business rule ownership | tersebar | terkonsolidasi |
| Unit test | sulit | mudah |
| Auditability | lemah | kuat |
| Refactoring | rawan | relatif aman |
| Template author risk | tinggi | rendah |
| Reuse | rendah | tinggi |

Top 1% engineer melihat directive sebagai alat composition dan presentation decision, bukan tempat menanam business decision.

---

## 2. Directive Taxonomy di FreeMarker

Directive FreeMarker bisa dikelompokkan secara mental menjadi beberapa keluarga.

### 2.1 Control-flow directives

Digunakan untuk mengatur alur rendering:

```ftl
<#if condition>...</#if>
<#elseif otherCondition>...</#elseif>
<#else>...</#else>

<#switch value>
  <#case "A">...</#case>
  <#default>...</#default>
</#switch>
```

Gunanya memilih bagian output.

### 2.2 Iteration directives

Digunakan untuk mengulang output:

```ftl
<#list users as user>
  ${user.name}
</#list>
```

Termasuk variasi modern seperti `#items`, `#sep`, `#else`, `#break`, `#continue`.

### 2.3 Composition directives

Digunakan untuk memecah template:

```ftl
<#include "fragments/header.ftl">
<#import "components/forms.ftl" as forms>
```

`include` memasukkan output template lain. `import` memuat library macro/function ke namespace.

### 2.4 Variable and scope directives

Digunakan untuk membuat variable dalam template:

```ftl
<#assign title = "Dashboard">
<#local normalizedName = user.name?trim>
<#global appName = "ACEAS">
```

Ini perlu hati-hati karena variable template bisa membuat alur sulit dibaca.

### 2.5 Reuse directives

Akan dibahas lebih dalam di Part 6:

```ftl
<#macro button label url>
  <a href="${url}">${label}</a>
</#macro>

<@button label="Save" url="/save" />
```

### 2.6 Error handling and control directives

FreeMarker juga punya directive seperti:

```ftl
<#attempt>
  ...
<#recover>
  ...
</#attempt>

<#stop "Invalid state">
```

Ini berguna tetapi rawan disalahgunakan. Error handling template harus tetap sejalan dengan error policy aplikasi.

---

## 3. `#if`, `#elseif`, `#else`: Conditional Rendering

### 3.1 Bentuk dasar

```ftl
<#if user.active>
  <p>Active user</p>
</#if>
```

Dengan else:

```ftl
<#if user.active>
  <p>Active user</p>
<#else>
  <p>Inactive user</p>
</#if>
```

Dengan elseif:

```ftl
<#if status == "APPROVED">
  <p class="success">Approved</p>
<#elseif status == "REJECTED">
  <p class="danger">Rejected</p>
<#elseif status == "PENDING">
  <p class="warning">Pending</p>
<#else>
  <p class="muted">Unknown status</p>
</#if>
```

### 3.2 Conditional rendering harus berdasarkan presentation state

Lebih baik:

```ftl
<#if canShowApproveButton>
  <button type="submit">Approve</button>
</#if>
```

Daripada:

```ftl
<#if user.roles?seq_contains("SUPERVISOR") && case.status == "PENDING_APPROVAL" && !case.locked>
  <button type="submit">Approve</button>
</#if>
```

Kenapa?

Karena `canShowApproveButton` adalah contract dari application layer. Template tidak perlu tahu seluruh rule. Template hanya tahu output.

Tetapi jangan salah paham: menyembunyikan tombol di UI bukan authorization. Backend tetap harus enforce permission.

### 3.3 Boolean naming matters

Nama boolean di model harus menjawab pertanyaan presentation.

Buruk:

```ftl
<#if flag1>
```

Lumayan:

```ftl
<#if active>
```

Bagus:

```ftl
<#if showInactiveAccountWarning>
```

Sangat bagus bila semantic-nya jelas:

```ftl
<#if shouldRenderRenewalDeadlineNotice>
```

Template yang baik bisa dibaca seperti dokumen UI.

### 3.4 Hindari nested conditional terlalu dalam

Buruk:

```ftl
<#if case??>
  <#if case.application??>
    <#if case.application.owner??>
      <#if case.application.owner.email??>
        ${case.application.owner.email}
      <#else>
        No email
      </#if>
    </#if>
  </#if>
</#if>
```

Ini sinyal bahwa data model tidak disiapkan dengan benar.

Lebih baik siapkan field:

```java
public record CaseView(
    String ownerEmailLabel
) {}
```

Template:

```ftl
${ownerEmailLabel}
```

Atau minimal:

```ftl
${case.application.owner.email!"No email"}
```

Tetapi untuk sistem enterprise, default text seperti `No email` sering lebih baik disiapkan via i18n/message layer, bukan hardcoded di banyak template.

### 3.5 Avoid condition duplication

Buruk:

```ftl
<#if order.status == "PAID">
  <span class="badge paid">Paid</span>
</#if>

...

<#if order.status == "PAID">
  <button>Generate Receipt</button>
</#if>

...

<#if order.status == "PAID">
  <p>Payment completed on ${order.paidAt}</p>
</#if>
```

Lebih baik:

```ftl
<#if order.paid>
  <#include "order/paid-summary.ftl">
</#if>
```

Atau:

```ftl
<#if showPaidSection>
  <#include "order/paid-section.ftl">
</#if>
```

Duplication condition adalah smell. Bisa jadi butuh fragment, macro, atau model shaping.

---

## 4. `#switch`, `#case`, `#default`: Multi-Branch Rendering

### 4.1 Kapan pakai switch?

Gunakan `#switch` ketika satu nilai diskrit menentukan variasi output.

```ftl
<#switch notificationType>
  <#case "APPROVAL">
    <p>Your application has been approved.</p>
    <#break>
  <#case "REJECTION">
    <p>Your application has been rejected.</p>
    <#break>
  <#case "REQUEST_INFO">
    <p>Please provide additional information.</p>
    <#break>
  <#default>
    <p>Please check your application status.</p>
</#switch>
```

### 4.2 Switch boleh untuk presentation mapping sederhana

Contoh yang masih acceptable:

```ftl
<#switch severity>
  <#case "INFO">
    <span class="badge badge-info">Info</span>
    <#break>
  <#case "WARNING">
    <span class="badge badge-warning">Warning</span>
    <#break>
  <#case "ERROR">
    <span class="badge badge-error">Error</span>
    <#break>
  <#default>
    <span class="badge badge-muted">Unknown</span>
</#switch>
```

Tetapi untuk design system yang matang, lebih baik model menyediakan `severityCssClass` dan `severityLabel`.

```ftl
<span class="badge ${severityCssClass}">${severityLabel}</span>
```

### 4.3 Switch yang terlalu besar adalah smell

Jika switch punya 20 case dan setiap case punya output panjang, kemungkinan kamu butuh:

1. template selector di Java;
2. map status ke template ID;
3. fragment per status;
4. strategy pattern;
5. workflow correspondence registry;
6. template catalog.

Buruk:

```ftl
<#switch caseState>
  <#case "DRAFT"> ... 100 lines ... <#break>
  <#case "SUBMITTED"> ... 100 lines ... <#break>
  <#case "SCREENING"> ... 100 lines ... <#break>
  <#case "INSPECTION"> ... 100 lines ... <#break>
  <#case "ENFORCEMENT"> ... 100 lines ... <#break>
  <#case "APPEAL"> ... 100 lines ... <#break>
</#switch>
```

Lebih baik:

```java
TemplateId templateId = correspondenceTemplateSelector.select(caseState, documentType, tenant);
renderer.render(templateId, model, context);
```

Template menjadi per document type/state, bukan satu monster template.

---

## 5. `#list`: Iteration sebagai Output Repetition

### 5.1 Bentuk dasar

```ftl
<ul>
  <#list users as user>
    <li>${user.displayName}</li>
  </#list>
</ul>
```

Mental model:

1. `users` adalah sequence/collection dari data model.
2. `user` adalah loop variable.
3. `user` hanya valid di dalam body `#list`.
4. Body menghasilkan output untuk setiap item.

### 5.2 Empty list handling

Buruk:

```ftl
<ul>
  <#list users as user>
    <li>${user.displayName}</li>
  </#list>
</ul>
```

Jika kosong, output menjadi:

```html
<ul>
</ul>
```

Kadang ini acceptable. Tetapi sering kamu butuh empty state:

```ftl
<#if users?size gt 0>
  <ul>
    <#list users as user>
      <li>${user.displayName}</li>
    </#list>
  </ul>
<#else>
  <p class="empty">No users found.</p>
</#if>
```

FreeMarker menyediakan pattern yang lebih rapi dengan `#list ... <#else>`:

```ftl
<ul>
  <#list users as user>
    <li>${user.displayName}</li>
  <#else>
    <li class="empty">No users found.</li>
  </#list>
</ul>
```

Tetapi perhatikan output semantics. Untuk HTML, empty state di dalam `<ul>` menghasilkan `<li>`. Jika desain UI butuh `<p>`, maka conditional di luar `<ul>` lebih benar.

### 5.3 Loop metadata

FreeMarker menyediakan informasi loop seperti index/counter/parity melalui loop variable built-ins.

Contoh umum:

```ftl
<table>
  <thead>
    <tr>
      <th>No.</th>
      <th>Name</th>
    </tr>
  </thead>
  <tbody>
    <#list users as user>
      <tr>
        <td>${user?counter}</td>
        <td>${user.displayName}</td>
      </tr>
    </#list>
  </tbody>
</table>
```

Beberapa konsep yang sering dipakai:

| Konsep | Makna |
|---|---|
| index | posisi berbasis 0 |
| counter | posisi berbasis 1 |
| has_next | apakah masih ada item setelah ini |
| is_first | apakah item pertama |
| is_last | apakah item terakhir |
| item_parity | ganjil/genap untuk styling |

Catatan: syntax detail loop built-ins bergantung pada versi FreeMarker modern, tetapi mental model-nya sama: metadata loop membantu rendering, bukan business decision.

### 5.4 Separator problem

Masalah umum saat render CSV/JSON/text adalah separator.

Buruk:

```ftl
<#list users as user>
  ${user.email},
</#list>
```

Output punya trailing comma.

Lebih baik:

```ftl
<#list users as user>
  ${user.email}<#sep>, </#sep>
</#list>
```

Atau untuk HTML breadcrumb:

```ftl
<nav aria-label="breadcrumb">
  <#list breadcrumbs as item>
    <a href="${item.url}">${item.label}</a><#sep> / </#sep>
  </#list>
</nav>
```

`#sep` membuat template lebih declarative: separator muncul antar item, bukan setelah semua item.

### 5.5 Nested list

Contoh:

```ftl
<#list departments as department>
  <section>
    <h2>${department.name}</h2>

    <#if department.employees?size gt 0>
      <ul>
        <#list department.employees as employee>
          <li>${employee.displayName}</li>
        </#list>
      </ul>
    <#else>
      <p>No employees.</p>
    </#if>
  </section>
</#list>
```

Nested list acceptable jika struktur output memang nested.

Tetapi nested list menjadi smell jika template melakukan data grouping:

```ftl
<#list allEmployees as employee>
  <#if employee.department == department.name>
    ...
  </#if>
</#list>
```

Grouping/filtering harus dilakukan di Java:

```java
record DepartmentView(String name, List<EmployeeView> employees) {}
```

Template tidak boleh menjadi query engine.

### 5.6 Jangan melakukan filtering kompleks di template

Buruk:

```ftl
<#list cases as case>
  <#if case.status == "OPEN" && case.priority == "HIGH" && case.assignedOfficer??>
    <tr>
      <td>${case.referenceNo}</td>
      <td>${case.assignedOfficer.name}</td>
    </tr>
  </#if>
</#list>
```

Lebih baik:

```java
record DashboardView(List<CaseRowView> highPriorityOpenCases) {}
```

Template:

```ftl
<#list highPriorityOpenCases as case>
  <tr>
    <td>${case.referenceNo}</td>
    <td>${case.assignedOfficerName}</td>
  </tr>
</#list>
```

Rule:

> Template boleh iterate; Java harus select, filter, group, sort, enrich.

### 5.7 Large list rendering

Template engine bukan solusi untuk merender jutaan row ke HTML.

Jika list besar:

1. pagination di query/application layer;
2. server-side filtering;
3. streaming output jika target text/file;
4. batch rendering jika email/document;
5. hindari `StringWriter` besar kalau output sangat besar;
6. tentukan maximum output size.

FreeMarker dapat menulis ke `Writer`, tetapi kalau kamu render ke `StringWriter`, seluruh output ada di memory.

Untuk HTML page, besar output juga berdampak ke browser, network, dan user experience.

---

## 6. `#items`: Memisahkan Empty Handling dari Item Rendering

FreeMarker punya bentuk list yang memungkinkan separation antara container dan item rendering.

Contoh konseptual:

```ftl
<#list users>
  <ul>
    <#items as user>
      <li>${user.displayName}</li>
    </#items>
  </ul>
<#else>
  <p>No users found.</p>
</#list>
```

Keuntungannya:

1. `<ul>` hanya muncul jika ada item;
2. empty state bisa berada di luar container;
3. template lebih semantik;
4. tidak perlu `users?size gt 0`.

Ini lebih bagus untuk HTML semantics dibanding empty `<ul>`.

Pattern ini sangat berguna untuk:

1. table body;
2. card list;
3. email item list;
4. PDF section list;
5. breadcrumb;
6. nested output yang container-nya tidak boleh muncul saat kosong.

Contoh table:

```ftl
<#list rows>
  <table>
    <thead>
      <tr>
        <th>No.</th>
        <th>Case Ref</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      <#items as row>
        <tr>
          <td>${row?counter}</td>
          <td>${row.referenceNo}</td>
          <td>${row.statusLabel}</td>
        </tr>
      </#items>
    </tbody>
  </table>
<#else>
  <p class="empty">No cases found.</p>
</#list>
```

Ini menunjukkan mental model bagus: list directive bukan hanya loop, tetapi juga struktur output conditional.

---

## 7. `#break` dan `#continue`: Gunakan Jarang

FreeMarker punya `#break` dan `#continue` untuk mengontrol loop. Ini familiar bagi programmer Java.

Contoh:

```ftl
<#list notifications as notification>
  <#if notification.hidden>
    <#continue>
  </#if>
  <p>${notification.message}</p>
</#list>
```

Tetapi dalam template engineering, `#continue` sering sinyal bahwa filtering belum dilakukan di Java.

Lebih baik:

```java
record NotificationPanelView(List<NotificationView> visibleNotifications) {}
```

Template:

```ftl
<#list visibleNotifications as notification>
  <p>${notification.message}</p>
</#list>
```

`#break` juga harus jarang:

```ftl
<#list announcements as announcement>
  <#if announcement.urgent>
    <div>${announcement.message}</div>
    <#break>
  </#if>
</#list>
```

Lebih baik model menyediakan:

```java
record DashboardView(Optional<AnnouncementView> topUrgentAnnouncement) {}
```

Template:

```ftl
<#if topUrgentAnnouncement??>
  <div>${topUrgentAnnouncement.message}</div>
</#if>
```

Rule praktis:

> `#break` dan `#continue` boleh untuk rendering edge-case kecil, tetapi jangan dipakai sebagai pengganti filtering, searching, dan selection di Java.

---

## 8. `#include`: Composition dengan Shared Context

### 8.1 Apa itu include?

`#include` memasukkan template lain dan mengeksekusinya dalam konteks rendering saat ini.

```ftl
<#include "fragments/header.ftl">

<main>
  <h1>${pageTitle}</h1>
  <p>${content}</p>
</main>

<#include "fragments/footer.ftl">
```

Jika `header.ftl` mengakses `${pageTitle}`, ia bisa melihat variable yang tersedia di context/namespace yang relevan.

### 8.2 Include cocok untuk partial yang bergantung pada context

Contoh:

`page.ftl`:

```ftl
<#assign pageTitle = "Dashboard">
<#include "layout/header.ftl">

<main>
  <h1>${pageTitle}</h1>
</main>

<#include "layout/footer.ftl">
```

`layout/header.ftl`:

```ftl
<header>
  <title>${pageTitle}</title>
</header>
```

Ini sederhana, tapi ada risiko: `header.ftl` punya dependency implisit terhadap `pageTitle`.

### 8.3 Dependency implisit adalah masalah maintainability

Jika fragment butuh variable tertentu tetapi tidak jelas dari pemanggilnya, template menjadi fragile.

Contoh:

`fragments/user-card.ftl`:

```ftl
<div class="card">
  <h2>${user.displayName}</h2>
  <p>${user.email}</p>
</div>
```

Pemanggil:

```ftl
<#include "fragments/user-card.ftl">
```

Apa dependency fragment ini? Ia butuh `user`. Tetapi itu tidak terlihat dari include call.

Macro lebih explicit:

```ftl
<@components.userCard user=user />
```

Maka untuk komponen reusable, macro sering lebih baik daripada include.

### 8.4 Include cocok untuk layout shell sederhana

Good use cases:

1. header/footer statis;
2. legal footer;
3. disclaimer global;
4. email preheader;
5. shared CSS block;
6. static snippet;
7. page shell yang memang memakai context global.

Poor use cases:

1. form component yang butuh banyak parameter;
2. table row reusable;
3. button component dengan variasi;
4. field rendering dengan error state;
5. business-specific conditional section.

Untuk poor use cases, gunakan macro/custom directive/component pattern.

### 8.5 Include dan output side effect

`#include` langsung menghasilkan output. Ia bukan import function. Jika file yang di-include punya whitespace, newline, atau HTML, itu masuk ke output.

Ini penting untuk:

1. JSON generation;
2. CSV generation;
3. email plain text;
4. fixed-width text;
5. generated source code.

Contoh buruk untuk JSON:

```ftl
{
  "user": <#include "json/user.ftl">
}
```

Jika `user.ftl` punya trailing comma atau whitespace tak terkendali, JSON bisa rusak.

Untuk output structured seperti JSON/XML, lebih baik hati-hati: sering kali Jackson/XML serializer lebih tepat daripada template engine, kecuali kamu memang sedang generate artifact khusus.

---

## 9. `#import`: Macro Library dan Namespace

### 9.1 Apa itu import?

`#import` memuat template sebagai library macro/function dan memberikan namespace alias.

```ftl
<#import "components/forms.ftl" as forms>

<@forms.input name="email" label="Email" value=user.email />
```

Berbeda dari `include`, `import` tidak dimaksudkan untuk langsung memasukkan output page. Ia lebih seperti memuat library.

### 9.2 Namespace membuat dependency explicit

Dengan import:

```ftl
<#import "components/buttons.ftl" as buttons>

<@buttons.primary label="Save" href="/save" />
<@buttons.secondary label="Cancel" href="/cancel" />
```

Kita tahu bahwa `primary` berasal dari namespace `buttons`.

Ini jauh lebih maintainable daripada semua macro berada di global namespace.

### 9.3 Import cocok untuk design system

Contoh library:

`components/buttons.ftl`:

```ftl
<#macro primary label href>
  <a class="btn btn-primary" href="${href}">${label}</a>
</#macro>

<#macro secondary label href>
  <a class="btn btn-secondary" href="${href}">${label}</a>
</#macro>
```

Pemakaian:

```ftl
<#import "components/buttons.ftl" as buttons>

<@buttons.primary label="Submit" href=submitUrl />
```

Ini mulai membentuk component system.

### 9.4 Jangan import terlalu banyak di setiap template

Buruk:

```ftl
<#import "components/buttons.ftl" as buttons>
<#import "components/forms.ftl" as forms>
<#import "components/tables.ftl" as tables>
<#import "components/cards.ftl" as cards>
<#import "components/modals.ftl" as modals>
<#import "components/badges.ftl" as badges>
<#import "components/nav.ftl" as nav>
<#import "components/icons.ftl" as icons>
```

Jika hampir semua page perlu semua library, mungkin butuh central prelude:

```ftl
<#import "components/all.ftl" as ui>
```

Atau shared variables dari Java configuration. Tetapi jangan overdo: global convenience sering menurunkan clarity.

### 9.5 Versioning macro library

Untuk enterprise template platform, macro library bisa berubah. Jika template lama tergantung macro lama, perubahan bisa merusak rendering historis.

Strategi:

1. `components/v1/forms.ftl`;
2. `components/v2/forms.ftl`;
3. macro deprecation policy;
4. golden output regression;
5. template compatibility check;
6. publish process.

Contoh:

```ftl
<#import "components/v2/forms.ftl" as forms>
```

Ini lebih eksplisit daripada semua template diam-diam memakai latest component.

---

## 10. Namespace: Cara FreeMarker Mengelola Template-Made Variables

### 10.1 Apa itu namespace?

Dalam FreeMarker, variable yang dibuat oleh template seperti macro/function/assign berada dalam namespace. Template utama punya main namespace. Template yang di-import punya namespace sendiri.

Mental model:

```text
Data model/global variables
        |
Main namespace
        |-- assigned variables in main template
        |-- included template variables often interact with main namespace
        |
Imported namespace: forms
        |-- input macro
        |-- select macro
        |-- textarea macro
        |
Imported namespace: buttons
        |-- primary macro
        |-- secondary macro
```

Namespace mencegah nama bertabrakan.

Tanpa namespace, dua library bisa sama-sama punya macro `input`, `button`, `label`, `field`, dan konflik.

### 10.2 Macro adalah variable

Di FreeMarker, macro/function yang didefinisikan di template juga adalah variable dalam namespace. Ini penting untuk memahami `import`.

`forms.ftl`:

```ftl
<#macro input name label value="">
  <label for="${name}">${label}</label>
  <input id="${name}" name="${name}" value="${value}">
</#macro>
```

Ketika di-import:

```ftl
<#import "forms.ftl" as forms>
```

Maka macro `input` tersedia sebagai:

```ftl
<@forms.input name="email" label="Email" />
```

### 10.3 Jangan mengandalkan variable global tersembunyi

Buruk:

```ftl
<#global currentTenant = tenant>
```

Lalu banyak template memakai:

```ftl
${currentTenant.brandName}
```

Masalah:

1. susah tahu siapa yang membuat variable;
2. susah dites;
3. rawan konflik;
4. template menjadi order-dependent;
5. dependency tersembunyi.

Lebih baik model eksplisit:

```ftl
${branding.name}
${branding.logoUrl}
```

Atau macro parameter:

```ftl
<@layout.header branding=branding />
```

---

## 11. `#assign`, `#local`, `#global`: Variable Scope dan Smell

### 11.1 `#assign`

`#assign` membuat variable di current namespace.

```ftl
<#assign pageTitle = "Application Detail">
<h1>${pageTitle}</h1>
```

Boleh untuk alias atau small presentation helper.

Contoh acceptable:

```ftl
<#assign fullName = user.firstName + " " + user.lastName>
<p>${fullName}</p>
```

Tetapi untuk production, bahkan `fullName` sebaiknya sering disiapkan di Java, karena name formatting bisa locale-specific.

### 11.2 `#assign` untuk capture output

FreeMarker bisa assign block output:

```ftl
<#assign warningBlock>
  <div class="warning">
    ${warningMessage}
  </div>
</#assign>

${warningBlock}
```

Gunakan hati-hati. Ini bisa membantu composition, tetapi juga bisa membuat output flow sulit dilacak.

### 11.3 `#local`

`#local` digunakan di dalam macro/function untuk variable lokal.

```ftl
<#macro userLabel user>
  <#local label = user.displayName?trim>
  <span>${label}</span>
</#macro>
```

Gunakan `#local` dalam macro agar tidak mencemari namespace luar.

### 11.4 `#global`

`#global` membuat variable yang visible di semua namespace. Ini harus sangat jarang dipakai.

Contoh:

```ftl
<#global appName = "My Application">
```

Masalah:

1. global variable menyembunyikan data-model variable dengan nama sama;
2. efeknya meluas;
3. membuat template sulit diprediksi;
4. bisa merusak library import lain.

Rule:

> Dalam template production, treat `#global` sebagai code smell kecuali ada alasan arsitektural yang sangat jelas.

### 11.5 Assignment bukan tempat normalisasi data besar

Buruk:

```ftl
<#assign activeUsers = []>
<#list users as user>
  <#if user.active>
    <#assign activeUsers = activeUsers + [user]>
  </#if>
</#list>
```

Ini jelas business/data processing. Pindahkan ke Java.

Template:

```ftl
<#list activeUsers as user>
  ${user.displayName}
</#list>
```

---

## 12. `#include` vs `#import` vs Macro: Decision Table

| Kebutuhan | Gunakan | Alasan |
|---|---|---|
| Memasukkan static/shared output seperti footer | `#include` | sederhana dan langsung |
| Memakai reusable component dengan parameter | `#import` + macro | dependency explicit |
| Memakai design system template | macro library | composable |
| Memecah page besar jadi section statis | `#include` | acceptable jika context jelas |
| Membuat form field reusable | macro | perlu parameter dan local scope |
| Membuat button reusable | macro | parameterized output |
| Membuat dynamic document section berdasarkan state | selector di Java + template per section | hindari monster switch |
| Membuat common helper function | import function/macro | namespace safe |
| Memuat template berdasarkan runtime ID | Java renderer/template selector | lebih governable |

Rule ringkas:

```text
include = output composition dengan context implisit
import  = library composition dengan namespace eksplisit
macro   = reusable parameterized rendering unit
Java    = selection, rule, workflow, data shaping
```

---

## 13. Composition Patterns

### 13.1 Static include pattern

Cocok untuk fragment yang benar-benar statis atau nyaris statis.

```ftl
<#include "layout/legal-footer.ftl">
```

`legal-footer.ftl`:

```ftl
<footer>
  <p>This is a system-generated message.</p>
</footer>
```

### 13.2 Contextual include pattern

Cocok jika fragment memang bagian dari page dan dependency-nya jelas secara konvensi.

```ftl
<#assign pageTitle = "Case Detail">
<#include "layout/header.ftl">
```

Tetapi dokumentasikan bahwa `layout/header.ftl` butuh `pageTitle`, `currentUser`, `navigation`, dsb.

### 13.3 Macro component pattern

Cocok untuk komponen reusable.

```ftl
<#import "components/field.ftl" as field>

<@field.text
  name="email"
  label="Email"
  value=form.email
  error=form.errors.email!""
/>
```

Keuntungan:

1. parameter explicit;
2. reusable;
3. mudah dites;
4. local variable isolated;
5. dependency jelas.

### 13.4 Template selector pattern

Cocok untuk variasi besar.

Java:

```java
String templateName = switch (documentType) {
    case APPROVAL_LETTER -> "letters/approval.ftl";
    case REJECTION_LETTER -> "letters/rejection.ftl";
    case REQUEST_INFO -> "letters/request-info.ftl";
};
```

Template tidak melakukan switch besar. Application layer memilih template.

### 13.5 Section registry pattern

Cocok untuk correspondence/case document yang terdiri dari section.

```java
record DocumentRenderPlan(
    String shellTemplate,
    List<SectionTemplate> sections
) {}
```

Shell template:

```ftl
<#list sections as section>
  ${section.renderedHtml?no_esc}
</#list>
```

Catatan: `?no_esc` hanya aman jika `section.renderedHtml` berasal dari renderer internal trusted yang sudah escaping/output-format benar. Jangan pakai untuk user input mentah.

---

## 14. Whitespace dan Output Control

Template engine menghasilkan teks. Newline dan space juga output.

Contoh:

```ftl
<#if showGreeting>
  Hello ${name}
</#if>
```

Output bisa mengandung newline/indentasi. Untuk HTML ini sering tidak masalah. Untuk text/plain, CSV, JSON, generated source, fixed-width file, ini penting.

### 14.1 HTML whitespace tolerance

HTML umumnya toleran terhadap whitespace.

```html
<p>
  Hello Fajar
</p>
```

Masih valid.

### 14.2 Text email whitespace sensitivity

Text email:

```ftl
Dear ${recipientName},

<#if approved>
Your application has been approved.
<#else>
Your application is still being reviewed.
</#if>

Regards,
${senderName}
```

Whitespace harus sengaja dirancang agar email terlihat rapi.

### 14.3 CSV/JSON whitespace and separator sensitivity

Untuk JSON:

```ftl
{
  "items": [
    <#list items as item>
      {"name": "${item.name}"}<#sep>,</#sep>
    </#list>
  ]
}
```

Risiko:

1. escaping string JSON tidak sama dengan HTML escaping;
2. trailing comma;
3. newline tidak masalah tapi harus valid;
4. user data harus escaped sesuai JSON context.

Untuk JSON umum, gunakan Jackson. Gunakan FreeMarker hanya jika output adalah template text khusus yang tidak cocok dengan serializer biasa.

### 14.4 Whitespace control policy

Dalam tim, tentukan style:

1. apakah directive tag satu baris;
2. apakah include di top;
3. apakah macro import di top;
4. bagaimana indent HTML vs FTL;
5. bagaimana render text/plain;
6. apakah golden output memperhatikan whitespace exact.

Tanpa style, template besar cepat menjadi kacau.

---

## 15. Error Handling Directive: `#attempt` dan `#recover`

### 15.1 Bentuk dasar

```ftl
<#attempt>
  ${user.profile.address.city}
<#recover>
  Address unavailable
</#attempt>
```

Ini menangkap error di blok attempt dan merender fallback.

### 15.2 Jangan jadikan attempt sebagai pengganti model validation

Buruk:

```ftl
<#attempt>
  ${case.application.owner.contact.primaryEmail}
<#recover>
  N/A
</#attempt>
```

Ini menyembunyikan masalah data model. Jika field wajib hilang, rendering seharusnya gagal agar bug ditemukan.

Lebih baik:

```java
record OwnerView(String primaryEmailLabel) {}
```

Template:

```ftl
${owner.primaryEmailLabel}
```

### 15.3 Kapan `#attempt` acceptable?

Acceptable untuk optional degradation yang benar-benar presentation-level.

Contoh:

```ftl
<#attempt>
  <#include "optional/banner.ftl">
<#recover>
  <#-- Banner failure should not block entire page in this specific context -->
</#attempt>
```

Tetapi untuk email legal/regulatory, biasanya lebih baik fail-fast daripada mengirim dokumen tidak lengkap.

### 15.4 Error policy by artifact type

| Artifact | Error Policy Umum |
|---|---|
| Legal letter | fail fast |
| Payment receipt | fail fast |
| Case decision notice | fail fast |
| Marketing email optional banner | degrade gracefully |
| Admin dashboard widget | degrade per widget bisa acceptable |
| Audit document | fail fast |
| Generated config/source | fail fast |

Top engineer tidak bertanya “bisa recover atau tidak?”, tetapi “artifact ini boleh tidak kalau sebagian hilang?”

---

## 16. Template Logic Boundary

### 16.1 Logic yang boleh di template

Template boleh berisi:

1. show/hide section;
2. choose CSS class dari field yang sudah disiapkan;
3. loop list yang sudah disiapkan;
4. render optional display field;
5. choose label sederhana;
6. format presentational minor;
7. include/macro composition;
8. layout-specific branching.

Contoh:

```ftl
<#if showWarning>
  <div class="warning">${warningMessage}</div>
</#if>
```

### 16.2 Logic yang seharusnya di Java

Java/application layer harus menangani:

1. authorization;
2. workflow decision;
3. escalation rule;
4. state transition;
5. filtering;
6. sorting;
7. grouping;
8. aggregation;
9. currency calculation;
10. SLA calculation;
11. template selection;
12. recipient selection;
13. tenant resolution;
14. localization fallback policy;
15. default legal text selection;
16. data redaction;
17. model validation.

### 16.3 Gray area

Beberapa logic bisa berada di dua tempat:

1. date formatting;
2. number formatting;
3. CSS class mapping;
4. empty label;
5. status label;
6. minor pluralization.

Rule praktis:

Jika perubahan logic butuh approval bisnis, audit, unit test, atau berdampak ke keputusan, letakkan di Java/config/rule layer.

Jika perubahan hanya mengubah cara tampilan, boleh di template.

---

## 17. Designing a Good FreeMarker View Model for Directives

Template yang bersih biasanya lahir dari model yang bersih.

### 17.1 Buruk: raw domain model

```java
model.put("case", caseEntity);
model.put("user", currentUserEntity);
model.put("application", applicationEntity);
```

Template:

```ftl
<#if case.status.name() == "PENDING" && user.hasRole("SUPERVISOR") && application.type.code == "EA">
  ...
</#if>
```

Masalah:

1. method domain terekspos;
2. template bergantung pada entity structure;
3. lazy loading risk;
4. authorization leak;
5. business logic leak;
6. testing sulit.

### 17.2 Bagus: explicit view model

```java
record CaseDetailPageView(
    String pageTitle,
    CaseSummaryView summary,
    List<ActionButtonView> actions,
    List<TimelineItemView> timeline,
    boolean showAppealNotice,
    String appealNoticeMessage
) {}
```

Template:

```ftl
<h1>${pageTitle}</h1>

<section>
  <h2>${summary.referenceNo}</h2>
  <p>${summary.statusLabel}</p>
</section>

<#list actions as action>
  <a class="${action.cssClass}" href="${action.href}">${action.label}</a>
</#list>

<#if showAppealNotice>
  <div class="notice">${appealNoticeMessage}</div>
</#if>
```

Directive menjadi sederhana karena model sudah presentation-ready.

### 17.3 Model shape determines template complexity

Jika template punya banyak:

1. nested `#if`;
2. `??` berulang;
3. `?size gt 0` berulang;
4. filtering di loop;
5. status comparison string;
6. role checking;
7. map lookup ajaib;
8. repeated fallback;

maka masalahnya bukan FreeMarker. Masalahnya model design.

---

## 18. Anti-Patterns Besar di FTL Control Flow

### 18.1 Monster template

Satu file `.ftl` berisi semua variasi page/document.

Gejala:

1. ribuan line;
2. switch besar;
3. nested if 5 level;
4. include acak;
5. variable assign di banyak tempat;
6. sulit tahu output final.

Solusi:

1. pecah per document/page type;
2. gunakan template selector;
3. macro component;
4. layout shell;
5. golden tests.

### 18.2 Business rule in template

Gejala:

```ftl
<#if amount gt 1000000 && customer.riskScore gt 70 && approvalCount lt 2>
```

Solusi:

```ftl
<#if showHighValueRiskWarning>
```

### 18.3 Raw entity traversal

Gejala:

```ftl
${case.application.owner.organization.address.postalCode}
```

Solusi:

```ftl
${ownerPostalCode}
```

Atau structured view:

```ftl
${owner.address.postalCode}
```

Jika memang address view adalah part dari rendering contract.

### 18.4 Include dependency hidden

Gejala:

```ftl
<#include "fragments/action-panel.ftl">
```

Tetapi fragment diam-diam butuh 15 variable.

Solusi:

```ftl
<@caseComponents.actionPanel actions=actions currentState=currentState />
```

### 18.5 Global variable abuse

Gejala:

```ftl
<#global x = ...>
```

Solusi:

1. pass parameter;
2. use context object;
3. use namespace;
4. shape model in Java.

### 18.6 Template as query engine

Gejala:

```ftl
<#list cases as case>
  <#if case.officer.id == currentUser.id>
```

Solusi:

```java
model.put("myCases", caseQueryService.findMyCases(...));
```

### 18.7 Silent fallback everywhere

Gejala:

```ftl
${applicant.name!""}
${applicant.email!""}
${application.referenceNo!""}
${decision.date!""}
```

Untuk legal/official document, ini sangat berbahaya. Missing data harus fail fast.

Lebih baik:

1. validate model before render;
2. explicit optional labels;
3. fail if mandatory field missing.

---

## 19. Practical Style Guide untuk FTL Control Flow

### 19.1 Import di atas

```ftl
<#import "components/layout.ftl" as layout>
<#import "components/forms.ftl" as forms>
<#import "components/buttons.ftl" as buttons>
```

### 19.2 Page-level assignments setelah import

```ftl
<#assign pageTitle = "Case Detail">
```

Tetapi jangan banyak assign. Jika butuh banyak, bentuk model belum tepat.

### 19.3 Satu konsep per section

```ftl
<section class="case-summary">
  ...
</section>

<section class="case-timeline">
  ...
</section>
```

### 19.4 Conditional section diberi nama jelas

```ftl
<#if showApplicantWarning>
  <section class="warning">
    ${applicantWarningMessage}
  </section>
</#if>
```

### 19.5 Hindari kondisi kompleks inline

Buruk:

```ftl
<#if case.status == "OPEN" && case.canAppeal && !case.expired && user.role == "OFFICER">
```

Bagus:

```ftl
<#if showAppealAction>
```

### 19.6 Loop hanya atas list yang siap render

Buruk:

```ftl
<#list allEvents as event>
  <#if event.visibleToApplicant>
```

Bagus:

```ftl
<#list visibleTimelineEvents as event>
```

### 19.7 Empty state explicit

```ftl
<#list timelineEvents>
  <ol class="timeline">
    <#items as event>
      <li>${event.label}</li>
    </#items>
  </ol>
<#else>
  <p class="empty">No timeline events available.</p>
</#list>
```

### 19.8 No raw status string comparison in many places

Buruk:

```ftl
<#if status == "PENDING_APPROVAL">
```

Bagus:

```ftl
<#if showPendingApprovalBanner>
```

Atau:

```ftl
${statusLabel}
<span class="${statusCssClass}">${statusLabel}</span>
```

### 19.9 Comment intent, not obvious syntax

Buruk:

```ftl
<#-- Loop over cases -->
<#list cases as case>
```

Bagus:

```ftl
<#-- Regulatory requirement: show withdrawn cases in the timeline, but disable action links. -->
```

### 19.10 Keep artifact type in mind

HTML, email text, PDF HTML, XML, CSV, generated config, dan source code punya whitespace/escaping/formatting requirement berbeda. Jangan copy pattern HTML ke text/plain atau JSON.

---

## 20. Example: Dari Template Buruk ke Template Production-Grade

### 20.1 Versi buruk

```ftl
<h1>${case.application.type.name} - ${case.referenceNo}</h1>

<#if case.status == "PENDING" && user.roles?seq_contains("SUPERVISOR") && !case.locked>
  <a href="/case/${case.id}/approve">Approve</a>
</#if>

<#if case.status == "PENDING" && user.roles?seq_contains("SUPERVISOR") && !case.locked>
  <a href="/case/${case.id}/reject">Reject</a>
</#if>

<table>
<#list case.events as event>
  <#if event.visible>
    <tr>
      <td>${event.createdAt?string("yyyy-MM-dd")}</td>
      <td>${event.description}</td>
      <td>
        <#if event.actor??>
          ${event.actor.name}
        <#else>
          System
        </#if>
      </td>
    </tr>
  </#if>
</#list>
</table>

<#if case.application.owner.address?? && case.application.owner.address.postalCode??>
  <p>Postal Code: ${case.application.owner.address.postalCode}</p>
<#else>
  <p>Postal Code: -</p>
</#if>
```

Masalah:

1. business/authorization logic di template;
2. repeated condition;
3. raw entity traversal;
4. filtering events di template;
5. fallback tersebar;
6. date format hardcoded;
7. URL construction raw;
8. table empty state tidak ada.

### 20.2 View model yang lebih baik

```java
public record CaseDetailView(
    String pageTitle,
    List<ActionLinkView> actionLinks,
    List<TimelineEventView> visibleTimelineEvents,
    String ownerPostalCodeLabel
) {}

public record ActionLinkView(
    String label,
    String href,
    String cssClass
) {}

public record TimelineEventView(
    String createdDateLabel,
    String description,
    String actorLabel
) {}
```

### 20.3 Template lebih bersih

```ftl
<h1>${pageTitle}</h1>

<#list actionLinks>
  <div class="actions">
    <#items as action>
      <a class="${action.cssClass}" href="${action.href}">${action.label}</a>
    </#items>
  </div>
</#list>

<#list visibleTimelineEvents>
  <table class="timeline">
    <thead>
      <tr>
        <th>Date</th>
        <th>Description</th>
        <th>Actor</th>
      </tr>
    </thead>
    <tbody>
      <#items as event>
        <tr>
          <td>${event.createdDateLabel}</td>
          <td>${event.description}</td>
          <td>${event.actorLabel}</td>
        </tr>
      </#items>
    </tbody>
  </table>
<#else>
  <p class="empty">No timeline events available.</p>
</#list>

<p>Postal Code: ${ownerPostalCodeLabel}</p>
```

Template sekarang hanya melakukan rendering. Semua keputusan berat sudah disiapkan.

---

## 21. Example: Email Template dengan Control Flow yang Aman

### 21.1 Model

```java
public record DecisionEmailView(
    String recipientName,
    String applicationReferenceNo,
    String decisionLabel,
    boolean showAdditionalInfoSection,
    String additionalInfoMessage,
    List<NextStepView> nextSteps,
    String supportContactLabel
) {}

public record NextStepView(
    String label,
    String description
) {}
```

### 21.2 Template HTML email

```ftl
<!doctype html>
<html>
<body>
  <p>Dear ${recipientName},</p>

  <p>
    Your application <strong>${applicationReferenceNo}</strong>
    has been marked as <strong>${decisionLabel}</strong>.
  </p>

  <#if showAdditionalInfoSection>
    <p>${additionalInfoMessage}</p>
  </#if>

  <#list nextSteps>
    <h2>Next steps</h2>
    <ol>
      <#items as step>
        <li>
          <strong>${step.label}</strong><br>
          ${step.description}
        </li>
      </#items>
    </ol>
  </#list>

  <p>For assistance, contact ${supportContactLabel}.</p>
</body>
</html>
```

### 21.3 Kenapa ini bagus?

1. Tidak ada rule approval di template.
2. Tidak ada raw entity.
3. Optional section explicit.
4. Empty next steps tidak menghasilkan heading kosong.
5. Semua label sudah presentation-ready.
6. Cocok untuk golden output test.

---

## 22. Example: Document Template dengan Section Selector

Untuk dokumen case management, sering ada section yang bergantung pada state.

Jangan membuat satu template dengan switch besar:

```ftl
<#switch caseState>
  <#case "APPROVED">...</#case>
  <#case "REJECTED">...</#case>
  <#case "WITHDRAWN">...</#case>
</#switch>
```

Lebih baik Java memilih template:

```java
TemplateId templateId = documentTemplateCatalog.resolve(
    tenantId,
    documentType,
    caseState,
    effectiveDate
);

renderer.render(templateId, viewModel, renderContext);
```

Template `decision-approved.ftl`:

```ftl
<h1>Notice of Approval</h1>

<p>Dear ${recipientName},</p>

<p>
  Your application ${applicationReferenceNo} has been approved.
</p>

<#list conditions>
  <h2>Approval Conditions</h2>
  <ol>
    <#items as condition>
      <li>${condition.text}</li>
    </#items>
  </ol>
</#list>
```

Template `decision-rejected.ftl`:

```ftl
<h1>Notice of Rejection</h1>

<p>Dear ${recipientName},</p>

<p>
  Your application ${applicationReferenceNo} has been rejected.
</p>

<#list reasons>
  <h2>Reasons</h2>
  <ol>
    <#items as reason>
      <li>${reason.text}</li>
    </#items>
  </ol>
</#list>
```

Ini lebih defensible karena:

1. dokumen punya template ID jelas;
2. template bisa versioned;
3. approval/rejection punya golden output test terpisah;
4. audit record bisa menyimpan template ID/version;
5. legal text tidak tercampur.

---

## 23. Testing Implication dari Control Flow

Control flow memperbanyak jalur output. Jika ada 5 boolean independent, secara teoritis ada 32 kombinasi output.

Template test harus memilih kombinasi yang meaningful.

### 23.1 Test conditional branch

Untuk:

```ftl
<#if showWarning>
  <div class="warning">${warningMessage}</div>
</#if>
```

Test:

1. `showWarning = true`, warning muncul;
2. `showWarning = false`, warning tidak muncul.

### 23.2 Test empty list

Untuk:

```ftl
<#list rows>
  <table>...</table>
<#else>
  <p>No rows</p>
</#list>
```

Test:

1. rows kosong;
2. rows satu item;
3. rows banyak item.

### 23.3 Test escaping branch

Jika branch render user input, test bahwa input dangerous tetap escaped.

Data:

```text
<script>alert(1)</script>
```

Expected untuk HTML:

```html
&lt;script&gt;alert(1)&lt;/script&gt;
```

### 23.4 Test include/import regression

Jika fragment/macro berubah, semua template pengguna fragment harus dites.

Gunakan:

1. golden output;
2. component-level macro test;
3. page-level render test;
4. template dependency registry.

---

## 24. Production Review Checklist

Gunakan checklist ini saat review `.ftl` yang memakai directive.

### 24.1 Conditional

- [ ] Apakah condition hanya presentation logic?
- [ ] Apakah ada business rule tersembunyi?
- [ ] Apakah condition terlalu kompleks?
- [ ] Apakah boolean model dinamai jelas?
- [ ] Apakah repeated condition bisa digabung?
- [ ] Apakah branch wajib punya test?

### 24.2 Loop

- [ ] Apakah list sudah difilter/sorted/grouped di Java?
- [ ] Apakah empty state jelas?
- [ ] Apakah separator benar?
- [ ] Apakah nested loop memang sesuai struktur output?
- [ ] Apakah list size dibatasi?
- [ ] Apakah tidak memicu lazy loading/domain method call?

### 24.3 Include/import

- [ ] Apakah include dependency jelas?
- [ ] Apakah reusable component memakai macro/import?
- [ ] Apakah macro library punya namespace?
- [ ] Apakah fragment terlalu bergantung pada global context?
- [ ] Apakah template dependency bisa dilacak?

### 24.4 Scope

- [ ] Apakah `#assign` dipakai minimal?
- [ ] Apakah `#local` dipakai dalam macro?
- [ ] Apakah tidak ada `#global` tanpa alasan kuat?
- [ ] Apakah variable tidak menimpa model penting?
- [ ] Apakah nama variable jelas?

### 24.5 Error and fallback

- [ ] Apakah mandatory field fail-fast?
- [ ] Apakah fallback tidak menyembunyikan data bug?
- [ ] Apakah `#attempt` dipakai hanya untuk degradation yang acceptable?
- [ ] Apakah log/error policy jelas?

### 24.6 Output correctness

- [ ] Apakah escaping sesuai output context?
- [ ] Apakah whitespace penting sudah diuji?
- [ ] Apakah artifact type jelas: HTML/email/text/XML/CSV/PDF pre-render?
- [ ] Apakah output valid secara syntax?

---

## 25. Deep Mental Model: Template Complexity Harus Dipindahkan ke Bentuk yang Tepat

Tidak semua kompleksitas buruk. Sistem enterprise memang kompleks. Yang buruk adalah kompleksitas berada di layer yang salah.

Jika kompleksitas adalah:

1. decision complexity → letakkan di domain/application/rule layer;
2. data complexity → letakkan di query/mapper/view model layer;
3. composition complexity → letakkan di macro/layout/component system;
4. variation complexity → letakkan di template selector/catalog;
5. formatting complexity → letakkan di formatter/i18n layer;
6. security complexity → letakkan di model redaction + escaping policy;
7. output complexity → letakkan di artifact-specific renderer.

Template boleh kompleks secara visual, tetapi tidak boleh menjadi pusat keputusan.

Contoh:

```text
Bad complexity:
.ftl decides whether a case should be escalated.

Good complexity:
Java decides showEscalationNotice=true.
.ftl decides where and how to show that notice.
```

---

## 26. Java 8–25 Considerations

FTL syntax tidak banyak bergantung pada versi Java. Tetapi cara kamu menyiapkan model dan rendering service sangat dipengaruhi Java runtime dan language features.

### 26.1 Java 8 baseline

Dengan Java 8:

1. gunakan DTO class biasa;
2. `Optional` hati-hati, jangan expose mentah ke template;
3. `java.time` sudah tersedia;
4. gunakan immutable model sebisa mungkin;
5. builder/factory manual.

Contoh:

```java
public final class UserView {
    private final String displayName;
    private final boolean showWarning;

    public UserView(String displayName, boolean showWarning) {
        this.displayName = displayName;
        this.showWarning = showWarning;
    }

    public String getDisplayName() {
        return displayName;
    }

    public boolean isShowWarning() {
        return showWarning;
    }
}
```

### 26.2 Java 16+ records

Records sangat cocok untuk immutable view model.

```java
public record UserView(
    String displayName,
    boolean showWarning
) {}
```

Tetapi pastikan object wrapper/template access policy mengenali property record sesuai konfigurasi FreeMarker version/object wrapper.

### 26.3 Java 17+ production baseline

Java 17 umum sebagai LTS baseline modern. Gunakan:

1. records;
2. sealed interfaces untuk view variants;
3. pattern matching secara terbatas;
4. stronger encapsulation awareness;
5. modern GC.

Contoh sealed variant untuk render plan:

```java
sealed interface DecisionView permits ApprovalView, RejectionView {}

record ApprovalView(String referenceNo, List<String> conditions) implements DecisionView {}
record RejectionView(String referenceNo, List<String> reasons) implements DecisionView {}
```

Namun jangan expose sealed domain variant mentah ke template jika itu membuat template harus inspect class/type. Lebih baik selector memilih template spesifik.

### 26.4 Java 21+ virtual threads

Virtual threads bisa berguna untuk workload rendering yang banyak melakukan blocking I/O sekitar rendering, misalnya:

1. load template dari external store;
2. load image/font/resource;
3. write document to object storage;
4. send email.

Tetapi rendering template in-memory sendiri adalah CPU-bound/string-processing. Virtual thread tidak membuat CPU-bound rendering lebih cepat. Ia membantu concurrency model untuk blocking orchestration.

### 26.5 Java 25 mindset

Dengan Java modern, desain rendering service harus:

1. immutable by default;
2. explicit contracts;
3. structured error model;
4. strong testability;
5. safe concurrency;
6. minimal reflection exposure;
7. clear boundary between domain and view.

---

## 27. Reference Patterns yang Akan Dipakai di Part Berikutnya

Bagian ini menjadi dasar untuk Part 6 dan seterusnya.

Pattern yang akan terus dipakai:

1. `#if` hanya untuk presentational branch;
2. `#list` hanya untuk prepared collection;
3. `#items` untuk container-aware list rendering;
4. `#sep` untuk separator-safe output;
5. `#include` untuk partial output sederhana;
6. `#import` untuk macro library;
7. `#assign` minimal;
8. `#global` hampir tidak pernah;
9. selector di Java untuk variasi besar;
10. view model sebagai rendering contract;
11. golden tests untuk branch penting;
12. fail-fast untuk official/legal artifacts.

---

## 28. Mini Lab: Refactor Template Logic

### 28.1 Initial template

```ftl
<#list applications as app>
  <#if app.status == "PENDING" && app.type == "EA" && app.submittedAt??>
    <div>
      <h2>${app.referenceNo}</h2>
      <p>${app.applicant.name}</p>
      <#if user.roles?seq_contains("OFFICER") && !app.locked>
        <a href="/applications/${app.id}/review">Review</a>
      </#if>
    </div>
  </#if>
</#list>
```

### 28.2 Problems

1. filtering applications in template;
2. status/type business logic in template;
3. authorization/presentation mixed;
4. entity traversal;
5. URL construction raw;
6. no empty state;
7. conditional action rule in template.

### 28.3 Better view model

```java
record PendingApplicationDashboardView(
    List<ApplicationCardView> cards
) {}

record ApplicationCardView(
    String referenceNo,
    String applicantName,
    List<ActionLinkView> actions
) {}

record ActionLinkView(
    String label,
    String href,
    String cssClass
) {}
```

### 28.4 Refactored template

```ftl
<#list cards>
  <div class="application-grid">
    <#items as card>
      <article class="application-card">
        <h2>${card.referenceNo}</h2>
        <p>${card.applicantName}</p>

        <#list card.actions as action>
          <a class="${action.cssClass}" href="${action.href}">${action.label}</a>
        </#list>
      </article>
    </#items>
  </div>
<#else>
  <p class="empty">No pending applications.</p>
</#list>
```

### 28.5 Key learning

The better template is not better because it uses clever FTL. It is better because the model is designed for rendering.

---

## 29. Summary

Directive FreeMarker memberi template kemampuan untuk bercabang, mengulang, menggabungkan fragment, membuat variable, dan memakai library. Kemampuan ini penting, tetapi harus dibatasi oleh arsitektur.

Hal paling penting dari bagian ini:

1. `#if` adalah untuk presentational branch, bukan business rule.
2. `#list` adalah untuk prepared collection, bukan filtering/querying.
3. `#items` dan `#sep` membantu output yang lebih semantik dan valid.
4. `#include` cocok untuk partial output dengan context implisit yang terkendali.
5. `#import` cocok untuk macro library dengan namespace explicit.
6. `#assign` harus minimal; `#local` cocok untuk macro; `#global` hampir selalu smell.
7. Template complexity sering menandakan view model yang belum matang.
8. Large switch dan nested conditional harus diganti dengan selector, fragment, macro, atau model shaping.
9. Error recovery di template harus sesuai artifact policy.
10. Top engineer tidak hanya bisa menulis FTL, tetapi bisa menentukan logic mana yang pantas berada di FTL.

---

## 30. Checklist Pemahaman

Kamu dianggap memahami Part 5 jika bisa menjawab pertanyaan berikut:

1. Apa perbedaan `#include` dan `#import` secara mental model?
2. Kenapa repeated condition dalam template adalah smell?
3. Kapan `#switch` acceptable dan kapan harus diganti template selector?
4. Kenapa filtering list di template biasanya buruk?
5. Apa risiko `#global`?
6. Apa perbedaan context implisit include dan parameter explicit macro?
7. Bagaimana cara membuat empty state list yang HTML-nya semantik?
8. Kenapa `#attempt` tidak boleh dijadikan pengganti model validation?
9. Apa bedanya presentation decision dan business decision?
10. Bagaimana Java records membantu view model untuk FreeMarker?

---

## 31. Referensi Resmi dan Lanjutan

- Apache FreeMarker Manual — Directive Reference: `assign`, `if`, `list`, `include`, `import`, `macro`, `global`, `local`, `switch`, `attempt`, dan directive lain.
- Apache FreeMarker Manual — `list`, `else`, `items`, `sep`, `break`, `continue`.
- Apache FreeMarker Manual — Namespaces.
- Apache FreeMarker Manual — Defining variables in the template.
- Apache FreeMarker Manual — Shared variables.
- Apache FreeMarker Manual — Expressions and template language overview.
- Apache FreeMarker Manual — Output formats and auto-escaping.

---

## 32. Status Seri

```text
Part 5 selesai.
Seri belum selesai.
Berikutnya: Part 6 — FreeMarker Macros, Functions, Custom Directives, and Reusable Template APIs.
```
