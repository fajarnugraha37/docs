# Part 11 — JSP Security: XSS, CSRF, Output Encoding, Session, and Headers

> Seri: `learn-java-jakarta-pages-el-tags-faces-server-side-ui`  
> Part: `11-jsp-security-xss-csrf-output-encoding-session-headers.md`  
> Fokus: memahami keamanan JSP/Jakarta Pages sebagai masalah **context-aware rendering**, **stateful web flow**, dan **defense-in-depth**, bukan sekadar menambahkan `c:out` atau token CSRF.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami bahwa security di JSP adalah masalah **data-flow dari server model ke browser parser**.
2. Membedakan output context:
   - HTML body,
   - HTML attribute,
   - JavaScript string,
   - JavaScript data block,
   - URL,
   - CSS,
   - raw HTML.
3. Menentukan encoding yang tepat untuk setiap output context.
4. Memahami kenapa `c:out` penting, tetapi tidak cukup untuk semua situasi.
5. Mendesain rendering CSRF token yang aman dan konsisten.
6. Memahami risiko session pada server-side UI:
   - session fixation,
   - session hijacking,
   - stale session,
   - sensitive data leakage,
   - session id exposure.
7. Membedakan **authorization-aware rendering** dengan **authorization enforcement**.
8. Mendesain secure headers untuk halaman JSP:
   - `Cache-Control`,
   - `Content-Security-Policy`,
   - `X-Frame-Options`/`frame-ancestors`,
   - `X-Content-Type-Options`,
   - cookie flags.
9. Melakukan review keamanan JSP legacy secara sistematis.
10. Membuat checklist produksi untuk aplikasi JSP/Faces-like server-rendered UI.

---

## 1. Big Picture: Security JSP Bukan Masalah JSP Saja

JSP berada di ujung paling terlihat dari sistem web Java. Ia menerima data yang sudah diproses oleh layer lain:

```text
Database / External API / User Input
        ↓
Domain / Service / Persistence
        ↓
Controller / Servlet / Filter
        ↓
Request Attributes / View Model / Session Attributes
        ↓
JSP + EL + JSTL + Custom Tags
        ↓
HTML / CSS / JavaScript / URL / Forms
        ↓
Browser Parser + User Interaction
```

Dari sudut pandang security, JSP adalah titik di mana data berubah dari **object server-side** menjadi **syntax browser-side**.

Itu berarti pertanyaan security paling penting bukan:

> “Apakah string ini sudah disanitize?”

Pertanyaan yang lebih tepat:

> “String ini akan masuk ke parser apa, pada context apa, dan encoding apa yang membuatnya tidak bisa berubah menjadi instruksi?”

Browser bukan membaca output sebagai “text biasa”. Browser membaca output sebagai beberapa grammar berbeda:

- HTML grammar,
- attribute grammar,
- JavaScript grammar,
- CSS grammar,
- URL grammar,
- sometimes SVG/XML grammar.

Karena grammar-nya berbeda, encoding-nya juga berbeda. Inilah penyebab banyak XSS tetap muncul walaupun developer merasa sudah “escape HTML”.

---

## 2. Security Threat Model untuk JSP

Sebelum membahas mitigasi, kita perlu threat model. JSP biasanya rentan pada kategori berikut:

| Risiko | Penyebab Umum | Dampak |
|---|---|---|
| Reflected XSS | Parameter request dirender tanpa encoding | Script execution di browser korban |
| Stored XSS | Data berbahaya tersimpan di DB lalu dirender | Persistent compromise untuk banyak user |
| DOM XSS | Data JSP masuk ke JavaScript lalu dipakai tidak aman | Script execution client-side |
| CSRF | Form state-changing tidak punya token valid | User melakukan aksi tanpa sadar |
| Authorization bypass | Tombol disembunyikan tapi endpoint tetap terbuka | Aksi ilegal via direct request |
| Sensitive data exposure | Data rahasia dirender ke hidden field, HTML comment, JS global | Leakage via browser/devtools/cache/log |
| Session fixation | Session id tidak diganti setelah login | Attacker memakai session yang sudah diketahui |
| Clickjacking | Halaman bisa di-embed iframe pihak lain | User dipancing klik aksi sensitif |
| Cache leakage | Protected page/cache browser/proxy menyimpan data | Data bocor setelah logout/shared machine |
| Open redirect | Redirect URL dari parameter tidak divalidasi | Phishing/token leakage |
| Header injection | User input masuk header response | Response splitting/cache poisoning |

Mental model penting:

```text
JSP security = secure rendering + secure flow + secure state + secure headers + server-side enforcement
```

Kalau hanya secure rendering, sistem masih bisa bobol via CSRF. Kalau hanya CSRF, sistem masih bisa bobol via XSS yang mencuri token. Kalau hanya menu disembunyikan, endpoint masih bisa dipanggil langsung.

---

## 3. XSS: Masalah “Untrusted Data Becomes Executable Syntax”

Cross-Site Scripting terjadi ketika data yang tidak dipercaya masuk ke output browser dan berubah menjadi instruksi executable.

Contoh sederhana:

```jsp
<p>Welcome ${param.name}</p>
```

Jika `name` berisi:

```html
<script>alert(1)</script>
```

Maka output bisa menjadi:

```html
<p>Welcome <script>alert(1)</script></p>
```

Browser tidak tahu bahwa `<script>` itu “data”. Browser menganggapnya instruksi HTML/JS.

### 3.1 Reflected XSS

Data berasal dari request dan langsung dirender:

```jsp
Search result for: ${param.q}
```

Contoh attack:

```text
/search?q=<script>alert(document.cookie)</script>
```

### 3.2 Stored XSS

Data berbahaya disimpan terlebih dahulu:

```text
Attacker submit comment: <img src=x onerror=alert(1)>
DB menyimpan comment
Admin membuka halaman moderation
JSP render comment tanpa encoding
Script berjalan di browser admin
```

Stored XSS lebih berbahaya karena korban tidak perlu membuka link attack; cukup membuka halaman normal.

### 3.3 DOM XSS dari JSP

JSP bisa menghasilkan JavaScript:

```jsp
<script>
  const displayName = '${user.displayName}';
</script>
```

Jika `displayName` berisi:

```text
'; alert(1); //
```

Output menjadi:

```html
<script>
  const displayName = ''; alert(1); //';
</script>
```

Di sini HTML escaping saja tidak cukup. Context-nya adalah JavaScript string literal.

---

## 4. Rule Utama: Encode Output, Bukan “Sanitize Semua Input”

Validasi input tetap penting, tetapi tidak menggantikan output encoding.

Validasi input menjawab:

> “Apakah data ini valid untuk domain saya?”

Output encoding menjawab:

> “Apakah data ini aman untuk grammar output tertentu?”

Contoh:

- Nama orang bisa valid mengandung apostrophe: `O'Connor`.
- Judul case bisa valid mengandung tanda kutip.
- Alamat bisa valid mengandung `#`, `/`, `&`.
- Deskripsi bisa valid mengandung `<` sebagai teks biasa.

Jika kamu “sanitize input” secara kasar, kamu bisa merusak data valid. Jika kamu tidak encode output, data valid bisa menjadi syntax berbahaya ketika masuk ke context tertentu.

Prinsip enterprise:

```text
Validate input for domain correctness.
Encode output for rendering safety.
Never rely on one global sanitizer for all contexts.
```

---

## 5. Context-Aware Output Encoding

Ini inti dari keamanan JSP.

Data yang sama bisa aman di satu context tetapi berbahaya di context lain.

Misal string:

```text
" onmouseover="alert(1)
```

Jika dirender di HTML body dengan HTML escaping, mungkin aman.

Jika dimasukkan ke attribute tanpa attribute encoding:

```jsp
<input value="${user.name}">
```

Output bisa menjadi:

```html
<input value="" onmouseover="alert(1)">
```

Sekarang data berubah menjadi event handler.

---

## 6. HTML Body Context

HTML body context adalah area teks biasa di antara tag:

```jsp
<p>${caseSummary.title}</p>
```

Lebih aman menggunakan:

```jsp
<p><c:out value="${caseSummary.title}" /></p>
```

`c:out` melakukan XML/HTML escaping untuk karakter seperti:

| Karakter | Escaped |
|---|---|
| `<` | `&lt;` |
| `>` | `&gt;` |
| `&` | `&amp;` |
| `"` | `&#034;` / entity sejenis |
| `'` | `&#039;` / entity sejenis |

Contoh:

```jsp
<c:out value="${comment.text}" />
```

Jika comment berisi:

```html
<script>alert(1)</script>
```

Output browser menjadi teks:

```html
&lt;script&gt;alert(1)&lt;/script&gt;
```

Bukan script executable.

### 6.1 Jangan Pakai EL Mentah untuk Data Tidak Terpercaya

Ini berbahaya:

```jsp
<p>${comment.text}</p>
```

Beberapa container/framework bisa punya behavior escaping berbeda tergantung teknologi dan tag. Jangan desain keamanan berdasarkan asumsi implisit. Jadikan escaping eksplisit pada boundary rendering.

Pattern yang lebih defensible:

```jsp
<p><c:out value="${comment.text}" /></p>
```

Atau gunakan custom tag internal:

```jsp
<app:text value="${comment.text}" />
```

yang selalu melakukan encoding sesuai context.

---

## 7. HTML Attribute Context

Attribute context lebih sensitif karena karakter seperti `"`, `'`, whitespace, dan backtick bisa memengaruhi struktur attribute.

Contoh berbahaya:

```jsp
<input type="text" name="displayName" value="${user.displayName}">
```

Jika value:

```text
" autofocus onfocus="alert(1)
```

Output:

```html
<input type="text" name="displayName" value="" autofocus onfocus="alert(1)">
```

### 7.1 Gunakan Attribute Encoding

Untuk simple JSP/JSTL, `c:out` di dalam attribute sering dipakai:

```jsp
<input type="text" name="displayName" value="<c:out value='${user.displayName}' />">
```

Tetapi pattern ini bisa menjadi sulit dibaca dan rawan quote mistake.

Lebih baik dalam enterprise tag library:

```jsp
<app:inputText name="displayName" value="${form.displayName}" />
```

Tag `app:inputText` bertanggung jawab melakukan attribute encoding secara konsisten.

### 7.2 Jangan Masukkan User Data ke Nama Attribute/Event Handler

Berbahaya:

```jsp
<div ${customAttributeName}="${customAttributeValue}"></div>
```

Sangat berbahaya:

```jsp
<button onclick="${actionScript}">Submit</button>
```

Nama attribute dan event handler harus berasal dari kode server yang trusted dan whitelisted, bukan dari user input.

### 7.3 Boolean Attribute

Jangan render boolean attribute dengan string bebas:

```jsp
<input ${form.disabledAttribute}>
```

Lebih aman:

```jsp
<input type="text" name="x" <c:if test="${form.disabled}">disabled</c:if> />
```

Atau di custom tag:

```jsp
<app:inputText name="x" disabled="${form.disabled}" />
```

---

## 8. JavaScript Context

Ini area paling sering salah.

Contoh buruk:

```jsp
<script>
  const username = '${user.username}';
</script>
```

Masalah:

1. HTML encoding bukan JavaScript string encoding.
2. Apostrophe bisa keluar dari string.
3. Backslash bisa mengubah escape sequence.
4. `</script>` bisa menutup script tag.
5. Unicode line separator bisa memecah string pada beberapa context.

### 8.1 Pattern Aman: JSON Encode, Jangan String Concatenation

Daripada:

```jsp
<script>
  const user = {
    id: '${user.id}',
    name: '${user.name}',
    role: '${user.role}'
  };
</script>
```

Lebih baik controller membuat JSON yang sudah diserialisasi dengan library JSON yang benar:

```java
String pageModelJson = objectMapper.writeValueAsString(pageModel);
request.setAttribute("pageModelJson", pageModelJson);
```

Lalu render sebagai JavaScript data block dengan encoding yang tepat:

```jsp
<script type="application/json" id="page-model">
<c:out value="${pageModelJson}" />
</script>
```

Kemudian client-side code membaca:

```html
<script>
  const raw = document.getElementById('page-model').textContent;
  const pageModel = JSON.parse(raw);
</script>
```

Namun ada detail penting: JSON di dalam HTML tetap harus memperhatikan `</script>`. Banyak library modern melakukan escaping slash atau karakter berbahaya jika dikonfigurasi. Jika tidak, kamu perlu utility khusus untuk JSON-safe-in-HTML.

Pattern yang lebih robust:

```jsp
<script>
  window.__PAGE_MODEL__ = JSON.parse('<app:jsString value="${pageModelJson}" />');
</script>
```

Tetapi ini butuh JavaScript string encoder yang benar. Jangan pakai `c:out` sebagai JavaScript encoder.

### 8.2 Jangan Render User Input ke JavaScript Code Context

Sangat berbahaya:

```jsp
<script>
  ${userProvidedScript}
</script>
```

Berbahaya:

```jsp
<script>
  if (${param.enabled}) {
    doSomething();
  }
</script>
```

Lebih aman:

```jsp
<script type="application/json" id="config">
<c:out value="${configJson}" />
</script>
```

### 8.3 Inline Event Handler Harus Dihindari

Berbahaya:

```jsp
<button onclick="approve('${caseId}')">Approve</button>
```

Jika `caseId` tidak di-escape untuk JavaScript string, XSS bisa terjadi.

Lebih baik:

```jsp
<button class="js-approve" data-case-id="<c:out value='${caseId}' />">Approve</button>
```

Lalu JavaScript:

```javascript
document.addEventListener('click', function (event) {
  const button = event.target.closest('.js-approve');
  if (!button) return;
  approve(button.dataset.caseId);
});
```

Data masuk ke HTML attribute context, bukan inline JavaScript code context. Tetap butuh attribute encoding, tetapi surface lebih kecil.

---

## 9. URL Context

URL context muncul pada:

```jsp
<a href="...">
<form action="...">
<script src="...">
<link href="...">
<img src="...">
```

Contoh buruk:

```jsp
<a href="${param.next}">Continue</a>
```

Jika `next` berisi:

```text
javascript:alert(1)
```

Maka link bisa menjalankan script.

### 9.1 Encode Parameter, Bukan Seluruh URL Secara Buta

Gunakan `c:url` dan `c:param` untuk membuat URL internal:

```jsp
<c:url var="caseUrl" value="/case/detail">
    <c:param name="id" value="${caseSummary.id}" />
    <c:param name="tab" value="${selectedTab}" />
</c:url>

<a href="${caseUrl}">View</a>
```

`c:param` membantu encoding query parameter.

### 9.2 Validasi Scheme dan Host untuk URL Eksternal

Untuk URL eksternal:

```java
public final class SafeUrl {
    private final String href;
    private final boolean external;
    private final String rel;

    // only constructed after validation
}
```

Controller/service harus melakukan whitelist:

```text
Allowed scheme: https
Allowed host: docs.example.gov, help.example.gov
Disallowed: javascript:, data:, file:, //evil.example
```

JSP hanya render:

```jsp
<a href="<c:out value='${safeUrl.href}' />" rel="noopener noreferrer">
    <c:out value="${safeUrl.label}" />
</a>
```

### 9.3 Open Redirect

Berbahaya:

```jsp
<a href="/login?redirect=${param.redirect}">Login</a>
```

Dan di server:

```java
response.sendRedirect(request.getParameter("redirect"));
```

Jika attacker membuat:

```text
/login?redirect=https://evil.example/phishing
```

Sistem menjadi open redirect.

Solusi:

- hanya izinkan relative path internal,
- gunakan redirect id/code, bukan raw URL,
- validasi host/scheme jika eksternal benar-benar perlu.

---

## 10. CSS Context

CSS context sering diremehkan. Contoh:

```jsp
<div style="background-image: url('${profile.backgroundUrl}')">
```

Jika input tidak dikontrol, bisa membuka risiko injection, tracking, atau browser-specific exploit. Modern browser sudah mengurangi beberapa vector lama, tetapi inline CSS tetap memperluas attack surface.

### 10.1 Hindari User Data di Inline Style

Lebih baik:

```jsp
<div class="profile-card profile-card--${profile.themeClass}">
```

Tapi `themeClass` harus whitelist:

```java
Set<String> allowed = Set.of("default", "blue", "green", "high-contrast");
```

JSP:

```jsp
<div class="profile-card profile-card--<c:out value='${profile.safeTheme}' />">
```

### 10.2 Jangan Render CSS Bebas dari User

Sangat berbahaya:

```jsp
<style>
  ${tenant.customCss}
</style>
```

Jika enterprise app butuh tenant-specific theme, desain dengan:

- whitelist token warna,
- server-generated CSS dari config tervalidasi,
- separate static resource,
- CSP yang sesuai,
- review khusus.

---

## 11. Raw HTML: Kasus Paling Berisiko

Kadang aplikasi perlu render rich text:

- announcement,
- email template preview,
- CMS content,
- policy text,
- instruction page,
- generated report.

Contoh raw rendering:

```jsp
${announcement.htmlBody}
```

Atau:

```jsp
<c:out value="${announcement.htmlBody}" escapeXml="false" />
```

`escapeXml="false"` adalah alarm security. Bukan selalu salah, tetapi harus dianggap sebagai privileged operation.

### 11.1 Raw HTML Harus Melewati Sanitizer Berbasis Allowlist

Jika harus render HTML:

```text
Input HTML
  ↓
HTML sanitizer allowlist
  ↓
SafeHtml value object
  ↓
JSP raw render melalui custom tag khusus
```

Jangan biarkan JSP memutuskan sendiri kapan escaping dimatikan.

Buruk:

```jsp
<c:out value="${body}" escapeXml="false" />
```

Lebih baik:

```jsp
<app:safeHtml value="${announcement.safeHtmlBody}" />
```

Dengan tipe domain:

```java
public final class SafeHtml {
    private final String sanitizedHtml;

    private SafeHtml(String sanitizedHtml) {
        this.sanitizedHtml = sanitizedHtml;
    }

    public static SafeHtml fromSanitized(String sanitizedHtml) {
        return new SafeHtml(sanitizedHtml);
    }

    public String asString() {
        return sanitizedHtml;
    }
}
```

### 11.2 Jangan Simpan “Sudah Aman” sebagai String Biasa

Jika sanitized HTML hanya disimpan sebagai `String`, developer berikutnya tidak tahu apakah itu:

- raw user input,
- escaped text,
- sanitized HTML,
- markdown,
- trusted admin HTML.

Gunakan tipe eksplisit:

```text
PlainText
SafeHtml
MarkdownSource
SanitizedMarkdownHtml
TrustedSystemTemplate
```

Ini membantu mencegah double escaping dan under escaping.

---

## 12. `c:out`: Penting, Tetapi Bukan Silver Bullet

`c:out` sangat berguna untuk HTML body dan banyak attribute context sederhana karena melakukan XML escaping.

Aman untuk pola seperti:

```jsp
<p><c:out value="${user.name}" /></p>
```

Cukup baik untuk simple quoted attribute:

```jsp
<input value="<c:out value='${form.name}' />">
```

Tetapi tidak cukup untuk:

```jsp
<script>
  const name = '<c:out value="${user.name}" />';
</script>
```

Tidak cukup untuk:

```jsp
<style>
  .x { background: url('<c:out value="${url}" />'); }
</style>
```

Tidak cukup untuk:

```jsp
<a href="<c:out value='${userProvidedUrl}' />">Open</a>
```

karena URL scheme seperti `javascript:` bukan diselesaikan oleh HTML escaping saja.

### 12.1 Decision Table Encoding

| Output Context | Example | Required Defense |
|---|---|---|
| HTML body text | `<p>DATA</p>` | HTML/XML escaping |
| HTML quoted attribute | `value="DATA"` | Attribute escaping + quote discipline |
| URL query param | `/x?q=DATA` | URL parameter encoding |
| Full URL href | `href="DATA"` | URL validation + attribute escaping |
| JavaScript string | `const x='DATA'` | JavaScript string encoding / JSON serialization |
| JavaScript code | `<script>DATA</script>` | Do not allow untrusted data |
| CSS property | `style="color:DATA"` | Whitelist tokens; avoid free input |
| Raw HTML | `DATA` as markup | Sanitizer allowlist + SafeHtml type |
| HTML comment | `<!-- DATA -->` | Avoid sensitive/untrusted data |

---

## 13. Design Pattern: Secure Rendering Tag Library

Untuk aplikasi besar, jangan berharap semua developer selalu memilih encoding manual yang benar. Bangun internal tag library.

Contoh API:

```jsp
<app:text value="${case.title}" />
<app:attr value="${form.name}" />
<app:url value="${safeUrl}" />
<app:jsString value="${value}" />
<app:jsonScript id="page-model" value="${pageModel}" />
<app:safeHtml value="${announcement.body}" />
```

Tujuannya:

1. Encoding policy terpusat.
2. Review security lebih mudah.
3. Developer tidak perlu mengingat semua nuance context.
4. Bisa menambahkan logging saat raw HTML digunakan.
5. Bisa enforce tipe seperti `SafeHtml`, `SafeUrl`, `PlainText`.

### 13.1 Example: `app:text`

```java
public class TextTag extends SimpleTagSupport {
    private Object value;

    public void setValue(Object value) {
        this.value = value;
    }

    @Override
    public void doTag() throws JspException, IOException {
        String text = value == null ? "" : String.valueOf(value);
        getJspContext().getOut().write(HtmlEscaper.escape(text));
    }
}
```

Ini sederhana, tetapi memberi satu tempat untuk standardisasi.

### 13.2 Example: `app:safeHtml`

```java
public class SafeHtmlTag extends SimpleTagSupport {
    private SafeHtml value;

    public void setValue(SafeHtml value) {
        this.value = value;
    }

    @Override
    public void doTag() throws JspException, IOException {
        if (value == null) {
            return;
        }
        getJspContext().getOut().write(value.asString());
    }
}
```

Tag ini sengaja menerima `SafeHtml`, bukan `String`.

Jika developer mencoba:

```jsp
<app:safeHtml value="${param.body}" />
```

seharusnya gagal type conversion atau ditolak oleh review.

---

## 14. CSRF: Masalah Browser Membawa Session Otomatis

CSRF terjadi karena browser otomatis menyertakan cookie session pada request ke domain yang sesuai.

Jika user sudah login ke `app.example.gov`, lalu membuka situs attacker, situs attacker bisa membuat request:

```html
<form action="https://app.example.gov/case/approve" method="post">
  <input type="hidden" name="caseId" value="CASE-123">
</form>
<script>document.forms[0].submit()</script>
```

Jika endpoint tidak punya proteksi CSRF, server bisa menganggap request sah karena cookie session user ikut terkirim.

### 14.1 CSRF Bukan XSS

XSS menjalankan script di origin aplikasi.

CSRF memanfaatkan browser korban untuk mengirim request authenticated dari origin lain.

Perbedaan:

| Aspek | XSS | CSRF |
|---|---|---|
| Attacker menjalankan JS di aplikasi? | Ya | Tidak perlu |
| Memanfaatkan cookie otomatis? | Bisa | Ya |
| Butuh endpoint state-changing? | Tidak selalu | Ya |
| Mitigasi utama | Output encoding, CSP, sanitization | Token, SameSite, origin checks |

### 14.2 Synchronizer Token Pattern

Pattern umum:

```text
Server generate token unpredictable
  ↓
Token disimpan di session/server-side store
  ↓
JSP render token ke form
  ↓
POST mengirim token
  ↓
Filter/controller validasi token
  ↓
Aksi state-changing diproses jika token valid
```

JSP:

```jsp
<form method="post" action="${pageContext.request.contextPath}/case/approve">
    <input type="hidden" name="_csrf" value="<c:out value='${csrfToken}' />">
    <input type="hidden" name="caseId" value="<c:out value='${caseDetail.id}' />">
    <button type="submit">Approve</button>
</form>
```

Token harus:

- random kuat,
- tidak predictable,
- tied to user/session,
- validated server-side,
- tidak hanya dicek presence-nya,
- rotated sesuai risk model.

### 14.3 Per-Session vs Per-Request Token

| Model | Kelebihan | Kekurangan |
|---|---|---|
| Per-session token | Sederhana, tidak mengganggu back button | Jika bocor, valid lebih lama |
| Per-request token | Window exploit lebih kecil | Bisa merusak multi-tab/back/refresh |
| Per-form/action token | Lebih granular | Lebih kompleks |

Untuk aplikasi enterprise dengan banyak form dan multi-tab, per-session atau per-form token sering lebih praktis daripada per-request token murni.

### 14.4 CSRF untuk AJAX

JSP sering render token ke meta tag:

```jsp
<meta name="csrf-token" content="<c:out value='${csrfToken}' />">
```

JavaScript:

```javascript
const csrf = document.querySelector('meta[name="csrf-token"]').content;

fetch('/case/approve', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrf
  },
  body: JSON.stringify({ caseId: 'CASE-123' })
});
```

Server harus validasi header/token.

### 14.5 Jangan Render CSRF Token ke External Script/Third Party

Jika halaman memuat third-party script, script itu bisa membaca DOM dan meta token jika berjalan di origin halaman. Karena itu, kontrol third-party script sangat penting.

CSP membantu, tetapi CSP bukan pengganti supply-chain governance.

---

## 15. SameSite Cookie: Defense Tambahan, Bukan Satu-Satunya CSRF Defense

Cookie `SameSite` membantu mengurangi pengiriman cookie pada cross-site request.

Mode umum:

| SameSite | Behavior | Catatan |
|---|---|---|
| `Strict` | Cookie tidak dikirim pada cross-site navigation | Aman tapi bisa mengganggu login/link eksternal |
| `Lax` | Cookie dikirim pada top-level safe navigation tertentu | Default modern yang sering praktis |
| `None` | Cookie dikirim cross-site | Harus `Secure`; perlu untuk beberapa SSO/embed flow |

Untuk aplikasi internal/enterprise server-rendered UI, `Lax` sering menjadi baseline masuk akal, dengan CSRF token tetap digunakan untuk state-changing request.

Jangan bergantung hanya pada `SameSite`, karena:

- browser lama/embedded webview bisa berbeda,
- SSO flow bisa butuh exception,
- subdomain/trust boundary bisa kompleks,
- XSS tetap bisa bypass CSRF dengan membaca token dan mengirim request dari same-origin.

---

## 16. Session Security di JSP

JSP mudah membuat session tanpa sadar.

Default JSP historically bisa memiliki session implicit object aktif. Jika page directive tidak menonaktifkan session, akses JSP bisa menyebabkan session creation tergantung container dan penggunaan.

Untuk public page yang tidak perlu session:

```jsp
<%@ page session="false" %>
```

### 16.1 Session Fixation

Session fixation terjadi ketika attacker membuat/menentukan session id, lalu korban login dengan session yang sama.

Mitigasi:

```text
Before login: anonymous session S1
User authenticates
Server changes session id / creates new authenticated session S2
Old session id invalid or no longer useful
```

Di Servlet modern, gunakan mekanisme container/security framework untuk mengganti session id setelah authentication, misalnya `changeSessionId()` jika kamu mengelola login manual.

### 16.2 Cookie Flags

Session cookie harus menggunakan:

```text
HttpOnly
Secure
SameSite appropriate value
Path scoped appropriately
Domain scoped carefully
```

- `HttpOnly`: mengurangi risiko pencurian cookie via JavaScript ketika XSS terjadi.
- `Secure`: cookie hanya dikirim via HTTPS.
- `SameSite`: mengurangi CSRF surface.
- `Domain`: jangan terlalu luas jika subdomain tidak semua trusted.
- `Path`: batasi jika aplikasi multi-context.

### 16.3 Jangan Simpan Sensitive Data Berlebihan di Session

Buruk:

```java
session.setAttribute("currentUser", fullUserEntityWithSecrets);
session.setAttribute("caseDraft", hugeMutableDomainGraph);
session.setAttribute("uploadedDocumentBytes", byteArray);
```

Masalah:

- memory bloat,
- serialization failure,
- replication overhead,
- stale authorization,
- sensitive data exposure via dump/log/debug,
- conflict multi-tab.

Lebih baik:

```text
Session:
- user id
- display name
- roles snapshot or authority reference
- locale
- csrf token
- minimal navigation context

Request/View Model:
- page-specific data
- form-specific data
- validation errors
```

### 16.4 Hidden Field Bukan Tempat Aman

Buruk:

```jsp
<input type="hidden" name="approvedBy" value="${currentUser.id}">
<input type="hidden" name="oldStatus" value="${case.status}">
<input type="hidden" name="newStatus" value="APPROVED">
<input type="hidden" name="role" value="ADMIN">
```

Semua hidden field bisa dimodifikasi user.

Hidden field hanya boleh dipakai untuk data non-sensitive yang server akan validasi ulang.

Lebih baik:

```text
POST /case/CASE-123/approve
Server derives:
- actor from session/security context
- allowed transition from workflow state
- old status from DB
- new status from server-side action definition
```

---

## 17. Authorization-Aware Rendering vs Authorization Enforcement

JSP sering menyembunyikan tombol:

```jsp
<c:if test="${permissions.canApprove}">
    <button type="submit">Approve</button>
</c:if>
```

Ini baik untuk UX, tetapi bukan security enforcement.

Attacker bisa langsung POST:

```text
POST /case/CASE-123/approve
```

Maka server-side controller/service harus tetap memeriksa permission.

Mental model:

```text
JSP rendered=false / c:if permission = UI hint
Controller/service permission check = security boundary
```

### 17.1 Permission View Model

Controller membuat view model:

```java
public record CasePermissionView(
    boolean canView,
    boolean canEdit,
    boolean canApprove,
    boolean canReject,
    boolean canUploadDocument,
    boolean canViewAudit
) {}
```

JSP:

```jsp
<c:if test="${casePage.permissions.canApprove}">
    <form method="post" action="${contextPath}/case/${casePage.caseId}/approve">
        <input type="hidden" name="_csrf" value="<c:out value='${csrfToken}' />">
        <button type="submit">Approve</button>
    </form>
</c:if>
```

Controller/service:

```java
caseAuthorization.assertCanApprove(actor, caseId);
caseWorkflow.approve(caseId, actor);
```

Keduanya perlu.

### 17.2 Jangan Kirim Permission Detail Berlebihan

Jangan render internal role/debug info:

```jsp
<!-- roles=${currentUser.roles}, permissions=${permissions.debugTrace} -->
```

HTML comments bisa dilihat user.

---

## 18. Secure Form Design

Form JSP harus dianggap sebagai input boundary.

### 18.1 Form Action Harus Explicit

Buruk:

```jsp
<form method="post">
```

Browser submit ke current URL. Ini bisa membingungkan untuk nested page, include, atau route yang berubah.

Lebih baik:

```jsp
<form method="post" action="${pageContext.request.contextPath}/case/${casePage.caseId}/approve">
```

### 18.2 POST untuk State-Changing Action

Jangan gunakan GET untuk aksi berubah state:

```jsp
<a href="/case/123/approve">Approve</a>
```

GET bisa dipicu oleh crawler, prefetch, browser history, image tag, link preview.

Gunakan POST:

```jsp
<form method="post" action="${contextPath}/case/123/approve">
    <input type="hidden" name="_csrf" value="...">
    <button type="submit">Approve</button>
</form>
```

### 18.3 Idempotency dan Double Submit

CSRF token bukan otomatis mencegah double submit.

Untuk action sensitif:

```text
User double-click submit
Browser sends two POST requests
Server processes both if not protected
```

Mitigasi:

- server-side idempotency key,
- workflow state guard,
- optimistic locking,
- unique command id,
- disable button hanya sebagai UX, bukan security.

JSP:

```jsp
<input type="hidden" name="commandId" value="<c:out value='${form.commandId}' />">
```

Server:

```text
If commandId already processed for user/form/action → reject/replay safe response
Else process and mark consumed
```

---

## 19. Cache-Control untuk Protected JSP

Protected pages sering berisi:

- user profile,
- case detail,
- audit data,
- financial data,
- documents,
- internal comments.

Browser/proxy caching bisa membocorkan data setelah logout atau pada shared device.

Header umum untuk sensitive authenticated page:

```http
Cache-Control: no-store
Pragma: no-cache
Expires: 0
```

`no-store` adalah sinyal kuat agar response tidak disimpan.

### 19.1 Terapkan di Filter, Bukan Per JSP Manual

Buat filter:

```java
public class SecurityHeadersFilter implements Filter {
    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
        throws IOException, ServletException {

        HttpServletResponse http = (HttpServletResponse) response;
        http.setHeader("Cache-Control", "no-store");
        http.setHeader("Pragma", "no-cache");
        http.setDateHeader("Expires", 0);
        chain.doFilter(request, response);
    }
}
```

Tetapi jangan apply `no-store` secara buta ke static assets, karena akan merusak performance. Pisahkan:

```text
/static/*             → cacheable with versioned filenames
/WEB-INF/jsp/* pages  → no-store if authenticated/sensitive
/api/private/*        → no-store if sensitive
```

---

## 20. Security Headers untuk Server-Rendered UI

Security headers tidak memperbaiki bad rendering, tetapi memberi layer tambahan.

### 20.1 Content-Security-Policy

CSP membatasi sumber script/style/image/frame dan dapat mengurangi dampak XSS.

Baseline ketat:

```http
Content-Security-Policy: default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
```

Tantangan JSP legacy:

- banyak inline `<script>`,
- inline `style`,
- inline event handler `onclick`,
- third-party library via CDN,
- generated script block dari JSP.

Maka CSP migration perlu bertahap:

1. Inventory inline scripts.
2. Pindahkan inline JS ke external static file.
3. Ganti inline event handler dengan event listener.
4. Gunakan nonce untuk script yang benar-benar perlu inline.
5. Aktifkan `Content-Security-Policy-Report-Only` terlebih dahulu.
6. Pantau violation report.
7. Baru enforce.

### 20.2 X-Frame-Options dan `frame-ancestors`

Untuk mencegah clickjacking:

```http
X-Frame-Options: DENY
```

atau via CSP:

```http
Content-Security-Policy: frame-ancestors 'none'
```

Jika halaman memang harus di-embed oleh domain tertentu:

```http
Content-Security-Policy: frame-ancestors 'self' https://portal.example.gov
```

### 20.3 X-Content-Type-Options

```http
X-Content-Type-Options: nosniff
```

Mencegah browser melakukan MIME sniffing yang bisa membuat response diperlakukan sebagai script/style berbeda dari intended content type.

### 20.4 Referrer-Policy

```http
Referrer-Policy: strict-origin-when-cross-origin
```

atau untuk aplikasi sangat sensitif:

```http
Referrer-Policy: no-referrer
```

Jangan sampai URL dengan case id/token/query sensitive terkirim sebagai referrer ke domain eksternal.

### 20.5 Permissions-Policy

Batasi fitur browser yang tidak diperlukan:

```http
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

Untuk aplikasi internal biasa, banyak fitur bisa dimatikan.

---

## 21. Error Page Security

JSP error page sering bocor informasi.

Buruk:

```jsp
<%@ page isErrorPage="true" %>
<h1>Error</h1>
<pre>${exception}</pre>
<pre><%= exception.getStackTrace() %></pre>
```

Masalah:

- class/package internal bocor,
- SQL/table/column bocor,
- path server bocor,
- token/header bisa bocor,
- attacker mendapat insight.

Lebih baik:

```jsp
<h1>Something went wrong</h1>
<p>Please contact support with reference id: <c:out value="${correlationId}" /></p>
```

Log server:

```text
ERROR correlationId=abc123 userId=U123 path=/case/123 exception=...
```

User melihat reference id; engineer melihat log detail.

### 21.1 Status Code Harus Benar

Jangan render error sebagai HTTP 200.

```text
404 → not found
403 → forbidden
400 → bad request
500 → internal error
```

Security impact:

- cache behavior,
- monitoring,
- crawler behavior,
- client-side handling,
- audit trail.

---

## 22. File Download Links

JSP sering render link download:

```jsp
<a href="/document/download?id=${doc.id}">Download</a>
```

Risiko:

- IDOR/BOLA,
- predictable id,
- authorization bypass,
- filename injection,
- content type sniffing,
- caching sensitive documents.

### 22.1 Server-Side Authorization Required

JSP boleh menyembunyikan link:

```jsp
<c:if test="${doc.canDownload}">
    <a href="${doc.downloadUrl}">Download</a>
</c:if>
```

Tetapi endpoint wajib check:

```java
documentAuthorization.assertCanDownload(actor, documentId);
```

### 22.2 Content-Disposition Aman

Filename dari user harus dibersihkan:

```http
Content-Disposition: attachment; filename="report.pdf"; filename*=UTF-8''report.pdf
Content-Type: application/pdf
X-Content-Type-Options: nosniff
Cache-Control: no-store
```

Jangan masukkan raw filename ke header tanpa sanitasi.

---

## 23. HTML Comments dan Debug Data

JSP legacy sering punya:

```jsp
<!-- user=${currentUser}, roles=${roles}, sql=${query}, env=${env} -->
```

HTML comment dikirim ke browser. Itu bukan comment server-side.

Jangan pernah render:

- SQL,
- stack trace,
- JWT,
- session id,
- CSRF token di comment,
- internal role mapping,
- feature flag debug,
- PII,
- authorization decision trace.

Gunakan server-side JSP comment untuk hal yang tidak dikirim:

```jsp
<%-- This comment is not sent to browser --%>
```

Namun tetap jangan taruh secret di source code comment.

---

## 24. Sensitive Data di JavaScript Global

Buruk:

```jsp
<script>
  window.currentUser = {
    id: '${user.id}',
    email: '${user.email}',
    roles: '${user.roles}',
    token: '${accessToken}',
    permissionsDebug: '${permissionsDebug}'
  };
</script>
```

Masalah:

- semua script di halaman bisa membaca,
- browser extension bisa membaca,
- XSS kecil menjadi data exfiltration besar,
- data tersimpan di page source/devtools/memory.

Lebih baik render hanya data minimum untuk UI:

```json
{
  "displayName": "Fajar",
  "locale": "id-ID",
  "features": {
    "newCaseSearch": true
  }
}
```

Jangan render bearer token ke JSP jika tidak perlu. Untuk server-rendered UI, server biasanya bisa memanggil backend sendiri tanpa expose token ke browser.

---

## 25. CSP Migration untuk JSP Legacy

Aplikasi JSP lama biasanya penuh inline script:

```jsp
<button onclick="submitForm('${id}')">Submit</button>
<script>
  var contextPath = '${pageContext.request.contextPath}';
</script>
```

CSP ketat akan gagal.

### 25.1 Migration Plan

Langkah realistis:

1. Tambahkan `Content-Security-Policy-Report-Only`.
2. Kumpulkan violation selama beberapa minggu/sprint.
3. Klasifikasi inline script:
   - config data,
   - event handler,
   - page initialization,
   - third-party script,
   - legacy library.
4. Pindahkan event handler ke external JS.
5. Pindahkan config ke JSON script tag atau `data-*` attributes.
6. Gunakan nonce untuk inline script yang benar-benar tidak bisa dipindahkan.
7. Hapus `unsafe-inline` secara bertahap.
8. Enforce CSP.

### 25.2 Example Refactor

Before:

```jsp
<button onclick="approve('${caseId}')">Approve</button>
```

After:

```jsp
<button class="js-approve" data-case-id="<c:out value='${caseId}' />">Approve</button>
<script src="${contextPath}/static/js/case-actions.js"></script>
```

External JS:

```javascript
document.addEventListener('click', function (event) {
  const button = event.target.closest('.js-approve');
  if (!button) return;
  approve(button.dataset.caseId);
});
```

---

## 26. Security Filter Architecture

JSP security should not be scattered across pages.

Gunakan filter chain:

```text
Request
  ↓
CorrelationIdFilter
  ↓
SecurityHeadersFilter
  ↓
AuthenticationFilter / Container Security
  ↓
CsrfFilter
  ↓
AuthorizationFilter or Controller Security
  ↓
Controller
  ↓
JSP
```

### 26.1 SecurityHeadersFilter

```java
public class SecurityHeadersFilter implements Filter {
    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {

        HttpServletResponse response = (HttpServletResponse) res;

        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
        response.setHeader("X-Frame-Options", "DENY");
        response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

        // For authenticated sensitive pages; static resources should be excluded or handled separately.
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Pragma", "no-cache");
        response.setDateHeader("Expires", 0);

        chain.doFilter(req, res);
    }
}
```

### 26.2 CSP Nonce Filter

If using nonce:

```java
public class CspNonceFilter implements Filter {
    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest request = (HttpServletRequest) req;
        HttpServletResponse response = (HttpServletResponse) res;

        String nonce = NonceGenerator.secureBase64();
        request.setAttribute("cspNonce", nonce);

        response.setHeader(
            "Content-Security-Policy",
            "default-src 'self'; " +
            "script-src 'self' 'nonce-" + nonce + "'; " +
            "object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
        );

        chain.doFilter(req, res);
    }
}
```

JSP:

```jsp
<script nonce="<c:out value='${cspNonce}' />">
  // minimal inline script only if necessary
</script>
```

Nonce harus unik per response dan tidak boleh predictable.

---

## 27. CSRF Filter: Conceptual Implementation

Contoh sederhana untuk form POST:

```java
public class CsrfFilter implements Filter {
    private static final String SESSION_TOKEN = "CSRF_TOKEN";
    private static final String PARAM_TOKEN = "_csrf";
    private static final String HEADER_TOKEN = "X-CSRF-Token";

    @Override
    public void doFilter(ServletRequest req, ServletResponse res, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest request = (HttpServletRequest) req;
        HttpServletResponse response = (HttpServletResponse) res;

        HttpSession session = request.getSession(false);
        if (session == null) {
            chain.doFilter(req, res);
            return;
        }

        String token = (String) session.getAttribute(SESSION_TOKEN);
        if (token == null) {
            token = SecureToken.generate();
            session.setAttribute(SESSION_TOKEN, token);
        }

        request.setAttribute("csrfToken", token);

        if (isStateChanging(request)) {
            String submitted = firstNonBlank(
                request.getParameter(PARAM_TOKEN),
                request.getHeader(HEADER_TOKEN)
            );

            if (!constantTimeEquals(token, submitted)) {
                response.sendError(HttpServletResponse.SC_FORBIDDEN);
                return;
            }
        }

        chain.doFilter(req, res);
    }

    private boolean isStateChanging(HttpServletRequest request) {
        String method = request.getMethod();
        return "POST".equals(method) || "PUT".equals(method)
            || "PATCH".equals(method) || "DELETE".equals(method);
    }
}
```

Production version harus mempertimbangkan:

- login/logout endpoint,
- multipart form,
- API JSON,
- token rotation,
- same-origin check,
- error UX,
- stateless vs stateful endpoint,
- exclusion untuk webhook/public callback,
- audit logging untuk CSRF failure.

---

## 28. Multipart Upload Forms

JSP upload form:

```jsp
<form method="post" enctype="multipart/form-data" action="${contextPath}/document/upload">
    <input type="hidden" name="_csrf" value="<c:out value='${csrfToken}' />">
    <input type="file" name="file">
    <button type="submit">Upload</button>
</form>
```

Security concern:

- CSRF still applies.
- File type validation must be server-side.
- Extension is not enough.
- Content-Type from browser is not trusted.
- Filename is not trusted.
- File size must be limited.
- Malware scanning may be required.
- Store outside web root.
- Download endpoint must authorize.

JSP hanya rendering. Enforcement tetap di upload controller/service.

---

## 29. Safe Menu Rendering

Menu sering role-based:

```jsp
<c:if test="${nav.canAccessAdmin}">
    <a href="${contextPath}/admin">Admin</a>
</c:if>
```

Baik untuk UX.

Tapi jangan lakukan permission logic kompleks langsung di JSP:

```jsp
<c:if test="${user.role == 'ADMIN' || user.department == case.department && case.status != 'CLOSED'}">
```

Masalah:

- duplikasi business rule,
- precedence bug,
- impossible to audit,
- inconsistent with backend enforcement.

Lebih baik:

```java
NavView nav = navigationService.buildFor(actor);
request.setAttribute("nav", nav);
```

JSP:

```jsp
<c:forEach var="item" items="${nav.items}">
    <c:if test="${item.visible}">
        <a href="<c:out value='${item.href}' />"><c:out value="${item.label}" /></a>
    </c:if>
</c:forEach>
```

Server endpoint tetap enforce.

---

## 30. Case Study: Regulatory Case Detail Page

Bayangkan halaman:

```text
/case/CASE-2026-001
```

Data yang tampil:

- case title,
- applicant name,
- status,
- assigned officer,
- internal remarks,
- uploaded documents,
- action buttons,
- audit history.

### 30.1 View Model

```java
public record CaseDetailPage(
    String caseId,
    String title,
    String applicantName,
    String statusLabel,
    List<DocumentRow> documents,
    List<ActionButton> actions,
    CasePermissionView permissions,
    String correlationId
) {}
```

### 30.2 JSP Rendering

```jsp
<h1><c:out value="${page.title}" /></h1>

<p>
    Applicant:
    <strong><c:out value="${page.applicantName}" /></strong>
</p>

<p>
    Status:
    <span class="status"><c:out value="${page.statusLabel}" /></span>
</p>

<c:if test="${page.permissions.canViewDocuments}">
    <h2>Documents</h2>
    <ul>
        <c:forEach var="doc" items="${page.documents}">
            <li>
                <a href="<c:out value='${doc.downloadUrl}' />">
                    <c:out value="${doc.fileName}" />
                </a>
            </li>
        </c:forEach>
    </ul>
</c:if>

<c:forEach var="action" items="${page.actions}">
    <form method="post" action="<c:out value='${action.postUrl}' />">
        <input type="hidden" name="_csrf" value="<c:out value='${csrfToken}' />">
        <input type="hidden" name="commandId" value="<c:out value='${action.commandId}' />">
        <button type="submit"><c:out value="${action.label}" /></button>
    </form>
</c:forEach>
```

### 30.3 Server Enforcement

For `approve` action:

```java
public void approve(String caseId, Actor actor, String commandId) {
    idempotency.assertNotProcessed(actor.id(), commandId);
    authorization.assertCanApprove(actor, caseId);

    CaseRecord record = caseRepository.findForUpdate(caseId);
    workflow.assertTransitionAllowed(record.status(), APPROVED, actor);

    record.approve(actor);
    caseRepository.save(record);
    audit.log(actor, caseId, "APPROVE");
    idempotency.markProcessed(actor.id(), commandId);
}
```

Security invariant:

```text
If button is visible, action should probably be allowed.
If button is hidden, action must still be denied server-side.
If button is forged, server must reject based on authorization/state/idempotency/CSRF.
```

---

## 31. JSP Security Review Method

Saat mereview JSP legacy, jangan baca file dari atas ke bawah saja. Gunakan data-flow review.

### 31.1 Step 1 — Identify Sources

Cari semua sumber data:

```text
${param.*}
${header.*}
${cookie.*}
${requestScope.*}
${sessionScope.*}
${applicationScope.*}
model attributes
DB-loaded fields
external API fields
uploaded filenames
localized messages
feature flags
```

### 31.2 Step 2 — Identify Sinks

Cari semua output sink:

```text
HTML body
HTML attributes
href/src/action
script block
inline event handlers
style attributes
style blocks
raw HTML escapeXml=false
HTML comments
hidden fields
meta tags
HTTP redirects
headers
```

### 31.3 Step 3 — Match Encoder to Sink

Untuk setiap source → sink, tanya:

```text
Apakah data trusted?
Apakah context-nya apa?
Encoding/validation apa yang terjadi?
Apakah escaping dimatikan?
Apakah raw HTML typed as SafeHtml?
Apakah URL scheme/host divalidasi?
```

### 31.4 Step 4 — Review Flow Protection

Untuk setiap form/action:

```text
Apakah method POST untuk state-changing action?
Apakah ada CSRF token?
Apakah endpoint validate token?
Apakah server enforce permission?
Apakah action idempotent?
Apakah old/new state divalidasi server-side?
```

### 31.5 Step 5 — Review State

```text
Apakah sensitive data disimpan di session?
Apakah hidden field dipercaya?
Apakah session id rotated after login?
Apakah protected page no-store?
Apakah cookie flags benar?
```

### 31.6 Step 6 — Review Headers

```text
CSP?
Frame protection?
Nosniff?
Referrer-Policy?
Cache-Control?
Cookie flags?
```

---

## 32. Common Vulnerable Patterns and Refactor

### 32.1 Raw Parameter in HTML

Bad:

```jsp
<p>${param.message}</p>
```

Better:

```jsp
<p><c:out value="${param.message}" /></p>
```

Best:

```text
Controller validates/normalizes message code.
JSP renders localized message by code.
```

---

### 32.2 Raw Parameter in Redirect Link

Bad:

```jsp
<a href="${param.next}">Continue</a>
```

Better:

```java
SafeUrl next = redirectService.resolveSafeInternalUrl(request.getParameter("next"));
request.setAttribute("next", next);
```

```jsp
<a href="<c:out value='${next.href}' />">Continue</a>
```

---

### 32.3 Inline JavaScript with EL

Bad:

```jsp
<script>
  alert('${message}');
</script>
```

Better:

```jsp
<div id="message" data-text="<c:out value='${message}' />"></div>
<script src="${contextPath}/static/js/message.js"></script>
```

---

### 32.4 Hidden Field Trusted as Authority

Bad:

```jsp
<input type="hidden" name="userId" value="${currentUser.id}">
```

Better:

```text
Server derives user from authenticated security context.
```

---

### 32.5 `escapeXml=false`

Bad:

```jsp
<c:out value="${article.body}" escapeXml="false" />
```

Better:

```jsp
<app:safeHtml value="${article.safeBody}" />
```

---

### 32.6 Authorization Logic in JSP

Bad:

```jsp
<c:if test="${user.role == 'ADMIN' || user.id == case.assigneeId}">
    <a href="/case/${case.id}/edit">Edit</a>
</c:if>
```

Better:

```jsp
<c:if test="${page.permissions.canEdit}">
    <a href="<c:out value='${page.editUrl}' />">Edit</a>
</c:if>
```

Endpoint still enforces.

---

## 33. Production Observability for JSP Security

Security yang baik perlu observability.

Log event:

```text
CSRF validation failure
Forbidden action attempt
Invalid view/form command id
Suspicious URL parameter rejected
Raw HTML sanitizer rejection
Open redirect attempt
Large/invalid input rejected
Repeated validation failure
Session rotation after login
Logout/session invalidation
```

Log harus berisi:

```text
correlationId
actorId if authenticated
session marker/hash, not raw session id
client ip / forwarded chain if trusted
user agent
path
action
reason code
```

Jangan log:

```text
raw password
raw token
full session id
full CSRF token
sensitive document content
PII unnecessarily
```

### 33.1 Metrics

```text
csrf_failures_total
forbidden_actions_total
xss_sanitizer_rejections_total
open_redirect_rejections_total
session_created_total
session_invalidated_total
view_render_error_total
security_header_missing_total
```

Metrics membantu mendeteksi regression dan attack attempt.

---

## 34. Testing JSP Security

### 34.1 Rendering Test for XSS

Test input:

```text
<script>alert(1)</script>
"><img src=x onerror=alert(1)>
';alert(1);//
javascript:alert(1)
</textarea><script>alert(1)</script>
```

Assertion:

```text
HTML output must not contain executable script.
Dangerous characters must be encoded in correct context.
URL schemes must be rejected/normalized.
```

### 34.2 CSRF Test

```text
POST without token → 403
POST with wrong token → 403
POST with valid token → allowed if permission OK
GET state-changing endpoint → not allowed or no state change
```

### 34.3 Authorization Test

```text
User without permission:
- button not visible in JSP
- direct POST rejected server-side
```

### 34.4 Cache Header Test

For protected page:

```text
Cache-Control includes no-store
No sensitive page response cacheable by shared proxy
```

### 34.5 Security Header Test

```text
CSP present
frame protection present
nosniff present
referrer policy present
cookie flags present
```

---

## 35. Java 8 sampai Java 25: Dampak Security Praktis

### 35.1 Java 8 Legacy

Banyak aplikasi Java 8 masih memakai:

- `javax.servlet`,
- JSP 2.x,
- JSTL 1.2,
- JSF 2.x,
- older Spring Security,
- older app servers.

Risiko:

- old dependencies,
- old default cookie behavior,
- weak CSP adoption,
- many scriptlet JSP,
- outdated sanitizer libraries.

### 35.2 Java 11/17 Transition

Ketika upgrade:

- dependency cleanup,
- TLS defaults berubah,
- reflection/module warnings,
- container upgrade,
- opportunity untuk add security headers.

### 35.3 Java 21/25 Modern Runtime

Untuk JSP sendiri, virtual threads bukan otomatis membuat JSP secure. Tetapi modern runtime memberi kesempatan:

- upgrade Jakarta stack,
- remove unsupported libraries,
- use modern security framework,
- stronger observability,
- structured concurrency pada backend calls jika relevan,
- better container support.

Security migration harus diperlakukan sebagai bagian dari platform modernization, bukan “nanti setelah compile”.

---

## 36. Migration Notes: `javax.*` ke `jakarta.*`

Security code juga terdampak namespace migration.

Old:

```java
import javax.servlet.Filter;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;
```

New:

```java
import jakarta.servlet.Filter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
```

Taglib URI juga berubah untuk Jakarta Tags 3.x:

```jsp
<%@ taglib prefix="c" uri="jakarta.tags.core" %>
<%@ taglib prefix="fmt" uri="jakarta.tags.fmt" %>
```

Legacy:

```jsp
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>
```

Migration checklist:

```text
Filter imports migrated
Security framework compatible with Jakarta namespace
Taglib URI updated
Custom tag handlers migrated
TLD class names migrated
web.xml schema/version migrated
Container supports target Jakarta EE version
Cookie/session config revalidated
CSP/security headers regression tested
CSRF filter still intercepts correct paths
```

---

## 37. Top 1% Mental Model: Security Invariants

Untuk menjadi engineer yang kuat, hafalan tag tidak cukup. Kamu perlu invariants.

### 37.1 Rendering Invariant

```text
Every untrusted value must be encoded for the exact browser context where it is rendered.
```

### 37.2 Authority Invariant

```text
The server never trusts the browser to declare identity, role, permission, old state, or next state.
```

### 37.3 Flow Invariant

```text
Every state-changing action requires intentional user-originated request proof, usually CSRF token plus server-side permission check.
```

### 37.4 State Invariant

```text
Session stores minimal state; hidden fields are transport only, never authority.
```

### 37.5 Raw HTML Invariant

```text
Raw HTML is not a string; it is a privileged typed artifact produced only by a sanitizer or trusted system template.
```

### 37.6 Visibility Invariant

```text
View visibility improves UX; endpoint authorization provides security.
```

### 37.7 Header Invariant

```text
Security headers are default platform behavior, not optional per-page decoration.
```

---

## 38. Practical Checklist for JSP Page Review

Gunakan checklist ini saat review PR JSP:

### Output Encoding

- [ ] Semua text user/domain dirender via `c:out` atau secure tag.
- [ ] Tidak ada `${param.*}` langsung ke output.
- [ ] Attribute values di-encode.
- [ ] URL parameter dibuat via `c:url`/builder aman.
- [ ] Full URL eksternal divalidasi scheme/host.
- [ ] Tidak ada user data di inline JavaScript tanpa JS/JSON encoding.
- [ ] Tidak ada user data di inline CSS tanpa whitelist.
- [ ] Tidak ada `escapeXml="false"` kecuali typed `SafeHtml`.

### Forms and CSRF

- [ ] State-changing action memakai POST/PUT/PATCH/DELETE, bukan GET.
- [ ] CSRF token dirender di semua form state-changing.
- [ ] AJAX state-changing mengirim token.
- [ ] Server memvalidasi token.
- [ ] Ada idempotency/concurrency guard untuk action sensitif.

### Authorization

- [ ] Tombol/link disembunyikan berdasarkan permission view model.
- [ ] Endpoint tetap enforce permission.
- [ ] Workflow transition divalidasi server-side.
- [ ] Hidden field tidak dipercaya sebagai authority.

### Session

- [ ] Public JSP memakai `session="false"` jika tidak butuh session.
- [ ] Session id diganti setelah login.
- [ ] Session cookie `HttpOnly`, `Secure`, `SameSite` sesuai.
- [ ] Session tidak menyimpan object besar/sensitif tanpa alasan.

### Headers

- [ ] Protected page `Cache-Control: no-store`.
- [ ] CSP ada atau ada migration plan.
- [ ] Frame protection ada.
- [ ] `X-Content-Type-Options: nosniff`.
- [ ] Referrer policy ada.

### Error and Debug

- [ ] Error page tidak menampilkan stack trace.
- [ ] HTML comment tidak berisi debug/sensitive data.
- [ ] Correlation id ditampilkan untuk support, detail di log.

---

## 39. Anti-Pattern yang Harus Cepat Dikenali

1. `${param.x}` langsung di HTML.
2. `escapeXml="false"` tanpa tipe `SafeHtml`.
3. Inline `onclick="do('${value}')"`.
4. Form state-changing tanpa CSRF token.
5. Link GET untuk approve/delete/cancel.
6. Hidden field berisi role/status/price/owner yang dipercaya server.
7. Authorization rule ditulis langsung di JSP.
8. Stack trace di error JSP.
9. Access token dirender ke JavaScript global.
10. Full external URL dari parameter langsung ke `href` atau redirect.
11. Session menyimpan full entity graph.
12. Protected page tanpa `no-store`.
13. CSP tidak mungkin diterapkan karena seluruh halaman inline script.
14. File download endpoint hanya mengandalkan link visibility.
15. HTML comments berisi SQL/debug/role.

---

## 40. Mini Exercise

### Exercise 1 — Identify Issues

```jsp
<h1>${param.title}</h1>

<script>
  var userName = '${user.name}';
</script>

<c:if test="${user.role == 'MANAGER'}">
  <a href="/case/${case.id}/approve">Approve</a>
</c:if>

<c:out value="${announcement.body}" escapeXml="false" />

<form method="post" action="/case/update">
  <input type="hidden" name="userId" value="${user.id}">
  <input type="hidden" name="status" value="${case.status}">
  <input name="comment" value="${param.comment}">
  <button type="submit">Save</button>
</form>
```

Issues:

1. `${param.title}` raw reflected XSS.
2. `user.name` inside JavaScript string without JS encoding.
3. Approve uses GET for state-changing action.
4. Authorization is only UI-side and role logic is in JSP.
5. Raw HTML with `escapeXml=false` without SafeHtml contract.
6. No CSRF token in POST form.
7. Hidden `userId` and `status` can be tampered.
8. Attribute `value="${param.comment}"` not explicitly encoded.

### Exercise 2 — Safer Version

```jsp
<h1><c:out value="${page.title}" /></h1>

<script type="application/json" id="page-model">
<c:out value="${pageModelJson}" />
</script>
<script src="${contextPath}/static/js/page.js"></script>

<c:if test="${page.permissions.canApprove}">
  <form method="post" action="<c:out value='${page.approveUrl}' />">
    <input type="hidden" name="_csrf" value="<c:out value='${csrfToken}' />">
    <input type="hidden" name="commandId" value="<c:out value='${page.approveCommandId}' />">
    <button type="submit">Approve</button>
  </form>
</c:if>

<app:safeHtml value="${announcement.safeBody}" />

<form method="post" action="<c:out value='${page.updateUrl}' />">
  <input type="hidden" name="_csrf" value="<c:out value='${csrfToken}' />">
  <input type="hidden" name="commandId" value="<c:out value='${page.updateCommandId}' />">
  <input name="comment" value="<c:out value='${form.comment}' />">
  <button type="submit">Save</button>
</form>
```

Server still must:

```text
- validate CSRF
- derive actor from security context
- load case from DB
- check permission
- validate allowed transition
- validate input
- apply optimistic locking/idempotency
- audit action
```

---

## 41. Ringkasan

JSP security bukan sekadar “pakai `c:out`”. `c:out` adalah bagian penting, tetapi security JSP yang matang membutuhkan model lebih luas:

1. Browser memiliki banyak parsing context.
2. Output encoding harus context-aware.
3. Raw HTML harus typed dan sanitized.
4. URL harus divalidasi, bukan hanya di-escape.
5. JavaScript data harus diserialisasi/di-encode dengan benar.
6. Form state-changing perlu CSRF token.
7. Hidden field tidak boleh dipercaya.
8. Menu/button visibility bukan authorization.
9. Session harus minimal dan cookie harus hardened.
10. Protected page butuh cache-control.
11. Security headers harus default platform behavior.
12. Error page tidak boleh membocorkan detail internal.
13. Observability diperlukan untuk mendeteksi abuse dan regression.

Mental model akhir:

```text
Secure JSP = explicit data ownership + context-aware rendering + server-side enforcement + hardened session + safe browser policy.
```

Jika kamu bisa membaca JSP dari perspektif data-flow, parser context, state transition, dan authority boundary, kamu tidak lagi hanya menjadi developer yang “bisa JSP”. Kamu menjadi engineer yang mampu menjaga sistem server-rendered enterprise tetap aman, predictable, dan defensible.

---

## 42. Referensi

- Jakarta Server Pages 4.0 Specification — https://jakarta.ee/specifications/pages/4.0/jakarta-server-pages-spec-4.0
- Jakarta Standard Tag Library 3.0 Specification — https://jakarta.ee/specifications/tags/3.0/
- Jakarta Servlet 6.0 Specification — https://jakarta.ee/specifications/servlet/6.0/jakarta-servlet-spec-6.0
- Jakarta Servlet 6.1 `Cookie` API — https://jakarta.ee/specifications/servlet/6.1/apidocs/jakarta.servlet/jakarta/servlet/http/cookie
- OWASP Cross Site Scripting Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
- OWASP Cross-Site Request Forgery Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- OWASP Top Ten Web Application Security Risks — https://owasp.org/www-project-top-ten/

---

## 43. Status Seri

Seri **belum selesai**.

Bagian berikutnya:

```text
12-jsp-performance-operations-compilation-buffering-caching-diagnostics.md
```
