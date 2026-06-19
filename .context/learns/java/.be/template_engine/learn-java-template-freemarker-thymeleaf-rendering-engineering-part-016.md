# learn-java-template-freemarker-thymeleaf-rendering-engineering-part-016

# Part 16 — Thymeleaf Layouts, Fragments, Components, and Design System

> Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`  
> Part: `016`  
> Topik: Thymeleaf layouts, fragments, reusable server-side components, dan design system engineering  
> Target Java: 8 sampai 25  
> Target pembaca: engineer yang sudah memahami Java web, Servlet/Spring MVC/Jakarta, security, validation, dan template rendering dasar

---

## 0. Posisi Part Ini Dalam Seri

Di part sebelumnya kita membahas:

- fundamental arsitektur Thymeleaf,
- expression model,
- DOM transformation,
- form binding,
- validation,
- dan error rendering.

Part ini naik satu level: dari **cara menulis satu halaman** menjadi **cara membangun sistem UI server-side yang konsisten, reusable, dan governable**.

Kalau Part 14 menjawab:

> Bagaimana Thymeleaf mengubah HTML menjadi output runtime?

Dan Part 15 menjawab:

> Bagaimana form, binding, dan error validation dirender secara benar?

Maka Part 16 menjawab:

> Bagaimana kita membangun banyak halaman Thymeleaf tanpa copy-paste, tanpa layout chaos, tanpa fragment dependency hell, dan tanpa membuat template menjadi mini-framework yang sulit dirawat?

---

## 1. Masalah Yang Diselesaikan Layout dan Fragment

Dalam aplikasi server-side rendered, halaman biasanya punya struktur berulang:

```text
html
└── body
    ├── header
    ├── sidebar
    ├── breadcrumb
    ├── page title
    ├── alert area
    ├── main content
    ├── footer
    └── scripts
```

Tanpa layout/fragments, setiap halaman akan mengulang struktur yang sama:

```html
<!DOCTYPE html>
<html>
<head>
  <title>...</title>
  <link rel="stylesheet" href="/assets/app.css">
</head>
<body>
  <header>...</header>
  <aside>...</aside>
  <main>...</main>
  <footer>...</footer>
</body>
</html>
```

Masalahnya bukan hanya copy-paste. Masalah sebenarnya adalah **inkonsistensi sistemik**.

Jika setiap page memiliki header, sidebar, error block, pagination, form field, button, dan table sendiri-sendiri, maka cepat atau lambat terjadi:

1. tampilan tidak konsisten,
2. aksesibilitas tidak konsisten,
3. authorization visibility tidak konsisten,
4. CSRF/form pattern tidak konsisten,
5. error message tidak konsisten,
6. naming dan CSS class berantakan,
7. perubahan layout global menjadi mahal,
8. bug security muncul di satu halaman tapi tidak di halaman lain,
9. maintenance bergantung pada ingatan manusia.

Top 1% engineer tidak melihat fragment sebagai “shortcut include HTML”. Ia melihat fragment sebagai **boundary reusable UI contract**.

---

## 2. Mental Model: Thymeleaf Fragment Adalah Template-Level Function

Thymeleaf fragment bisa dipahami seperti function di level markup.

Function Java:

```java
String badge(String label, String kind) {
    return "<span class='badge badge-" + kind + "'>" + label + "</span>";
}
```

Fragment Thymeleaf:

```html
<span th:fragment="badge(label, kind)"
      th:class="|badge badge-${kind}|"
      th:text="${label}">
  Draft
</span>
```

Pemanggilan:

```html
<span th:replace="~{fragments/ui :: badge('Approved', 'success')}"></span>
```

Tetapi ada perbedaan penting:

| Aspek | Java Function | Thymeleaf Fragment |
|---|---|---|
| Input | typed parameters | expression/context parameters |
| Output | object/value | DOM/markup fragment |
| Validation | compiler/runtime type check | mostly runtime/template tests |
| Side effect | possible | output transformation |
| Reuse boundary | code API | template API |
| Breakage | compile/test failure | often runtime rendering failure |

Karena fragment adalah API, maka harus diperlakukan seperti API:

- punya nama stabil,
- punya parameter jelas,
- punya default behavior,
- punya ownership,
- punya test,
- tidak terlalu banyak implicit dependency,
- tidak membaca global context sembarangan,
- tidak berubah breaking tanpa migration plan.

---

## 3. Thymeleaf Fragment Fundamentals

Thymeleaf menyediakan fragment melalui `th:fragment` dan fragment expression `~{...}`.

Contoh sederhana:

```html
<!-- templates/fragments/common.html -->
<footer th:fragment="footer">
  <p>&copy; 2026 Example Agency</p>
</footer>
```

Dipakai dari halaman:

```html
<footer th:replace="~{fragments/common :: footer}"></footer>
```

Maknanya:

```text
Ambil fragment bernama footer dari template fragments/common.html,
lalu replace elemen <footer> pemanggil dengan hasil fragment tersebut.
```

Ada tiga konsep yang harus dipisahkan:

| Konsep | Arti |
|---|---|
| fragment definition | markup yang diberi `th:fragment` |
| fragment expression | ekspresi `~{template :: fragment}` untuk menunjuk fragment |
| fragment insertion/replacement | cara memasukkan fragment ke DOM pemanggil |

---

## 4. `th:insert` vs `th:replace`

Dua operasi fragment paling penting adalah:

```html
<div th:insert="~{fragments/common :: footer}"></div>
<div th:replace="~{fragments/common :: footer}"></div>
```

Perbedaannya:

| Attribute | Efek |
|---|---|
| `th:insert` | memasukkan fragment sebagai child dari host element |
| `th:replace` | mengganti host element dengan fragment |

Misal fragment:

```html
<footer th:fragment="footer">
  <p>Footer content</p>
</footer>
```

Pemanggil:

```html
<div th:insert="~{fragments/common :: footer}"></div>
```

Output konseptual:

```html
<div>
  <footer>
    <p>Footer content</p>
  </footer>
</div>
```

Pemanggil:

```html
<div th:replace="~{fragments/common :: footer}"></div>
```

Output konseptual:

```html
<footer>
  <p>Footer content</p>
</footer>
```

Rule praktis:

| Kebutuhan | Gunakan |
|---|---|
| host element hanya placeholder | `th:replace` |
| host element memang wrapper semantik/layout | `th:insert` |
| ingin output DOM bersih | biasanya `th:replace` |
| ingin mempertahankan wrapper pemanggil | `th:insert` |

Kesalahan umum:

```html
<div th:insert="~{fragments/navbar :: nav}"></div>
```

Jika fragment `nav` sudah punya elemen `<nav>`, hasilnya menjadi:

```html
<div>
  <nav>...</nav>
</div>
```

Mungkin valid, tapi wrapper `<div>` sering tidak perlu dan dapat merusak CSS/layout.

---

## 5. Fragment Parameter

Fragment dapat menerima parameter.

```html
<!-- fragments/ui.html -->
<span th:fragment="statusBadge(label, tone)"
      th:class="|badge badge-${tone}|"
      th:text="${label}">
  Draft
</span>
```

Pemanggilan:

```html
<span th:replace="~{fragments/ui :: statusBadge('Approved', 'success')}"></span>
```

Output konseptual:

```html
<span class="badge badge-success">Approved</span>
```

Parameter membuat fragment menjadi reusable, tetapi juga membawa risiko.

Fragment buruk:

```html
<div th:fragment="casePanel(caseObj, user, permissions, mode, flags, config, pageState)">
  ...
</div>
```

Masalah:

- parameter terlalu banyak,
- fragment tahu terlalu banyak domain,
- sulit dites,
- sulit digunakan ulang,
- breaking change tinggi,
- responsibility blur.

Fragment lebih baik:

```html
<div th:fragment="summaryCard(title, subtitle, statusLabel, statusTone)">
  ...
</div>
```

Lebih baik lagi bila data kompleks disiapkan sebagai ViewModel kecil:

```java
public record SummaryCardView(
    String title,
    String subtitle,
    String statusLabel,
    String statusTone
) {}
```

Lalu fragment:

```html
<div th:fragment="summaryCard(card)" class="summary-card">
  <h2 th:text="${card.title}">Application #123</h2>
  <p th:text="${card.subtitle}">Submitted by...</p>
  <span th:replace="~{fragments/ui :: statusBadge(${card.statusLabel}, ${card.statusTone})}"></span>
</div>
```

---

## 6. Fragment Sebagai Component: Apa Bedanya?

Dalam frontend modern, “component” biasanya berarti unit UI yang punya:

- markup,
- style,
- behavior,
- props,
- state,
- lifecycle.

Thymeleaf fragment bukan component penuh seperti React/Vue component. Namun untuk SSR, fragment dapat berperan sebagai **server-rendered component** bila kita disiplin.

Perbandingan:

| Aspek | Thymeleaf Fragment | React/Vue Component |
|---|---|---|
| Runtime | server-side | client-side atau SSR/hybrid |
| Input | model/fragment params | props |
| State | server request model | client/server component state |
| Lifecycle | render request | mount/update/unmount |
| Interactivity | HTML + JS progressive enhancement | built-in reactive runtime |
| Best use | stable pages/forms/admin/correspondence | rich interaction |

Mental model sehat:

```text
Thymeleaf fragment = server-side presentational component.
Bukan reactive component.
Bukan domain service.
Bukan authorization engine.
Bukan business workflow executor.
```

---

## 7. Kategori Fragment Dalam Aplikasi Enterprise

Tidak semua fragment sejenis. Kategori membantu governance.

### 7.1 Layout Fragments

Contoh:

- page shell,
- header,
- sidebar,
- footer,
- breadcrumb area,
- flash message area.

Karakteristik:

- dipakai hampir semua halaman,
- perubahan berdampak luas,
- harus stabil,
- tidak boleh membaca domain model spesifik.

### 7.2 UI Primitive Fragments

Contoh:

- badge,
- button,
- alert,
- icon,
- pill,
- empty state,
- loading state.

Karakteristik:

- kecil,
- parameter sederhana,
- reusable lintas modul,
- tidak tahu domain.

### 7.3 Form Fragments

Contoh:

- text field,
- select field,
- textarea,
- checkbox group,
- radio group,
- date input,
- error block.

Karakteristik:

- sangat sensitif pada binding,
- harus konsisten dengan validation/error handling,
- harus mempertimbangkan accessibility.

### 7.4 Data Display Fragments

Contoh:

- table,
- pagination,
- filter panel,
- summary card,
- timeline,
- detail list.

Karakteristik:

- sering menerima ViewModel,
- raw entity exposure harus dihindari,
- pagination/sort harus jelas.

### 7.5 Domain-Specific Fragments

Contoh:

- case status badge,
- application summary panel,
- enforcement stage timeline,
- approval decision block,
- SLA warning banner.

Karakteristik:

- domain-aware,
- dimiliki module tertentu,
- tidak boleh masuk shared UI library global sembarangan.

### 7.6 Security-Aware Fragments

Contoh:

- action button yang hanya terlihat bila allowed,
- admin menu item,
- read-only vs editable field,
- masked sensitive field.

Karakteristik:

- hanya rendering visibility,
- bukan sumber kebenaran authorization,
- backend tetap wajib enforce permission.

---

## 8. Layout Strategy 1: Native Thymeleaf Fragments

Strategi native tidak butuh dependency tambahan.

Contoh struktur:

```text
src/main/resources/templates/
├── layouts/
│   └── base.html
├── fragments/
│   ├── shell.html
│   ├── nav.html
│   ├── forms.html
│   └── ui.html
└── cases/
    └── detail.html
```

`layouts/base.html`:

```html
<!DOCTYPE html>
<html lang="en" xmlns:th="http://www.thymeleaf.org">
<head th:fragment="head(pageTitle)">
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title th:text="${pageTitle}">Application</title>
  <link rel="stylesheet" th:href="@{/assets/app.css}">
</head>
<body>
<header th:replace="~{fragments/nav :: topNav}"></header>
<main>
  <!-- page content placeholder pattern handled by caller -->
</main>
<footer th:replace="~{fragments/shell :: footer}"></footer>
</body>
</html>
```

Page:

```html
<!DOCTYPE html>
<html lang="en" xmlns:th="http://www.thymeleaf.org">
<head th:replace="~{layouts/base :: head(${page.title})}"></head>
<body>
<header th:replace="~{fragments/nav :: topNav}"></header>
<main class="page">
  <h1 th:text="${page.title}">Case Detail</h1>
  <section>
    ...
  </section>
</main>
<footer th:replace="~{fragments/shell :: footer}"></footer>
</body>
</html>
```

Kelebihan:

- simple,
- official/native,
- mudah dipahami,
- dependency minimal,
- cocok untuk aplikasi kecil-menengah.

Kekurangan:

- page shell bisa tetap terduplikasi,
- sulit membuat inheritance-style layout,
- head/scripts per page perlu pola disiplin,
- composition bisa verbose.

---

## 9. Layout Strategy 2: Layout Dialect

Thymeleaf Layout Dialect adalah dialect tambahan yang populer untuk layout composition. Ia menyediakan konsep decoration/inheritance sehingga halaman dapat “mengisi” layout utama.

Contoh konseptual:

```html
<!-- layouts/main.html -->
<!DOCTYPE html>
<html xmlns:th="http://www.thymeleaf.org"
      xmlns:layout="http://www.ultraq.net.nz/thymeleaf/layout">
<head>
  <title layout:title-pattern="$CONTENT_TITLE - $LAYOUT_TITLE">App</title>
  <link rel="stylesheet" th:href="@{/assets/app.css}">
</head>
<body>
<header th:replace="~{fragments/nav :: topNav}"></header>
<main layout:fragment="content">
  <p>Default content</p>
</main>
<footer th:replace="~{fragments/shell :: footer}"></footer>
</body>
</html>
```

Page:

```html
<!DOCTYPE html>
<html xmlns:th="http://www.thymeleaf.org"
      xmlns:layout="http://www.ultraq.net.nz/thymeleaf/layout"
      layout:decorate="~{layouts/main}">
<head>
  <title>Case Detail</title>
</head>
<body>
<main layout:fragment="content">
  <h1 th:text="${page.title}">Case Detail</h1>
  <section>...</section>
</main>
</body>
</html>
```

Kelebihan:

- page lebih bersih,
- layout inheritance lebih natural,
- cocok untuk banyak halaman dengan shell sama,
- lebih dekat ke konsep decorator.

Kekurangan:

- dependency tambahan,
- perlu pemahaman dialect,
- debugging bisa lebih tidak langsung,
- migration/version compatibility harus dikelola.

Rule praktis:

| Situasi | Rekomendasi |
|---|---|
| aplikasi kecil | native fragments cukup |
| banyak page dengan shell sama | layout dialect layak |
| tim baru belajar Thymeleaf | mulai native dulu |
| butuh page inheritance jelas | layout dialect |
| dependency governance ketat | native fragments |

---

## 10. Layout Strategy 3: Component-Like Fragments

Strategi ini membangun library fragment seperti design system.

Contoh:

```text
templates/fragments/
├── components/
│   ├── alert.html
│   ├── badge.html
│   ├── button.html
│   ├── card.html
│   ├── form-field.html
│   ├── modal.html
│   ├── pagination.html
│   └── table.html
└── domain/
    ├── case-status.html
    └── sla-banner.html
```

`components/alert.html`:

```html
<div th:fragment="alert(type, title, message)"
     th:class="|alert alert-${type}|"
     role="alert">
  <strong th:text="${title}">Information</strong>
  <p th:text="${message}">Message</p>
</div>
```

Usage:

```html
<div th:replace="~{fragments/components/alert :: alert('warning', 'Review required', ${page.reviewMessage})}"></div>
```

Component-like fragments harus sederhana. Bila fragment membutuhkan banyak logic, itu sinyal bahwa kita butuh:

- ViewModel lebih baik,
- helper service sebelum rendering,
- atau memecah fragment.

---

## 11. Page Shell Pattern

Page shell adalah layout global yang mengatur struktur dasar halaman.

Komponen umum:

```text
PageShell
├── HtmlHead
├── GlobalHeader
├── Sidebar
├── Breadcrumb
├── FlashMessages
├── MainContent slot
├── Footer
└── Script area
```

Native fragment pattern bisa menggunakan fragment parameter untuk body/content, tapi di Thymeleaf native ini cepat menjadi canggung karena kita ingin melewatkan markup sebagai slot.

Dengan layout dialect, shell biasanya lebih nyaman.

Namun konsep yang lebih penting adalah separation:

| Bagian | Sumber data |
|---|---|
| title | page model |
| nav active item | navigation model |
| user menu | session/principal view model |
| alerts | flash/request model |
| content | page-specific view model |
| scripts | page asset metadata |

Jangan biarkan shell membaca semua object global sembarangan.

Buruk:

```html
<header>
  <span th:text="${session.user.organization.profile.displayName}"></span>
</header>
```

Lebih baik:

```html
<header>
  <span th:text="${shell.currentOrganizationName}"></span>
</header>
```

Controller/advice menyiapkan `shell`:

```java
public record ShellView(
    String currentUserName,
    String currentOrganizationName,
    List<NavigationItemView> navigation,
    List<FlashMessageView> flashMessages
) {}
```

---

## 12. Navigation Fragment

Navigation sering terlihat sederhana, tetapi sebenarnya banyak edge case:

- active menu,
- permission-based visibility,
- nested menu,
- mobile collapse,
- current module,
- unread count/badge,
- external link,
- accessibility,
- keyboard navigation.

Contoh model:

```java
public record NavigationItemView(
    String label,
    String href,
    String icon,
    boolean active,
    boolean visible,
    List<NavigationItemView> children
) {}
```

Fragment:

```html
<nav th:fragment="sideNav(items)" aria-label="Main navigation">
  <ul class="nav-list">
    <li th:each="item : ${items}"
        th:if="${item.visible}">
      <a th:href="@{${item.href}}"
         th:classappend="${item.active} ? ' is-active' : ''"
         th:aria-current="${item.active} ? 'page' : null">
        <span th:text="${item.label}">Menu</span>
      </a>

      <ul th:if="${item.children != null and !item.children.isEmpty()}">
        <li th:each="child : ${item.children}"
            th:if="${child.visible}">
          <a th:href="@{${child.href}}"
             th:classappend="${child.active} ? ' is-active' : ''"
             th:text="${child.label}">Child</a>
        </li>
      </ul>
    </li>
  </ul>
</nav>
```

Important invariant:

```text
UI visibility is not authorization enforcement.
```

Jika tombol/menu disembunyikan di UI, backend tetap harus menolak request unauthorized.

---

## 13. Breadcrumb Fragment

Breadcrumb membantu orientasi pengguna.

Model:

```java
public record BreadcrumbItemView(
    String label,
    String href,
    boolean current
) {}
```

Fragment:

```html
<nav th:fragment="breadcrumb(items)" aria-label="Breadcrumb">
  <ol class="breadcrumb">
    <li th:each="item : ${items}"
        th:classappend="${item.current} ? ' is-current' : ''">
      <a th:if="${!item.current}"
         th:href="@{${item.href}}"
         th:text="${item.label}">Home</a>
      <span th:if="${item.current}"
            aria-current="page"
            th:text="${item.label}">Current</span>
    </li>
  </ol>
</nav>
```

Design rule:

- breadcrumb bukan hasil parsing URL mentah,
- breadcrumb harus berasal dari page/navigation model,
- current page harus jelas,
- jangan membuat breadcrumb logic kompleks di template.

---

## 14. Alert and Flash Message Fragment

Flash messages umum setelah redirect.

Model:

```java
public record FlashMessageView(
    String type,       // success, warning, danger, info
    String title,
    String message
) {}
```

Fragment:

```html
<section th:fragment="flashMessages(messages)"
         th:if="${messages != null and !messages.isEmpty()}"
         aria-label="Notifications">
  <div th:each="msg : ${messages}"
       th:class="|alert alert-${msg.type}|"
       role="alert">
    <strong th:text="${msg.title}">Success</strong>
    <p th:text="${msg.message}">Saved successfully.</p>
  </div>
</section>
```

Security note:

- gunakan `th:text`, bukan `th:utext`,
- jangan render raw exception message ke user,
- jangan masukkan PII sensitif ke flash message,
- untuk production, pesan teknis masuk log, user message tetap aman.

---

## 15. Empty State Fragment

Empty state sering diremehkan, padahal berdampak besar pada UX.

Fragment:

```html
<section th:fragment="emptyState(title, message, actionLabel, actionHref)"
         class="empty-state">
  <h2 th:text="${title}">No records found</h2>
  <p th:text="${message}">Try adjusting your filters.</p>
  <a th:if="${actionLabel != null and actionHref != null}"
     class="button button-primary"
     th:href="@{${actionHref}}"
     th:text="${actionLabel}">Create</a>
</section>
```

Usage:

```html
<div th:if="${page.items.isEmpty()}"
     th:replace="~{fragments/components/empty-state :: emptyState(
       'No cases found',
       'Try changing the filter or create a new case.',
       null,
       null
     )}">
</div>
```

Top 1% detail:

Empty state sebaiknya dibedakan:

| Empty Type | Meaning | UX |
|---|---|---|
| no data yet | system benar-benar belum punya data | CTA create/import |
| no search result | filter/search tidak menemukan data | suggest reset filter |
| no permission | user tidak boleh melihat data | jangan bocorkan existence |
| load failed | data tidak bisa dimuat | retry/contact support |

Jangan satu fragment “No data” dipakai untuk semua situasi tanpa makna.

---

## 16. Button Fragment

Button kelihatannya trivial, tetapi di enterprise app button sering membawa:

- style variant,
- type submit/button/link,
- disabled state,
- permission visibility,
- icon,
- confirmation,
- loading behavior,
- accessibility label.

Fragment sederhana:

```html
<button th:fragment="button(label, variant, type, disabled)"
        th:type="${type} ?: 'button'"
        th:class="|button button-${variant ?: 'secondary'}|"
        th:disabled="${disabled}"
        th:text="${label}">
  Save
</button>
```

Tetapi untuk link-button:

```html
<a th:fragment="linkButton(label, variant, href)"
   th:href="@{${href}}"
   th:class="|button button-${variant ?: 'secondary'}|"
   th:text="${label}">
  View
</a>
```

Jangan menyatukan terlalu banyak perilaku dalam satu fragment:

```html
<!-- terlalu pintar -->
<button th:fragment="megaButton(label, variant, href, method, csrf, confirm, icon, modal, ajax, permission, disabled, analytics)">
```

Itu bukan design system; itu coupling system.

---

## 17. Form Field Component Pattern

Form field adalah kandidat fragment paling berguna.

Tujuan:

- label konsisten,
- error konsisten,
- help text konsisten,
- required marker konsisten,
- CSS class konsisten,
- accessibility konsisten.

Contoh basic field:

```html
<!-- fragments/forms.html -->
<div th:fragment="textField(fieldName, label, placeholder, required)"
     class="form-field"
     th:classappend="${#fields.hasErrors(fieldName)} ? ' has-error' : ''">

  <label th:for="${#ids.next(fieldName)}">
    <span th:text="${label}">Field</span>
    <span th:if="${required}" aria-hidden="true">*</span>
  </label>

  <input type="text"
         th:field="*{__${fieldName}__}"
         th:placeholder="${placeholder}"
         th:aria-invalid="${#fields.hasErrors(fieldName)}" />

  <p class="field-error"
     th:if="${#fields.hasErrors(fieldName)}"
     th:errors="*{__${fieldName}__}">
    Error message
  </p>
</div>
```

Namun ada catatan penting: fragment dengan dynamic `th:field` seperti ini harus diuji serius, karena dynamic field expression bisa mudah menjadi sulit dibaca dan tergantung versi/konfigurasi parser.

Alternatif yang lebih eksplisit:

```html
<div class="form-field"
     th:classappend="${#fields.hasErrors('name')} ? ' has-error' : ''">
  <label for="name">Name</label>
  <input id="name" type="text" th:field="*{name}">
  <p th:if="${#fields.hasErrors('name')}" th:errors="*{name}"></p>
</div>
```

Trade-off:

| Pattern | Kelebihan | Kekurangan |
|---|---|---|
| generic form field fragment | konsisten, DRY | lebih kompleks, debugging lebih sulit |
| explicit field markup | mudah dibaca | repetitif |
| hybrid | balance | butuh guideline |

Rekomendasi enterprise:

```text
Gunakan reusable fragments untuk wrapper, label, error, help text.
Tetap pertimbangkan explicit th:field untuk field kompleks.
```

---

## 18. Table/List Component Pattern

Table sering menjadi sumber coupling antara UI dan query logic.

Fragment table yang terlalu generik biasanya buruk:

```html
<table th:fragment="table(columns, rows, actions, sort, filter, permissions, formatters)">
```

Itu mencoba membangun UI framework di template.

Lebih baik pisahkan:

1. table shell,
2. header cell,
3. pagination,
4. empty state,
5. domain-specific row markup tetap di page.

Contoh:

```html
<div th:fragment="tableShell(title)" class="table-shell">
  <div class="table-shell-header">
    <h2 th:text="${title}">Results</h2>
  </div>
  <div class="table-shell-body">
    <th:block th:insert="~{::tableContent}"></th:block>
  </div>
</div>
```

Namun native Thymeleaf slot-like composition bisa kurang nyaman. Alternatif pragmatic:

```html
<section class="table-shell">
  <header>
    <h2>Cases</h2>
  </header>

  <table>
    <thead>...</thead>
    <tbody>
      <tr th:each="row : ${page.rows}">
        ...
      </tr>
    </tbody>
  </table>

  <nav th:replace="~{fragments/components/pagination :: pagination(${page.pagination})}"></nav>
</section>
```

Rule:

```text
Jangan membuat table fragment terlalu generik sampai template menjadi reflection-based renderer.
```

Server-side table yang baik membutuhkan model yang sudah siap:

```java
public record CaseListPageView(
    List<CaseRowView> rows,
    PaginationView pagination,
    CaseFilterView filter,
    List<FlashMessageView> messages
) {}
```

---

## 19. Pagination Fragment

Model:

```java
public record PaginationView(
    int page,
    int size,
    long totalItems,
    int totalPages,
    boolean hasPrevious,
    boolean hasNext,
    String previousHref,
    String nextHref,
    List<PageLinkView> links
) {}

public record PageLinkView(
    int page,
    String label,
    String href,
    boolean current
) {}
```

Fragment:

```html
<nav th:fragment="pagination(p)"
     th:if="${p != null and p.totalPages > 1}"
     aria-label="Pagination">
  <ul class="pagination">
    <li>
      <a th:if="${p.hasPrevious}"
         th:href="@{${p.previousHref}}">Previous</a>
      <span th:if="${!p.hasPrevious}" aria-disabled="true">Previous</span>
    </li>

    <li th:each="link : ${p.links}">
      <a th:if="${!link.current}"
         th:href="@{${link.href}}"
         th:text="${link.label}">1</a>
      <span th:if="${link.current}"
            aria-current="page"
            th:text="${link.label}">1</span>
    </li>

    <li>
      <a th:if="${p.hasNext}"
         th:href="@{${p.nextHref}}">Next</a>
      <span th:if="${!p.hasNext}" aria-disabled="true">Next</span>
    </li>
  </ul>
</nav>
```

Important design decision:

```text
URL construction for pagination should mostly happen in Java, not in template.
```

Kenapa?

- query parameter preservation lebih kompleks daripada terlihat,
- filter/sort state harus stabil,
- canonical URL behavior harus konsisten,
- template tidak cocok untuk URL state machine.

---

## 20. Modal/Dialog Fragment

Server-rendered modal bisa dipakai untuk simple confirmation atau progressive enhancement.

Fragment:

```html
<div th:fragment="confirmDialog(id, title, message, confirmLabel)"
     th:id="${id}"
     class="modal"
     role="dialog"
     aria-modal="true"
     th:aria-labelledby="|${id}-title|"
     hidden>
  <div class="modal-panel">
    <h2 th:id="|${id}-title|" th:text="${title}">Confirm</h2>
    <p th:text="${message}">Are you sure?</p>
    <div class="modal-actions">
      <button type="button" data-modal-close>Cancel</button>
      <button type="submit" class="button-danger" th:text="${confirmLabel}">Confirm</button>
    </div>
  </div>
</div>
```

Caveat:

- focus trap perlu JavaScript,
- ESC close perlu JavaScript,
- screen reader behavior harus diuji,
- destructive action tetap harus divalidasi backend,
- confirmation modal bukan security boundary.

---

## 21. Accessibility-Aware Fragment Design

Reusable fragment adalah tempat terbaik untuk enforce accessibility.

Checklist:

| Component | Accessibility Concern |
|---|---|
| alert | `role="alert"`, tidak spam screen reader |
| nav | `aria-label`, active item `aria-current` |
| breadcrumb | `aria-label="Breadcrumb"`, current item |
| pagination | `aria-label`, current page |
| modal | `role="dialog"`, `aria-modal`, focus management |
| form field | label associated with input, error association |
| icon button | accessible label |
| table | semantic header, caption if needed |

Buruk:

```html
<button><i class="icon-trash"></i></button>
```

Lebih baik:

```html
<button type="button" aria-label="Delete case">
  <i class="icon-trash" aria-hidden="true"></i>
</button>
```

Jika fragment button mendukung icon-only mode, parameter accessible label wajib.

---

## 22. Design System Mapping

Design system bukan hanya CSS. Dalam SSR Thymeleaf, design system memiliki beberapa layer:

```text
Design Tokens
  ↓
CSS Utilities / Component Classes
  ↓
Thymeleaf UI Primitive Fragments
  ↓
Application-Level Components
  ↓
Domain-Specific Page Composition
```

Contoh:

| Layer | Contoh |
|---|---|
| token | spacing scale, colors, typography |
| CSS class | `.button`, `.alert`, `.badge` |
| primitive fragment | `button`, `alert`, `badge` |
| app component | `summaryCard`, `pagination`, `filterPanel` |
| domain component | `caseStatusTimeline`, `slaBanner` |

Jangan mencampur semua layer.

Buruk:

```html
<div th:fragment="caseStatusBadge(case)"
     th:style="${case.urgent} ? 'color:red;font-weight:bold' : 'color:gray'">
```

Lebih baik:

```html
<span th:fragment="caseStatusBadge(status)"
      th:class="|badge badge-${status.tone}|"
      th:text="${status.label}">
  Pending
</span>
```

Java menentukan tone:

```java
public record StatusView(String label, String tone) {}
```

CSS menentukan visual.

---

## 23. Fragment Naming Convention

Tanpa convention, fragment library cepat kacau.

Rekomendasi struktur:

```text
templates/fragments/
├── layout/
│   ├── shell.html
│   ├── head.html
│   ├── header.html
│   ├── sidebar.html
│   └── footer.html
├── components/
│   ├── alert.html
│   ├── badge.html
│   ├── button.html
│   ├── card.html
│   ├── empty-state.html
│   ├── pagination.html
│   └── modal.html
├── forms/
│   ├── field.html
│   ├── errors.html
│   └── controls.html
└── domain/
    ├── case/
    │   ├── status.html
    │   ├── timeline.html
    │   └── summary.html
    └── application/
        └── summary.html
```

Naming convention:

```text
file: kebab-case.html
fragment: camelCase or lowerCamelCase
parameter: descriptive lowerCamelCase
```

Example:

```html
<div th:fragment="summaryCard(card)"></div>
<span th:fragment="statusBadge(label, tone)"></span>
<nav th:fragment="pagination(pagination)"></nav>
```

Hindari:

```html
<div th:fragment="x(a,b,c)"></div>
<div th:fragment="renderThing(data)"></div>
<div th:fragment="common"></div>
```

---

## 24. Fragment Parameter Design Rules

Parameter fragment harus dirancang seperti API.

### 24.1 Prefer Few Parameters

Baik:

```html
<div th:fragment="alert(type, title, message)"></div>
```

Buruk:

```html
<div th:fragment="alert(type, title, message, closable, timeout, icon, analyticsKey, role, cssClass, id)"></div>
```

Jika parameter > 4–5, pertimbangkan ViewModel:

```java
public record AlertView(
    String type,
    String title,
    String message,
    boolean closable
) {}
```

Fragment:

```html
<div th:fragment="alert(alert)"></div>
```

### 24.2 Avoid Boolean Explosion

Buruk:

```html
<div th:fragment="button(label, primary, danger, outline, small, disabled)"></div>
```

Lebih baik:

```html
<button th:fragment="button(label, variant, size, disabled)"></button>
```

### 24.3 Use Domain-Neutral Names for Shared Components

Buruk untuk shared component:

```html
<div th:fragment="applicationAlert(application)"></div>
```

Baik:

```html
<div th:fragment="alert(alert)"></div>
```

Domain-specific tetap boleh, tetapi letakkan di folder domain.

### 24.4 Prefer Precomputed View State

Buruk:

```html
<span th:class="${case.dueDate.isBefore(T(java.time.LocalDate).now())} ? 'danger' : 'normal'"></span>
```

Lebih baik:

```html
<span th:class="|badge badge-${case.slaTone}|" th:text="${case.slaLabel}"></span>
```

Java:

```java
public record CaseRowView(
    String id,
    String title,
    String slaLabel,
    String slaTone
) {}
```

---

## 25. Avoiding Implicit Context Coupling

Fragment bisa membaca variable dari context pemanggil. Ini fleksibel, tetapi berbahaya.

Buruk:

```html
<!-- fragments/card.html -->
<div th:fragment="caseCard">
  <h2 th:text="${case.title}">Title</h2>
  <p th:text="${currentUser.name}">User</p>
  <span th:text="${permissions.canEdit}">true</span>
</div>
```

Pemanggil tidak terlihat mengirim apa pun:

```html
<div th:replace="~{fragments/card :: caseCard}"></div>
```

Masalah:

- dependency tersembunyi,
- fragment sulit dites,
- variable name conflict,
- perubahan page model bisa merusak fragment.

Lebih baik:

```html
<div th:fragment="caseCard(card)">
  <h2 th:text="${card.title}">Title</h2>
  <p th:text="${card.ownerName}">Owner</p>
  <a th:if="${card.canEdit}" th:href="@{${card.editHref}}">Edit</a>
</div>
```

Pemanggil eksplisit:

```html
<div th:replace="~{fragments/domain/case/summary :: caseCard(${page.caseCard})}"></div>
```

Rule:

```text
Shared fragments should be explicit.
Layout fragments may use a small, controlled global shell model.
```

---

## 26. Fragment Dependency Hell

Fragment dependency hell terjadi saat fragment saling memanggil secara tidak terkendali.

Contoh buruk:

```text
page/detail.html
  -> fragments/case/card.html
      -> fragments/common/status.html
          -> fragments/security/permission.html
              -> fragments/layout/sidebar.html
                  -> fragments/case/card.html
```

Gejala:

- sulit tahu output final,
- sulit debug,
- fragment A berubah, page Z rusak,
- cyclic mental dependency,
- performance tidak terprediksi,
- ownership kabur.

Pencegahan:

1. buat layering jelas,
2. fragment domain boleh memakai primitive UI,
3. primitive UI tidak boleh memakai domain fragment,
4. layout boleh memakai primitive/layout fragment,
5. primitive tidak boleh baca shell/page model,
6. hindari deep nesting fragment > 3–4 level.

Layering sehat:

```text
Page
  ↓
Domain fragments
  ↓
Application components
  ↓
UI primitives
  ↓
Raw HTML/CSS classes
```

Arah dependency tidak boleh naik.

---

## 27. Fragment Versioning

Dalam aplikasi besar, fragment berubah. Perubahan bisa breaking.

Contoh fragment lama:

```html
<span th:fragment="badge(label, tone)"></span>
```

Kemudian ingin menambah icon:

```html
<span th:fragment="badge(label, tone, icon)"></span>
```

Jika semua caller harus berubah, ini breaking.

Strategi:

### 27.1 Add Optional Default Internally

```html
<span th:fragment="badge(label, tone)"
      th:class="|badge badge-${tone}|">
  <span th:text="${label}">Label</span>
</span>
```

Buat fragment baru untuk icon:

```html
<span th:fragment="badgeWithIcon(label, tone, icon)"></span>
```

### 27.2 Use ViewModel

```java
public record BadgeView(
    String label,
    String tone,
    String icon
) {}
```

Template bisa handle icon null:

```html
<span th:fragment="badge(badge)" th:class="|badge badge-${badge.tone}|">
  <i th:if="${badge.icon != null}" th:class="|icon icon-${badge.icon}|" aria-hidden="true"></i>
  <span th:text="${badge.label}">Label</span>
</span>
```

### 27.3 Parallel Version

```html
<span th:fragment="badgeV1(label, tone)"></span>
<span th:fragment="badgeV2(badge)"></span>
```

Gunakan bila perubahan besar dan migrasi bertahap.

---

## 28. Fragment Testing Strategy

Fragment harus dites. Bukan hanya page penuh.

Jenis test:

| Test | Tujuan |
|---|---|
| render smoke test | fragment bisa dirender dengan model minimal |
| golden HTML test | output stabil |
| escaping test | data berbahaya ter-escape |
| accessibility snapshot | atribut penting ada |
| missing field test | error jelas saat model tidak lengkap |
| integration page test | fragment bekerja dalam page nyata |

Contoh pseudo-test Spring:

```java
@Test
void rendersStatusBadgeSafely() {
    Context context = new Context(Locale.ENGLISH);
    context.setVariable("label", "<script>alert(1)</script>");
    context.setVariable("tone", "success");

    String html = templateEngine.process(
        "fragments/components/badge :: badge(${label}, ${tone})",
        context
    );

    assertThat(html).contains("&lt;script&gt;");
    assertThat(html).doesNotContain("<script>");
}
```

Catatan: cara memproses fragment langsung bisa berbeda tergantung setup; dalam beberapa project lebih mudah membuat test host template kecil yang memanggil fragment.

---

## 29. CSS and Asset Strategy

Fragment tidak boleh membawa style inline sembarangan.

Buruk:

```html
<div th:fragment="alert(type, msg)"
     th:style="${type == 'danger'} ? 'background:red;color:white' : 'background:blue;color:white'">
```

Baik:

```html
<div th:fragment="alert(type, msg)"
     th:class="|alert alert-${type}|">
  <p th:text="${msg}">Message</p>
</div>
```

CSS:

```css
.alert { ... }
.alert-danger { ... }
.alert-info { ... }
```

Untuk per-page CSS/JS, jangan semua fragment bebas menambahkan `<script>` sendiri.

Strategi:

1. global assets di layout,
2. page-specific assets di page metadata,
3. component JS melalui progressive enhancement berbasis data-attribute,
4. hindari inline JavaScript dengan interpolasi data mentah.

Contoh:

```html
<button type="button"
        data-confirm
        data-confirm-message="Delete this record?">
  Delete
</button>
```

JS global membaca attribute tersebut.

---

## 30. JavaScript Integration: Progressive Enhancement

Thymeleaf cocok untuk SSR. Interaktivitas ringan bisa memakai progressive enhancement.

Pattern:

```html
<div th:fragment="collapsible(id, title)" class="collapsible" th:id="${id}">
  <button type="button"
          class="collapsible-trigger"
          th:aria-controls="|${id}-panel|"
          aria-expanded="false">
    <span th:text="${title}">Details</span>
  </button>
  <div th:id="|${id}-panel|" class="collapsible-panel" hidden>
    <th:block th:insert="~{::content}"></th:block>
  </div>
</div>
```

Namun slot-like nested content dengan native fragments perlu desain hati-hati. Untuk interaksi kompleks:

- gunakan HTMX/Alpine kecil bila cocok,
- atau pindahkan bagian tertentu ke SPA component,
- jangan memaksa Thymeleaf menjadi reactive framework.

Decision rule:

| Interaksi | Cocok Thymeleaf? |
|---|---|
| form CRUD biasa | sangat cocok |
| table paginated server-side | cocok |
| admin workflow page | cocok |
| dashboard real-time banyak widget | pertimbangkan hybrid |
| drag-drop complex UI | biasanya SPA lebih cocok |
| collaborative editing | bukan Thymeleaf-only |

---

## 31. Authorization-Aware Components

Misal action bar:

```java
public record CaseActionBarView(
    boolean canEdit,
    boolean canApprove,
    boolean canReject,
    String editHref,
    String approveHref,
    String rejectHref
) {}
```

Fragment:

```html
<div th:fragment="caseActions(actions)" class="action-bar">
  <a th:if="${actions.canEdit}"
     th:href="@{${actions.editHref}}"
     class="button button-secondary">Edit</a>

  <form th:if="${actions.canApprove}"
        th:action="@{${actions.approveHref}}"
        method="post">
    <button type="submit" class="button button-primary">Approve</button>
  </form>

  <form th:if="${actions.canReject}"
        th:action="@{${actions.rejectHref}}"
        method="post">
    <button type="submit" class="button button-danger">Reject</button>
  </form>
</div>
```

Critical invariant:

```text
canApprove in view model is only a rendering hint.
The POST /approve endpoint must independently authorize the action.
```

Jangan begini:

```html
<form th:if="${#authorization.expression('hasRole(''ADMIN'')')}" ...>
```

Boleh untuk simple rendering, tetapi untuk domain permission lebih baik backend menyiapkan action model agar policy tidak tersebar di template.

---

## 32. Domain-Specific Fragment: Case Status Timeline

Dalam regulatory/case-management system, timeline sering penting.

Model:

```java
public record TimelineStepView(
    String label,
    String description,
    String timestampText,
    String actorName,
    String tone,
    boolean current
) {}

public record TimelineView(
    List<TimelineStepView> steps
) {}
```

Fragment:

```html
<ol th:fragment="caseTimeline(timeline)" class="timeline">
  <li th:each="step : ${timeline.steps}"
      th:class="|timeline-step timeline-step-${step.tone}|"
      th:classappend="${step.current} ? ' is-current' : ''">
    <div class="timeline-marker" aria-hidden="true"></div>
    <div class="timeline-content">
      <h3 th:text="${step.label}">Submitted</h3>
      <p th:text="${step.description}">Application submitted.</p>
      <p class="timeline-meta">
        <span th:text="${step.timestampText}">19 Jun 2026 10:00</span>
        <span th:if="${step.actorName != null}" th:text="|by ${step.actorName}|">by User</span>
      </p>
    </div>
  </li>
</ol>
```

Important design:

- timeline ordering ditentukan di Java,
- timezone formatting ditentukan sebelum render atau via formatter policy yang jelas,
- sensitive actor name bisa dimasking sebelum template,
- status tone bukan dihitung di template.

---

## 33. Server-Side Component Library Governance

Jika aplikasi besar, fragment library perlu governance.

Minimal governance:

1. folder convention,
2. naming convention,
3. parameter convention,
4. allowed dependency direction,
5. shared vs domain fragment distinction,
6. test requirement untuk shared fragment,
7. visual review untuk layout/component change,
8. changelog untuk breaking change,
9. ownership per module,
10. security review untuk fragments yang memakai raw HTML, URLs, authorization, atau forms.

Contoh ownership:

| Area | Owner |
|---|---|
| layout shell | platform/UI foundation team |
| primitive components | UI foundation team |
| form fragments | platform + backend web team |
| case domain fragments | case module team |
| correspondence fragments | notification/document team |
| security-aware fragments | security/platform team |

---

## 34. Anti-Patterns

### 34.1 God Layout

Satu layout yang tahu semua module:

```html
<div th:if="${case != null}">...</div>
<div th:if="${application != null}">...</div>
<div th:if="${appeal != null}">...</div>
```

Masalah:

- layout jadi domain-aware,
- semua module saling terikat,
- sulit berubah.

### 34.2 God Fragment

Satu fragment untuk semua variasi:

```html
<div th:fragment="panel(type, mode, data, options, flags, permissions, callbacks)">
```

Masalah:

- parameter tidak bermakna,
- banyak conditional,
- sulit dites.

### 34.3 Template as Policy Engine

```html
<button th:if="${case.status == 'SUBMITTED' and user.role == 'MANAGER' and case.amount < 100000 and !case.expired}">
```

Policy harus di Java/domain/application layer.

### 34.4 Inline Style System

```html
<div th:style="${urgent} ? 'color:red' : 'color:black'"></div>
```

Gunakan semantic tone + CSS class.

### 34.5 Raw HTML Component

```html
<div th:utext="${content}"></div>
```

Jika content dari user/admin/CMS, ini butuh sanitization policy. Default-nya hindari.

### 34.6 Hidden Global Dependencies

Fragment membaca `${user}`, `${case}`, `${permissions}`, `${config}` tanpa parameter eksplisit.

### 34.7 Too Generic Table/Form Renderer

Template engine berubah menjadi meta-framework yang lebih rumit daripada kode Java.

---

## 35. Practical Architecture: Recommended Folder and Model Structure

### 35.1 Template Folder

```text
src/main/resources/templates/
├── layouts/
│   ├── main.html
│   ├── auth.html
│   └── error.html
├── fragments/
│   ├── layout/
│   │   ├── head.html
│   │   ├── top-nav.html
│   │   ├── side-nav.html
│   │   ├── breadcrumb.html
│   │   └── footer.html
│   ├── components/
│   │   ├── alert.html
│   │   ├── badge.html
│   │   ├── button.html
│   │   ├── card.html
│   │   ├── empty-state.html
│   │   ├── modal.html
│   │   └── pagination.html
│   ├── forms/
│   │   ├── field.html
│   │   ├── errors.html
│   │   └── controls.html
│   └── domain/
│       ├── case/
│       │   ├── status-badge.html
│       │   ├── action-bar.html
│       │   └── timeline.html
│       └── application/
│           └── summary-card.html
└── pages/
    ├── cases/
    │   ├── list.html
    │   ├── detail.html
    │   └── edit.html
    └── applications/
        └── detail.html
```

### 35.2 Java View Model Folder

```text
src/main/java/com/example/web/view/
├── shell/
│   ├── ShellView.java
│   ├── NavigationItemView.java
│   └── FlashMessageView.java
├── component/
│   ├── BadgeView.java
│   ├── AlertView.java
│   └── PaginationView.java
├── form/
│   └── FieldErrorView.java
└── caseview/
    ├── CaseListPageView.java
    ├── CaseRowView.java
    ├── CaseDetailPageView.java
    ├── CaseActionBarView.java
    └── TimelineView.java
```

### 35.3 Controller Pattern

```java
@GetMapping("/cases/{id}")
public String detail(@PathVariable String id, Model model) {
    CaseDetailPageView page = casePageAssembler.toDetailPage(id);
    model.addAttribute("page", page);
    return "pages/cases/detail";
}
```

Assembler prepares rendering contract:

```java
@Component
public class CasePageAssembler {
    public CaseDetailPageView toDetailPage(String id) {
        // Load domain/application data
        // Evaluate permissions
        // Build links
        // Format labels/tone
        // Build page model
        return ...;
    }
}
```

Template stays simple:

```html
<h1 th:text="${page.title}">Case detail</h1>
<div th:replace="~{fragments/domain/case/action-bar :: caseActions(${page.actions})}"></div>
<ol th:replace="~{fragments/domain/case/timeline :: caseTimeline(${page.timeline})}"></ol>
```

---

## 36. Java 8 to 25 Considerations

Thymeleaf fragment design is mostly Java-version independent, but Java version affects the quality of your ViewModel and rendering infrastructure.

### Java 8

Use immutable-ish classes manually:

```java
public final class BadgeView {
    private final String label;
    private final String tone;

    public BadgeView(String label, String tone) {
        this.label = label;
        this.tone = tone;
    }

    public String getLabel() { return label; }
    public String getTone() { return tone; }
}
```

### Java 16+

Records make ViewModel concise:

```java
public record BadgeView(String label, String tone) {}
```

### Java 17+

Sealed hierarchies help model component variants:

```java
public sealed interface AlertView permits InfoAlertView, ErrorAlertView {}
```

But be careful: Thymeleaf property access and template readability are often better with flat ViewModels than complex sealed hierarchies.

### Java 21+

Virtual threads may help high-concurrency MVC workloads, but rendering itself is CPU/string/DOM transformation work. Virtual threads do not make CPU-bound rendering magically faster. They help when request handling blocks on I/O around rendering.

### Java 25

Same architectural guidance applies. Prefer simple immutable rendering models, deterministic formatting, and explicit contracts.

---

## 37. Production Checklist

Sebelum fragment/layout dipakai luas:

### Layout

- [ ] Layout tidak domain-aware.
- [ ] Shell model eksplisit.
- [ ] Header/sidebar/footer reusable.
- [ ] Page title konsisten.
- [ ] Flash message area konsisten.
- [ ] Error page punya layout sendiri bila perlu.

### Fragment API

- [ ] Nama jelas.
- [ ] Parameter sedikit dan eksplisit.
- [ ] Tidak membaca global context sembarangan.
- [ ] Tidak expose entity mentah.
- [ ] Tidak menghitung policy kompleks.
- [ ] Tidak memakai raw HTML kecuali ada sanitization.

### Security

- [ ] Default output memakai escaped rendering.
- [ ] `th:utext` direview.
- [ ] URL berasal dari safe model.
- [ ] Authorization tetap enforced di backend.
- [ ] Sensitive fields dimasking sebelum template.

### Accessibility

- [ ] Form field punya label.
- [ ] Error field terbaca.
- [ ] Navigation punya `aria-label`.
- [ ] Current page/state jelas.
- [ ] Icon-only button punya accessible label.

### Performance

- [ ] Fragment nesting tidak berlebihan.
- [ ] Page model sudah siap, tidak memicu lazy loading.
- [ ] Table memakai pagination.
- [ ] Template cache production aktif.
- [ ] Large list rendering dihindari.

### Testing

- [ ] Shared fragments punya render tests.
- [ ] Escaping behavior dites.
- [ ] Critical pages punya integration/snapshot tests.
- [ ] Layout changes diuji di representative pages.

---

## 38. Summary Mental Model

Layout dan fragment Thymeleaf harus dipahami sebagai **server-side UI composition system**.

Core principles:

```text
1. Fragment is a template-level API.
2. Layout is a page-level contract.
3. ViewModel is the real boundary.
4. Shared fragments must be domain-neutral.
5. Domain fragments must depend downward on primitives, not upward on pages.
6. Template visibility is not authorization.
7. CSS class/tone should encode visual intent, not inline style logic.
8. Avoid hidden global context coupling.
9. Test fragments that are reused widely.
10. Do not turn Thymeleaf into a full client-side component framework.
```

Part ini bukan hanya tentang `th:fragment`. Ini tentang menjaga **consistency, evolvability, security, accessibility, and governance** dari server-rendered UI.

---

## 39. Latihan

### Latihan 1 — Build UI Primitive Library

Buat fragment untuk:

1. badge,
2. alert,
3. button,
4. empty state,
5. pagination.

Constraint:

- tidak boleh membaca global context,
- semua input harus parameter eksplisit atau ViewModel,
- tidak boleh `th:utext`,
- minimal satu accessibility attribute per component jika relevan.

### Latihan 2 — Refactor Duplicate Pages

Ambil tiga halaman Thymeleaf yang punya header/form/error/table mirip.

Tugas:

1. identifikasi duplikasi,
2. ekstrak layout fragment,
3. ekstrak UI primitive,
4. ekstrak domain fragment,
5. pastikan output HTML tetap sama secara semantik.

### Latihan 3 — Design Fragment Dependency Graph

Gambar dependency graph:

```text
Page -> Domain Fragment -> App Component -> UI Primitive
```

Pastikan tidak ada dependency upward.

### Latihan 4 — Build Case Action Bar

Buat:

```java
CaseActionBarView
```

Dengan action:

- edit,
- approve,
- reject,
- close,
- reopen.

Template hanya render action yang allowed. Backend endpoint tetap harus enforce authorization.

### Latihan 5 — Accessibility Review

Review fragment:

- nav,
- pagination,
- modal,
- form field,
- alert.

Tambahkan ARIA/semantic markup yang tepat.

---

## 40. Common Interview/Architecture Questions

### Q1: Apa perbedaan `th:insert` dan `th:replace`?

`th:insert` memasukkan fragment sebagai child dari host element. `th:replace` mengganti host element dengan fragment. `th:replace` sering menghasilkan DOM lebih bersih ketika host hanya placeholder.

### Q2: Apakah Thymeleaf fragment sama seperti React component?

Tidak. Fragment adalah server-side markup reuse mechanism. Ia bisa dipakai sebagai presentational component, tetapi tidak punya client-side lifecycle, reactive state, atau runtime component model seperti React/Vue.

### Q3: Kapan memakai Layout Dialect?

Saat aplikasi punya banyak halaman dengan shell/layout sama dan native fragment composition mulai verbose. Namun dependency dan debugging complexity harus dipertimbangkan.

### Q4: Kenapa tidak expose entity langsung ke fragment?

Karena entity membawa domain graph, lazy loading risk, security risk, dan coupling tinggi. Template sebaiknya menerima ViewModel yang sudah disiapkan khusus untuk rendering.

### Q5: Bagaimana mencegah fragment dependency hell?

Buat layer dependency: Page -> Domain Fragment -> Application Component -> UI Primitive. Hindari fragment primitive membaca domain model. Batasi nesting. Buat ownership dan tests.

### Q6: Apakah menyembunyikan button berdasarkan role di template cukup untuk security?

Tidak. Itu hanya UI visibility. Backend tetap harus enforce authorization pada endpoint/action.

---

## 41. Referensi

- Thymeleaf Official Documentation — Using Thymeleaf 3.1: fragments, `th:insert`, `th:replace`, parameterized fragments, standard expressions, natural templates.  
  https://www.thymeleaf.org/doc/tutorials/3.1/usingthymeleaf.html

- Thymeleaf Official Article — Thymeleaf Page Layouts.  
  https://www.thymeleaf.org/doc/articles/layouts.html

- Thymeleaf + Spring Official Documentation.  
  https://www.thymeleaf.org/doc/tutorials/3.1/thymeleafspring.html

- Thymeleaf Layout Dialect Documentation.  
  https://ultraq.github.io/thymeleaf-layout-dialect/

- Thymeleaf Layout Dialect GitHub.  
  https://github.com/ultraq/thymeleaf-layout-dialect

---

## 42. Status Seri

Part 16 selesai.

Seri belum selesai.

Berikutnya:

```text
Part 17 — Thymeleaf Security: XSS, CSRF, Authorization Rendering, and Safe HTML
```
