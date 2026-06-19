# learn-java-template-freemarker-thymeleaf-rendering-engineering-part-017

# Part 17 — Thymeleaf Security: XSS, CSRF, Authorization Rendering, and Safe HTML

> Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`  
> Scope Java: Java 8 hingga Java 25  
> Fokus: Thymeleaf security boundary, XSS defense, CSRF integration, authorization-aware rendering, safe HTML, dan production checklist.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu seharusnya tidak hanya tahu bahwa `th:text` aman dan `th:utext` berbahaya. Target sebenarnya lebih tinggi:

1. Mampu membedakan **template security**, **browser security**, **application authorization**, dan **data leakage prevention**.
2. Mampu menjelaskan kenapa XSS bukan sekadar masalah escaping, tetapi masalah **output context**.
3. Mampu mendesain Thymeleaf template yang aman untuk:
   - HTML body,
   - HTML attribute,
   - URL,
   - JavaScript inline,
   - CSS inline,
   - rich text dari user,
   - role/permission-based rendering,
   - multi-tenant UI.
4. Mampu memahami batas keamanan `th:text`, `th:utext`, `th:href`, `th:src`, `th:inline`, dan Spring Security dialect.
5. Mampu mencegah kesalahan umum:
   - menganggap hide button sama dengan authorization,
   - memasukkan object sensitif ke model,
   - menaruh token/secret di hidden field,
   - render raw HTML tanpa sanitization,
   - memasukkan variable langsung ke inline JavaScript,
   - melakukan permission check hanya di template.
6. Mampu membuat checklist review security untuk Thymeleaf page sebelum production.

Part ini sengaja ditempatkan setelah layout/fragments karena security Thymeleaf tidak bisa dipahami hanya per attribute. Dalam sistem nyata, vulnerability sering muncul dari kombinasi fragment, shared layout, form, inline script, model global, dan conditional rendering.

---

## 1. Mental Model: Thymeleaf Security Bukan Satu Fitur, Tetapi Beberapa Boundary

Dalam aplikasi server-side rendered, Thymeleaf duduk di antara:

```text
Domain/Application Layer
        |
        v
Controller / Handler
        |
        v
View Model / Form Model / Page Model
        |
        v
Thymeleaf Template
        |
        v
Rendered HTML/CSS/JS/URL/Form
        |
        v
Browser
        |
        v
User Interaction / HTTP Request
```

Security boundary-nya tidak hanya satu.

Ada minimal enam boundary yang harus dipahami:

| Boundary | Pertanyaan Utama | Contoh Risiko |
|---|---|---|
| Data-to-template boundary | Data apa yang boleh masuk ke model? | PII leak, internal state leak |
| Template-to-browser boundary | Output context apa yang sedang dirender? | XSS |
| Browser-to-server boundary | Request user valid atau forged? | CSRF |
| UI-to-authorization boundary | Apakah user boleh melihat/menekan action? | Broken access control |
| Rich-content boundary | HTML dari user aman atau tidak? | Stored XSS |
| Multi-tenant boundary | Apakah data/branding/link tenant tercampur? | Cross-tenant leak |

Top 1% engineer tidak melihat Thymeleaf sebagai “template HTML”. Ia melihatnya sebagai **security-sensitive compiler** dari model server menjadi dokumen browser.

---

## 2. Core Principle: Browser Context Menentukan Cara Aman Merender Data

Kesalahan umum:

> “Kalau sudah di-escape berarti aman.”

Yang benar:

> “Data harus di-encode sesuai konteks parsing browser tempat data itu ditempatkan.”

Browser tidak membaca semua teks sebagai HTML body. Browser memiliki banyak context:

1. HTML text node.
2. HTML attribute value.
3. URL attribute.
4. JavaScript string literal.
5. JavaScript code context.
6. CSS property value.
7. HTML comment.
8. Raw text element seperti `<script>` dan `<style>`.

Contoh data yang sama:

```text
" onmouseover="alert(1)
```

Aman atau tidak tergantung ditempatkan di mana.

Di body text:

```html
<p>VALUE_HERE</p>
```

Di attribute:

```html
<a title="VALUE_HERE">Open</a>
```

Di JavaScript:

```html
<script>
  const name = "VALUE_HERE";
</script>
```

Di URL:

```html
<a href="VALUE_HERE">Open</a>
```

Satu encoder tidak otomatis cocok untuk semua. OWASP XSS Prevention Cheat Sheet menekankan bahwa browser mem-parse HTML, JS, URL, dan CSS secara berbeda, sehingga encoding yang salah bisa tetap menghasilkan vulnerability.

---

## 3. Thymeleaf Default Safety: `th:text` Sebagai Baseline Aman

### 3.1 Apa yang dilakukan `th:text`

`th:text` mengganti isi element dengan teks yang dihasilkan dari expression dan melakukan escaping sehingga karakter HTML special tidak dieksekusi sebagai markup.

Contoh:

```html
<p th:text="${user.displayName}">Static name</p>
```

Jika `user.displayName` bernilai:

```text
<script>alert('xss')</script>
```

Output aman secara konseptual akan menjadi text escaped, bukan script aktif:

```html
<p>&lt;script&gt;alert('xss')&lt;/script&gt;</p>
```

Mental model:

```text
th:text = render value as text, not as HTML structure
```

Gunakan `th:text` sebagai default untuk hampir semua data yang berasal dari:

- user input,
- database,
- external API,
- uploaded document metadata,
- email subject,
- case description,
- comments,
- search keyword,
- organization name,
- address,
- officer remarks,
- audit message,
- error message.

### 3.2 Jangan menganggap data internal pasti aman

Banyak XSS production bukan dari field yang jelas seperti komentar user, tetapi dari field yang dianggap “internal”:

- agency name,
- product name,
- case title,
- notification subject,
- branch office name,
- template title,
- status description,
- rejection reason,
- appeal remark,
- dynamic configuration label.

Rule production:

```text
Unless a value is a trusted, sanitized, typed markup value, render it as text.
```

---

## 4. `th:utext`: Raw HTML Rendering dan Kenapa Ini Berbahaya

### 4.1 Apa itu `th:utext`

`th:utext` berarti unescaped text. Ia merender hasil expression sebagai markup mentah.

Contoh:

```html
<div th:utext="${article.bodyHtml}"></div>
```

Jika `article.bodyHtml` berisi:

```html
<p>Hello</p><script>alert('xss')</script>
```

Maka browser bisa mengeksekusi script jika tidak ada sanitization dan defense lain.

Mental model:

```text
th:utext = trust this value as HTML
```

Karena itu, pertanyaan sebelum memakai `th:utext` bukan:

> “Field ini isinya HTML atau bukan?”

Pertanyaan yang benar:

> “Siapa yang membuat HTML ini, kapan ia disanitasi, dengan policy apa, dan apakah policy itu sesuai konteks render ini?”

### 4.2 Kapan `th:utext` mungkin valid

`th:utext` dapat valid untuk:

1. HTML statis dari developer yang dimuat dari resource trusted.
2. HTML hasil sanitizer allowlist yang ketat.
3. CMS content dari trusted editor setelah sanitization server-side.
4. Pre-rendered legal text yang sudah melalui approval dan sanitization.
5. System-generated markup yang tidak mengandung user-controlled fragment.

Tetapi tetap harus memiliki kontrol:

- source jelas,
- sanitizer jelas,
- allowed tags jelas,
- allowed attributes jelas,
- URL scheme filtering jelas,
- audit trail jelas,
- test payload XSS jelas.

### 4.3 Kapan `th:utext` harus ditolak

Hindari `th:utext` untuk:

```html
<div th:utext="${param.message}"></div>
<div th:utext="${comment.body}"></div>
<div th:utext="${case.officerRemark}"></div>
<div th:utext="${errorMessage}"></div>
<div th:utext="${notification.bodyFromExternalSystem}"></div>
```

Juga hindari pola ini:

```java
model.addAttribute("html", "<b>" + userInput + "</b>");
```

lalu:

```html
<div th:utext="${html}"></div>
```

Ini mencampur HTML composition dengan untrusted data dan membuat review security lebih sulit.

---

## 5. Safe HTML: Escaping Tidak Sama Dengan Sanitization

Ada dua konsep yang sering tertukar:

| Konsep | Tujuan | Contoh |
|---|---|---|
| Escaping / output encoding | Membuat data tampil sebagai teks, bukan syntax aktif | `<` menjadi `&lt;` |
| Sanitization | Membuang/menormalisasi HTML agar subset markup aman | remove `<script>`, remove `onerror`, block `javascript:` |

Jika requirement-nya:

> User boleh menulis rich text: bold, italic, list, link.

Maka `th:text` terlalu aman karena markup akan tampil sebagai teks. Tetapi `th:utext` terlalu berbahaya jika langsung render raw input.

Pipeline yang benar:

```text
User rich text input
        |
        v
Server-side sanitizer with allowlist policy
        |
        v
Store sanitized HTML or store raw + sanitize on render with versioned policy
        |
        v
Render sanitized HTML using th:utext
```

### 5.1 Allowlist mindset

Sanitizer harus berbasis allowlist, bukan denylist.

Contoh policy konseptual:

```text
Allowed tags:
- p
- br
- strong
- em
- ul
- ol
- li
- a

Allowed attributes:
- a[href]
- a[title]

Allowed URL schemes:
- https
- mailto, if explicitly required

Forbidden:
- script
- style
- iframe
- object
- embed
- form
- input
- event handler attributes: onclick, onerror, onload, ...
- javascript: URLs
- data: URLs unless very narrowly justified
```

### 5.2 Store raw or sanitized?

Ada dua strategi:

#### Strategy A — Store sanitized HTML

```text
Input -> sanitize -> store sanitized -> render
```

Kelebihan:

- render cepat,
- output konsisten,
- lebih mudah untuk display.

Kekurangan:

- jika sanitizer policy berubah, data lama harus dimigrasi atau re-sanitize.

#### Strategy B — Store raw + sanitize on render

```text
Input -> store raw -> sanitize during render -> render
```

Kelebihan:

- policy terbaru selalu bisa dipakai,
- raw content masih tersedia untuk reprocessing.

Kekurangan:

- render lebih mahal,
- raw dangerous content tetap tersimpan,
- perlu kontrol akses ketat,
- audit dan forensics lebih sensitif.

#### Strategy C — Store both raw and sanitized with policy version

```text
Input -> store raw restricted + sanitized_html + sanitizer_policy_version
```

Ini lebih cocok untuk sistem enterprise/regulatory jika rich text punya nilai audit.

---

## 6. HTML Attribute Safety

Thymeleaf sering dipakai untuk attribute:

```html
<input th:value="${form.name}">
<a th:title="${case.title}">Open</a>
<span th:data-id="${case.id}"></span>
```

Attribute context berbeda dari text node. Thymeleaf attribute processors umumnya akan menghasilkan attribute value yang escaped sesuai HTML/XML output. Namun developer tetap harus menjaga semantic safety.

### 6.1 Attribute injection

Payload:

```text
" autofocus onfocus="alert(1)
```

Jika rendering dilakukan dengan string concatenation manual, bisa menjadi:

```html
<input value="" autofocus onfocus="alert(1)">
```

Dengan Thymeleaf attribute binding yang benar:

```html
<input th:value="${form.name}">
```

nilai diperlakukan sebagai attribute value, bukan tambahan attribute.

### 6.2 Jangan membuat attribute mentah via concatenation

Hindari:

```html
<div th:utext="${rawAttributesHtml}"></div>
```

Hindari juga membangun HTML string di controller:

```java
model.addAttribute("inputHtml", "<input value=\"" + value + "\">");
```

Gunakan struktur template:

```html
<input th:value="${value}">
```

### 6.3 Data attributes bukan tempat rahasia

Contoh buruk:

```html
<button
  th:data-user-id="${user.id}"
  th:data-email="${user.email}"
  th:data-nric="${user.nric}"
  th:data-token="${apiToken}">
  Action
</button>
```

Ingat:

```text
Anything rendered to HTML is visible to the user.
```

`data-*` attribute bukan storage aman. Browser devtools membuat semua terlihat.

Rule:

- ID teknis boleh jika memang dibutuhkan dan tidak sensitif.
- Token rahasia tidak boleh.
- PII tidak boleh kecuali memang harus ditampilkan dan user berwenang.
- Authorization-sensitive value jangan dipakai sebagai satu-satunya kontrol.

---

## 7. URL Safety: `th:href`, `th:src`, Redirect, dan Scheme Abuse

### 7.1 Gunakan URL expression `@{...}`

Contoh:

```html
<a th:href="@{/cases/{id}(id=${caseId})}">Open case</a>
```

Keuntungan:

- path variable lebih jelas,
- query parameter lebih terstruktur,
- context path bisa ditangani,
- mengurangi string concatenation.

### 7.2 URL bukan hanya escaping problem

Payload berbahaya bisa berupa scheme:

```text
javascript:alert(1)
```

Jika dipakai sebagai `href`:

```html
<a th:href="${userProvidedUrl}">Open</a>
```

maka walaupun attribute di-escape, semantic URL-nya tetap bisa berbahaya jika browser menganggapnya executable scheme.

Rule:

```text
Escaping protects syntax; validation protects meaning.
```

Untuk user-provided URL:

1. Parse URL server-side.
2. Allowlist scheme: biasanya `https`.
3. Optional allowlist host/domain.
4. Normalize before store/use.
5. Reject `javascript:`, dangerous `data:`, unusual control chars, encoded bypass.

### 7.3 Open redirect risk

Contoh buruk:

```html
<a th:href="${returnUrl}">Back</a>
```

Jika `returnUrl` berasal dari request param:

```text
https://evil.example/phishing
```

maka UI bisa menjadi bagian dari phishing flow.

Pola aman:

```java
String safeReturnPath = returnUrlPolicy.normalizeToInternalPath(requestedReturnUrl);
model.addAttribute("returnPath", safeReturnPath);
```

```html
<a th:href="@{${returnPath}}">Back</a>
```

Lebih baik lagi: jangan menerima arbitrary URL, gunakan enum/route key.

```java
enum ReturnTarget {
    CASE_LIST,
    DASHBOARD,
    TASK_INBOX
}
```

---

## 8. Inline JavaScript: Area Paling Sering Salah

### 8.1 Jangan inject variable langsung ke script tanpa mode yang benar

Contoh raw dan berbahaya:

```html
<script>
  const name = "[[${user.name}]]";
</script>
```

Thymeleaf punya JavaScript inlining:

```html
<script th:inline="javascript">
  const name = [[${user.name}]];
</script>
```

Dalam mode inline JavaScript, Thymeleaf dapat menghasilkan literal JavaScript yang escaped sesuai kebutuhan.

Tetapi tetap ada aturan desain:

1. Hanya inject data kecil dan tidak sensitif.
2. Jangan inject object domain besar.
3. Jangan inject permission matrix lengkap.
4. Jangan inject secret/token kecuali memang token publik/CSRF sesuai desain.
5. Jangan membangun JavaScript code dari user input.

### 8.2 Data is okay, code is not

Aman secara konsep:

```html
<script th:inline="javascript">
  const pageConfig = {
    caseId: [[${page.caseId}]],
    canEdit: [[${page.canEdit}]],
    status: [[${page.statusCode}]]
  };
</script>
```

Berbahaya:

```html
<script th:inline="javascript">
  [[${customScriptFromDatabase}]]
</script>
```

Rule:

```text
Template may render data into JavaScript literals.
Template must not render user-controlled JavaScript code.
```

### 8.3 Prefer data attributes or JSON script block?

Untuk data kecil per element:

```html
<button th:data-case-id="${case.id}">Open</button>
```

Untuk page-level config:

```html
<script th:inline="javascript">
  window.pageConfig = [[${pageConfig}]];
</script>
```

Untuk data besar:

- prefer fetch via authenticated endpoint,
- atau embed JSON with strict escaping and safe script type if framework supports it,
- hindari dumping seluruh table/list besar ke HTML.

### 8.4 Jangan render sensitive data ke JavaScript

Contoh buruk:

```html
<script th:inline="javascript">
  const currentUser = [[${currentUser}]];
</script>
```

Jika `currentUser` berisi:

- email,
- phone,
- roles internal,
- permissions granular,
- tenant membership,
- feature flags internal,
- audit flags,
- security classification,

maka semua masuk ke browser.

Buat view model minimal:

```java
record CurrentUserView(
    String displayName,
    boolean canCreateCase
) {}
```

---

## 9. Inline CSS: Hindari Dynamic CSS dari Input

CSS juga punya parsing context sendiri. Hindari:

```html
<div th:style="${userProvidedStyle}"></div>
```

Atau:

```html
<style th:inline="css">
  .banner {
    background-image: url([[${url}]])
  }
</style>
```

Masalahnya:

- CSS bisa memuat URL,
- browser behavior bervariasi,
- style bisa mempengaruhi clickjacking-like deception,
- user-controlled CSS bisa menyembunyikan warning/security message,
- data exfiltration via CSS pernah menjadi area riset/abuse.

Pola aman:

1. Gunakan class allowlist.
2. Jangan menerima arbitrary style.
3. Map domain state ke class server-side.

Contoh:

```java
String statusClass = switch (status) {
    case APPROVED -> "badge-success";
    case REJECTED -> "badge-danger";
    case PENDING -> "badge-warning";
};
model.addAttribute("statusClass", statusClass);
```

```html
<span class="badge" th:classappend="${statusClass}" th:text="${statusLabel}"></span>
```

Jangan:

```html
<span th:style="${statusStyleFromDb}"></span>
```

---

## 10. CSRF: Thymeleaf Form Rendering dan Spring Security

### 10.1 Apa masalah CSRF?

CSRF terjadi ketika browser user yang sudah authenticated dipaksa mengirim request state-changing ke aplikasi tanpa intent user yang sah.

Contoh:

```html
<form action="https://target.example/cases/123/delete" method="post">
  <button>Click</button>
</form>
```

Jika user sedang login ke target, browser bisa mengirim cookie session. CSRF token membantu membedakan request yang berasal dari form sah aplikasi vs request forged.

Spring Security melindungi CSRF secara default untuk unsafe HTTP methods seperti POST dalam konfigurasi servlet modern.

### 10.2 Thymeleaf dan hidden CSRF token

Dalam integrasi Spring MVC + Thymeleaf + Spring Security, form yang menggunakan `th:action` biasanya dapat menyertakan token CSRF secara otomatis dalam rendered form sesuai integrasi framework.

Contoh:

```html
<form th:action="@{/cases/{id}/approve(id=${caseId})}" method="post">
  <button type="submit">Approve</button>
</form>
```

Rendered HTML secara konseptual dapat berisi hidden input:

```html
<input type="hidden" name="_csrf" value="...">
```

Jika perlu manual:

```html
<input type="hidden"
       th:name="${_csrf.parameterName}"
       th:value="${_csrf.token}">
```

Tetapi manual rendering harus konsisten dengan konfigurasi security.

### 10.3 CSRF untuk AJAX/fetch

Jika memakai JavaScript request:

```javascript
fetch('/cases/123/approve', { method: 'POST' })
```

maka token perlu dikirim, misalnya lewat header sesuai konfigurasi.

Template bisa merender token sebagai meta tag:

```html
<meta name="_csrf" th:content="${_csrf.token}">
<meta name="_csrf_header" th:content="${_csrf.headerName}">
```

Lalu JavaScript mengambilnya:

```javascript
const token = document.querySelector('meta[name="_csrf"]').content;
const header = document.querySelector('meta[name="_csrf_header"]').content;

fetch('/cases/123/approve', {
  method: 'POST',
  headers: {
    [header]: token
  }
});
```

Security consideration:

- CSRF token boleh ada di page karena ia memang untuk browser session itu.
- Jangan samakan CSRF token dengan API secret.
- Jangan kirim CSRF token ke third-party domain.
- Jangan expose token dalam URL.
- Jangan log token.

### 10.4 Jangan disable CSRF karena “form error”

Anti-pattern:

```java
csrf.disable()
```

hanya karena POST dari Thymeleaf gagal.

Yang benar:

1. Pastikan form memakai POST untuk unsafe action.
2. Pastikan `th:action` benar.
3. Pastikan token muncul di rendered HTML.
4. Pastikan session/cookie valid.
5. Pastikan AJAX mengirim header CSRF.
6. Pastikan endpoint method/security config sesuai.

Disable CSRF harus menjadi keputusan architecture/security yang jelas, bukan workaround form.

---

## 11. Authorization Rendering: Show/Hide UI Bukan Authorization

### 11.1 Dua level authorization

Ada dua hal berbeda:

```text
UI authorization rendering:
- Apakah button/link/menu ditampilkan?

Server authorization enforcement:
- Apakah request/action benar-benar boleh dilakukan?
```

Hiding button meningkatkan UX dan mengurangi kebingungan, tetapi tidak mengamankan endpoint.

Contoh:

```html
<button th:if="${canApprove}">Approve</button>
```

Ini tidak cukup. User bisa tetap mengirim POST manual:

```http
POST /cases/123/approve
```

Backend tetap harus enforce:

```java
@PreAuthorize("@casePermission.canApprove(authentication, #caseId)")
@PostMapping("/cases/{caseId}/approve")
public String approve(@PathVariable Long caseId) {
    ...
}
```

Rule:

```text
Template authorization is presentation logic.
Backend authorization is security control.
```

### 11.2 Model-driven permission flag

Controller/application service dapat menyiapkan permission flag:

```java
record CaseDetailPage(
    Long caseId,
    String caseNo,
    String statusLabel,
    boolean canEdit,
    boolean canApprove,
    boolean canReject,
    boolean canAssign
) {}
```

Template:

```html
<a th:if="${page.canEdit}"
   th:href="@{/cases/{id}/edit(id=${page.caseId})}">
  Edit
</a>

<form th:if="${page.canApprove}"
      th:action="@{/cases/{id}/approve(id=${page.caseId})}"
      method="post">
  <button type="submit">Approve</button>
</form>
```

Kelebihan:

- template sederhana,
- permission logic tidak menyebar,
- bisa diuji di service/controller layer,
- mudah untuk audit.

Kekurangan:

- harus disiplin menjaga backend enforcement.

### 11.3 Spring Security dialect

Dengan Thymeleaf Extras Spring Security, template bisa memakai authorization expression seperti:

```html
<div sec:authorize="hasRole('ADMIN')">
  Admin panel
</div>
```

Atau menampilkan nama authenticated user, role, dan block tertentu berdasarkan authorization expression.

Ini berguna untuk:

- menu global,
- header user info,
- role-based navigation,
- simple role check.

Tetapi untuk domain-specific permission yang kompleks, lebih baik gunakan page model flag dari application service.

Contoh domain-specific:

```text
User can approve case if:
- user belongs to same agency,
- case status is PENDING_REVIEW,
- user is assigned reviewer or supervisor,
- case is not locked,
- no pending dependency,
- action is within allowed SLA window.
```

Jangan taruh logic ini di template.

Template cukup:

```html
<form th:if="${page.actions.canApprove}" ...>
```

### 11.4 Jangan expose seluruh role/permission list

Anti-pattern:

```html
<script th:inline="javascript">
  const permissions = [[${allCurrentUserPermissions}]];
</script>
```

Atau:

```html
<div th:data-permissions="${allPermissionsJson}"></div>
```

Masalah:

- permission internal bocor,
- attacker mendapat map sistem,
- logic UI bisa dimanipulasi,
- raw permission sering mengandung tenant/module/action detail.

Lebih aman:

```java
record PageActions(
    boolean canEdit,
    boolean canApprove,
    boolean canCancel
) {}
```

Expose keputusan minimal, bukan seluruh policy.

---

## 12. Sensitive Data Leakage in Hidden Fields

Hidden field bukan secret storage.

Contoh buruk:

```html
<input type="hidden" name="previousStatus" th:value="${case.status}">
<input type="hidden" name="assignedOfficerId" th:value="${case.assignedOfficerId}">
<input type="hidden" name="riskScore" th:value="${case.riskScore}">
<input type="hidden" name="approvalLimit" th:value="${user.approvalLimit}">
```

User bisa melihat dan mengubah hidden field.

### 12.1 Hidden field hanya untuk non-sensitive round-trip data

Boleh untuk:

- form id,
- pagination state,
- selected tab,
- optimistic lock version jika memang didesain,
- CSRF token,
- id resource yang user memang sedang akses.

Tidak boleh untuk:

- authorization decision,
- price/risk/score internal,
- role,
- approval limit,
- trusted status transition,
- tenant id sebagai kontrol tunggal,
- security classification,
- token API,
- password reset token setelah initial use,
- secret key.

### 12.2 Server harus recompute trust

Jika form submit:

```html
<input type="hidden" name="caseId" value="123">
<input type="hidden" name="action" value="APPROVE">
```

Backend harus:

1. Load case 123 dari database.
2. Check user authorization.
3. Check current state.
4. Check transition rule.
5. Apply action.

Jangan percaya field:

```java
if (form.previousStatus().equals("PENDING")) {
    approve();
}
```

Status harus dari DB/current authoritative state.

---

## 13. Model Security: Jangan Lempar Domain Object Mentah ke Template

### 13.1 Masalah entity exposure

Contoh:

```java
model.addAttribute("case", caseEntity);
model.addAttribute("currentUser", userEntity);
```

Template bisa mengakses banyak properti:

```html
<span th:text="${case.internalRiskScore}"></span>
<span th:text="${case.investigationNote}"></span>
<span th:text="${currentUser.passwordHash}"></span>
```

Mungkin tidak disengaja, tetapi template author bisa melihat property yang tidak seharusnya.

Masalah lain:

- lazy loading terjadi saat render,
- N+1 query,
- internal object graph bocor,
- circular reference,
- inconsistent formatting,
- access control sulit.

### 13.2 Gunakan page-specific view model

Contoh:

```java
record CaseDetailPage(
    Long caseId,
    String caseNo,
    String statusLabel,
    String applicantName,
    String submittedAtText,
    List<ActionButton> actions,
    List<TimelineItem> timeline
) {}
```

Template:

```html
<h1 th:text="${page.caseNo}">CASE-0001</h1>
<p th:text="${page.statusLabel}">Pending</p>
<p th:text="${page.applicantName}">Applicant</p>
```

Security benefit:

```text
Template can only render what the view model exposes.
```

### 13.3 Redaction belongs before rendering

Jangan:

```html
<span th:if="${canViewNric}" th:text="${person.nric}"></span>
<span th:unless="${canViewNric}">****</span>
```

Untuk field sensitif, lebih baik service menyiapkan:

```java
record PersonView(
    String displayName,
    String nricDisplay
) {}
```

Dengan isi:

```text
S1234567D      // jika boleh lihat
S****567D      // jika partial
Restricted     // jika tidak boleh
```

Template hanya render:

```html
<span th:text="${person.nricDisplay}"></span>
```

Kenapa?

- logic redaction terkonsolidasi,
- bisa dites,
- tidak ada raw sensitive value di model jika tidak boleh,
- mengurangi risiko accidentally rendered.

---

## 14. Error Message Rendering: Jangan Render Raw Exception/User Input

Error page sering jadi sumber leak.

Contoh buruk:

```html
<div th:utext="${error.message}"></div>
<pre th:text="${exception.stackTrace}"></pre>
```

Risiko:

- XSS jika message mengandung input user,
- leak stack trace,
- leak SQL/query/table name,
- leak file path,
- leak class/package internal,
- leak security configuration.

Pola aman:

```java
record ErrorPage(
    String title,
    String userMessage,
    String correlationId
) {}
```

Template:

```html
<h1 th:text="${error.title}">Something went wrong</h1>
<p th:text="${error.userMessage}">Please try again later.</p>
<p>Reference: <span th:text="${error.correlationId}"></span></p>
```

Guideline:

- User-facing error: generic and escaped.
- Internal error: logs/observability only.
- Correlation ID: safe bridge between user report and internal logs.

---

## 15. Multi-Tenant and Cross-Entity Rendering Risks

Dalam enterprise/regulatory/case system, Thymeleaf page sering menampilkan data dari banyak entity:

- user,
- organization,
- agency,
- case,
- task,
- correspondence,
- document,
- workflow state,
- assigned officer,
- applicant.

Risiko bukan hanya XSS, tetapi **cross-tenant data leak**.

### 15.1 Template tidak boleh menjadi tenant filter

Buruk:

```html
<tr th:each="case : ${allCases}"
    th:if="${case.tenantId == currentTenantId}">
  <td th:text="${case.caseNo}"></td>
</tr>
```

Kenapa buruk?

- data tenant lain sudah masuk model,
- bisa bocor via HTML/JS/log/debug,
- pagination/count salah,
- performance buruk,
- authorization terlambat.

Benar:

```text
Repository/query/service layer only returns authorized tenant-scoped data.
Template receives only renderable authorized data.
```

### 15.2 Branding tenant bukan trust boundary

Contoh:

```html
<img th:src="${tenant.logoUrl}">
<a th:href="${tenant.portalUrl}">Portal</a>
```

Jika tenant metadata bisa diedit admin tenant, validasi tetap perlu:

- logo URL scheme/host/path,
- size/content-type saat upload,
- no SVG unless sanitized or served safely,
- portal URL allowlist/verified domain,
- no `javascript:` or hostile external redirect.

### 15.3 Tenant-specific templates

Jika tenant boleh punya custom template, risiko naik signifikan.

Pertanyaan wajib:

1. Apakah template author trusted?
2. Apakah template bisa mengakses object apa saja?
3. Apakah expression bisa memanggil method sensitif?
4. Apakah template bisa membuat infinite/huge output?
5. Apakah template bisa include template lain?
6. Apakah template bisa exfiltrate data melalui URL/image/link?
7. Apakah template version disetujui sebelum aktif?

Untuk user-editable templates, Thymeleaf raw power biasanya harus dibatasi atau diganti dengan DSL/placeholder system yang lebih sempit.

---

## 16. Fragment and Layout Security

Fragment membuat UI reusable, tetapi juga bisa menyebarkan vulnerability.

### 16.1 Shared fragment raw HTML problem

Contoh fragment:

```html
<div th:fragment="alert(messageHtml)">
  <div class="alert" th:utext="${messageHtml}"></div>
</div>
```

Lalu dipakai di banyak tempat:

```html
<div th:replace="~{fragments/alert :: alert(${errorMessage})}"></div>
```

Satu fragment berbahaya bisa menyebar ke seluruh aplikasi.

Lebih aman:

```html
<div th:fragment="alert(message)">
  <div class="alert" th:text="${message}"></div>
</div>
```

Jika memang perlu rich HTML, buat nama eksplisit:

```html
<div th:fragment="trustedRichAlert(sanitizedHtml)">
  <div class="alert" th:utext="${sanitizedHtml}"></div>
</div>
```

Nama parameter harus membawa warning:

- `sanitizedHtml`, bukan `message`.
- `trustedMarkup`, bukan `content`.
- `safeHtml`, bukan `body`.

### 16.2 Fragment authorization problem

Contoh:

```html
<div th:fragment="adminMenu">
  <a href="/admin/users">Users</a>
  <a href="/admin/config">Config</a>
</div>
```

Jika layout selalu include fragment ini, user biasa bisa melihat link admin.

Pola:

```html
<div th:fragment="adminMenu(actions)" th:if="${actions.showAdminMenu}">
  <a th:if="${actions.canManageUsers}" th:href="@{/admin/users}">Users</a>
  <a th:if="${actions.canManageConfig}" th:href="@{/admin/config}">Config</a>
</div>
```

Tetapi backend endpoint tetap harus protected.

### 16.3 Layout leakage

Layout global sering memuat:

- current user,
- organization,
- notification count,
- feature flags,
- menu items,
- environment banner,
- support links.

Pastikan global model tidak memasukkan data terlalu banyak.

Buruk:

```java
@ModelAttribute("currentUser")
public UserEntity currentUser() { ... }
```

Lebih baik:

```java
@ModelAttribute("layout")
public LayoutView layout() {
    return new LayoutView(displayName, menuItems, environmentBanner);
}
```

---

## 17. Content Security Policy: Defense-in-Depth, Bukan Pengganti Escaping

Content Security Policy atau CSP bisa mengurangi dampak XSS, misalnya dengan membatasi script source dan melarang inline script tanpa nonce/hash.

Tetapi CSP bukan alasan untuk memakai `th:utext` sembarangan.

Mental model:

```text
Escaping/sanitization prevents injection.
CSP reduces exploitability if injection slips through.
```

### 17.1 SSR + CSP challenge

Thymeleaf sering punya inline JavaScript:

```html
<script th:inline="javascript">
  const pageConfig = [[${pageConfig}]];
</script>
```

Jika CSP melarang inline script, pattern ini harus berubah:

1. Gunakan nonce untuk inline script yang sah.
2. Atau pindahkan JS ke external file dan pass config via safe JSON script block/meta/data attributes.
3. Atau endpoint JSON untuk fetch config.

### 17.2 Jangan pakai `unsafe-inline` sembarangan

CSP seperti ini lemah:

```http
Content-Security-Policy: script-src 'self' 'unsafe-inline'
```

Karena inline payload menjadi lebih mudah dieksekusi.

Untuk aplikasi high-security, diskusikan strategi:

- nonce per response,
- external scripts,
- no inline event handlers,
- no dynamic code eval,
- strict `default-src`,
- restricted `img-src`, `connect-src`, `frame-ancestors`.

---

## 18. Template Injection vs XSS

XSS:

```text
User input becomes executable content in browser.
```

Template injection:

```text
User input becomes executable template expression on server.
```

Contoh berbahaya jika aplikasi menerima template text dari user/admin:

```text
Hello [[${user.name}]]
```

Jika user bisa mengontrol template source, ia mungkin bisa mencoba mengakses model object yang tidak dimaksudkan.

### 18.1 Thymeleaf template source harus trusted

Untuk kebanyakan aplikasi:

```text
Template source = trusted developer artifact.
Data model = potentially untrusted data.
```

Jika berubah menjadi:

```text
Template source = user/admin editable content.
```

maka threat model berubah total.

Solusi biasanya bukan memberi Thymeleaf penuh ke user, tetapi membuat placeholder DSL terbatas:

```text
Dear {{applicantName}},
Your case {{caseNo}} has been {{status}}.
```

Lalu renderer hanya mengganti placeholder allowlist, bukan menjalankan arbitrary expression.

### 18.2 Expression injection via preprocessing/dynamic expressions

Hati-hati terhadap pattern yang membuat expression dari string user.

Contoh konseptual berbahaya:

```text
User input -> becomes Thymeleaf expression -> evaluated by engine
```

Rule:

```text
Never let user input define expression code.
User input may be expression data only.
```

---

## 19. Secure Controller-to-Template Contract

Controller yang aman tidak hanya memanggil `return "view"`.

Ia harus memastikan:

1. User authenticated jika diperlukan.
2. Authorization diperiksa untuk resource.
3. Data yang dimuat sudah scoped.
4. View model minimal dan redacted.
5. Permission flags dihitung server-side.
6. Form object tidak mengandung field yang tidak boleh diedit.
7. CSRF aktif untuk unsafe action.
8. Error message aman.
9. Redirect URL divalidasi.
10. Template tidak menerima service/entity/raw HTML sembarangan.

Contoh controller yang buruk:

```java
@GetMapping("/cases/{id}")
public String detail(@PathVariable Long id, Model model) {
    CaseEntity c = caseRepository.findById(id).orElseThrow();
    model.addAttribute("case", c);
    model.addAttribute("currentUser", userService.currentUserEntity());
    return "cases/detail";
}
```

Contoh lebih baik:

```java
@GetMapping("/cases/{id}")
public String detail(@PathVariable Long id, Model model, Authentication authentication) {
    CaseDetailPage page = casePageService.buildDetailPage(id, authentication);
    model.addAttribute("page", page);
    return "cases/detail";
}
```

`casePageService.buildDetailPage` bertanggung jawab untuk:

- load authorized case,
- check tenant/agency scope,
- compute action permissions,
- format display values,
- redact sensitive fields,
- provide only renderable data.

---

## 20. Secure Form Design with Thymeleaf

### 20.1 Form object harus command-specific

Buruk:

```java
@PostMapping("/users/{id}")
public String update(@ModelAttribute UserEntity user) { ... }
```

Jika entity punya field:

- role,
- enabled,
- tenantId,
- passwordHash,
- approvalLimit,

maka over-posting/mass assignment risk muncul.

Lebih aman:

```java
record UpdateProfileCommand(
    String displayName,
    String phone
) {}
```

Template:

```html
<form th:object="${form}" th:action="@{/profile}" method="post">
  <input th:field="*{displayName}">
  <input th:field="*{phone}">
  <button type="submit">Save</button>
</form>
```

Backend:

```java
@PostMapping("/profile")
public String update(@Valid @ModelAttribute("form") UpdateProfileCommand form,
                     BindingResult bindingResult,
                     Authentication authentication) {
    if (bindingResult.hasErrors()) {
        return "profile/edit";
    }
    profileService.update(authentication, form);
    return "redirect:/profile";
}
```

### 20.2 Disable field bukan security

HTML:

```html
<input th:field="*{role}" disabled>
```

User bisa craft request manual.

Backend harus ignore/reject field yang tidak boleh diedit. Lebih baik field tidak ada di command object.

### 20.3 Readonly field juga bukan security

```html
<input th:field="*{approvalLimit}" readonly>
```

Readonly hanya UI behavior. Request tetap bisa dimodifikasi.

---

## 21. Security Review Checklist per Template

Gunakan checklist ini saat review PR Thymeleaf.

### 21.1 Output safety

- [ ] Apakah semua user/external/database text memakai `th:text`, bukan `th:utext`?
- [ ] Jika ada `th:utext`, apakah input sudah sanitized dengan policy jelas?
- [ ] Apakah nama variable raw HTML eksplisit seperti `sanitizedHtml`?
- [ ] Apakah inline JavaScript memakai `th:inline="javascript"`?
- [ ] Apakah tidak ada user-controlled JavaScript code?
- [ ] Apakah dynamic URL divalidasi scheme/host/path?
- [ ] Apakah dynamic CSS tidak berasal dari arbitrary input?
- [ ] Apakah fragment shared tidak memakai raw HTML generic?

### 21.2 Data leakage

- [ ] Apakah template menerima view model, bukan entity mentah?
- [ ] Apakah model tidak mengandung token/secret/password hash/internal score?
- [ ] Apakah hidden field tidak berisi data sensitif?
- [ ] Apakah JavaScript config tidak memuat data sensitif?
- [ ] Apakah global layout model minimal?
- [ ] Apakah error page tidak render stack trace?

### 21.3 Authorization

- [ ] Apakah show/hide UI hanya untuk UX, bukan satu-satunya security?
- [ ] Apakah endpoint tetap protected server-side?
- [ ] Apakah permission flag dihitung di service/backend?
- [ ] Apakah template tidak memuat permission logic kompleks?
- [ ] Apakah role/permission list internal tidak diexpose ke browser?

### 21.4 CSRF/form

- [ ] Apakah unsafe form memakai POST/PUT/PATCH/DELETE sesuai desain?
- [ ] Apakah CSRF protection aktif?
- [ ] Apakah rendered form menyertakan token?
- [ ] Apakah AJAX/fetch mengirim CSRF header?
- [ ] Apakah CSRF token tidak muncul di URL/log?
- [ ] Apakah form command object tidak over-broad?

### 21.5 Multi-tenant

- [ ] Apakah tenant filtering dilakukan sebelum model dibuat?
- [ ] Apakah template tidak menerima data tenant lain lalu filter pakai `th:if`?
- [ ] Apakah branding/logo/link tenant divalidasi?
- [ ] Apakah tenant-specific content disanitasi?

---

## 22. Testing Thymeleaf Security

Security tidak cukup dengan code review. Template perlu dites.

### 22.1 XSS payload test untuk `th:text`

Contoh test konseptual:

```java
@Test
void shouldEscapeUserDisplayName() {
    var page = new UserPage("<script>alert(1)</script>");

    String html = renderer.render("users/detail", Map.of("page", page));

    assertThat(html).contains("&lt;script&gt;alert(1)&lt;/script&gt;");
    assertThat(html).doesNotContain("<script>alert(1)</script>");
}
```

### 22.2 Attribute injection test

```java
@Test
void shouldEscapeAttributeValue() {
    var page = new FormPage("\" autofocus onfocus=\"alert(1)");

    String html = renderer.render("forms/edit", Map.of("page", page));

    assertThat(html).doesNotContain("autofocus onfocus");
}
```

### 22.3 URL scheme test

Test di service layer:

```java
@ParameterizedTest
@ValueSource(strings = {
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    " //evil.example",
    "https://evil.example/phish"
})
void shouldRejectUnsafeReturnUrl(String url) {
    assertThatThrownBy(() -> returnUrlPolicy.normalize(url))
        .isInstanceOf(InvalidReturnUrlException.class);
}
```

### 22.4 Authorization rendering test

```java
@Test
void shouldNotRenderApproveButtonWhenUserCannotApprove() {
    var page = CaseDetailPageFixtures.withCanApprove(false);

    String html = renderer.render("cases/detail", Map.of("page", page));

    assertThat(html).doesNotContain("Approve");
    assertThat(html).doesNotContain("/approve");
}
```

Tetapi tetap harus ada backend authorization test:

```java
@Test
void shouldRejectApprovePostWhenUserCannotApprove() {
    mockMvc.perform(post("/cases/123/approve").with(user("viewer")))
        .andExpect(status().isForbidden());
}
```

### 22.5 CSRF test

```java
@Test
void shouldRejectPostWithoutCsrf() {
    mockMvc.perform(post("/cases/123/approve"))
        .andExpect(status().isForbidden());
}

@Test
void shouldAllowPostWithCsrfAndPermission() {
    mockMvc.perform(post("/cases/123/approve")
            .with(csrf())
            .with(user("reviewer").roles("REVIEWER")))
        .andExpect(status().is3xxRedirection());
}
```

---

## 23. Common Anti-Patterns and Corrections

### Anti-pattern 1 — `th:utext` untuk convenience

Buruk:

```html
<div th:utext="${message}"></div>
```

Baik:

```html
<div th:text="${message}"></div>
```

Jika rich HTML:

```html
<div th:utext="${sanitizedMessageHtml}"></div>
```

Dengan sanitizer policy yang jelas.

---

### Anti-pattern 2 — Authorization hanya di template

Buruk:

```html
<form th:if="${user.role == 'ADMIN'}" action="/admin/delete" method="post">
  <button>Delete</button>
</form>
```

Baik:

```html
<form th:if="${page.actions.canDelete}" th:action="@{/admin/delete}" method="post">
  <button>Delete</button>
</form>
```

Dan backend:

```java
@PreAuthorize("hasAuthority('ADMIN_DELETE')")
@PostMapping("/admin/delete")
public String delete(...) { ... }
```

---

### Anti-pattern 3 — Entity langsung ke model

Buruk:

```java
model.addAttribute("user", userEntity);
```

Baik:

```java
model.addAttribute("page", UserDetailPage.from(userEntity, permissions));
```

---

### Anti-pattern 4 — Arbitrary redirect URL

Buruk:

```html
<a th:href="${returnUrl}">Back</a>
```

Baik:

```html
<a th:href="@{${safeReturnPath}}">Back</a>
```

Dengan `safeReturnPath` hasil normalize allowlist internal path.

---

### Anti-pattern 5 — Secret di HTML

Buruk:

```html
<input type="hidden" th:value="${apiSecret}">
<script th:inline="javascript">
  const token = [[${internalToken}]];
</script>
```

Baik:

```text
Never render backend secrets to browser.
Use server-side proxy/session-bound endpoints.
```

---

### Anti-pattern 6 — Tenant filtering di template

Buruk:

```html
<tr th:each="x : ${allItems}" th:if="${x.tenantId == tenantId}">
```

Baik:

```text
Only authorized tenant-scoped items are queried and placed in model.
```

---

## 24. Production Design Pattern: Secure Page Model

Gunakan pola berikut untuk page yang kompleks.

```java
public record SecurePage<T>(
    LayoutView layout,
    T content,
    PageActions actions,
    SecurityDisplay security
) {}
```

Contoh:

```java
public record CaseDetailContent(
    String caseNo,
    String statusLabel,
    String applicantName,
    String submittedAt,
    List<TimelineItem> timeline
) {}

public record PageActions(
    boolean canEdit,
    boolean canApprove,
    boolean canReject,
    boolean canDownload
) {}

public record SecurityDisplay(
    String dataClassificationLabel,
    boolean showConfidentialBanner
) {}
```

Template:

```html
<header th:replace="~{layout/header :: header(${page.layout})}"></header>

<main>
  <div th:if="${page.security.showConfidentialBanner}" class="banner">
    <span th:text="${page.security.dataClassificationLabel}"></span>
  </div>

  <h1 th:text="${page.content.caseNo}"></h1>
  <p th:text="${page.content.statusLabel}"></p>

  <a th:if="${page.actions.canEdit}"
     th:href="@{/cases/{id}/edit(id=${caseId})}">
    Edit
  </a>
</main>
```

Keuntungan:

- layout data terpisah,
- content data terpisah,
- action decision eksplisit,
- security display eksplisit,
- raw entity tidak bocor,
- template lebih mudah direview.

---

## 25. Java 8–25 Considerations

Thymeleaf security pattern secara konsep tidak tergantung pada Java version, tetapi Java 8–25 memberi kemampuan berbeda untuk membuat model aman.

### Java 8

Gunakan immutable class manual:

```java
public final class CaseDetailPage {
    private final String caseNo;
    private final String statusLabel;

    public CaseDetailPage(String caseNo, String statusLabel) {
        this.caseNo = Objects.requireNonNull(caseNo);
        this.statusLabel = Objects.requireNonNull(statusLabel);
    }

    public String getCaseNo() { return caseNo; }
    public String getStatusLabel() { return statusLabel; }
}
```

### Java 14+ / 16+

Gunakan records untuk view model:

```java
public record CaseDetailPage(
    String caseNo,
    String statusLabel,
    PageActions actions
) {}
```

Records membantu:

- immutability semantic,
- explicit fields,
- contract clarity,
- less boilerplate.

### Java 17+

Sealed hierarchy dapat berguna untuk action rendering:

```java
sealed interface PageAction permits LinkAction, FormAction, DisabledAction {}
```

### Java 21–25

Virtual threads tidak membuat template lebih aman, tetapi bisa dipakai untuk concurrent server-side request handling. Tetap:

- jangan render huge output tanpa limit,
- jangan block external resource dari template,
- jangan lazy-load DB dari template,
- jangan mengandalkan concurrency untuk menutupi desain model buruk.

Security invariant tetap sama:

```text
Minimal model + context-aware output + backend authorization + CSRF + safe rich HTML policy.
```

---

## 26. Review Heuristic: “Can This Value Become Syntax?”

Saat membaca template, tanyakan untuk setiap expression:

```html
<span th:text="${x}"></span>
<a th:href="${x}"></a>
<script th:inline="javascript">const x = [[${x}]];</script>
<div th:utext="${x}"></div>
```

Pertanyaan:

1. Apakah `x` bisa dikontrol user/external system?
2. Apakah `x` bisa mengubah struktur HTML?
3. Apakah `x` bisa menjadi URL executable?
4. Apakah `x` bisa menjadi JavaScript code?
5. Apakah `x` mengandung data yang user tidak boleh lihat?
6. Apakah `x` sudah divalidasi/sanitized/redacted sebelum masuk model?
7. Apakah backend tetap enforce authorization?

Jika jawabannya tidak jelas, template belum siap production.

---

## 27. Ringkasan Mental Model

Thymeleaf security dapat diringkas menjadi beberapa invariant:

1. **Default to text.** Gunakan `th:text` untuk data normal.
2. **Raw HTML is exceptional.** `th:utext` hanya untuk HTML yang trusted/sanitized.
3. **Context matters.** HTML body, attribute, URL, JS, CSS punya aturan berbeda.
4. **Escaping is not validation.** URL scheme dan business meaning tetap harus divalidasi.
5. **Sanitization is not escaping.** Rich HTML butuh sanitizer allowlist.
6. **Hidden is not secret.** Hidden field/data attribute/JS variable terlihat oleh user.
7. **UI authorization is not backend authorization.** Hide button bukan security control utama.
8. **Model is the real contract.** Jangan expose entity/domain object mentah.
9. **Redact before render.** Jangan kirim raw sensitive data ke template jika user tidak boleh melihatnya.
10. **Template source must be trusted.** Jika user bisa edit template, threat model berubah.
11. **Fragments amplify risk.** Satu fragment unsafe bisa menyebarkan vulnerability ke banyak page.
12. **Test security behavior.** XSS/CSRF/authorization harus punya automated tests.

---

## 28. Latihan Mandiri

### Latihan 1 — Audit Template

Ambil satu Thymeleaf template existing, lalu tandai semua:

- `th:text`,
- `th:utext`,
- `th:href`,
- `th:src`,
- `th:style`,
- `th:inline`,
- hidden input,
- `sec:authorize`,
- `th:if` yang terkait permission.

Untuk setiap expression, jawab:

```text
Source data dari mana?
Apakah user/external-controlled?
Output context apa?
Apakah bisa menjadi syntax aktif?
Apakah ada data sensitif?
Apakah backend enforce action?
```

### Latihan 2 — Refactor Entity Model ke Secure Page Model

Dari controller yang mengirim entity langsung:

```java
model.addAttribute("case", caseEntity);
```

Refactor menjadi:

```java
model.addAttribute("page", CaseDetailPage.from(...));
```

Pastikan:

- field sensitif tidak ada,
- permission menjadi boolean action flag,
- formatted display value disiapkan,
- template tidak memanggil nested domain property.

### Latihan 3 — Rich Text Policy

Desain policy untuk field `officerRemarkRichText`:

1. Siapa boleh input?
2. Tag apa yang boleh?
3. Attribute apa yang boleh?
4. URL scheme apa yang boleh?
5. Apakah raw disimpan?
6. Apakah sanitized version disimpan?
7. Bagaimana test XSS?
8. Bagaimana audit policy version?

### Latihan 4 — Authorization Test Matrix

Untuk satu page case detail, buat matrix:

| Role | State | canEdit | canApprove | canReject | Endpoint Approve |
|---|---:|---:|---:|---:|---:|
| Viewer | Pending | false | false | false | 403 |
| Reviewer | Pending | false | true | true | 302/200 |
| Reviewer | Closed | false | false | false | 409/403 |
| Admin | Pending | true | true | true | 302/200 |

Lalu buat test rendering dan test endpoint.

---

## 29. Production Checklist Final

Sebelum Thymeleaf page masuk production:

```text
[ ] Template tidak memakai th:utext kecuali justified.
[ ] Semua th:utext memakai sanitized/trusted HTML variable.
[ ] Tidak ada raw entity object di model.
[ ] Tidak ada secret/token internal di HTML/JS/data attribute.
[ ] Dynamic URL divalidasi.
[ ] Dynamic CSS dihindari atau allowlisted.
[ ] Inline JS memakai th:inline="javascript" dan hanya data, bukan code.
[ ] CSRF aktif dan diuji.
[ ] Backend authorization aktif dan diuji.
[ ] UI authorization hanya UX, bukan enforcement tunggal.
[ ] Hidden field tidak dipercaya.
[ ] Error page tidak leak stack trace/internal message.
[ ] Tenant scoping dilakukan sebelum rendering.
[ ] Fragment shared aman dan tidak generic raw HTML.
[ ] XSS payload tests tersedia untuk field berisiko.
[ ] Security review dilakukan pada template dan controller/service pembentuk model.
```

---

## 30. Penutup

Security Thymeleaf bukan sekadar hafalan:

```text
th:text aman, th:utext bahaya.
```

Itu hanya permukaan.

Pemahaman yang lebih matang adalah:

```text
A server-side template renders trusted structure plus untrusted data into a browser parsing context.
Security depends on strict model shaping, context-aware encoding, controlled raw markup, CSRF protection, backend authorization, and data minimization.
```

Dengan mental model ini, kamu bisa mendesain Thymeleaf page yang bukan hanya “jalan”, tetapi aman untuk sistem enterprise, multi-role, multi-tenant, dan regulatory-grade.

---

## 31. Referensi

1. Thymeleaf 3.1 Documentation — Using Thymeleaf: `https://www.thymeleaf.org/doc/tutorials/3.1/usingthymeleaf.html`
2. Thymeleaf + Spring Documentation: `https://www.thymeleaf.org/doc/tutorials/3.1/thymeleafspring.html`
3. Thymeleaf + Spring Security Integration Basics: `https://www.thymeleaf.org/doc/articles/springsecurity.html`
4. Spring Security Reference — CSRF: `https://docs.spring.io/spring-security/reference/servlet/exploits/csrf.html`
5. OWASP Cross Site Scripting Prevention Cheat Sheet: `https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html`
6. OWASP Top 10 2025: `https://owasp.org/Top10/2025/en/`

---

## Status Seri

```text
Part 17 selesai.
Seri belum selesai.
Berikutnya: Part 18 — Thymeleaf Performance, Caching, and Production Tuning.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-016.md">⬅️ Part 16 — Thymeleaf Layouts, Fragments, Components, and Design System</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-018.md">Part 18 — Thymeleaf Performance, Caching, and Production Tuning ➡️</a>
</div>
