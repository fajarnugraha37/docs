# learn-java-template-freemarker-thymeleaf-rendering-engineering-part-014

# Part 14 — Thymeleaf Attributes, DOM Transformation, and Natural HTML

## Status Seri

- Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`
- Part: `014`
- Topik: `Thymeleaf Attributes, DOM Transformation, and Natural HTML`
- Scope Java: Java 8 sampai Java 25
- Status: selesai untuk Part 14, seri belum selesai
- Prasyarat konseptual:
  - Part 12 — Thymeleaf Fundamental Architecture
  - Part 13 — Thymeleaf Standard Expressions Deep Dive

---

## 1. Tujuan Bagian Ini

Bagian ini membahas Thymeleaf dari sudut pandang yang sering luput ketika orang hanya belajar `th:text`, `th:each`, atau `th:if` secara potongan.

Tujuan utamanya bukan sekadar hafal attribute, tetapi memahami bahwa Thymeleaf bekerja sebagai **DOM transformation engine**.

Artinya, template Thymeleaf bukan hanya string yang disisipi variable, melainkan dokumen HTML/XML/textual yang diproses oleh engine melalui processor, attribute, template mode, expression, dan context sehingga menghasilkan output final.

Mental model yang harus terbentuk setelah bagian ini:

```text
HTML template valid
  + th:* attributes
  + model/context
  + template mode
  + dialect processors
  + precedence rules
  + escaping rules
  = rendered output
```

Thymeleaf unggul ketika kita ingin membuat template yang tetap bisa dibuka sebagai HTML statis oleh browser, tetapi saat runtime berubah menjadi dynamic page. Inilah yang disebut **natural template**.

Namun, kekuatan ini hanya aman dan maintainable jika kita memahami beberapa hal:

1. `th:*` bukan sekadar attribute tambahan.
2. Setiap `th:*` adalah instruksi transformasi DOM.
3. Urutan attribute di HTML source tidak menentukan urutan eksekusi.
4. Thymeleaf punya attribute precedence sendiri.
5. `th:text` aman secara default karena escaped.
6. `th:utext` berbahaya jika input tidak trusted/sanitized.
7. `th:href`, `th:src`, `th:action`, dan `@{...}` adalah URL construction layer.
8. `th:each` dapat menggandakan node, bukan hanya mengulang string.
9. `th:if`/`th:unless` menghapus atau mempertahankan node.
10. Template yang baik harus tetap readable sebagai HTML dan tidak berubah menjadi business logic dump.

---

## 2. Apa Yang Tidak Akan Diulang

Kita tidak akan mengulang detail Part 13 tentang expression syntax seperti `${...}`, `*{...}`, `#{...}`, `@{...}`, dan `~{...}` kecuali untuk melihat bagaimana expression tersebut dipakai oleh attribute.

Kita juga tidak akan membahas form binding secara mendalam karena itu masuk Part 15.

Bagian ini fokus pada:

- attribute processing,
- DOM transformation,
- natural template,
- attribute precedence,
- conditional rendering,
- iteration,
- dynamic attribute construction,
- class/style handling,
- safe vs unsafe rendering,
- template readability,
- failure-prone patterns.

---

## 3. Mental Model: Thymeleaf Bukan String Interpolation Engine Biasa

Banyak template engine bekerja dengan mental model seperti ini:

```text
Hello ${name}
```

lalu engine mengganti `${name}` dengan value.

Thymeleaf bisa melakukan itu, tetapi model utamanya lebih kaya.

Contoh template:

```html
<p th:text="${user.displayName}">Static User Name</p>
```

Saat dibuka langsung di browser tanpa server, browser melihat:

```html
<p>Static User Name</p>
```

Saat dirender oleh Thymeleaf, engine menghasilkan:

```html
<p>Fajar Abdi Nugraha</p>
```

Yang penting: Thymeleaf tidak hanya menambal text. Ia membaca element `<p>`, menemukan processor untuk `th:text`, mengevaluasi expression, lalu mengganti body element.

Jadi operasi sebenarnya:

```text
node <p>
  attribute th:text="${user.displayName}"
  fallback body: "Static User Name"

runtime transformation:
  evaluate ${user.displayName}
  escape as text
  replace body of <p>
  remove th:text from output
```

Output final tidak membawa `th:text`:

```html
<p>Fajar Abdi Nugraha</p>
```

Ini berbeda dari sekadar:

```text
replace placeholder with value
```

Thymeleaf berpikir dalam bentuk **node transformation**.

---

## 4. Natural Template: Kenapa Ini Penting

Natural template berarti file HTML bisa:

1. dibuka langsung oleh browser sebagai static prototype,
2. tetap valid sebagai HTML,
3. dirender oleh Thymeleaf menjadi output dinamis,
4. dibaca oleh developer, designer, QA, atau stakeholder UI tanpa selalu menjalankan backend.

Contoh:

```html
<table>
  <tbody>
    <tr th:each="caseItem : ${cases}">
      <td th:text="${caseItem.referenceNo}">CASE-2026-0001</td>
      <td th:text="${caseItem.statusLabel}">Pending Review</td>
      <td>
        <a th:href="@{/cases/{id}(id=${caseItem.id})}">View</a>
      </td>
    </tr>
  </tbody>
</table>
```

Tanpa server, browser masih menampilkan satu contoh row.

Dengan server, row tersebut diulang sebanyak item dalam `${cases}`.

Ini powerful untuk:

- admin portal,
- internal case management,
- notification preview,
- regulatory letter preview,
- server-side rendered UI,
- workflow screen,
- document/email preview.

Namun ada trade-off:

Natural template mendorong kita menjaga HTML tetap bersih. Kalau template penuh expression panjang, nested conditional, dan raw JavaScript inline, natural template value-nya hilang.

---

## 5. Attribute Processor: `th:*` Sebagai Instruksi Transformasi

Setiap attribute `th:*` biasanya diproses oleh processor dari dialect.

Contoh:

```html
<span th:text="${message}">Default message</span>
```

`th:text` diproses oleh processor yang bertugas:

1. membaca expression `${message}`,
2. mengevaluasi expression terhadap context,
3. melakukan escaping sesuai template mode,
4. mengganti body element,
5. menghapus attribute `th:text` dari output final.

Contoh lain:

```html
<a th:href="@{/cases/{id}(id=${caseId})}">Open</a>
```

`th:href`:

1. mengevaluasi URL expression,
2. membangun URL final,
3. menulis attribute `href`,
4. menghapus attribute `th:href`.

Output:

```html
<a href="/cases/123">Open</a>
```

Jadi `th:href` bukan attribute tambahan di output. Ia adalah **instruction attribute**.

---

## 6. Kenapa Urutan Attribute HTML Tidak Menentukan Eksekusi

Dalam HTML/XML, urutan attribute pada satu tag tidak memiliki makna semantik.

Ini berarti dua element berikut secara HTML equivalent:

```html
<tr th:each="item : ${items}" th:classappend="${item.active} ? 'active'" th:text="${item.name}">
```

```html
<tr th:text="${item.name}" th:classappend="${item.active} ? 'active'" th:each="item : ${items}">
```

Namun secara template, kita perlu `th:each` diproses sebelum `th:text` karena `item` harus tersedia dulu.

Karena itu Thymeleaf memiliki **attribute precedence**.

Mental model:

```text
HTML attribute order: cosmetic/source-code order
Thymeleaf attribute precedence: runtime execution order
```

Ini sangat penting saat menggabungkan:

- `th:each` + `th:text`,
- `th:if` + `th:classappend`,
- `th:object` + `th:field`,
- `th:replace` + fragment parameter,
- `th:with` + expression lain.

Jika tidak paham precedence, bug akan terlihat “aneh”: variable seolah tidak ada, fragment tidak menerima value, atau node hilang sebelum attribute lain diproses.

---

## 7. Attribute Precedence: Urutan Konseptual

Urutan tepat dapat berubah menurut versi/dialect detail, tetapi secara mental model, kelompok prioritas pentingnya adalah:

1. Fragment inclusion/substitution
   - `th:insert`
   - `th:replace`
2. Iteration
   - `th:each`
3. Conditional evaluation
   - `th:if`
   - `th:unless`
   - `th:switch`
   - `th:case`
4. Local variable definition
   - `th:object`
   - `th:with`
5. General attribute modification
   - `th:attr`
   - `th:href`
   - `th:src`
   - `th:class`
   - `th:classappend`
   - `th:style`
   - `th:value`
6. Specific text/body modification
   - `th:text`
   - `th:utext`
7. Fragment specification/removal
   - `th:fragment`
   - `th:remove`

Prinsipnya:

```text
Structure first, content later.
```

Artinya:

- duplicate/include node dulu,
- putuskan node ada atau tidak,
- definisikan variable lokal,
- modifikasi attribute,
- isi text/body,
- bersihkan/proses fragment metadata.

Contoh:

```html
<li th:each="role : ${user.roles}" th:text="${role.label}">Role</li>
```

`th:each` harus diproses sebelum `th:text` karena `role` baru tersedia setelah iteration.

---

## 8. `th:text`: Escaped Text Replacement

`th:text` adalah attribute yang paling sering dipakai dan salah satu yang paling aman.

Contoh:

```html
<p th:text="${user.displayName}">John Doe</p>
```

Jika model:

```java
model.addAttribute("user", new UserView("Fajar"));
```

Output:

```html
<p>Fajar</p>
```

Jika value mengandung HTML:

```text
<script>alert('xss')</script>
```

Dengan `th:text`, output akan di-escape:

```html
<p>&lt;script&gt;alert('xss')&lt;/script&gt;</p>
```

Artinya browser menampilkan teks literal, bukan menjalankan script.

Rule production:

```text
Default gunakan th:text untuk data dinamis.
Gunakan th:utext hanya bila value sudah trusted dan sanitized.
```

---

## 9. `th:utext`: Unescaped Text, Useful Tapi Berbahaya

`th:utext` berarti unescaped text.

Contoh:

```html
<div th:utext="${article.renderedHtml}">
  <p>Preview content</p>
</div>
```

Jika value:

```html
<strong>Hello</strong>
```

Output:

```html
<div><strong>Hello</strong></div>
```

Ini berguna untuk:

- CMS content yang sudah disanitasi,
- rich text legal clause yang berasal dari curated source,
- template preview hasil Markdown-to-HTML yang sudah di-sanitize,
- static trusted HTML snippet.

Namun ini berbahaya jika value berasal dari user input mentah.

Contoh buruk:

```html
<div th:utext="${comment.body}"></div>
```

Jika comment body berisi:

```html
<img src=x onerror=alert(1)>
```

Maka output bisa mengeksekusi script.

Production rule:

```text
th:utext requires proof:
- source trusted, atau
- sanitized with allowlist HTML sanitizer, dan
- field name jelas menunjukkan safe HTML, misalnya safeHtml, sanitizedHtml, renderedTrustedHtml.
```

Jangan beri nama:

```java
String body;
```

lalu render dengan `th:utext`.

Lebih baik:

```java
String sanitizedBodyHtml;
```

Nama field harus membantu reviewer melihat boundary keamanan.

---

## 10. Text Replacement vs Body Preservation

Template:

```html
<span th:text="${statusLabel}">Pending Review</span>
```

Body `Pending Review` adalah fallback static prototype.

Saat runtime, body diganti sepenuhnya.

Artinya jika template seperti ini:

```html
<span th:text="${count}">Total: <strong>10</strong></span>
```

Maka runtime body menjadi hanya value `${count}`.

Jika `${count}` adalah `20`, output:

```html
<span>20</span>
```

Bukan:

```html
<span>Total: <strong>20</strong></span>
```

Untuk menggabungkan static text dan dynamic value, pilih:

```html
<span>Total: <strong th:text="${count}">10</strong></span>
```

atau:

```html
<span th:text="|Total: ${count}|">Total: 10</span>
```

Rule:

```text
Gunakan th:text pada node paling kecil yang memang ingin diganti.
```

Ini menjaga HTML tetap stabil dan meminimalkan risiko output tidak sesuai.

---

## 11. Literal Substitution Untuk Text Sederhana

Thymeleaf mendukung literal substitution:

```html
<p th:text="|Hello, ${user.displayName}!|">Hello, John!</p>
```

Bagus untuk kalimat pendek.

Namun untuk i18n, jangan hardcode kalimat panjang:

```html
<p th:text="|Your case ${caseNo} has been approved on ${approvedDate}.|"></p>
```

Lebih baik gunakan message expression:

```html
<p th:text="#{case.approved.message(${caseNo}, ${approvedDate})}"></p>
```

Karena kalimat panjang biasanya perlu diterjemahkan, diformat, dan direview.

Rule:

```text
Literal substitution cocok untuk glue text kecil.
Untuk user-facing business sentence, gunakan message bundle.
```

---

## 12. `th:if` dan `th:unless`: Conditional Node Presence

`th:if` menentukan apakah node dipertahankan.

```html
<div th:if="${caseItem.canApprove}">
  <button>Approve</button>
</div>
```

Jika `canApprove == true`, node ada.

Jika `false`, node dihapus dari output.

`th:unless` kebalikannya:

```html
<p th:unless="${caseItem.hasDocuments}">No documents uploaded.</p>
```

Mental model:

```text
th:if/th:unless is node existence control.
```

Bukan CSS visibility.

Jika node dihapus, browser tidak menerima markup itu sama sekali.

Namun jangan salah paham:

```text
Menyembunyikan button dengan th:if bukan security backend.
```

Contoh:

```html
<button th:if="${canDelete}">Delete</button>
```

Ini hanya menyembunyikan UI. Endpoint delete tetap harus melakukan authorization.

---

## 13. `th:if` Untuk Struktur, Bukan Business Rule Berat

Contoh masih sehat:

```html
<span th:if="${caseItem.overdue}" class="badge">Overdue</span>
```

Contoh mulai buruk:

```html
<div th:if="${case.status.name() == 'PENDING_REVIEW' and case.assignee != null and case.assignee.department == currentUser.department and !case.locked and case.submissionDate.isBefore(today.minusDays(7))}">
  ...
</div>
```

Masalah:

1. business rule tersebar di template,
2. sulit dites,
3. sulit diaudit,
4. raw domain model bocor ke view,
5. kemungkinan null error meningkat,
6. perubahan rule harus cari di banyak template.

Lebih baik controller/service menyiapkan:

```java
record CaseRowView(
    String referenceNo,
    String statusLabel,
    boolean showOverdueBadge,
    boolean showApproveAction,
    boolean showEscalateAction
) {}
```

Template:

```html
<span th:if="${caseItem.showOverdueBadge}" class="badge badge-danger">Overdue</span>
<button th:if="${caseItem.showApproveAction}">Approve</button>
<button th:if="${caseItem.showEscalateAction}">Escalate</button>
```

Rule:

```text
Template boleh memilih struktur berdasarkan precomputed view-state.
Template tidak boleh menjadi rule engine.
```

---

## 14. Conditional Pairing: Tidak Ada `else` Langsung

Thymeleaf tidak memakai bentuk seperti:

```html
<div th:if="...">A</div>
<div th:else>B</div>
```

Biasanya digunakan `th:if` dan `th:unless`:

```html
<p th:if="${user.loggedIn}">Welcome back.</p>
<p th:unless="${user.loggedIn}">Please sign in.</p>
```

Untuk kondisi multi-cabang, pakai `th:switch` dan `th:case`.

---

## 15. `th:switch` dan `th:case`

Contoh:

```html
<div th:switch="${caseItem.statusCode}">
  <span th:case="'DRAFT'" class="badge">Draft</span>
  <span th:case="'PENDING_REVIEW'" class="badge">Pending Review</span>
  <span th:case="'APPROVED'" class="badge">Approved</span>
  <span th:case="*" class="badge">Unknown</span>
</div>
```

Gunakan untuk mapping kecil di presentation layer.

Namun untuk mapping status yang banyak, multilingual, dan style-specific, lebih baik precompute:

```java
record StatusBadgeView(
    String label,
    String cssClass,
    String ariaLabel
) {}
```

Template:

```html
<span th:text="${caseItem.status.label}"
      th:class="${caseItem.status.cssClass}"
      th:attr="aria-label=${caseItem.status.ariaLabel}">
  Pending Review
</span>
```

Rule:

```text
th:switch baik untuk branching kecil.
Untuk status enterprise yang dipakai lintas layar, jadikan view model/component.
```

---

## 16. `th:each`: Iteration Sebagai Node Duplication

`th:each` menggandakan node tempat attribute ditempel.

Contoh:

```html
<ul>
  <li th:each="role : ${roles}" th:text="${role.label}">Admin</li>
</ul>
```

Jika roles ada 3, output:

```html
<ul>
  <li>Admin</li>
  <li>Reviewer</li>
  <li>Approver</li>
</ul>
```

Mental model:

```text
th:each duplicates the host node for each item.
```

Bukan hanya mengulang isi node.

Jika `th:each` ditempel di `<tr>`, row diulang.
Jika ditempel di `<td>`, cell diulang.
Jika ditempel di `<section>`, section diulang.

---

## 17. Letakkan `th:each` Pada Node Yang Benar

Contoh benar untuk table row:

```html
<tbody>
  <tr th:each="caseItem : ${cases}">
    <td th:text="${caseItem.referenceNo}">CASE-001</td>
    <td th:text="${caseItem.statusLabel}">Pending</td>
  </tr>
</tbody>
```

Contoh salah:

```html
<tbody th:each="caseItem : ${cases}">
  <tr>
    <td th:text="${caseItem.referenceNo}">CASE-001</td>
  </tr>
</tbody>
```

Ini menggandakan `<tbody>`, bukan `<tr>`.

Kadang valid, tapi biasanya bukan yang diinginkan.

Rule:

```text
Pasang th:each pada unit visual yang ingin direplikasi.
```

---

## 18. Iteration Status Variable

Thymeleaf menyediakan status variable.

Contoh:

```html
<tr th:each="caseItem, stat : ${cases}">
  <td th:text="${stat.count}">1</td>
  <td th:text="${caseItem.referenceNo}">CASE-001</td>
</tr>
```

Status biasanya memiliki informasi seperti:

- index berbasis 0,
- count berbasis 1,
- size,
- current,
- even/odd,
- first/last.

Gunakan untuk presentation behavior:

```html
<tr th:each="caseItem, stat : ${cases}"
    th:classappend="${stat.odd} ? 'table-row-odd' : 'table-row-even'">
```

Namun hati-hati: styling zebra row lebih baik sering diserahkan ke CSS `:nth-child` jika memungkinkan.

Rule:

```text
Iteration status boleh untuk display number dan lightweight presentation.
Jangan pakai untuk business decision.
```

---

## 19. Empty State Untuk Collection

Contoh buruk:

```html
<tbody>
  <tr th:each="item : ${items}">
    <td th:text="${item.name}">Item</td>
  </tr>
</tbody>
```

Jika list kosong, user melihat table kosong tanpa penjelasan.

Lebih baik:

```html
<tbody>
  <tr th:each="item : ${items}">
    <td th:text="${item.name}">Item</td>
  </tr>
  <tr th:if="${#lists.isEmpty(items)}">
    <td colspan="5">No records found.</td>
  </tr>
</tbody>
```

Namun untuk reusable screen, lebih baik controller menyediakan:

```java
boolean hasItems;
String emptyMessage;
```

Template:

```html
<tr th:if="${!page.hasItems}">
  <td colspan="5" th:text="${page.emptyMessage}">No records found.</td>
</tr>
```

Rule:

```text
Setiap list/table harus punya empty state yang disengaja.
```

---

## 20. Avoid Rendering Huge Lists

Template engine bukan solusi untuk masalah pagination.

Contoh buruk:

```html
<tr th:each="audit : ${auditTrailEntries}">
```

Jika audit trail berisi 100.000 row, masalahnya bukan Thymeleaf lambat saja. Masalahnya desain UI, memory, network, browser rendering, dan database query.

Rule production:

```text
Large list must be paginated, filtered, summarized, streamed as export, or rendered asynchronously.
```

Untuk admin portal:

- table page size 20/50/100,
- server-side filter,
- server-side sorting,
- export job untuk data besar,
- jangan kirim semua data ke template.

---

## 21. `th:href`: URL Construction Yang Context-Aware

Contoh:

```html
<a th:href="@{/cases/{id}(id=${caseItem.id})}">View</a>
```

Output:

```html
<a href="/cases/123">View</a>
```

Keuntungan:

1. lebih aman daripada string concatenation,
2. mendukung path variable,
3. mendukung query parameter,
4. bisa context-path aware dalam web app,
5. lebih readable.

Query parameter:

```html
<a th:href="@{/cases(page=${page.number}, size=${page.size}, status=${filter.status})}">Next</a>
```

Output:

```html
<a href="/cases?page=2&size=20&status=PENDING">Next</a>
```

Path variable + query:

```html
<a th:href="@{/cases/{id}/documents(id=${caseItem.id}, type=${documentType})}">Documents</a>
```

Rule:

```text
Jangan build URL dengan string concatenation di template.
Gunakan @{...} melalui th:href/th:src/th:action.
```

---

## 22. URL Injection dan Redirect Risk

Hati-hati dengan URL yang berasal dari user input.

Contoh risk:

```html
<a th:href="${returnUrl}">Back</a>
```

Jika `returnUrl` bisa diisi user:

```text
javascript:alert(1)
```

atau external phishing URL:

```text
https://evil.example/login
```

Maka UI bisa menjadi attack surface.

Lebih aman:

```java
record NavigationLink(String label, String safeInternalPath) {}
```

Controller melakukan validasi:

- hanya path internal,
- hanya route allowlisted,
- tidak menerima scheme external sembarangan,
- encode parameter dengan benar.

Template:

```html
<a th:href="@{${nav.safeInternalPath}}" th:text="${nav.label}">Back</a>
```

Namun dynamic URL expression sendiri juga harus dikontrol. Untuk sistem enterprise, lebih baik template menerima route id atau prepared safe link, bukan raw user URL.

Rule:

```text
Dynamic href/src/action harus dianggap security-sensitive.
```

---

## 23. `th:src` Untuk Asset dan Dynamic Resource

Contoh static asset:

```html
<img th:src="@{/assets/logo.png}" alt="Company logo">
```

Dynamic avatar:

```html
<img th:src="@{/users/{id}/avatar(id=${user.id})}" th:alt="${user.displayName}">
```

Untuk server-side app, jangan expose raw file path:

```html
<!-- buruk -->
<img th:src="${user.profileImageFilePath}">
```

Lebih baik expose resource URL yang sudah dikontrol:

```java
String avatarUrl = "/users/123/avatar";
```

atau gunakan route builder.

Rule:

```text
Template tidak boleh tahu filesystem path, S3 key mentah, atau internal storage layout.
```

---

## 24. `th:action` Untuk Form Submission

Contoh:

```html
<form th:action="@{/cases/{id}/approve(id=${caseItem.id})}" method="post">
  <button type="submit">Approve</button>
</form>
```

Untuk action yang mengubah state, gunakan POST/PUT/PATCH/DELETE semantic melalui backend pattern. Karena HTML form native hanya mendukung GET/POST, method override bisa dipakai di framework tertentu.

Jangan gunakan link GET untuk destructive action:

```html
<!-- buruk -->
<a th:href="@{/cases/{id}/delete(id=${caseItem.id})}">Delete</a>
```

Lebih baik:

```html
<form th:action="@{/cases/{id}/delete(id=${caseItem.id})}" method="post">
  <button type="submit">Delete</button>
</form>
```

Plus CSRF protection di server.

Rule:

```text
th:href untuk navigasi.
th:action untuk state-changing command.
```

---

## 25. `th:class` dan `th:classappend`

`th:class` mengganti class attribute.

```html
<span th:class="${status.cssClass}" th:text="${status.label}">Pending</span>
```

Jika static class juga diperlukan, gunakan `th:classappend`:

```html
<span class="badge"
      th:classappend="${caseItem.overdue} ? ' badge-danger' : ' badge-secondary'"
      th:text="${caseItem.statusLabel}">
  Pending
</span>
```

Output:

```html
<span class="badge badge-danger">Overdue</span>
```

Pola lebih bersih:

```html
<span th:class="|badge ${caseItem.statusCssClass}|"
      th:text="${caseItem.statusLabel}">
  Pending
</span>
```

Tapi jangan biarkan model mengirim class arbitrary dari user input.

Baik:

```java
statusCssClass = switch (status) {
    case APPROVED -> "badge-success";
    case REJECTED -> "badge-danger";
    case PENDING -> "badge-warning";
};
```

Buruk:

```java
statusCssClass = request.getParameter("class");
```

Rule:

```text
Dynamic CSS class harus berasal dari allowlisted presentation state.
```

---

## 26. Class Append Pitfall: Spasi

Contoh:

```html
<span class="badge" th:classappend="${active} ? 'active' : ''">X</span>
```

Bergantung output, bisa menjadi:

```html
<span class="badgeactive">X</span>
```

Gunakan spasi eksplisit:

```html
<span class="badge" th:classappend="${active} ? ' active' : ''">X</span>
```

Atau gunakan class builder di view model:

```java
String cssClass = "badge active";
```

Template:

```html
<span th:class="${item.cssClass}">X</span>
```

Rule:

```text
Ketika append class manual, perhatikan whitespace.
Untuk class kompleks, precompute di ViewModel.
```

---

## 27. `th:style` dan CSS Injection

Contoh:

```html
<div th:style="|width: ${progressPercent}%;|">...</div>
```

Ini terlihat sederhana, tetapi hati-hati jika value bukan numeric controlled.

Buruk:

```html
<div th:style="${userProvidedStyle}"></div>
```

CSS bisa menjadi attack vector atau data exfiltration vector dalam kondisi tertentu. Jangan menerima style mentah dari user.

Lebih baik:

```java
int safeProgressPercent = Math.max(0, Math.min(100, progressPercent));
```

Template:

```html
<div class="progress-bar" th:style="|width: ${safeProgressPercent}%;|"></div>
```

Rule:

```text
Dynamic style hanya untuk value sempit dan tervalidasi, seperti number/range/token allowlist.
```

---

## 28. `th:attr`: General Attribute Modification

`th:attr` bisa mengubah attribute apa saja.

Contoh:

```html
<button th:attr="data-case-id=${caseItem.id}, aria-label=${caseItem.actionAriaLabel}">
  View
</button>
```

Output:

```html
<button data-case-id="123" aria-label="View case CASE-001">View</button>
```

Gunakan untuk:

- `data-*`,
- `aria-*`,
- attribute yang tidak punya shortcut khusus,
- multiple attribute sekaligus.

Namun jika ada dedicated attribute seperti `th:href`, `th:src`, `th:value`, biasanya lebih jelas pakai dedicated attribute.

Rule:

```text
Gunakan dedicated th:* jika tersedia.
Gunakan th:attr untuk attribute umum, data attribute, dan ARIA.
```

---

## 29. `th:attrappend` dan `th:attrprepend`

Kadang kita ingin menambah attribute yang sudah ada.

Contoh:

```html
<input class="form-control" th:attrappend="class=${field.hasError} ? ' is-invalid' : ''">
```

Namun untuk class, `th:classappend` lebih jelas.

Untuk attribute lain:

```html
<a href="/help" th:attrappend="title=' - opens help page'">Help</a>
```

Jarang dibutuhkan dalam template yang bersih.

Rule:

```text
Kalau sering memakai attrappend kompleks, kemungkinan ViewModel belum cukup matang.
```

---

## 30. Boolean Attribute Handling

HTML punya boolean attributes seperti:

- `disabled`,
- `checked`,
- `selected`,
- `readonly`,
- `multiple`,
- `required`.

Thymeleaf menyediakan processor terkait, misalnya:

```html
<button th:disabled="${!caseItem.canApprove}">Approve</button>
```

Jika true, output memiliki `disabled`.
Jika false, attribute tidak ada.

Jangan lakukan:

```html
<button disabled="${!caseItem.canApprove}">Approve</button>
```

Karena dalam HTML, adanya `disabled` saja sudah membuat disabled, walaupun value string-nya `false`.

Rule:

```text
Untuk boolean HTML attributes, gunakan th:disabled/th:checked/th:selected/dll.
Jangan tulis disabled="false".
```

---

## 31. `th:value`, `th:placeholder`, `th:title`, `th:alt`

Contoh:

```html
<input type="text"
       th:value="${filter.keyword}"
       th:placeholder="#{case.search.placeholder}">
```

Image alt:

```html
<img th:src="@{/assets/logo.png}" th:alt="#{app.logo.alt}">
```

Title:

```html
<button th:title="${caseItem.approveTooltip}">Approve</button>
```

Rule accessibility:

```text
Dynamic UI must not only render visible text.
It must also render accessible labels, alt, aria-label, aria-describedby, and validation hints correctly.
```

Top engineer tidak hanya membuat output “kelihatan benar”; dia membuat output bisa digunakan oleh assistive technology, automated tests, dan audit.

---

## 32. `th:object`: Selection Context

`th:object` menetapkan selection target untuk `*{...}` expression.

Contoh:

```html
<section th:object="${caseDetail}">
  <h1 th:text="*{referenceNo}">CASE-001</h1>
  <p th:text="*{statusLabel}">Pending Review</p>
</section>
```

Ini equivalent dengan:

```html
<h1 th:text="${caseDetail.referenceNo}"></h1>
```

Namun `th:object` membuat template lebih ringkas ketika banyak field dari object yang sama.

Hati-hati nesting:

```html
<section th:object="${caseDetail}">
  <div th:object="*{applicant}">
    <span th:text="*{name}">Applicant Name</span>
  </div>
</section>
```

Nesting bisa membuat template sulit dibaca jika terlalu dalam.

Rule:

```text
Gunakan th:object untuk satu cohesive section.
Jangan nested th:object terlalu dalam tanpa alasan kuat.
```

---

## 33. `th:with`: Local Variables

`th:with` membuat variable lokal.

Contoh:

```html
<div th:with="overdue=${caseItem.overdue}, severity=${caseItem.severity}">
  <span th:if="${overdue}" th:text="${severity.label}">High</span>
</div>
```

Berguna untuk:

- membuat expression lebih pendek,
- menyimpan hasil calculation ringan,
- memberi alias untuk object nested,
- fragment parameter preparation.

Namun jangan jadikan `th:with` tempat business logic.

Buruk:

```html
<div th:with="eligible=${case.status == 'PENDING' and case.score > 80 and user.department == case.department and !case.locked}">
```

Lebih baik:

```java
boolean eligibleForApproval;
```

Template:

```html
<div th:if="${caseItem.eligibleForApproval}">
```

Rule:

```text
th:with is for local readability, not for hiding complex rules.
```

---

## 34. `th:remove`: Prototype Cleanup

`th:remove` dapat menghapus bagian tertentu dari template.

Contoh natural template dengan dummy rows:

```html
<tbody>
  <tr th:each="caseItem : ${cases}">
    <td th:text="${caseItem.referenceNo}">CASE-001</td>
    <td th:text="${caseItem.statusLabel}">Pending</td>
  </tr>
  <tr th:remove="all">
    <td>CASE-002</td>
    <td>Approved</td>
  </tr>
  <tr th:remove="all">
    <td>CASE-003</td>
    <td>Rejected</td>
  </tr>
</tbody>
```

Saat dibuka statis, designer melihat tiga rows.
Saat runtime, dummy rows dihapus.

Rule:

```text
th:remove berguna untuk natural prototype.
Jangan terlalu banyak dummy markup sampai membingungkan reviewer.
```

---

## 35. `th:block`: Logical Container Tanpa Output Element

Kadang kita butuh grouping untuk Thymeleaf tetapi tidak ingin menambah element HTML.

Contoh:

```html
<th:block th:each="action : ${actions}">
  <button th:text="${action.label}">Action</button>
</th:block>
```

`th:block` tidak muncul sebagai element final.

Output:

```html
<button>Approve</button>
<button>Reject</button>
```

Berguna untuk:

- loop yang menghasilkan beberapa sibling nodes,
- conditional group,
- fragment logic.

Namun jangan overuse. Jika HTML semantic element tersedia, pakai element nyata.

Rule:

```text
th:block adalah control structure helper.
Gunakan saat tidak ingin menambah node wrapper yang mengganggu HTML.
```

---

## 36. Inline Expressions: `[[...]]` dan `[(...)]`

Selain `th:text`, Thymeleaf mendukung inline expression.

Escaped inline:

```html
<p>Hello, [[${user.displayName}]]!</p>
```

Unescaped inline:

```html
<div>[(${trustedHtml})]</div>
```

Rule sama seperti `th:text`/`th:utext`:

```text
[[...]] escaped.
[(...)] unescaped.
```

Untuk natural template, `th:text` sering lebih baik karena fallback static text jelas.

Contoh:

```html
<p th:text="|Hello, ${user.displayName}!|">Hello, John Doe!</p>
```

Inline berguna untuk:

- text kecil di tengah paragraph,
- JavaScript natural template,
- CSS natural template,
- message composition sederhana.

Namun jika satu paragraph penuh dengan `[[...]]`, readability bisa turun.

---

## 37. JavaScript Inlining: Powerful Tapi Risky

Contoh:

```html
<script th:inline="javascript">
  const currentUser = [[${currentUserJson}]];
</script>
```

Thymeleaf dapat melakukan JavaScript-aware output dalam inline mode.

Namun, top engineer harus sangat hati-hati.

Risiko:

1. data sensitif bocor ke browser,
2. JSON double-encoded,
3. unsafe string masuk ke JS context,
4. CSP menjadi sulit,
5. template menjadi campuran Java/HTML/JS logic,
6. hydration/state duplication.

Lebih aman untuk data besar:

```html
<script type="application/json" id="page-data" th:text="${pageDataJson}">
  {}
</script>
```

Kemudian JS membaca textContent.

Namun `pageDataJson` harus sudah JSON-safe dan tidak mengandung data sensitif.

Untuk banyak kasus server-rendered UI, hindari mengirim object besar ke JS. Render HTML langsung, dan gunakan progressive enhancement kecil.

Rule:

```text
Inline JS hanya untuk konfigurasi kecil dan non-sensitive.
Untuk data besar atau kompleks, gunakan endpoint/API yang jelas atau render HTML server-side.
```

---

## 38. CSS Inlining

Thymeleaf juga mendukung CSS template mode/inlining.

Contoh konseptual:

```html
<style th:inline="css">
  .banner {
    background-image: url([[${bannerUrl}]]);
  }
</style>
```

Risiko mirip:

- CSS injection,
- URL injection,
- CSP issue,
- maintainability buruk.

Untuk production, lebih baik CSS static dan dynamic state lewat class allowlist.

Buruk:

```html
<div th:style="${userDefinedCss}"></div>
```

Baik:

```html
<div th:classappend="${theme.dark} ? ' theme-dark' : ' theme-light'"></div>
```

Rule:

```text
Prefer dynamic class over dynamic inline style.
```

---

## 39. `th:insert`, `th:replace`, dan Fragments Sekilas

Part 16 akan membahas fragment/layout secara dalam, tetapi attribute transformation tidak lengkap tanpa menyebut inclusion.

`th:insert` memasukkan fragment ke dalam host element.

`th:replace` mengganti host element dengan fragment.

Contoh:

```html
<header th:replace="~{fragments/layout :: header}"></header>
```

Host `<header>` diganti fragment.

Contoh insert:

```html
<div th:insert="~{fragments/alerts :: alertBox}"></div>
```

Fragment dimasukkan ke dalam `<div>`.

Mental model:

```text
th:replace changes the node itself.
th:insert changes the node content.
```

Rule:

```text
Gunakan th:replace untuk semantic component replacement.
Gunakan th:insert ketika wrapper host memang diperlukan.
```

---

## 40. Natural HTML dan Static Prototype Data

Natural template memungkinkan static placeholder tetap ada.

Contoh:

```html
<h1 th:text="${page.title}">Case Detail</h1>
<p th:text="${caseDetail.summary}">
  This is a static summary shown during prototype review.
</p>
```

Placeholder harus realistis:

- contoh status yang valid,
- contoh tanggal dengan format benar,
- contoh role/action yang masuk akal,
- contoh empty/error state.

Jangan placeholder random:

```html
<p th:text="${caseDetail.summary}">asdf qwer lorem aaa</p>
```

Template adalah dokumen komunikasi antara developer, designer, tester, dan reviewer.

Rule:

```text
Prototype text should be representative, not meaningless filler.
```

---

## 41. Template Sebagai Contract UI

Template bukan hanya file view. Ia adalah consumer dari contract model.

Contoh template:

```html
<span th:text="${caseItem.referenceNo}">CASE-001</span>
<span th:text="${caseItem.statusLabel}">Pending Review</span>
<span th:if="${caseItem.showApproveAction}">Approve</span>
```

Maka template membutuhkan model:

```java
record CaseItemView(
    String referenceNo,
    String statusLabel,
    boolean showApproveAction
) {}
```

Jika field diganti nama tanpa update template, render gagal atau output salah.

Top engineer melihat template sebagai bagian dari API internal.

Rule:

```text
Controller/service provides ViewModel contract.
Template consumes ViewModel contract.
Test must verify both sides match.
```

---

## 42. Jangan Expose Entity Langsung Ke Template

Contoh buruk:

```java
model.addAttribute("case", caseEntity);
```

Template:

```html
<span th:text="${case.applicant.profile.identityDocument.number}"></span>
```

Masalah:

1. lazy loading bisa terjadi di view,
2. N+1 query tersembunyi,
3. sensitive field mudah bocor,
4. domain model coupling,
5. null path kompleks,
6. security boundary kabur,
7. template menjadi tahu struktur database/domain.

Lebih baik:

```java
record CaseDetailPage(
    String referenceNo,
    String applicantDisplayName,
    String statusLabel,
    List<ActionView> actions,
    List<DocumentRowView> documents
) {}
```

Template:

```html
<span th:text="${page.applicantDisplayName}">Applicant Name</span>
```

Rule:

```text
Template consumes presentation model, not persistence entity.
```

---

## 43. DOM Transformation and Data Loading Boundary

Dangerous pattern:

```html
<tr th:each="doc : ${case.documents}">
```

If `case.documents` is lazy-loaded, rendering may trigger database access.

Even worse:

```html
<span th:text="${doc.owner.department.name}"></span>
```

This could trigger N+1 query.

Better:

```java
List<DocumentRowView> documents = queryService.findDocumentRows(caseId);
model.addAttribute("documents", documents);
```

Template:

```html
<tr th:each="doc : ${documents}">
  <td th:text="${doc.fileName}">file.pdf</td>
  <td th:text="${doc.ownerDepartmentLabel}">Legal</td>
</tr>
```

Rule:

```text
Rendering must not trigger hidden data access.
All required data must be prepared before rendering.
```

---

## 44. Attribute Value Escaping Is Contextual

Text node escaping and attribute escaping are related but not identical contexts.

Example:

```html
<span th:text="${userInput}"></span>
```

This writes into text body.

```html
<input th:value="${userInput}">
```

This writes into attribute value.

Thymeleaf processors handle normal escaping for these contexts, but developer still must avoid unsafe contexts like raw inline JS or untrusted URL schemes.

Rule:

```text
Use dedicated Thymeleaf attributes for the target context.
Avoid manually concatenating dynamic values into raw HTML/JS/CSS.
```

---

## 45. Dynamic Attributes and Sensitive Data Leakage

Example:

```html
<button th:attr="data-user-token=${sessionToken}">Action</button>
```

This leaks token into DOM.

Even hidden input leaks:

```html
<input type="hidden" th:value="${user.nationalId}">
```

If browser receives it, user/devtools/extensions can read it.

Rule:

```text
Do not render secrets into HTML, including hidden fields, data attributes, comments, JS variables, or CSS.
```

Only render data needed by the page.

---

## 46. HTML Comments and Prototype Comments

Static template comments can leak implementation detail if not processed carefully.

Example:

```html
<!-- TODO: hide this if user is not admin -->
```

This comment could appear in output.

Avoid sensitive comments in templates.

If comments are needed for prototype only, ensure they are removed or harmless.

Rule:

```text
Assume template comments can reach client unless verified otherwise.
```

---

## 47. Accessibility-Aware Attribute Rendering

Thymeleaf attribute transformation should include accessibility.

Example:

```html
<button th:if="${action.visible}"
        th:disabled="${!action.enabled}"
        th:text="${action.label}"
        th:title="${action.tooltip}"
        th:attr="aria-label=${action.ariaLabel}">
  Approve
</button>
```

If action disabled, explain why:

```html
<button th:disabled="${!action.enabled}"
        th:attr="aria-describedby=${!action.enabled} ? ${action.reasonId} : null">
  Approve
</button>
<p th:if="${!action.enabled}"
   th:id="${action.reasonId}"
   th:text="${action.disabledReason}">
  You cannot approve this case yet.
</p>
```

Rule:

```text
Dynamic rendering must preserve accessibility state.
```

---

## 48. Good Page Structure: Separate Page, Section, Row, Action View Models

For complex screens, avoid one mega model.

Better:

```java
record CaseSearchPage(
    String title,
    CaseSearchFilterView filter,
    PageView<CaseRowView> results,
    List<ActionView> globalActions,
    EmptyStateView emptyState
) {}

record CaseRowView(
    String referenceNo,
    String applicantName,
    StatusBadgeView status,
    List<ActionView> actions
) {}

record ActionView(
    String label,
    String href,
    boolean visible,
    boolean enabled,
    String cssClass,
    String ariaLabel
) {}
```

Template becomes simple:

```html
<tr th:each="row : ${page.results.items}">
  <td th:text="${row.referenceNo}">CASE-001</td>
  <td th:text="${row.applicantName}">Applicant</td>
  <td>
    <span th:class="${row.status.cssClass}" th:text="${row.status.label}">Pending</span>
  </td>
  <td>
    <a th:each="action : ${row.actions}"
       th:if="${action.visible}"
       th:href="@{${action.href}}"
       th:class="${action.cssClass}"
       th:text="${action.label}">
      View
    </a>
  </td>
</tr>
```

This is much easier to test and review.

Rule:

```text
Complex pages need structured ViewModel, not Map<String,Object> dumping.
```

---

## 49. Map-Based Model: Convenient Tapi Berbahaya Jika Tidak Dikontrol

Spring MVC model often starts as:

```java
model.addAttribute("cases", cases);
model.addAttribute("filter", filter);
model.addAttribute("pageTitle", "Cases");
```

This is acceptable for simple pages, but can degrade into ungoverned Map.

Better for complex page:

```java
model.addAttribute("page", caseSearchPage);
```

Template:

```html
<h1 th:text="${page.title}">Cases</h1>
```

Benefits:

1. one root object,
2. easier contract testing,
3. easier IDE navigation,
4. easier snapshot test,
5. fewer naming collisions,
6. easier versioning.

Rule:

```text
For non-trivial pages, prefer one root PageView object.
```

---

## 50. Naming Conventions For Thymeleaf Templates

Recommended model naming:

```text
page             -> root page view model
filter           -> search/filter model if separate
row/item         -> loop variable for generic list
caseItem         -> loop variable for case list
status           -> status badge view
stat             -> iteration status
form             -> form backing view model
action           -> action view model
```

Avoid ambiguous names:

```text
data
object
result
bean
x
list
map
```

Good template code reads like domain language:

```html
<tr th:each="caseItem : ${page.results.items}">
```

Bad:

```html
<tr th:each="x : ${data}">
```

Rule:

```text
Template variable names are part of readability and maintainability.
```

---

## 51. Avoid Too Many Root Variables

Bad:

```html
<h1 th:text="${title}"></h1>
<div th:each="caseItem : ${cases}"></div>
<div th:if="${canExport}"></div>
<span th:text="${count}"></span>
<form th:object="${searchForm}"></form>
```

Better:

```html
<h1 th:text="${page.title}"></h1>
<div th:each="caseItem : ${page.cases}"></div>
<div th:if="${page.canExport}"></div>
<span th:text="${page.countLabel}"></span>
<form th:object="${page.searchForm}"></form>
```

Why:

- namespace is clearer,
- fewer collisions,
- easier testing,
- easier handoff.

---

## 52. Handling Null and Missing Values

Thymeleaf supports safe navigation and defaulting depending expression dialect, but do not make null handling chaotic.

Bad:

```html
<span th:text="${case.applicant?.profile?.name ?: '-'}"></span>
```

This may be acceptable occasionally, but repeated null navigation means model is not shaped well.

Better:

```java
String applicantNameLabel = applicantName != null ? applicantName : "-";
```

Template:

```html
<span th:text="${caseItem.applicantNameLabel}">-</span>
```

Rule:

```text
Template can handle presentation fallback.
But repeated deep null handling belongs in ViewModel preparation.
```

---

## 53. Error States, Empty States, and Permission States

A mature UI has multiple rendering states:

1. data present,
2. data empty,
3. validation error,
4. permission denied,
5. action disabled,
6. partial information,
7. stale data,
8. loading/progressive enhancement,
9. system error fallback.

Thymeleaf template should express these states clearly.

Example:

```html
<section th:if="${page.permission.allowed}">
  <!-- normal content -->
</section>

<section th:unless="${page.permission.allowed}">
  <h2>Access restricted</h2>
  <p th:text="${page.permission.message}">You do not have access.</p>
</section>
```

But again: backend must enforce permission.

Rule:

```text
UI state rendering improves UX.
It does not replace server-side enforcement.
```

---

## 54. Natural Template vs Accurate Runtime State

Natural template can mislead if static prototype shows controls that runtime often hides.

Example:

```html
<button th:if="${caseItem.showApproveAction}">Approve</button>
<button th:if="${caseItem.showRejectAction}">Reject</button>
<button th:if="${caseItem.showEscalateAction}">Escalate</button>
```

Static browser preview shows all buttons because Thymeleaf is not running.

This can be okay for design, but it may confuse non-technical reviewer.

Use prototype comments or dedicated sample state sections carefully.

Alternative:

```html
<div class="prototype-note" th:remove="all">
  Prototype displays all possible actions. Runtime visibility depends on permission and case state.
</div>
```

Rule:

```text
Natural template is a design aid, not proof of runtime authorization/state.
```

---

## 55. Attribute Transformation and CSS/JS Frameworks

Thymeleaf works with Bootstrap, Tailwind, Alpine.js, HTMX, Stimulus, vanilla JS, etc. But integration style matters.

Example with HTMX-like attributes:

```html
<button th:attr="hx-post=@{/cases/{id}/approve(id=${caseItem.id})}, hx-target='#case-actions'">
  Approve
</button>
```

This can work, but it couples server template to client behavior.

Better to centralize actions:

```java
record HtmxActionView(
    String label,
    String postUrl,
    String target,
    boolean visible
) {}
```

Template:

```html
<button th:if="${action.visible}"
        th:text="${action.label}"
        th:attr="hx-post=${action.postUrl}, hx-target=${action.target}">
  Approve
</button>
```

Rule:

```text
Client-behavior attributes are also part of rendering contract.
Treat them as carefully as href/action.
```

---

## 56. Prevent Template From Becoming Frontend Logic Dump

Bad smell:

```html
<div th:if="${mode == 'A'}">...</div>
<div th:if="${mode == 'B'}">...</div>
<div th:if="${mode == 'C'}">...</div>
<script th:inline="javascript">
  if ([[${case.status}]] === 'PENDING' && [[${user.role}]] === 'APPROVER') {
    ...
  }
</script>
```

This mixes:

- business state,
- authorization,
- presentation,
- client behavior,
- backend assumptions.

Better:

```java
record PageBehaviorView(
    boolean showApprove,
    boolean showReject,
    boolean enableInlineComment,
    String clientMode
) {}
```

Template stays declarative.

Rule:

```text
Template declares UI structure.
Application computes business decisions.
```

---

## 57. Common Anti-Patterns

### 57.1 Entity Graph Traversal In Template

```html
<span th:text="${case.applicant.profile.address.country.name}"></span>
```

Fix: flatten into ViewModel.

### 57.2 Raw HTML Rendering Without Sanitization

```html
<div th:utext="${userComment}"></div>
```

Fix: `th:text` or sanitized trusted HTML.

### 57.3 Dynamic URL From User Input

```html
<a th:href="${next}">Next</a>
```

Fix: route allowlist / server-generated safe link.

### 57.4 Too Much Logic In `th:if`

```html
<div th:if="${a and b and c and d and e}"></div>
```

Fix: precompute boolean.

### 57.5 Hidden Field Sensitive Data

```html
<input type="hidden" th:value="${secretToken}">
```

Fix: keep secrets server-side.

### 57.6 Repeating Markup Instead of Fragment/Component

```html
<!-- same status badge copied in 12 templates -->
```

Fix: fragment/component library.

### 57.7 Huge Table Rendering

```html
<tr th:each="row : ${allRows}">
```

Fix: pagination/export job.

---

## 58. Production Code Example: Clean Case List Page

### 58.1 View Model

```java
public record CaseListPageView(
    String title,
    CaseFilterView filter,
    PageView<CaseRowView> results,
    EmptyStateView emptyState,
    List<ActionView> globalActions
) {}

public record CaseRowView(
    String referenceNo,
    String applicantName,
    StatusBadgeView status,
    String detailHref,
    List<ActionView> actions
) {}

public record StatusBadgeView(
    String label,
    String cssClass,
    String ariaLabel
) {}

public record ActionView(
    String label,
    String href,
    String method,
    boolean visible,
    boolean enabled,
    String cssClass,
    String ariaLabel,
    String disabledReason
) {}

public record EmptyStateView(
    boolean visible,
    String title,
    String message
) {}
```

### 58.2 Template

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title th:text="${page.title}">Case List</title>
</head>
<body>
  <main>
    <header>
      <h1 th:text="${page.title}">Case List</h1>
    </header>

    <section aria-labelledby="case-results-title">
      <h2 id="case-results-title">Results</h2>

      <table>
        <thead>
          <tr>
            <th>Reference No</th>
            <th>Applicant</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr th:each="caseItem : ${page.results.items}">
            <td>
              <a th:href="@{${caseItem.detailHref}}"
                 th:text="${caseItem.referenceNo}">
                CASE-2026-0001
              </a>
            </td>
            <td th:text="${caseItem.applicantName}">Applicant Name</td>
            <td>
              <span th:class="${caseItem.status.cssClass}"
                    th:text="${caseItem.status.label}"
                    th:attr="aria-label=${caseItem.status.ariaLabel}">
                Pending Review
              </span>
            </td>
            <td>
              <a th:each="action : ${caseItem.actions}"
                 th:if="${action.visible and action.method == 'GET'}"
                 th:href="@{${action.href}}"
                 th:class="${action.cssClass}"
                 th:text="${action.label}"
                 th:attr="aria-label=${action.ariaLabel}">
                View
              </a>
            </td>
          </tr>

          <tr th:if="${page.emptyState.visible}">
            <td colspan="4">
              <strong th:text="${page.emptyState.title}">No cases found</strong>
              <p th:text="${page.emptyState.message}">Try changing your filters.</p>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </main>
</body>
</html>
```

### 58.3 Why This Is Good

1. Template consumes `page`, not random root variables.
2. Domain rule already computed in ViewModel.
3. Status rendering is simple.
4. Links are generated from safe route values.
5. Empty state is explicit.
6. No entity graph traversal.
7. No `th:utext`.
8. UI authorization is visible but not assumed as backend security.
9. Natural prototype remains readable.

---

## 59. Production Review Checklist

Use this checklist when reviewing Thymeleaf template attributes.

### 59.1 Structure

- Is `th:each` placed on the correct repeated node?
- Are empty states present for lists/tables?
- Are conditional sections clear?
- Is `th:block` used only when wrapper node is undesirable?
- Are fragments used for repeated UI patterns?

### 59.2 Data Model

- Does template consume ViewModel instead of entity?
- Are deeply nested expressions avoided?
- Are business rules precomputed?
- Are root variables organized under a root `page` object?
- Are null/default labels handled consistently?

### 59.3 Security

- Is default output `th:text`, not `th:utext`?
- If `th:utext` exists, is input trusted/sanitized?
- Are dynamic URLs safe/allowlisted?
- Are secrets absent from hidden fields/data attributes/JS?
- Are actions backed by server-side authorization?
- Are destructive actions not implemented as GET links?

### 59.4 Accessibility

- Do images have meaningful `alt`?
- Do icon-only buttons have `aria-label`?
- Do disabled controls explain why?
- Are dynamic error messages connected to fields?
- Are table headings semantically correct?

### 59.5 Performance

- Are large lists paginated?
- Does rendering avoid lazy-loading entity relationships?
- Are expensive calculations outside template?
- Are repeated fragments not overly complex?
- Is client-side JS state not bloated?

### 59.6 Maintainability

- Are expressions short?
- Are variable names meaningful?
- Are CSS classes allowlisted/precomputed?
- Are repeated status/action patterns extracted?
- Can the template be opened as useful static prototype?

---

## 60. Java 8–25 Considerations

Thymeleaf usage at template level is mostly independent from Java version, but Java evolution affects ViewModel design and rendering architecture.

### Java 8

Common baseline:

- `java.time` available,
- records not available,
- use immutable classes/builders for ViewModel,
- avoid exposing mutable entities.

Example:

```java
public final class StatusBadgeView {
    private final String label;
    private final String cssClass;
    private final String ariaLabel;

    public StatusBadgeView(String label, String cssClass, String ariaLabel) {
        this.label = label;
        this.cssClass = cssClass;
        this.ariaLabel = ariaLabel;
    }

    public String getLabel() { return label; }
    public String getCssClass() { return cssClass; }
    public String getAriaLabel() { return ariaLabel; }
}
```

### Java 11–17

Better runtime baseline for modern Spring applications. Java 16+ records become attractive for immutable ViewModel.

Example:

```java
public record StatusBadgeView(
    String label,
    String cssClass,
    String ariaLabel
) {}
```

### Java 21–25

Modern Java enables cleaner rendering orchestration:

- records for ViewModel,
- switch expressions for status mapping,
- pattern matching in mapper code,
- virtual threads for concurrent I/O-heavy page assembly if needed,
- better GC/runtime improvements for server workloads.

Example:

```java
StatusBadgeView badge = switch (status) {
    case DRAFT -> new StatusBadgeView("Draft", "badge badge-secondary", "Draft case");
    case PENDING_REVIEW -> new StatusBadgeView("Pending Review", "badge badge-warning", "Pending review case");
    case APPROVED -> new StatusBadgeView("Approved", "badge badge-success", "Approved case");
    case REJECTED -> new StatusBadgeView("Rejected", "badge badge-danger", "Rejected case");
};
```

Key point:

```text
Modern Java should simplify ViewModel preparation.
It should not push more logic into Thymeleaf templates.
```

---

## 61. Engineering Heuristics For Top 1% Usage

### Heuristic 1 — Template Is Not Where Business Truth Lives

Template can decide visibility based on ViewModel fields.
It should not derive business truth from domain internals.

### Heuristic 2 — Attribute Is A Transformation Contract

Every `th:*` should have a clear reason:

- text replacement,
- URL construction,
- condition,
- iteration,
- attribute binding,
- fragment inclusion.

If you cannot explain why an attribute exists, it is probably accidental complexity.

### Heuristic 3 — HTML Output Is A Security Boundary

Everything rendered into HTML is delivered to the browser.
Hidden is not secret.
Commented is not secret.
Disabled is not authorized.
Invisible is not protected.

### Heuristic 4 — Natural Template Is A Collaboration Feature

Preserve static readability where practical.
Representative placeholder text improves design review, QA, and maintainability.

### Heuristic 5 — Complex Expression Means Missing ViewModel Field

When expression becomes long, stop and ask:

```text
Should this be precomputed in Java?
```

Often, yes.

### Heuristic 6 — Repetition Demands Fragment Or View Component

If status badge/action button/table cell pattern repeats across pages, extract it.
But do not create too many tiny fragments prematurely.

### Heuristic 7 — URL Is Not Just A String

URL expresses navigation, authorization, tenant boundary, and sometimes security risk.
Build it deliberately.

### Heuristic 8 — Rendering Must Be Testable

If template behavior cannot be tested without full manual browser testing, the design is too implicit.

---

## 62. Mini Lab: Refactor Bad Template

### 62.1 Bad Template

```html
<tr th:each="c : ${cases}">
  <td th:text="${c.applicant.profile.name}"></td>
  <td th:text="${c.status.name()}"></td>
  <td>
    <span th:if="${c.status.name() == 'PENDING' and currentUser.role == 'APPROVER' and !c.locked}">
      <a th:href="@{'/case/' + ${c.id} + '/approve'}">Approve</a>
    </span>
    <span th:utext="${c.comment}"></span>
  </td>
</tr>
```

Problems:

1. short unclear variable `c`,
2. entity graph traversal,
3. status enum formatting in template,
4. business authorization logic in template,
5. unsafe URL concatenation,
6. `th:utext` on comment,
7. action as GET link,
8. no empty state,
9. no accessibility labels.

### 62.2 Better ViewModel

```java
record CaseRowView(
    String referenceNo,
    String applicantName,
    StatusBadgeView status,
    String commentText,
    boolean showApproveAction,
    String approvePostUrl
) {}
```

### 62.3 Better Template

```html
<tr th:each="caseItem : ${page.results.items}">
  <td th:text="${caseItem.referenceNo}">CASE-001</td>
  <td th:text="${caseItem.applicantName}">Applicant Name</td>
  <td>
    <span th:class="${caseItem.status.cssClass}"
          th:text="${caseItem.status.label}"
          th:attr="aria-label=${caseItem.status.ariaLabel}">
      Pending
    </span>
  </td>
  <td th:text="${caseItem.commentText}">Comment</td>
  <td>
    <form th:if="${caseItem.showApproveAction}"
          th:action="@{${caseItem.approvePostUrl}}"
          method="post">
      <button type="submit">Approve</button>
    </form>
  </td>
</tr>
```

This is not only cleaner. It is safer, testable, and more aligned with server-side authorization.

---

## 63. Summary

Thymeleaf attributes are not decorative syntax. They are transformation instructions applied to an HTML/XML/textual template by dialect processors.

The core lesson of this part:

```text
Thymeleaf should make dynamic HTML look like intentional HTML,
not like business logic disguised as markup.
```

Key takeaways:

1. Thymeleaf is DOM-oriented in HTML/XML modes.
2. `th:*` attributes are runtime transformation instructions.
3. Natural templates preserve static preview value.
4. `th:text` is escaped and should be the default.
5. `th:utext` requires strict trust/sanitization proof.
6. `th:if`/`th:unless` control node existence, not authorization.
7. `th:each` duplicates the host node.
8. Attribute execution follows Thymeleaf precedence, not source order.
9. URLs should be constructed with `@{...}` and controlled as security-sensitive output.
10. Dynamic CSS/style must be allowlisted or constrained.
11. Template should consume ViewModel, not entity graph.
12. Complex conditions usually indicate missing presentation fields.
13. Large lists need pagination/export strategy, not brute-force rendering.
14. Accessibility attributes are part of dynamic rendering responsibility.
15. Template output is a security boundary.

---

## 64. What Comes Next

Part berikutnya:

```text
Part 15 — Thymeleaf Forms, Binding, Validation, and Error Rendering
```

Di Part 15, kita akan membahas:

- form backing object,
- `th:object`,
- `th:field`,
- BindingResult,
- field errors,
- global errors,
- enum rendering,
- collection/nested forms,
- checkbox/radio pitfalls,
- CSRF token rendering,
- Post-Redirect-Get,
- multi-step forms,
- over-posting prevention,
- form rendering yang aman dan maintainable.

---

## 65. Status Akhir Part 14

```text
Part 14 selesai.
Seri belum selesai.
Lanjut ke Part 15.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-013.md">⬅️ Part 13 — Thymeleaf Standard Expressions Deep Dive</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-015.md">Part 15 — Thymeleaf Forms, Binding, Validation, and Error Rendering ➡️</a>
</div>
