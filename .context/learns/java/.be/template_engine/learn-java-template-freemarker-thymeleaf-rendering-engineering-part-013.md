# learn-java-template-freemarker-thymeleaf-rendering-engineering-part-013

# Part 13 — Thymeleaf Standard Expressions Deep Dive

> Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`  
> Topik: Java Template, FreeMarker, Thymeleaf, Rendering Engineering  
> Level: Advanced / Top 1% Engineering Mental Model  
> Target Java: 8 sampai 25  
> Fokus part ini: expression model Thymeleaf, desain model, batas logic, SpringEL/OGNL, security, dan production correctness.

---

## 0. Posisi Part Ini Dalam Seri

Kita sudah membangun fondasi:

- Part 0: template engineering sebagai deterministic transformation.
- Part 1: landscape engine Java.
- Part 2: `template + data model + context + output sink = rendered output`.
- Part 3–11: FreeMarker architecture, language, security, performance, dan integration.
- Part 12: fundamental architecture Thymeleaf.

Part ini masuk ke inti bahasa ekspresi Thymeleaf.

Kalau Part 12 menjawab:

> “Bagaimana Thymeleaf engine memproses template?”

Maka Part 13 menjawab:

> “Bagaimana template mengambil data, memilih objek, membaca message, membuat URL, mereferensikan fragment, memakai utility object, dan menjaga agar expression tetap aman, stabil, dan readable?”

Thymeleaf expression adalah salah satu area yang terlihat sederhana, tetapi di production sering menjadi sumber:

- template berantakan,
- ekspresi terlalu pintar,
- hidden N+1 query,
- leaking domain model,
- XSS karena salah output context,
- logic authorization palsu,
- route/URL rusak,
- form binding tidak stabil,
- i18n sulit dirawat,
- fragment coupling yang tidak terkendali.

Tujuan bagian ini bukan hanya hafal syntax, tetapi membangun mental model agar expression Thymeleaf dipakai sebagai **presentation mapping layer**, bukan sebagai tempat business logic.

---

## 1. Big Picture: Expression di Thymeleaf Itu Apa?

Dalam Thymeleaf, expression adalah bahasa kecil yang dipakai template untuk membaca dan menyusun nilai dari context.

Secara sederhana:

```html
<p th:text="${user.fullName}">John Doe</p>
```

Artinya:

1. Ambil variable `user` dari context.
2. Baca property `fullName`.
3. Jadikan hasilnya text node.
4. Escape sesuai context HTML.
5. Ganti body `<p>` dengan hasil tersebut.

Tetapi di belakang syntax sederhana itu ada beberapa konsep penting:

```text
Controller / Rendering Service
        |
        v
Model / Context
        |
        v
Expression Evaluation
        |
        v
Attribute Processor
        |
        v
DOM Transformation
        |
        v
Rendered HTML/XML/Text/JS/CSS
```

Thymeleaf bukan string interpolation engine biasa. Ia melakukan transformasi template berbasis markup/DOM-like event processing. Expression adalah instruksi yang dipakai oleh processor untuk memutuskan nilai akhir attribute, text, URL, fragment, conditional rendering, iteration, dan binding.

### 1.1 Top 1% Mental Model

Expression Thymeleaf harus diperlakukan sebagai **read-only query terhadap presentation context**, bukan sebagai program kecil.

Template expression yang sehat punya ciri:

```text
- pendek
- mudah dibaca
- tidak mengandung business decision besar
- tidak memanggil service/repository
- tidak mengubah state
- aman terhadap null/missing data
- output-context aware
- tidak membuat data access diam-diam
- predictable untuk testing
```

Expression yang buruk biasanya seperti:

```html
<tr th:each="case : ${caseService.findByAgencyAndStatus(session.agency.id, 'OPEN')}">
```

Masalahnya:

- template memanggil service,
- data access terjadi di view layer,
- sulit di-test,
- performance tidak terlihat,
- security boundary bocor,
- template author punya power terlalu besar,
- controller tidak lagi menjadi tempat membentuk model.

Versi sehat:

```java
model.addAttribute("openCases", casePresenter.toRows(openCases));
```

```html
<tr th:each="row : ${openCases}">
```

Template hanya membaca data yang sudah disiapkan.

---

## 2. Keluarga Expression di Thymeleaf

Thymeleaf Standard/SpringStandard expression umumnya terdiri dari:

| Expression | Bentuk | Fungsi |
|---|---:|---|
| Variable expression | `${...}` | Membaca variable dari context/model |
| Selection expression | `*{...}` | Membaca property relatif terhadap selected object |
| Message expression | `#{...}` | Membaca pesan i18n dari message bundle |
| Link URL expression | `@{...}` | Membentuk URL/context-relative URL dengan parameter |
| Fragment expression | `~{...}` | Mereferensikan template fragment |
| Literal | `'text'`, `123`, `true` | Nilai literal |
| Literal substitution | `|Hello ${name}|` | String interpolation yang lebih readable |

Contoh ringkas:

```html
<p th:text="${user.fullName}">Full Name</p>
<p th:text="*{fullName}" th:object="${user}">Full Name</p>
<p th:text="#{profile.title}">Profile</p>
<a th:href="@{/users/{id}(id=${user.id})}">Open</a>
<div th:replace="~{layout :: content}"></div>
<p th:text="|Hello, ${user.fullName}!|">Hello</p>
```

Dalam praktik, lima expression pertama adalah inti produktivitas Thymeleaf.

---

## 3. Variable Expressions: `${...}`

Variable expression adalah bentuk paling umum:

```html
<span th:text="${user.fullName}">John Doe</span>
```

Expression ini mengevaluasi nilai dari context.

### 3.1 Dari Mana Variable Datang?

Variable bisa berasal dari:

1. Spring MVC `Model`.
2. `ModelAndView`.
3. `@ModelAttribute`.
4. Thymeleaf `Context` / `WebContext`.
5. Local variable dari `th:each`.
6. Local variable dari `th:with`.
7. Fragment parameter.
8. Expression utility object seperti `#dates`, `#numbers`, `#strings`, `#lists`, `#maps`.
9. Request/session/application attribute tergantung environment dan konfigurasi.

Contoh Spring MVC:

```java
@GetMapping("/users/{id}")
public String detail(@PathVariable long id, Model model) {
    UserView user = userQuery.findUserView(id);
    model.addAttribute("user", user);
    return "users/detail";
}
```

Template:

```html
<h1 th:text="${user.fullName}">User Full Name</h1>
<p th:text="${user.email}">email@example.com</p>
```

### 3.2 Property Access

Thymeleaf expression dapat membaca property object:

```html
<p th:text="${user.fullName}"></p>
<p th:text="${user.address.city}"></p>
```

Secara konseptual, ini mirip membaca JavaBean property:

```java
user.getFullName()
user.getAddress().getCity()
```

Tetapi untuk desain production, jangan berpikir “template bebas menjelajahi object graph”. Lebih baik pikirkan:

```text
Template hanya boleh membaca field yang secara sengaja disediakan oleh ViewModel.
```

Buruk:

```html
<span th:text="${case.application.person.identityDocument.rawValue}"></span>
```

Lebih baik:

```html
<span th:text="${caseRow.maskedIdentityNo}"></span>
```

Karena template tidak perlu tahu struktur domain internal, masking policy, atau object graph detail.

### 3.3 Map Access

Jika model berisi map:

```java
Map<String, Object> stats = Map.of(
    "open", 10,
    "closed", 15
);
model.addAttribute("stats", stats);
```

Template:

```html
<span th:text="${stats.open}">0</span>
<span th:text="${stats['closed']}">0</span>
```

Bracket notation lebih aman ketika key mengandung karakter khusus:

```html
<span th:text="${stats['open-cases']}"></span>
```

### 3.4 Method Calls

Dalam expression, method bisa dipanggil tergantung expression engine dan exposure:

```html
<span th:text="${user.displayName()}"></span>
```

Namun, untuk template production, method call harus dibatasi secara desain.

Method yang masih masuk akal:

```java
public String displayName() { ... }
public boolean hasWarning() { ... }
```

Method yang buruk:

```java
public List<Case> loadCasesFromDatabase() { ... }
public void markAsRead() { ... }
public BigDecimal recomputePenalty() { ... }
```

Rule:

```text
Template boleh membaca derived presentation value.
Template tidak boleh memicu I/O, mutation, query, command, atau business transition.
```

### 3.5 Expression Jangan Menjadi Business Logic

Buruk:

```html
<span th:text="${case.type == 'APPEAL' and case.status == 'PENDING_DIRECTOR' and case.amount > 10000 ? 'High Risk Appeal' : 'Normal'}"></span>
```

Lebih baik:

```java
record CaseRow(
    String caseNo,
    String statusLabel,
    String riskLabel
) {}
```

```html
<span th:text="${case.riskLabel}"></span>
```

Kenapa?

Karena rule “high risk appeal” adalah business/presentation decision yang harus:

- bisa di-unit-test,
- bisa direview,
- bisa dilacak,
- tidak tersebar di banyak template,
- tidak berubah diam-diam karena template edit.

### 3.6 `th:text` vs Inline Text

Bentuk umum:

```html
<span th:text="${user.fullName}">Prototype Name</span>
```

Bentuk inline:

```html
<p>Hello, [[${user.fullName}]]!</p>
```

Gunakan `th:text` saat mengganti seluruh content element. Gunakan inline text saat natural sentence lebih readable.

Baik:

```html
<p>Hello, [[${user.fullName}]]. Your application is [[${application.statusLabel}]].</p>
```

Kurang baik:

```html
<p th:text="${'Hello, ' + user.fullName + '. Your application is ' + application.statusLabel + '.'}"></p>
```

Literal substitution lebih baik lagi untuk attribute:

```html
<span th:title="|Submitted by ${submittedBy} at ${submittedAtLabel}|"></span>
```

---

## 4. Selection Expressions: `*{...}`

Selection expression membaca property relatif terhadap selected object.

Contoh:

```html
<div th:object="${user}">
    <p th:text="*{fullName}">Full Name</p>
    <p th:text="*{email}">Email</p>
</div>
```

Artinya:

```text
Selected object = user
*{fullName}     = user.fullName
*{email}        = user.email
```

### 4.1 Kapan Memakai `*{...}`?

Gunakan selection expression untuk:

1. form binding,
2. section yang jelas punya object utama,
3. fragment component dengan parameter object,
4. mengurangi noise repetisi `${user.xxx}`.

Contoh baik:

```html
<section th:object="${profile}">
    <h1 th:text="*{displayName}">Name</h1>
    <p th:text="*{email}">Email</p>
    <p th:text="*{phoneLabel}">Phone</p>
</section>
```

### 4.2 Selection Object dan Nested Scope

Hati-hati ketika `th:object` nested:

```html
<div th:object="${application}">
    <p th:text="*{referenceNo}"></p>

    <section th:object="*{applicant}">
        <p th:text="*{fullName}"></p>
    </section>

    <p th:text="*{statusLabel}"></p>
</div>
```

Ini readable jika scope kecil. Tetapi kalau nested terlalu dalam, pembaca akan bingung `*{...}` mengacu ke object mana.

Rule:

```text
Gunakan th:object untuk section kecil dan jelas.
Jangan membuat template panjang bergantung pada selected object yang berubah-ubah.
```

### 4.3 Form Binding

Dalam Spring MVC + Thymeleaf, `th:object` dan `th:field` sangat penting:

```html
<form th:action="@{/users}" th:object="${userForm}" method="post">
    <input th:field="*{fullName}" />
    <input th:field="*{email}" />
    <button type="submit">Save</button>
</form>
```

`th:field` bukan sekadar set `value`. Ia membantu binding `id`, `name`, selected/checked state, dan integrasi error binding. Detail ini akan dibahas lebih dalam di Part 15.

Pada Part 13, mental model cukup:

```text
${...} = cari dari context global/local variable.
*{...} = cari relatif terhadap selected object.
```

---

## 5. Message Expressions: `#{...}`

Message expression membaca message dari bundle/resource.

Contoh:

```html
<h1 th:text="#{profile.title}">Profile</h1>
<label th:text="#{profile.fullName}">Full Name</label>
```

Biasanya dipakai untuk i18n/l10n.

### 5.1 Message Key sebagai Contract

Message key adalah contract antara template dan resource bundle.

Template:

```html
<h1 th:text="#{case.detail.title}">Case Detail</h1>
```

Bundle `messages.properties`:

```properties
case.detail.title=Case Detail
```

Bundle `messages_id.properties`:

```properties
case.detail.title=Detail Kasus
```

### 5.2 Parameterized Message

Message bisa menerima parameter:

```properties
case.submittedBy=Submitted by {0} on {1}
```

Template:

```html
<p th:text="#{case.submittedBy(${case.submittedByName}, ${case.submittedAtLabel})}"></p>
```

Namun, jangan terlalu banyak format kompleks di template. Untuk tanggal/waktu kritikal, sering lebih baik controller/presenter menyediakan `submittedAtLabel` yang sudah diformat sesuai policy.

### 5.3 Message Key Naming

Key buruk:

```properties
title=Title
button=Button
name=Name
```

Karena terlalu generik.

Key lebih baik:

```properties
case.detail.title=Case Detail
case.detail.action.approve=Approve
case.detail.action.reject=Reject
case.search.field.caseNo=Case Number
```

Pattern enterprise:

```text
<module>.<page-or-component>.<element>.<semantic-name>
```

Contoh:

```text
appeal.detail.title
appeal.detail.field.appealNo
appeal.detail.action.assignOfficer
appeal.detail.error.missingDecisionReason
```

### 5.4 Message Jangan Menyembunyikan Rule

Buruk:

```html
<span th:text="#{${case.statusMessageKey}}"></span>
```

Ini kadang valid, tetapi hati-hati. Kalau `statusMessageKey` berasal dari domain/presenter yang aman, boleh.

Lebih baik:

```java
record CaseRow(String statusCode, String statusMessageKey) {}
```

```html
<span th:text="#{${case.statusMessageKey}}"></span>
```

Tetapi jangan biarkan user input menentukan message key secara bebas.

Buruk:

```html
<span th:text="#{${param.messageKey}}"></span>
```

Karena user bisa probing key internal atau menghasilkan behavior tidak terduga.

### 5.5 Missing Message Strategy

Missing message di production bisa berarti:

- typo template,
- bundle belum diterjemahkan,
- locale fallback salah,
- template/model mismatch,
- deployment bundle tidak lengkap.

Untuk sistem serius, missing message harus terlihat di CI atau preflight rendering, bukan ditemukan user.

Checklist:

```text
- scan semua template untuk message keys
- verify key ada di default locale
- verify locale penting punya translation
- snapshot render per locale
- fail CI jika key penting missing
```

---

## 6. Link URL Expressions: `@{...}`

Link expression membentuk URL.

Contoh:

```html
<a th:href="@{/users}">Users</a>
<a th:href="@{/users/{id}(id=${user.id})}">View</a>
<a th:href="@{/cases(page=${page.number}, size=${page.size})}">Next</a>
```

### 6.1 Kenapa Tidak Hardcode URL?

Hardcode:

```html
<a href="/myapp/users/123">View</a>
```

Masalah:

- context path bisa berubah,
- reverse proxy path bisa berubah,
- deployment prefix bisa berubah,
- parameter escaping rawan,
- readability menurun.

Dengan Thymeleaf:

```html
<a th:href="@{/users/{id}(id=${user.id})}">View</a>
```

Thymeleaf memahami URL sebagai URL expression, bukan string biasa.

### 6.2 Path Variable

```html
<a th:href="@{/cases/{caseId}(caseId=${case.id})}">Open Case</a>
```

Jika route punya banyak variable:

```html
<a th:href="@{/agencies/{agencyId}/cases/{caseId}(agencyId=${agency.id}, caseId=${case.id})}">
    Open
</a>
```

### 6.3 Query Parameter

```html
<a th:href="@{/cases(status=${filter.status}, page=${page.next})}">Next</a>
```

Hasil konseptual:

```text
/cases?status=OPEN&page=2
```

### 6.4 Optional Parameter

Jika parameter nullable, desain harus jelas:

```html
<a th:href="@{/cases(status=${filter.status}, officer=${filter.officerId})}">Search</a>
```

Pertanyaan production:

- Apakah `null` parameter dihilangkan?
- Apakah empty string tetap dikirim?
- Apakah default di controller sama dengan default UI?
- Apakah filter URL shareable?

Untuk search/filter page, sebaiknya presenter membentuk parameter object yang eksplisit.

```java
record CaseSearchLink(
    String status,
    Long officerId,
    Integer page,
    Integer size
) {}
```

Template:

```html
<a th:href="@{/cases(status=${link.status}, officer=${link.officerId}, page=${link.page}, size=${link.size})}">Search</a>
```

### 6.5 External URL

```html
<a th:href="@{https://example.com/docs/{id}(id=${doc.id})}">Docs</a>
```

Namun external URL sebaiknya tidak dibangun dari user input mentah.

Buruk:

```html
<a th:href="${redirectUrl}">Continue</a>
```

Lebih aman:

```java
record LinkView(String label, String safeHref) {}
```

`safeHref` harus sudah divalidasi allowlist host/path di Java.

### 6.6 URL Authorization Trap

Jangan berpikir karena tombol tidak ditampilkan, endpoint aman.

```html
<a sec:authorize="hasRole('ADMIN')" th:href="@{/admin/users}">Admin</a>
```

Ini hanya UI rendering. Backend tetap wajib enforce authorization.

Mental model:

```text
Template controls discoverability, not authority.
Backend controls authority.
```

---

## 7. Fragment Expressions: `~{...}`

Fragment expression mereferensikan bagian template lain.

Contoh:

```html
<div th:replace="~{layout :: header}"></div>
```

Atau dengan parameter:

```html
<div th:replace="~{components/badge :: statusBadge(${case.status})}"></div>
```

Fragment expression adalah fondasi layout/component-like composition di Thymeleaf.

### 7.1 Fragment sebagai Presentation Component

Fragment:

```html
<!-- components/badge.html -->
<span th:fragment="statusBadge(status)"
      class="badge"
      th:classappend="| badge-${status.cssClass}|"
      th:text="${status.label}">
    Status
</span>
```

Pemakaian:

```html
<span th:replace="~{components/badge :: statusBadge(${case.status})}"></span>
```

### 7.2 Fragment Parameter Harus Stabil

Buruk:

```html
<div th:replace="~{components/case-card :: card(${case}, ${session}, ${securityContext}, ${caseService})}"></div>
```

Lebih baik:

```html
<div th:replace="~{components/case-card :: card(${caseCard})}"></div>
```

Karena fragment seharusnya menerima view model kecil, bukan seluruh dunia.

### 7.3 Fragment sebagai API

Setiap fragment publik harus dianggap punya API.

```html
<div th:fragment="pagination(page)" class="pagination">
```

`page` harus punya contract:

```java
record PageView(
    int currentPage,
    int totalPages,
    boolean hasPrevious,
    boolean hasNext,
    String previousHref,
    String nextHref,
    List<PageLink> links
) {}
```

Template lain tidak perlu tahu bagaimana pagination dihitung.

### 7.4 Fragment Coupling

Anti-pattern:

```html
<!-- Fragment expects global variables implicitly -->
<div th:fragment="statusBadge">
    <span th:text="${case.status.label}"></span>
</div>
```

Pemakaian fragment ini rapuh karena membutuhkan variable global `case`.

Lebih baik:

```html
<div th:fragment="statusBadge(status)">
    <span th:text="${status.label}"></span>
</div>
```

Rule:

```text
Fragment reusable harus menerima parameter eksplisit.
Hindari dependency implisit ke variable global halaman.
```

---

## 8. Literals dan Literal Substitution

### 8.1 String Literal

```html
<span th:text="'Hello'"></span>
```

### 8.2 Number Literal

```html
<span th:text="${count + 1}"></span>
```

### 8.3 Boolean Literal

```html
<div th:if="${true}"></div>
```

### 8.4 Null Literal

```html
<span th:if="${user.middleName != null}"></span>
```

### 8.5 Literal Substitution

Literal substitution memakai `|...|`:

```html
<span th:text="|Hello, ${user.fullName}!|"></span>
```

Untuk attribute:

```html
<input th:placeholder="|Search ${moduleLabel}|" />
```

Lebih readable daripada concatenation:

```html
<span th:text="${'Hello, ' + user.fullName + '!'}"></span>
```

### 8.6 Kapan Tidak Memakai Literal Substitution?

Jangan pakai literal substitution untuk message i18n yang perlu diterjemahkan.

Buruk:

```html
<p th:text="|Submitted by ${name} on ${date}|">
```

Lebih baik:

```properties
case.submittedBy=Submitted by {0} on {1}
```

```html
<p th:text="#{case.submittedBy(${name}, ${dateLabel})}"></p>
```

Karena urutan kata bisa berbeda antar bahasa.

---

## 9. Operators dan Conditional Expressions

Thymeleaf expressions mendukung operator umum.

Contoh:

```html
<span th:text="${count + 1}"></span>
<span th:if="${user.active}"></span>
<span th:if="${case.status == 'OPEN'}"></span>
<span th:text="${case.highPriority ? 'High' : 'Normal'}"></span>
```

### 9.1 Equality

```html
<div th:if="${status == 'OPEN'}"></div>
<div th:if="${status != 'CLOSED'}"></div>
```

Untuk enum, lebih baik presenter menyediakan boolean atau label.

Kurang ideal:

```html
<div th:if="${case.status.name() == 'PENDING_DIRECTOR_APPROVAL'}"></div>
```

Lebih baik:

```html
<div th:if="${case.pendingDirectorApproval}"></div>
```

### 9.2 Ternary Operator

```html
<span th:text="${user.active ? 'Active' : 'Inactive'}"></span>
```

Masih wajar untuk label sederhana.

Tetapi jika mulai panjang:

```html
<span th:text="${case.status == 'OPEN' and case.priority == 'HIGH' and case.ageDays > 14 ? 'Escalate' : 'Normal'}"></span>
```

Pindahkan ke presenter:

```java
record CaseRow(String escalationLabel) {}
```

### 9.3 Elvis/Default Style

Dalam Thymeleaf/SpringEL style, default bisa memakai Elvis operator tergantung expression engine:

```html
<span th:text="${user.displayName ?: 'Unknown'}"></span>
```

Namun, lebih baik tetapkan null/default policy di ViewModel.

```java
record UserView(String displayName) {
    UserView {
        displayName = displayName == null || displayName.isBlank() ? "Unknown" : displayName;
    }
}
```

Template:

```html
<span th:text="${user.displayName}"></span>
```

### 9.4 Complexity Budget

Rule praktis:

```text
Expression boleh punya 1 keputusan kecil.
Jika butuh 2+ operator boolean, pindahkan ke Java.
Jika butuh nested ternary, pindahkan ke Java.
Jika butuh method service, pindahkan ke Java.
Jika butuh rule domain, pindahkan ke Java.
```

---

## 10. Utility Objects: `#strings`, `#lists`, `#maps`, `#numbers`, `#temporals`, dan Kawan-kawan

Thymeleaf menyediakan expression utility objects.

Contoh:

```html
<span th:text="${#strings.toUpperCase(user.fullName)}"></span>
<span th:if="${#lists.isEmpty(cases)}">No cases</span>
<span th:text="${#numbers.formatDecimal(amount, 1, 2)}"></span>
```

### 10.1 Utility Objects Itu Membantu, Tapi Bukan Tempat Business Logic

Baik:

```html
<span th:if="${#lists.isEmpty(rows)}">No data</span>
```

Masih wajar.

Buruk:

```html
<span th:text="${#lists.size(caseService.findAllOpenCases())}"></span>
```

Utility object tidak boleh menjadi gateway menuju service call atau complex computation.

### 10.2 `#strings`

Pemakaian umum:

```html
<span th:text="${#strings.defaultString(user.nickname, 'N/A')}"></span>
<span th:text="${#strings.abbreviate(description, 120)}"></span>
```

Tetapi untuk policy seperti masking:

Buruk:

```html
<span th:text="${#strings.substring(identityNo, 0, 4) + '****'}"></span>
```

Lebih baik:

```html
<span th:text="${person.maskedIdentityNo}"></span>
```

Karena masking adalah security/privacy policy, bukan dekorasi ringan.

### 10.3 `#lists`

Contoh:

```html
<div th:if="${#lists.isEmpty(caseRows)}">No cases</div>
<table th:if="${!#lists.isEmpty(caseRows)}">...</table>
```

Namun, lebih readable jika presenter menyediakan state:

```java
record CaseListView(
    List<CaseRow> rows,
    boolean empty
) {}
```

```html
<div th:if="${caseList.empty}">No cases</div>
```

### 10.4 `#maps`

Contoh:

```html
<span th:if="${#maps.containsKey(stats, 'open')}"></span>
```

Tetapi map-heavy model sering menjadi tanda contract lemah. Untuk template penting, gunakan typed ViewModel.

Buruk:

```html
<span th:text="${stats['module-A']['open']['count']}"></span>
```

Lebih baik:

```java
record ModuleStatsView(String moduleName, int openCount, int closedCount) {}
```

### 10.5 `#numbers`

Contoh:

```html
<span th:text="${#numbers.formatDecimal(invoice.total, 1, 2)}"></span>
```

Untuk amount/currency legal/finance, sebaiknya Java presenter melakukan formatting dengan locale/currency policy yang explicit.

```java
record InvoiceView(String totalAmountLabel) {}
```

Template:

```html
<span th:text="${invoice.totalAmountLabel}"></span>
```

### 10.6 Date/Time Utility

Thymeleaf punya utility date/time. Dalam Java modern, gunakan `java.time` di domain/presenter.

Pertanyaan production:

- tanggal ditampilkan dalam timezone siapa?
- apakah tanggal adalah instant absolut atau local date?
- apakah format tergantung locale?
- apakah legal document harus freeze timezone?
- apakah email batch memakai user locale atau agency locale?

Jangan biarkan template menebak.

Buruk:

```html
<span th:text="${#temporals.format(case.createdAt, 'dd/MM/yyyy HH:mm')}"></span>
```

Bisa wajar untuk UI sederhana, tetapi untuk sistem regulasi/document generation, lebih baik:

```java
record CaseView(String createdAtLabel, String createdAtTimezoneLabel) {}
```

```html
<span th:text="${case.createdAtLabel}"></span>
<span th:text="${case.createdAtTimezoneLabel}"></span>
```

---

## 11. Expression Engine: OGNL vs SpringEL

Thymeleaf Standard Dialect memakai OGNL. Dalam integrasi Spring, SpringStandard Dialect memakai Spring Expression Language atau SpringEL.

Secara praktis:

```text
Non-Spring Thymeleaf      -> Standard Dialect      -> OGNL
Spring MVC/WebFlux setup  -> SpringStandardDialect -> SpringEL
```

Ini penting karena detail operator, property access, conversion, dan security behavior dapat berbeda.

### 11.1 Apa Dampaknya Untuk Engineer?

Jangan menulis template yang bergantung pada edge behavior expression engine.

Hindari:

- ekspresi reflection-heavy,
- method resolution kompleks,
- overloaded method call dari template,
- static access aneh,
- nested collection transformation kompleks,
- side-effect method.

Template yang portable dan sehat biasanya hanya memakai:

```text
property access
simple boolean
simple iteration
simple message
simple URL
simple fragment parameter
utility object ringan
```

### 11.2 SpringEL Power Trap

SpringEL powerful. Power ini berguna, tetapi berbahaya jika template menjadi programmable surface.

Buruk:

```html
<span th:text="${@caseService.calculateRisk(case.id)}"></span>
```

Ini bisa terjadi jika bean access tersedia dalam environment. Jangan menjadikan template sebagai service orchestration layer.

Lebih baik:

```java
CaseView view = casePresenter.toView(case);
model.addAttribute("case", view);
```

```html
<span th:text="${case.riskLabel}"></span>
```

### 11.3 Conversion Service

Dalam Spring integration, Thymeleaf dapat memanfaatkan conversion service untuk formatting/conversion tertentu, termasuk double-brace syntax:

```html
<td th:text="${{user.lastAccessDate}}">...</td>
```

Mental model:

```text
${...}  = raw expression evaluation
${{...}} = expression evaluation + configured conversion/formatting service
```

Gunakan dengan disiplin. Untuk field yang perlu domain/legal formatting eksplisit, lebih baik presenter menyediakan label.

---

## 12. Null, Missing Data, dan Safe Model Design

Salah satu penyebab template rapuh adalah null handling.

Contoh:

```html
<span th:text="${user.address.city}"></span>
```

Jika `address` null, tergantung engine/config, rendering bisa error.

### 12.1 Jangan Menormalkan Null di Template Terlalu Banyak

Buruk:

```html
<span th:text="${user.address != null and user.address.city != null ? user.address.city : '-'}"></span>
```

Lebih baik:

```java
record UserView(String cityLabel) {}
```

```html
<span th:text="${user.cityLabel}"></span>
```

### 12.2 Null Policy di ViewModel

Untuk sistem production, tentukan policy:

| Jenis data | Policy |
|---|---|
| Required field | fail before render jika missing |
| Optional field | render placeholder eksplisit |
| Sensitive field | render masked/redacted value |
| Date/time | render formatted label + timezone policy |
| Amount | render formatted label + currency policy |
| Status | render label/css/accessibility text |

Contoh:

```java
public record PersonView(
    String fullName,
    String emailLabel,
    String phoneLabel
) {
    public PersonView {
        Objects.requireNonNull(fullName, "fullName is required");
        emailLabel = blankToDash(emailLabel);
        phoneLabel = blankToDash(phoneLabel);
    }

    private static String blankToDash(String value) {
        return value == null || value.isBlank() ? "-" : value;
    }
}
```

Template:

```html
<p th:text="${person.fullName}"></p>
<p th:text="${person.emailLabel}"></p>
<p th:text="${person.phoneLabel}"></p>
```

### 12.3 Missing Variable Harus Error di Development

Jangan sembunyikan missing variable terlalu cepat. Jika template butuh `case`, tetapi controller lupa menambahkan, itu bug.

Better practice:

```text
Development/CI: fail fast.
Production: classify error, log safely, show generic error page or fallback if allowed.
```

---

## 13. Expression dan Escaping: Jangan Campur Konsep

Expression menghasilkan nilai. Attribute processor menentukan bagaimana nilai dipakai.

```html
<span th:text="${comment.body}"></span>
```

`th:text` akan menghasilkan escaped text untuk HTML context.

```html
<span th:utext="${comment.body}"></span>
```

`th:utext` menghasilkan unescaped text. Ini berbahaya jika `comment.body` berasal dari user input.

### 13.1 `th:text` Default Aman Untuk Text Node

```html
<p th:text="${userInput}"></p>
```

Jika `userInput` berisi:

```html
<script>alert(1)</script>
```

Maka harus dirender sebagai teks, bukan script.

### 13.2 `th:utext` Harus Jarang

`th:utext` hanya boleh dipakai jika:

1. input sudah sanitized,
2. sanitization dilakukan dengan allowlist HTML sanitizer,
3. source field dinamai jelas, misalnya `safeHtmlDescription`,
4. ada security review,
5. ada test XSS.

Contoh lebih aman:

```java
record ArticleView(String title, String safeHtmlBody) {}
```

```html
<article th:utext="${article.safeHtmlBody}"></article>
```

Penamaan `safeHtmlBody` lebih baik daripada `body`, karena memberi sinyal bahwa field sudah melewati sanitization policy.

### 13.3 Inline JavaScript

Thymeleaf bisa dipakai dalam JavaScript context, tetapi harus hati-hati.

Buruk:

```html
<script>
  const name = '[[${user.name}]]';
</script>
```

Lebih baik gunakan JavaScript inline mode yang benar dan pahami escaping context. Untuk data besar, sering lebih aman expose endpoint JSON terpisah atau render JSON script block dengan serializer yang benar.

Rule:

```text
HTML text escaping tidak sama dengan JavaScript string escaping.
URL escaping tidak sama dengan HTML escaping.
CSS escaping tidak sama dengan JavaScript escaping.
```

---

## 14. Expression dan Authorization Rendering

Dengan Spring Security dialect, template bisa melakukan rendering kondisional berdasarkan authorization.

Contoh konseptual:

```html
<button sec:authorize="hasAuthority('CASE_APPROVE')">Approve</button>
```

Namun ini hanya mengatur visibility.

### 14.1 Jangan Salah Mental Model

Salah:

```text
Kalau tombol tidak muncul, user tidak bisa approve.
```

Benar:

```text
Kalau tombol tidak muncul, user tidak diarahkan approve lewat UI.
Endpoint approve tetap harus mengecek authorization.
```

### 14.2 Permission Sebaiknya Dipresentasikan Sebagai View Capability

Daripada template tahu terlalu banyak security expression:

```html
<button th:if="${case.canApprove}">Approve</button>
<button th:if="${case.canReject}">Reject</button>
<button th:if="${case.canAssign}">Assign</button>
```

Presenter:

```java
record CaseDetailView(
    String caseNo,
    String statusLabel,
    boolean canApprove,
    boolean canReject,
    boolean canAssign
) {}
```

Backend endpoint tetap enforce permission:

```java
@PostMapping("/cases/{id}/approve")
@PreAuthorize("hasAuthority('CASE_APPROVE')")
public String approve(@PathVariable long id) { ... }
```

Kenapa view capability lebih baik?

- template lebih sederhana,
- permission logic testable di Java,
- bisa mempertimbangkan state case + role user + tenant + lock,
- tidak hanya role-based.

---

## 15. Expression dan N+1 Query Trap

Template expression dapat memicu method/property yang lazy-load.

Contoh JPA entity exposure:

```html
<tr th:each="case : ${cases}">
    <td th:text="${case.applicant.name}"></td>
    <td th:text="${case.assignedOfficer.name}"></td>
</tr>
```

Jika `case.applicant` dan `case.assignedOfficer` lazy relation, rendering bisa memicu N+1 query.

### 15.1 View Layer Tidak Boleh Mengontrol Fetch Plan

Buruk:

```text
Controller kirim List<CaseEntity> ke template.
Template traversal menentukan relasi apa yang diload.
```

Baik:

```text
Query layer mengambil projection sesuai kebutuhan page.
Presenter membentuk CaseRow.
Template membaca CaseRow flat.
```

Contoh:

```java
record CaseRow(
    String caseNo,
    String applicantName,
    String officerName,
    String statusLabel
) {}
```

```html
<tr th:each="row : ${caseRows}">
    <td th:text="${row.caseNo}"></td>
    <td th:text="${row.applicantName}"></td>
    <td th:text="${row.officerName}"></td>
    <td th:text="${row.statusLabel}"></td>
</tr>
```

### 15.2 Top 1% Rule

```text
Template should not shape persistence access.
Template should consume a persistence-detached presentation model.
```

Untuk page list/table, gunakan query projection, bukan entity graph besar.

---

## 16. Expression dan ViewModel Design

Expression yang bersih lahir dari ViewModel yang baik.

### 16.1 Buruk: Template Dipaksa Menyelesaikan Semuanya

```html
<td th:text="${case.application != null and case.application.person != null ? case.application.person.fullName : '-'}"></td>
<td th:text="${case.status == 'PENDING' ? 'Pending Review' : case.status == 'APPROVED' ? 'Approved' : 'Rejected'}"></td>
<td th:classappend="${case.priority == 'HIGH' ? 'text-danger fw-bold' : ''}"></td>
```

### 16.2 Baik: Template Membaca Presentation Contract

```java
record CaseRowView(
    String caseNo,
    String applicantNameLabel,
    String statusLabel,
    String priorityCssClass,
    String priorityAriaLabel
) {}
```

```html
<td th:text="${row.caseNo}"></td>
<td th:text="${row.applicantNameLabel}"></td>
<td th:text="${row.statusLabel}"></td>
<td th:classappend="${row.priorityCssClass}" th:attr="aria-label=${row.priorityAriaLabel}"></td>
```

### 16.3 Presentation Model Harus Menjawab Kebutuhan Template

Jangan expose domain lalu berharap template memilih sendiri. Desain model dari kebutuhan output:

```text
Untuk halaman case detail, template butuh:
- header summary
- status display
- applicant section
- documents section
- timeline section
- action buttons
- audit labels
- permission/capability flags
- links
- warnings
```

Maka ViewModel:

```java
record CaseDetailPage(
    CaseHeaderView header,
    ApplicantView applicant,
    List<DocumentRow> documents,
    List<TimelineItem> timeline,
    CaseActionsView actions,
    List<WarningView> warnings
) {}
```

Template expression menjadi pendek:

```html
<h1 th:text="${page.header.title}"></h1>
<section th:replace="~{components/applicant :: view(${page.applicant})}"></section>
<section th:replace="~{components/actions :: caseActions(${page.actions})}"></section>
```

---

## 17. Expression Naming: Clarity Beats Cleverness

Nama variable mempengaruhi kualitas template.

Buruk:

```html
<span th:text="${x.a.b}"></span>
<div th:each="i : ${l}"></div>
```

Baik:

```html
<span th:text="${caseDetail.header.caseNo}"></span>
<tr th:each="document : ${caseDetail.documents}"></tr>
```

### 17.1 Naming Guidelines

Gunakan nama yang menjelaskan role presentation:

| Nama | Cocok? | Catatan |
|---|---:|---|
| `user` | Kadang | Untuk object kecil jelas |
| `page` | Bagus | Root page model |
| `caseDetail` | Bagus | Page/domain-specific root |
| `row` | Bagus dalam table loop | Local dan jelas |
| `item` | Cukup | Kurang semantic jika banyak loop |
| `dto` | Buruk | Bocor istilah teknis |
| `entity` | Buruk | Jangan expose entity |
| `data` | Buruk | Terlalu generik |
| `model` | Buruk | Membingungkan dengan MVC model |

### 17.2 Root Object Pattern

Untuk page kompleks, gunakan satu root object:

```java
model.addAttribute("page", caseDetailPage);
```

Template:

```html
<h1 th:text="${page.title}"></h1>
<table>
  <tr th:each="row : ${page.rows}">
    <td th:text="${row.caseNo}"></td>
  </tr>
</table>
```

Keuntungan:

- context tidak penuh variable acak,
- fragment parameter lebih jelas,
- contract lebih mudah dites,
- page model mudah snapshot.

---

## 18. `th:with`: Local Variables

`th:with` membuat local variable.

Contoh:

```html
<div th:with="fullName=${user.firstName + ' ' + user.lastName}">
    <span th:text="${fullName}"></span>
</div>
```

### 18.1 Kapan `th:with` Berguna?

Untuk alias sederhana:

```html
<section th:with="header=${page.header}">
    <h1 th:text="${header.title}"></h1>
    <p th:text="${header.subtitle}"></p>
</section>
```

Untuk menghitung nilai presentation ringan:

```html
<tr th:each="row : ${page.rows}" th:with="highlight=${row.highPriority}">
    <td th:classappend="${highlight} ? 'highlight' : ''"></td>
</tr>
```

### 18.2 Kapan `th:with` Buruk?

Jika dipakai untuk logic besar:

```html
<div th:with="risk=${case.status == 'OPEN' and case.ageDays > 30 and case.amount > 10000 ? 'HIGH' : 'NORMAL'}">
```

Pindahkan ke presenter.

Rule:

```text
th:with boleh untuk readability alias.
th:with tidak boleh menjadi computation layer.
```

---

## 19. Inline Expressions: Text, JavaScript, CSS

Thymeleaf mendukung inline expression dalam mode tertentu.

Text inline:

```html
<p>Hello, [[${user.fullName}]]!</p>
```

Unescaped inline expression:

```html
<p>[(${htmlContent})]</p>
```

Unescaped harus sangat jarang dipakai.

### 19.1 Inline Text vs `th:text`

Gunakan inline text untuk sentence:

```html
<p>Welcome back, [[${user.displayName}]].</p>
```

Gunakan `th:text` untuk single value:

```html
<span th:text="${user.displayName}"></span>
```

### 19.2 Inline JavaScript

JavaScript inline expression perlu context-aware serialization.

Untuk small flags:

```html
<script th:inline="javascript">
  const currentUser = /*[[${user.displayName}]]*/ "Prototype User";
</script>
```

Namun untuk object besar:

- pertimbangkan endpoint JSON,
- jangan render secret,
- jangan dump entire user/session,
- jangan masukkan permission internal mentah,
- gunakan DTO khusus frontend.

### 19.3 CSS Inline

CSS inline expression punya risiko sendiri jika value berasal dari user input.

Buruk:

```html
<div th:style="|background-image: url(${userProvidedUrl})|"></div>
```

Lebih baik:

- validasi URL allowlist di Java,
- gunakan class mapping, bukan style bebas,
- jangan inject raw CSS dari user.

---

## 20. Expression dalam Attribute Processor

Expression tidak berdiri sendiri. Ia dipakai oleh attribute processor.

Contoh:

```html
<a th:href="@{/cases/{id}(id=${case.id})}" th:text="${case.caseNo}">CASE-001</a>
```

Di sini:

- `th:href` memakai link expression,
- `th:text` memakai variable expression,
- output context berbeda.

### 20.1 `th:attr`

`th:attr` bisa set attribute dinamis:

```html
<button th:attr="data-case-id=${case.id}, aria-label=${case.actionAriaLabel}">
    Open
</button>
```

Namun untuk attribute umum, gunakan dedicated processor jika tersedia:

```html
<a th:href="@{/cases/{id}(id=${case.id})}"></a>
<img th:src="@{/images/logo.png}" />
<input th:value="${form.name}" />
```

Dedicated attribute biasanya lebih readable.

### 20.2 `th:classappend`

```html
<tr th:classappend="${row.highPriority} ? 'table-warning' : ''">
```

Untuk class yang kompleks, presenter bisa menyediakan class:

```html
<tr th:classappend="${row.cssClass}">
```

Tetapi hati-hati: jangan biarkan raw user input menjadi CSS class bebas.

### 20.3 Boolean Attributes

Untuk disabled/checked/selected, gunakan processor yang sesuai.

```html
<button th:disabled="${!actions.canSubmit}">Submit</button>
```

Ini lebih baik daripada string-manual attribute.

---

## 21. Expression dan Natural Templates

Salah satu kekuatan Thymeleaf adalah natural templates: HTML masih bisa dibuka di browser sebagai prototype.

Contoh:

```html
<h1 th:text="${page.title}">Case Detail Prototype</h1>
```

Saat statis, browser menampilkan:

```text
Case Detail Prototype
```

Saat runtime, Thymeleaf mengganti dengan `page.title`.

### 21.1 Prototype Value Harus Masuk Akal

Buruk:

```html
<h1 th:text="${page.title}"></h1>
```

Masih valid, tapi prototype kosong.

Lebih baik:

```html
<h1 th:text="${page.title}">Case Detail</h1>
```

Untuk table:

```html
<tr th:each="row : ${page.rows}">
    <td th:text="${row.caseNo}">CASE-2026-001</td>
    <td th:text="${row.statusLabel}">Pending Review</td>
</tr>
```

### 21.2 Jangan Biarkan Prototype Menipu

Prototype data bukan test data. Jangan menganggap karena static HTML tampak bagus, runtime model benar.

Harus tetap ada:

- render test,
- snapshot test,
- missing field test,
- locale test,
- security escaping test.

---

## 22. Expression Anti-Patterns Catalog

### 22.1 Business Rule in Template

Buruk:

```html
<span th:if="${case.status == 'OPEN' and case.daysSinceSubmission > 14 and user.role == 'SUPERVISOR'}">
```

Lebih baik:

```html
<span th:if="${case.showEscalationWarning}">
```

### 22.2 Service Call in Template

Buruk:

```html
<span th:text="${@caseService.countOpenCases()}" />
```

Lebih baik:

```html
<span th:text="${dashboard.openCaseCount}" />
```

### 22.3 Entity Graph Traversal

Buruk:

```html
<span th:text="${case.application.applicant.primaryAddress.country.name}"></span>
```

Lebih baik:

```html
<span th:text="${case.applicantCountryLabel}"></span>
```

### 22.4 Nested Ternary Hell

Buruk:

```html
<span th:text="${s == 'A' ? 'Approved' : s == 'R' ? 'Rejected' : s == 'P' ? 'Pending' : 'Unknown'}"></span>
```

Lebih baik:

```html
<span th:text="${case.statusLabel}"></span>
```

### 22.5 Raw HTML Without Contract

Buruk:

```html
<div th:utext="${description}"></div>
```

Lebih baik:

```html
<div th:utext="${safeHtmlDescription}"></div>
```

Plus sanitizer + tests.

### 22.6 URL Built by Concatenation

Buruk:

```html
<a th:href="${'/cases/' + case.id + '?tab=' + tab}"></a>
```

Lebih baik:

```html
<a th:href="@{/cases/{id}(id=${case.id}, tab=${tab})}"></a>
```

### 22.7 Fragment with Hidden Global Dependency

Buruk:

```html
<div th:fragment="actions">
  <button th:if="${case.canApprove}">Approve</button>
</div>
```

Lebih baik:

```html
<div th:fragment="actions(actions)">
  <button th:if="${actions.canApprove}">Approve</button>
</div>
```

---

## 23. Designing Expression-Friendly ViewModels

### 23.1 Page ViewModel

```java
public record CaseDetailPage(
    String title,
    CaseHeader header,
    ApplicantSection applicant,
    List<DocumentRow> documents,
    CaseActionBar actions,
    List<AlertView> alerts
) {}
```

Template:

```html
<main th:object="${page}">
    <h1 th:text="*{title}">Case Detail</h1>

    <section th:replace="~{case/fragments/header :: header(*{header})}"></section>
    <section th:replace="~{case/fragments/applicant :: applicant(*{applicant})}"></section>
    <section th:replace="~{case/fragments/actions :: actions(*{actions})}"></section>
</main>
```

### 23.2 Row ViewModel

```java
public record CaseRow(
    String caseNo,
    String applicantName,
    String statusLabel,
    String statusCssClass,
    String detailHref
) {}
```

Template:

```html
<tr th:each="row : ${page.rows}">
    <td>
        <a th:href="${row.detailHref}" th:text="${row.caseNo}">CASE-001</a>
    </td>
    <td th:text="${row.applicantName}">Applicant</td>
    <td>
        <span th:classappend="${row.statusCssClass}" th:text="${row.statusLabel}">Status</span>
    </td>
</tr>
```

Note: `detailHref` boleh disediakan oleh presenter jika route logic kompleks. Kalau route sederhana, template `@{...}` juga baik. Pilih satu policy yang konsisten.

### 23.3 Action ViewModel

```java
public record CaseActionBar(
    boolean canApprove,
    boolean canReject,
    boolean canAssign,
    String approveHref,
    String rejectHref,
    String assignHref
) {}
```

Template:

```html
<div class="actions" th:object="${page.actions}">
    <a th:if="*{canApprove}" th:href="*{approveHref}">Approve</a>
    <a th:if="*{canReject}" th:href="*{rejectHref}">Reject</a>
    <a th:if="*{canAssign}" th:href="*{assignHref}">Assign</a>
</div>
```

### 23.4 Alert ViewModel

```java
public record AlertView(
    String level,
    String cssClass,
    String messageKey,
    List<String> messageArgs
) {}
```

Template sederhana:

```html
<div th:each="alert : ${page.alerts}" th:classappend="${alert.cssClass}">
    <span th:text="#{${alert.messageKey}}">Alert</span>
</div>
```

Untuk parameterized message dinamis, hati-hati. Kadang lebih baik presenter menyediakan final `messageLabel` agar template tidak perlu dynamic message resolution.

---

## 24. Expression Testing Strategy

Expression tidak boleh dianggap “cuma view”. Banyak bug production terjadi di view.

### 24.1 Render Test Minimal

```java
@Test
void rendersCaseDetail() {
    Context context = new Context(Locale.ENGLISH);
    context.setVariable("page", sampleCaseDetailPage());

    String html = templateEngine.process("case/detail", context);

    assertThat(html).contains("CASE-2026-001");
    assertThat(html).contains("Pending Review");
}
```

### 24.2 Missing Variable Test

Render template dengan model minimal dan pastikan fail untuk field required.

```text
Goal: catch template/model mismatch before deployment.
```

### 24.3 Escaping Test

Input:

```text
<script>alert(1)</script>
```

Expected:

```text
Output contains escaped text, not executable script.
```

### 24.4 URL Test

Pastikan link hasil render benar:

```html
/cases/123?tab=documents
```

Bukan:

```html
/cases/null
/cases/123?tab=<script>
```

### 24.5 Locale Test

Render dengan locale berbeda:

```java
new Context(Locale.ENGLISH)
new Context(new Locale("id"))
```

Pastikan message key resolve.

### 24.6 Fragment Contract Test

Render fragment dengan parameter minimal.

```text
Fragment is a component API.
Component API needs tests.
```

---

## 25. Production Design Rules

Berikut rule praktis untuk expression Thymeleaf yang sehat:

### Rule 1 — Expression Membaca, Tidak Mengorkestrasi

```text
Expression should read prepared presentation data.
Expression should not orchestrate service, repository, workflow, or domain policy.
```

### Rule 2 — Template Model Adalah API

Jika template membaca:

```html
${page.header.title}
```

Maka `page.header.title` adalah public API antara Java layer dan template.

Perubahan field harus dianggap breaking change.

### Rule 3 — Jangan Expose Entity

Jangan kirim JPA entity langsung ke template untuk page penting.

Gunakan:

- projection,
- DTO,
- ViewModel,
- Presenter output.

### Rule 4 — Jangan Expose Service

Template tidak boleh tahu service/repository.

### Rule 5 — Jangan Gunakan `th:utext` Kecuali Ada Sanitization Contract

Raw HTML harus explicit:

```text
safeHtmlXxx
sanitizedHtmlXxx
trustedHtmlXxx
```

Dan tetap harus ada test/security review.

### Rule 6 — URL Pakai `@{...}` atau Precomputed Safe Link

Jangan concatenate URL manual.

### Rule 7 — Fragment Parameter Explicit

Fragment reusable harus menerima parameter, bukan membaca global variable diam-diam.

### Rule 8 — Formatting Policy Harus Jelas

Untuk date/time/currency/identity/status legal/regulatory, lebih baik presenter menyediakan label yang sudah sesuai policy.

### Rule 9 — Expression Complexity Budget

Jika expression terlalu panjang untuk dibaca dalam 5 detik, pindahkan ke Java.

### Rule 10 — Test Rendering Seperti Test Software Lain

Template adalah production code.

---

## 26. Contoh End-to-End: Case List Page

### 26.1 Controller

```java
@GetMapping("/cases")
public String listCases(CaseSearchRequest request, Model model, Locale locale) {
    CaseSearchResult result = caseQuery.search(request);
    CaseListPage page = caseListPresenter.toPage(result, request, locale);
    model.addAttribute("page", page);
    return "case/list";
}
```

### 26.2 ViewModel

```java
public record CaseListPage(
    String title,
    CaseFilterView filter,
    List<CaseRowView> rows,
    PageView pagination,
    boolean empty
) {}

public record CaseRowView(
    String caseNo,
    String applicantName,
    String statusLabel,
    String statusCssClass,
    String submittedAtLabel,
    String detailHref
) {}
```

### 26.3 Template

```html
<!doctype html>
<html lang="en" xmlns:th="http://www.thymeleaf.org">
<head>
    <title th:text="${page.title}">Case List</title>
</head>
<body>
<main>
    <h1 th:text="${page.title}">Case List</h1>

    <section th:replace="~{case/fragments/filter :: filter(${page.filter})}"></section>

    <p th:if="${page.empty}" th:text="#{case.list.empty}">No cases found.</p>

    <table th:if="${!page.empty}">
        <thead>
        <tr>
            <th th:text="#{case.list.column.caseNo}">Case No</th>
            <th th:text="#{case.list.column.applicant}">Applicant</th>
            <th th:text="#{case.list.column.status}">Status</th>
            <th th:text="#{case.list.column.submittedAt}">Submitted At</th>
        </tr>
        </thead>
        <tbody>
        <tr th:each="row : ${page.rows}">
            <td><a th:href="${row.detailHref}" th:text="${row.caseNo}">CASE-001</a></td>
            <td th:text="${row.applicantName}">Applicant Name</td>
            <td><span th:classappend="${row.statusCssClass}" th:text="${row.statusLabel}">Pending</span></td>
            <td th:text="${row.submittedAtLabel}">19 Jun 2026</td>
        </tr>
        </tbody>
    </table>

    <nav th:replace="~{components/pagination :: pagination(${page.pagination})}"></nav>
</main>
</body>
</html>
```

### 26.4 Kenapa Ini Baik?

Karena:

- template expression pendek,
- tidak ada JPA entity traversal,
- tidak ada service call,
- i18n key explicit,
- URL disiapkan aman atau bisa memakai `@{...}` konsisten,
- fragment parameter explicit,
- status label/css sudah disiapkan presenter,
- date/time sudah diformat sesuai policy,
- empty state explicit.

---

## 27. Contoh End-to-End: Detail Page dengan Action Capability

### 27.1 ViewModel

```java
public record CaseDetailPage(
    String title,
    CaseHeaderView header,
    ApplicantView applicant,
    CaseActionView actions,
    List<TimelineItemView> timeline
) {}

public record CaseActionView(
    boolean canApprove,
    boolean canReject,
    boolean canRequestInfo,
    String approveHref,
    String rejectHref,
    String requestInfoHref
) {}
```

### 27.2 Template

```html
<section th:object="${page}">
    <h1 th:text="*{title}">Case Detail</h1>

    <div th:replace="~{case/fragments/header :: header(*{header})}"></div>
    <div th:replace="~{case/fragments/applicant :: applicant(*{applicant})}"></div>

    <div class="actions" th:object="*{actions}">
        <a th:if="*{canApprove}" th:href="*{approveHref}" th:text="#{case.action.approve}">Approve</a>
        <a th:if="*{canReject}" th:href="*{rejectHref}" th:text="#{case.action.reject}">Reject</a>
        <a th:if="*{canRequestInfo}" th:href="*{requestInfoHref}" th:text="#{case.action.requestInfo}">Request Info</a>
    </div>
</section>
```

### 27.3 Important Boundary

`canApprove` bukan security enforcement final. Itu hanya view capability. Endpoint approve tetap wajib validasi:

```java
@PostMapping("/cases/{caseId}/approve")
public String approve(@PathVariable long caseId, Principal principal) {
    caseCommand.approve(caseId, principal);
    return "redirect:/cases/" + caseId;
}
```

Command layer tetap mengecek:

- user permission,
- case state,
- lock/assignment,
- tenant/agency boundary,
- optimistic concurrency,
- required decision reason,
- audit event.

---

## 28. Java 8 sampai 25 Considerations

Thymeleaf usage pattern relatif stabil lintas Java 8–25, tetapi Java version mempengaruhi desain ViewModel dan runtime.

### 28.1 Java 8

Gunakan class biasa atau Lombok-style DTO jika record belum tersedia.

```java
public final class CaseRowView {
    private final String caseNo;
    private final String statusLabel;

    public CaseRowView(String caseNo, String statusLabel) {
        this.caseNo = Objects.requireNonNull(caseNo);
        this.statusLabel = Objects.requireNonNull(statusLabel);
    }

    public String getCaseNo() { return caseNo; }
    public String getStatusLabel() { return statusLabel; }
}
```

### 28.2 Java 16+

Records cocok untuk immutable ViewModel:

```java
public record CaseRowView(String caseNo, String statusLabel) {}
```

### 28.3 Java 17/21/25

Gunakan:

- records untuk presentation model,
- sealed types untuk variant UI state jika cocok,
- `java.time` untuk date/time,
- pattern matching di presenter untuk mapping state,
- virtual threads untuk concurrent I/O sekitar rendering pipeline jika ada batch/email/document workload, bukan untuk membuat template logic lebih kompleks.

Contoh sealed UI state:

```java
sealed interface AlertView permits InfoAlert, WarningAlert, ErrorAlert {}

record InfoAlert(String messageLabel) implements AlertView {}
record WarningAlert(String messageLabel) implements AlertView {}
record ErrorAlert(String messageLabel) implements AlertView {}
```

Presenter bisa map ke simple row/alert DTO sebelum template, sehingga template tidak perlu pattern matching kompleks.

---

## 29. Deep Mental Model: Expression sebagai Query Language Terhadap Presentation Snapshot

Agar desain tetap benar, bayangkan setiap render punya snapshot:

```text
RenderSnapshot
├── templateName
├── templateVersion
├── locale
├── timezone
├── principal/viewCapabilities
├── page model
├── message bundle version
└── static asset version
```

Expression hanya boleh membaca snapshot itu.

Tidak boleh:

- mengambil data baru dari database,
- mengubah workflow state,
- mengirim email,
- memanggil API,
- mengubah session tanpa kontrol,
- membaca secret internal,
- melakukan authorization final,
- menentukan fetch plan.

Dengan mental model ini, template menjadi deterministic:

```text
same template + same model + same locale + same config => same output
```

Ini sangat penting untuk:

- audit,
- test,
- debugging,
- document reproducibility,
- email re-render prevention,
- legal/regulatory defensibility.

---

## 30. Checklist Review Template Expression

Gunakan checklist ini saat code review:

```text
[ ] Apakah expression pendek dan jelas?
[ ] Apakah template hanya membaca ViewModel, bukan entity besar?
[ ] Apakah ada service/repository call dari template?
[ ] Apakah ada lazy relation traversal yang bisa memicu N+1?
[ ] Apakah ternary/boolean logic masih sederhana?
[ ] Apakah message key stabil dan terstruktur?
[ ] Apakah URL memakai @{...} atau safe precomputed link?
[ ] Apakah fragment parameter eksplisit?
[ ] Apakah th:utext tidak dipakai sembarangan?
[ ] Apakah user input dirender dengan escaping benar?
[ ] Apakah date/time/currency punya locale/timezone policy?
[ ] Apakah authorization UI bukan dianggap backend authorization?
[ ] Apakah missing model field akan terdeteksi di test/CI?
[ ] Apakah output bisa diuji secara deterministic?
```

---

## 31. Ringkasan

Thymeleaf Standard Expressions adalah core produktivitas Thymeleaf:

```text
${...}  -> variable expression
*{...}  -> selection expression
#{...}  -> message expression
a@{...} -> link expression
~{...}  -> fragment expression
|...|   -> literal substitution
```

Tetapi kemampuan ini harus dipakai dengan disiplin engineering.

Kesimpulan penting:

1. Expression adalah read-only query terhadap presentation context.
2. Template model adalah API, bukan tempat menaruh object sembarang.
3. Entity/service exposure adalah sumber coupling, security risk, dan performance risk.
4. Fragment expression menciptakan component API; parameter harus eksplisit.
5. Message expression adalah contract i18n; key harus stabil dan dites.
6. URL expression mencegah string URL manual yang rawan rusak.
7. `th:utext` adalah fitur berisiko tinggi dan harus butuh sanitization contract.
8. View capability di template bukan authorization final.
9. Expression complexity harus punya budget; logic besar pindahkan ke Java presenter.
10. Rendering yang baik harus deterministic, testable, observable, dan aman.

Top 1% engineer tidak hanya tahu syntax Thymeleaf. Mereka tahu batasnya.

Mereka tahu kapan menulis:

```html
<span th:text="${case.statusLabel}"></span>
```

bukan:

```html
<span th:text="${case.status == 'PENDING_DIRECTOR_APPROVAL' ? 'Pending Director Approval' : 'Other'}"></span>
```

Karena kualitas template bukan diukur dari seberapa banyak logic yang bisa dimasukkan, tetapi dari seberapa jelas kontrak antara Java layer dan rendering layer.

---

## 32. Referensi

- Thymeleaf Official Documentation — Using Thymeleaf 3.1: standard expressions, template modes, natural templates, link expressions, message expressions, fragment expressions.
- Thymeleaf Official Documentation — Thymeleaf + Spring 3.1: Spring integration, SpringStandard dialect, form binding, fragments from controller return values.
- Thymeleaf API Documentation — `TemplateEngine`, `StandardDialect`, `SpringStandardDialect`, `Fragment`.
- Spring Framework Reference — Thymeleaf integration in Spring MVC.
- OWASP XSS Prevention Cheat Sheet — context-aware escaping and output encoding principles.

---

## 33. Status Seri

```text
Part 13 selesai.
Seri belum selesai.
Berikutnya: Part 14 — Thymeleaf Attributes, DOM Transformation, and Natural HTML.
```
