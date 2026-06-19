# learn-java-template-freemarker-thymeleaf-rendering-engineering-part-008

# Part 8 — FreeMarker Output Formats, Auto-Escaping, XSS Defense, and HTML Safety

> Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`  
> Fokus: Java 8–25, FreeMarker 2.3.x, server-side rendering, email/document generation, production security  
> Posisi: lanjutan dari Part 7 tentang object wrapping dan security boundary  
> Target: mampu mendesain rendering FreeMarker yang aman terhadap XSS, unsafe HTML, context confusion, double escaping, raw markup leakage, dan template misuse.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Memahami kenapa escaping bukan sekadar “replace `<` jadi `&lt;`”.
2. Membedakan output context: HTML text, HTML attribute, JavaScript string, CSS, URL, XML, plain text.
3. Memahami FreeMarker output format dan auto-escaping sebagai mekanisme safety boundary.
4. Menjelaskan perbedaan string biasa dan markup output value di FreeMarker.
5. Menghindari jebakan `?no_esc`, `?html`, `?xml`, raw HTML, dan inline JavaScript.
6. Mendesain template policy yang aman untuk aplikasi enterprise.
7. Membuat rendering pipeline yang aman untuk HTML page, email HTML, XML, dan text output.
8. Memahami hubungan antara output escaping, sanitization, CSP, response header, dan authorization.
9. Menentukan kapan konten HTML user-generated boleh dirender dan bagaimana mengamankannya.
10. Membuat checklist review template yang bisa dipakai di code review dan security review.

---

## 2. Core Mental Model

Template engine mengambil data dari aplikasi dan menaruhnya ke output.

Secara abstrak:

```text
Application Data + Template + Output Context = Rendered Artifact
```

Namun yang sering dilupakan adalah bagian `Output Context`.

Nilai yang sama bisa aman di satu tempat, tetapi berbahaya di tempat lain.

Contoh data:

```text
Alice <script>alert(1)</script>
```

Jika dimasukkan ke HTML body sebagai teks, output harus menjadi:

```html
Alice &lt;script&gt;alert(1)&lt;/script&gt;
```

Tetapi jika dimasukkan ke JavaScript string:

```html
<script>
  const name = "Alice <script>alert(1)</script>";
</script>
```

maka HTML escaping saja tidak cukup. Browser sedang berada di konteks JavaScript, bukan hanya konteks HTML text.

Top 1% mental model:

> Escaping adalah transformasi berdasarkan parser yang akan membaca output, bukan berdasarkan asal data.

Artinya pertanyaan yang benar bukan:

```text
Apakah data ini dari user?
```

Tetapi:

```text
Data ini akan dibaca oleh parser apa, di posisi sintaks apa, dengan aturan delimiter apa?
```

Browser tidak membaca HTML sebagai satu bahasa. Browser berpindah context:

```text
HTML parser
  -> attribute parser
  -> URL parser
  -> JavaScript parser
  -> CSS parser
  -> entity decoder
  -> DOM construction
```

Karena itu, satu escape function tidak bisa aman untuk semua konteks.

---

## 3. Rendering Security Boundary

Template rendering adalah boundary keamanan karena ia mengubah data menjadi instruksi/markup yang akan dieksekusi atau ditafsirkan oleh consumer.

Consumer bisa berupa:

1. Browser.
2. Email client.
3. XML parser.
4. PDF renderer.
5. Shell/config parser.
6. Java compiler jika output berupa generated source code.
7. Human reviewer jika output berupa legal document.

Dalam Part 8 ini fokus utama adalah HTML/XML/browser safety.

Tetapi prinsipnya berlaku umum:

```text
Never place untrusted data into executable/interpretable syntax without context-correct encoding.
```

Output FreeMarker bisa berupa HTML, XML, JSON-like text, email, plain text, atau config. Tiap output punya grammar dan delimiter sendiri.

---

## 4. XSS: Masalah Output, Bukan Sekadar Input

XSS atau Cross-Site Scripting terjadi ketika attacker bisa membuat browser victim menjalankan script yang tidak seharusnya dijalankan.

Bentuk umum:

1. Reflected XSS.
2. Stored XSS.
3. DOM-based XSS.
4. Mutation XSS.
5. HTML injection yang berubah menjadi script execution melalui event handler, URL scheme, SVG, atau parser quirk.

Kesalahan berpikir umum:

```text
“Sudah validate input, berarti aman.”
```

Input validation penting, tetapi tidak cukup.

Contoh nama orang valid secara domain mungkin mengandung karakter apostrophe:

```text
O'Connor
```

Jika output ditaruh ke JavaScript string dengan delimiter `'`, maka apostrophe menjadi karakter sintaks penting.

Contoh lain:

```text
ACME <Research>
```

Untuk nama organisasi, karakter `<` bisa saja muncul sebagai teks legal, tetapi jika tidak di-escape dalam HTML, browser menganggapnya markup.

Maka XSS prevention yang benar adalah kombinasi:

```text
Input validation + output encoding + safe template policy + sanitization untuk rich HTML + response headers + CSP + testing
```

Namun pusat kontrolnya tetap:

```text
context-aware output encoding
```

---

## 5. FreeMarker Output Format: Konsep Penting

FreeMarker modern memiliki konsep `output_format` dan auto-escaping.

Secara sederhana:

```text
Output format = jenis output yang sedang dihasilkan oleh template/section template.
```

Contoh output format:

1. HTML.
2. XML.
3. XHTML.
4. RTF.
5. Plain text.
6. Undefined/custom.

Jika output format mendukung escaping, FreeMarker bisa melakukan auto-escaping untuk interpolation.

Contoh:

```ftl
<#ftl output_format="HTML" auto_esc=true>
<p>Hello ${user.name}</p>
```

Jika `user.name` berisi:

```text
Alice <Admin>
```

maka output menjadi:

```html
<p>Hello Alice &lt;Admin&gt;</p>
```

FreeMarker melihat `${user.name}` sebagai plain string yang akan masuk ke HTML output format, sehingga karakter HTML-sensitive di-escape.

---

## 6. Auto-Escaping: Apa yang Dilakukan dan Tidak Dilakukan

Auto-escaping berarti FreeMarker secara otomatis melakukan escaping pada nilai string ketika nilai itu di-output melalui interpolation dalam output format yang mendukung escaping.

Contoh aman:

```ftl
<#ftl output_format="HTML" auto_esc=true>
<div>${message}</div>
```

Jika:

```java
model.put("message", "<script>alert(1)</script>");
```

maka output:

```html
<div>&lt;script&gt;alert(1)&lt;/script&gt;</div>
```

Namun auto-escaping tidak berarti semua konteks browser aman.

Auto-escaping HTML aman untuk HTML text dan banyak attribute normal, tetapi tidak otomatis menyelesaikan semua kasus seperti:

1. Inline JavaScript expression.
2. Inline CSS.
3. URL scheme validation.
4. Raw HTML rendering.
5. User-generated rich text.
6. Dangerous attributes seperti event handler.
7. Template-controlled context switching yang salah.

Contoh bermasalah:

```ftl
<#ftl output_format="HTML" auto_esc=true>
<script>
  const name = '${user.name}';
</script>
```

HTML escaping tidak sama dengan JavaScript string escaping.

Jika `user.name` mengandung:

```text
'; alert(1); //
```

HTML escaping tidak otomatis mengubah `'` menjadi escape JavaScript yang benar dalam semua situasi.

Template ini salah desain.

Lebih aman:

```ftl
<script type="application/json" id="page-data">
${pageDataJson?no_esc}
</script>
```

Tetapi hanya jika `pageDataJson` dibuat oleh JSON serializer yang aman di Java, bukan hasil concat manual.

Bahkan untuk `application/json` embedded di HTML, perlu memperhatikan sequence seperti `</script>` agar tidak menutup script tag. Solusi yang lebih defensible adalah menaruh data JSON di endpoint terpisah, atau memakai encoder JSON yang memang aman untuk HTML embedding.

---

## 7. Markup Output Value: String Biasa vs Markup Aman

FreeMarker membedakan nilai string biasa dan markup output value.

String biasa:

```text
Plain text yang belum diketahui aman sebagai markup.
```

Markup output value:

```text
Nilai yang sudah berada dalam output format tertentu, misalnya HTML yang sudah escaped atau HTML yang sengaja dipercaya.
```

Contoh:

```ftl
${user.name}
```

Jika auto-escaping aktif, string biasa akan di-escape.

Contoh markup output:

```ftl
<#assign safeName = user.name?esc>
${safeName}
```

`?esc` menghasilkan markup output value sesuai output format saat ini.

Konsep ini penting untuk mencegah double escaping.

Contoh double escaping klasik:

```text
Alice &lt;Admin&gt;
```

Jika string ini sebenarnya sudah HTML-escaped tetapi dimasukkan sebagai string biasa, auto-escaping akan menghasilkan:

```html
Alice &amp;lt;Admin&amp;gt;
```

Output tampil sebagai:

```text
Alice &lt;Admin&gt;
```

Ini bukan XSS, tetapi bug tampilan dan tanda bahwa pipeline data tidak jelas.

Top 1% rule:

> Jangan mencampur plain text, escaped string, sanitized HTML, dan trusted markup dalam tipe yang sama tanpa metadata.

Di Java, representasikan dengan tipe berbeda jika perlu:

```java
record PlainText(String value) {}
record SanitizedHtml(String value) {}
record TrustedSystemHtml(String value) {}
```

Kemudian rendering layer menentukan bagaimana tiap tipe boleh dipakai.

---

## 8. Konteks Output Utama di HTML

### 8.1 HTML Text Context

Contoh:

```ftl
<p>${user.displayName}</p>
```

Karakter penting:

```text
< > &
```

Dengan HTML auto-escaping, ini umumnya aman.

Output aman:

```html
<p>Alice &lt;Admin&gt;</p>
```

### 8.2 HTML Attribute Context

Contoh:

```ftl
<input value="${user.displayName}">
```

Karakter penting:

```text
& < > " '
```

Jika attribute selalu di-quote, HTML escaping biasanya aman.

Rule:

```text
Selalu quote attribute.
```

Jangan:

```ftl
<input value=${user.displayName}>
```

Karena spasi, quote, slash, dan event payload bisa memecah attribute.

Gunakan:

```ftl
<input value="${user.displayName}">
```

### 8.3 Attribute Name Context

Jangan pernah menaruh user input sebagai nama attribute.

Buruk:

```ftl
<div ${user.attributeName}="x"></div>
```

Ini membuka jalan ke:

```html
<div onclick="alert(1)"="x"></div>
```

Rule:

```text
Attribute name harus constant atau allowlisted enum dari server.
```

### 8.4 Tag Name Context

Jangan pernah:

```ftl
<${user.tagName}>Content</${user.tagName}>
```

Tag name harus constant atau allowlisted dengan sangat ketat.

### 8.5 URL Attribute Context

Contoh:

```ftl
<a href="${profileUrl}">Profile</a>
```

HTML escaping saja tidak cukup untuk URL safety.

Masalah:

```text
javascript:alert(1)
data:text/html,<script>alert(1)</script>
```

HTML escaping tidak mengubah fakta bahwa URL scheme berbahaya.

Rule:

1. URL harus dibangun oleh server dari route yang known-safe.
2. Jika menerima external URL, validate scheme allowlist: `https`, mungkin `mailto` jika perlu.
3. Jangan mengizinkan `javascript:`, `data:`, `vbscript:`.
4. Gunakan URI builder di Java, bukan concat template.

Lebih baik:

```java
model.put("profileUrl", routes.profile(userId));
```

Template:

```ftl
<a href="${profileUrl}">Profile</a>
```

Lebih buruk:

```ftl
<a href="/users/${user.id}?redirect=${redirect}">Profile</a>
```

Karena ada URL encoding concern. Lebih baik URL final dibangun oleh Java route/link builder.

### 8.6 JavaScript Context

Contoh rawan:

```ftl
<script>
  const username = "${user.name}";
</script>
```

Browser sedang menafsirkan JavaScript string. Dibutuhkan JavaScript string escaping, bukan HTML escaping biasa.

FreeMarker punya built-in seperti `?js_string` untuk escaping string JavaScript, tetapi pemakaian harus disiplin.

Contoh:

```ftl
<script>
  const username = "${user.name?js_string}";
</script>
```

Namun rule yang lebih kuat:

```text
Hindari inline JavaScript dengan interpolasi user data.
```

Pola lebih aman:

1. Put data in `data-*` attributes only if simple scalar and HTML-escaped.
2. Fetch JSON from endpoint.
3. Embed server-generated JSON using safe serializer and script-safe escaping.
4. Use CSP nonce/hash and avoid inline script when possible.

### 8.7 CSS Context

Contoh rawan:

```ftl
<div style="color: ${user.color}">
```

CSS punya grammar sendiri. Data seperti:

```text
red; background-image: url(javascript:alert(1))
```

bisa menyisipkan deklarasi tambahan.

Rule:

1. Jangan interpolasi arbitrary user input ke CSS.
2. Gunakan allowlist enum.
3. Mapping di Java:

```java
enum BadgeColor {
    RED("badge-red"), BLUE("badge-blue"), GRAY("badge-gray");
}
```

Template:

```ftl
<span class="badge ${badge.cssClass}">${badge.label}</span>
```

Bukan:

```ftl
<span style="color:${badge.color}">${badge.label}</span>
```

### 8.8 HTML Comment Context

Buruk:

```ftl
<!-- ${user.note} -->
```

Jika user note mengandung:

```text
--> <script>alert(1)</script> <!--
```

Maka comment bisa ditutup.

Rule:

```text
Jangan letakkan untrusted data dalam HTML comment.
```

### 8.9 Raw HTML Context

Contoh:

```ftl
${article.body?no_esc}
```

Ini sangat berbahaya jika `article.body` berasal dari user/admin/CMS tanpa sanitization.

Rule:

```text
Raw HTML hanya boleh dari trusted system template atau sanitized HTML dengan provenance jelas.
```

---

## 9. `?no_esc`: Built-in yang Harus Dianggap Berbahaya

`?no_esc` memberitahu FreeMarker:

```text
Jangan escape nilai ini; treat sebagai markup output.
```

Contoh:

```ftl
${content?no_esc}
```

Jika `content` adalah:

```html
<script>alert(1)</script>
```

maka script akan dirender sebagai script.

`?no_esc` bukan formatting tool. Ia adalah security bypass.

Production rule:

```text
Setiap penggunaan ?no_esc harus punya justifikasi eksplisit.
```

Minimal code review question:

1. Dari mana nilai ini berasal?
2. Apakah ini trusted template fragment atau user-generated content?
3. Apakah sudah disanitasi?
4. Sanitizer apa yang digunakan?
5. Policy tag/attribute apa yang diizinkan?
6. Apakah output target HTML email atau browser page?
7. Apakah audit log menyimpan raw dan sanitized version?
8. Apakah ada test dengan payload XSS?

Contoh penggunaan yang mungkin valid:

```ftl
${systemGeneratedIconSvg?no_esc}
```

Dengan syarat:

1. SVG berasal dari static resource yang dikontrol developer.
2. Bukan dari database editable user.
3. Tidak mengandung script/event handler.
4. Sudah direview.

Contoh penggunaan yang salah:

```ftl
${caseOfficerRemarks?no_esc}
```

Karena remarks umumnya berasal dari user input.

---

## 10. `?html`, `?xml`, `?esc`, dan Era Auto-Escaping

Di FreeMarker lama, developer sering memakai:

```ftl
${name?html}
```

atau:

```ftl
${value?xml}
```

Dalam setup modern dengan output format dan auto-escaping, lebih baik template memakai auto-escaping sebagai default.

Contoh modern:

```ftl
<#ftl output_format="HTML" auto_esc=true>
<p>${name}</p>
```

Bukan:

```ftl
<p>${name?html}</p>
```

Kenapa?

Karena escaping manual cenderung menimbulkan:

1. Inconsistent escaping.
2. Double escaping.
3. Missing escaping di tempat lain.
4. Salah encoder untuk context berbeda.
5. Developer fatigue.

`?esc` berguna untuk menghasilkan markup output value sesuai output format saat ini, terutama saat auto-escaping dimatikan atau saat ingin menyimpan captured escaped content.

Namun rule umum:

```text
Aktifkan output_format + auto_esc di template, lalu biarkan interpolation normal aman by default.
```

---

## 11. Template Header Policy

Untuk FreeMarker HTML template, biasakan header eksplisit:

```ftl
<#ftl output_format="HTML" auto_esc=true strip_whitespace=true>
```

Untuk XML:

```ftl
<#ftl output_format="XML" auto_esc=true>
```

Untuk plain text:

```ftl
<#ftl output_format="plainText" auto_esc=false>
```

Catatan: penamaan output format tergantung konfigurasi FreeMarker dan versi. Dalam banyak setup, HTML/XML output format bisa dikonfigurasi dari `Configuration` atau header template.

Yang penting secara desain:

```text
Setiap template harus menyatakan format output-nya.
```

Jangan biarkan developer menebak.

Template catalog sebaiknya menyimpan metadata:

```yaml
templateId: case-approval-email-html
version: 3
outputFormat: HTML
autoEscaping: true
owner: correspondence-team
allowedRawHtml: false
```

---

## 12. Escaping vs Sanitization

Escaping dan sanitization berbeda.

### 12.1 Escaping

Escaping mengubah karakter agar dianggap data, bukan sintaks.

Input:

```html
<script>alert(1)</script>
```

Escaped untuk HTML text:

```html
&lt;script&gt;alert(1)&lt;/script&gt;
```

Browser menampilkan teks, bukan menjalankan script.

### 12.2 Sanitization

Sanitization menerima HTML sebagai HTML, tetapi menghapus bagian berbahaya.

Input:

```html
<p>Hello</p><script>alert(1)</script>
```

Sanitized:

```html
<p>Hello</p>
```

Escaping cocok untuk plain text.

Sanitization dibutuhkan jika requirement memang mengizinkan rich HTML dari user/admin.

Contoh use case:

1. CMS content.
2. Rich text email body dari admin.
3. Announcement content.
4. Knowledge base article.
5. Case note yang mendukung bold/italic/list.

Jika user tidak perlu rich HTML, jangan sanitize; cukup escape.

Top 1% rule:

```text
Default: treat all user content as plain text.
Exception: allow rich HTML only through explicit sanitized type and policy.
```

---

## 13. Rich HTML Rendering Pattern

Misalnya sistem punya announcement body yang boleh berisi:

```html
<p>, <strong>, <em>, <ul>, <ol>, <li>, <a>
```

Jangan langsung:

```ftl
${announcement.body?no_esc}
```

Buat pipeline:

```text
Raw user HTML
  -> sanitize with strict policy
  -> store sanitized HTML or store raw+sanitized pair
  -> mark as SanitizedHtml
  -> render only in approved raw slot
```

Java type:

```java
public record SanitizedHtml(String value) {
    public SanitizedHtml {
        Objects.requireNonNull(value, "value");
    }
}
```

Model:

```java
model.put("announcementBodyHtml", sanitizedHtml.value());
```

Template:

```ftl
<div class="announcement-body">
  ${announcementBodyHtml?no_esc}
</div>
```

But enforce by policy:

1. Only fields ending with `Html` may use `?no_esc`.
2. Those fields must be typed as `SanitizedHtml` or `TrustedHtml` in Java.
3. Static template lint rejects `?no_esc` on non-allowlisted variables.
4. Test includes payloads like `onerror`, `javascript:`, `<svg/onload>`, malformed tags.

---

## 14. HTML Email Safety Is Different from Web Page Safety

HTML email is a special output target.

Email clients often:

1. Strip scripts.
2. Rewrite links.
3. Ignore CSS features.
4. Render HTML inconsistently.
5. Proxy images.
6. Block remote images.
7. Treat forms differently.

But do not assume email client sanitization makes your template safe.

Reasons:

1. Email may be archived and displayed later in web portal.
2. Same HTML may be reused for PDF generation.
3. Email preview page may render it in browser.
4. Some clients have parsing quirks.
5. Link injection/phishing remains possible.

Rules for email template:

1. Auto-escape all dynamic text.
2. Do not allow arbitrary raw HTML unless sanitized.
3. Build links server-side.
4. Validate external URLs.
5. Avoid JavaScript entirely.
6. Avoid forms unless strictly required.
7. Avoid user-controlled CSS.
8. Include plain text alternative.
9. Store template version and rendered snapshot for audit.

---

## 15. XML Output Safety

FreeMarker can generate XML.

Example:

```ftl
<#ftl output_format="XML" auto_esc=true>
<user>
  <name>${user.name}</name>
</user>
```

If `user.name` contains:

```text
Alice & Bob <Admin>
```

XML escaping should produce:

```xml
<name>Alice &amp; Bob &lt;Admin&gt;</name>
```

XML contexts:

1. Element text.
2. Attribute value.
3. CDATA.
4. Comment.
5. Processing instruction.

Avoid dynamic tag names and attribute names.

Avoid putting untrusted data in comments or CDATA unless carefully handled.

CDATA is not a magic safe zone:

```xml
<![CDATA[ ${value} ]]>
```

If value contains:

```text
]]><evil/>
```

CDATA can be closed.

Rule:

```text
Prefer normal XML escaping over CDATA for untrusted data.
```

---

## 16. Plain Text Output Safety

Plain text has no HTML XSS risk by itself.

But plain text can still be dangerous depending on consumer:

1. Email header injection.
2. Log injection.
3. CSV formula injection.
4. Shell/config injection.
5. Markdown injection.
6. Generated code injection.

Example email header injection:

```text
Subject: Hello ${subject}
```

If subject contains CRLF:

```text
Hello
BCC: attacker@example.com
```

It can inject email headers if mail API is misused.

For plain text templates:

```text
Escaping depends on downstream protocol, not on FreeMarker alone.
```

---

## 17. URL Construction: Jangan Dibebankan ke Template

Template sering tergoda membuat URL:

```ftl
<a href="/cases/${case.id}/documents/${doc.name}">Download</a>
```

Masalah:

1. Path encoding.
2. Query encoding.
3. Route changes.
4. Authorization leakage.
5. Open redirect.
6. Broken links.
7. Tenant prefix.
8. Reverse proxy/base path.

Lebih baik Java menyediakan link final:

```java
model.put("downloadUrl", linkBuilder.caseDocument(caseId, documentId));
```

Template:

```ftl
<a href="${downloadUrl}">Download</a>
```

Jika template harus membentuk URL, batasi hanya untuk route helper yang aman:

```ftl
<a href="${routes.caseDetail(case.id)}">View case</a>
```

Namun ini berarti kamu mengekspos helper method; pastikan helper itu tidak menjadi general-purpose service exposure.

---

## 18. Inline JavaScript: Strategy yang Defensible

Inline JavaScript dengan interpolation adalah salah satu sumber XSS paling sering.

### 18.1 Hindari Jika Bisa

Gunakan external JS:

```html
<script src="/assets/case-page.js"></script>
```

Data dari endpoint:

```text
GET /api/cases/{id}/page-data
```

### 18.2 Data Attributes untuk Scalar Sederhana

Template:

```ftl
<div id="case-page"
     data-case-id="${case.id}"
     data-mode="${page.mode}">
</div>
```

JavaScript:

```js
const root = document.getElementById('case-page');
const caseId = root.dataset.caseId;
```

Tetap validate mode di server sebagai enum.

### 18.3 JSON Script Tag

Jika harus embed JSON:

```html
<script type="application/json" id="page-data">
  {"caseId":"123"}
</script>
```

Tetapi JSON harus dibuat oleh serializer Java, bukan concat di FTL.

Buruk:

```ftl
<script>
  const data = {
    name: "${user.name?js_string}"
  };
</script>
```

Lebih baik:

```java
String pageDataJson = safeJsonForHtmlScript(objectMapper, pageData);
model.put("pageDataJson", pageDataJson);
```

Template:

```ftl
<script type="application/json" id="page-data">${pageDataJson?no_esc}</script>
```

Namun `?no_esc` ini hanya boleh karena `pageDataJson` adalah trusted serialized JSON yang sudah script-safe.

---

## 19. CSS and Style Safety

Jangan lakukan:

```ftl
<div style="background:${user.background}">
```

Jangan lakukan:

```ftl
<style>
  .theme { color: ${theme.color}; }
</style>
```

Gunakan mapping:

```java
public enum Theme {
    DEFAULT("theme-default"),
    WARNING("theme-warning"),
    SUCCESS("theme-success")
}
```

Template:

```ftl
<body class="${theme.cssClass}">
```

Jika user boleh memilih warna, validasi di Java:

```text
^#[0-9a-fA-F]{6}$
```

Lalu render hanya di tempat sangat terbatas. Tetapi untuk enterprise system, class mapping biasanya lebih governable daripada inline style.

---

## 20. Dangerous HTML Sinks

Beberapa lokasi HTML terlalu berbahaya untuk user data:

1. `<script>...</script>`.
2. `<style>...</style>`.
3. Event handler attributes: `onclick`, `onload`, `onerror`.
4. `href` with uncontrolled scheme.
5. `srcdoc` attribute.
6. `iframe` content.
7. SVG raw markup.
8. MathML raw markup.
9. HTML comments.
10. Dynamic tag/attribute names.

Policy:

```text
Untrusted data must not be inserted into dangerous sinks.
```

Even with escaping, avoid designing templates around dangerous sinks.

---

## 21. Response Headers and CSP

Escaping is primary. Headers are defense-in-depth.

Important browser response headers for HTML pages:

```http
Content-Type: text/html; charset=UTF-8
X-Content-Type-Options: nosniff
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-...'; object-src 'none'; base-uri 'self'
Referrer-Policy: strict-origin-when-cross-origin
```

CSP can reduce impact of missed XSS, but CSP is not a replacement for escaping.

Why?

1. CSP can be misconfigured.
2. Legacy browsers/clients may behave differently.
3. Some XSS payloads can exploit allowed script sources.
4. Inline event handlers might still work if unsafe policy exists.
5. Email clients do not follow normal web CSP semantics.

Top 1% rule:

```text
Escaping prevents injection. CSP limits blast radius. Do both.
```

---

## 22. FreeMarker Configuration for Safer HTML Rendering

A baseline setup:

```java
import freemarker.cache.ClassTemplateLoader;
import freemarker.core.HTMLOutputFormat;
import freemarker.template.Configuration;
import freemarker.template.TemplateExceptionHandler;
import freemarker.template.Version;

public final class FreeMarkerHtmlConfig {

    public static Configuration create() {
        Configuration cfg = new Configuration(Configuration.VERSION_2_3_32);
        cfg.setTemplateLoader(new ClassTemplateLoader(
                FreeMarkerHtmlConfig.class,
                "/templates"
        ));

        cfg.setDefaultEncoding("UTF-8");
        cfg.setOutputFormat(HTMLOutputFormat.INSTANCE);
        cfg.setRecognizeStandardFileExtensions(true);
        cfg.setTemplateExceptionHandler(TemplateExceptionHandler.RETHROW_HANDLER);
        cfg.setLogTemplateExceptions(false);
        cfg.setWrapUncheckedExceptions(true);
        cfg.setFallbackOnNullLoopVariable(false);

        return cfg;
    }
}
```

Catatan versi:

1. Gunakan versi FreeMarker yang tersedia/stabil di dependency stack-mu.
2. `Configuration.VERSION_2_3_32` hanya contoh baseline dari FreeMarker 2.3.x modern.
3. Sesuaikan dengan versi aktual project.

Template:

```ftl
<#ftl output_format="HTML" auto_esc=true>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${pageTitle}</title>
</head>
<body>
  <h1>${heading}</h1>
  <p>${message}</p>
</body>
</html>
```

---

## 23. Secure Rendering Service Pattern

Jangan biarkan semua module membuat `Configuration` dan render sendiri-sendiri.

Buat rendering service:

```java
public interface HtmlTemplateRenderer {
    RenderedHtml render(TemplateId templateId, HtmlRenderModel model, RenderContext context);
}
```

Types:

```java
public record TemplateId(String value) {}

public record RenderContext(
        Locale locale,
        ZoneId zoneId,
        String correlationId,
        String templateVersion
) {}

public record RenderedHtml(String value) {}
```

Implementation:

```java
public final class FreeMarkerHtmlTemplateRenderer implements HtmlTemplateRenderer {

    private final Configuration configuration;
    private final TemplateModelValidator validator;

    public FreeMarkerHtmlTemplateRenderer(
            Configuration configuration,
            TemplateModelValidator validator
    ) {
        this.configuration = Objects.requireNonNull(configuration);
        this.validator = Objects.requireNonNull(validator);
    }

    @Override
    public RenderedHtml render(
            TemplateId templateId,
            HtmlRenderModel model,
            RenderContext context
    ) {
        validator.validate(templateId, model);

        try {
            Template template = configuration.getTemplate(
                    templateId.value(),
                    context.locale(),
                    "UTF-8"
            );

            StringWriter writer = new StringWriter(4096);
            template.process(model.asMap(context), writer);
            return new RenderedHtml(writer.toString());
        } catch (IOException | TemplateException ex) {
            throw new TemplateRenderingException(templateId, context.correlationId(), ex);
        }
    }
}
```

Security benefit:

1. One place to enforce configuration.
2. One place to validate model.
3. One place to log safely.
4. One place to measure latency.
5. One place to restrict raw HTML policy.

---

## 24. Template Model Policy for Safe Output

Design model fields with semantic suffix/type.

Examples:

```java
public record CaseApprovalEmailModel(
        String recipientNameText,
        String caseReferenceText,
        String decisionText,
        String detailUrl,
        SanitizedHtml additionalInstructionsHtml
) {}
```

Naming convention:

1. `*Text`: plain text, auto-escaped by template.
2. `*Url`: prebuilt safe URL.
3. `*Html`: sanitized or trusted HTML only.
4. `*CssClass`: allowlisted class name.
5. `*Json`: serialized safe JSON only.

Template:

```ftl
<p>Dear ${recipientNameText},</p>
<p>Your case ${caseReferenceText} has been ${decisionText}.</p>
<p><a href="${detailUrl}">View details</a></p>
<div>${additionalInstructionsHtml?no_esc}</div>
```

Review rule:

```text
?no_esc only allowed for variables ending with Html and backed by SanitizedHtml/TrustedHtml type.
```

---

## 25. Static Lint Rules for FreeMarker Templates

In high-assurance systems, do not rely only on reviewer memory.

Possible lint rules:

1. Reject `?no_esc` unless allowlisted.
2. Reject `th` irrelevant here; for FreeMarker reject `<script>` interpolation unless allowlisted.
3. Reject dynamic tag names.
4. Reject dynamic attribute names.
5. Reject unquoted attributes containing interpolation.
6. Reject `href="${...}"` unless variable suffix is `Url` or expression uses route helper.
7. Reject `style="${...}"` or interpolation inside style.
8. Reject event handler attributes containing interpolation.
9. Reject `<#noautoesc>` unless allowlisted.
10. Require `<#ftl output_format="HTML" auto_esc=true>` for HTML templates.
11. Require template metadata header/comment.
12. Reject use of `?api` in templates.
13. Reject service-like object names: `repository`, `service`, `dao`, `entityManager`, `request`, `session`.

Example simple grep-like policy:

```text
Forbidden patterns:
- ?no_esc
- <#noautoesc>
- onclick=
- onerror=
- <script>.*${
- style=".*${
- <${
```

This is not perfect parsing, but catches many mistakes early.

For stronger enforcement, parse templates with FreeMarker APIs or build custom static analyzer.

---

## 26. Testing XSS Defense

For every HTML template, create test payloads.

Payload set:

```text
<script>alert(1)</script>
"><script>alert(1)</script>
' onmouseover='alert(1)
javascript:alert(1)
<img src=x onerror=alert(1)>
</textarea><script>alert(1)</script>
</script><script>alert(1)</script>
<!-- --> <script>alert(1)</script>
<svg/onload=alert(1)>
```

Unit test idea:

```java
@Test
void renderEscapesUserControlledDisplayName() {
    CasePageModel model = new CasePageModel(
            "<script>alert(1)</script>",
            "/cases/123"
    );

    RenderedHtml html = renderer.render(new TemplateId("case-page.ftlh"), model, context);

    assertThat(html.value()).doesNotContain("<script>alert(1)</script>");
    assertThat(html.value()).contains("&lt;script&gt;alert(1)&lt;/script&gt;");
}
```

For URL fields:

```java
@Test
void rejectsJavascriptUrlBeforeRendering() {
    assertThatThrownBy(() -> SafeUrl.external("javascript:alert(1)"))
            .isInstanceOf(InvalidUrlException.class);
}
```

For sanitized HTML:

```java
@Test
void sanitizerRemovesEventHandlers() {
    SanitizedHtml html = sanitizer.sanitize("<img src=x onerror=alert(1)><p>Hello</p>");

    assertThat(html.value()).doesNotContain("onerror");
    assertThat(html.value()).contains("<p>Hello</p>");
}
```

---

## 27. Common Anti-Patterns

### Anti-Pattern 1: Escaping in Java Before Template

Bad:

```java
model.put("name", StringEscapeUtils.escapeHtml4(user.name()));
```

Template:

```ftl
${name}
```

Problem:

1. Double escaping risk.
2. Context is unknown in Java.
3. Same field may be used in HTML text, JS, URL, XML.

Better:

```java
model.put("name", user.name());
```

Template auto-escapes based on output format.

Exception:

1. Prebuilt sanitized HTML with explicit type.
2. Prebuilt safe JSON with explicit type.
3. Prebuilt safe URL after validation.

### Anti-Pattern 2: Turning Off Auto-Escaping Globally

Bad:

```ftl
<#noautoesc>
  ${content}
</#noautoesc>
```

or config disabling auto-escaping for HTML.

Better:

```ftl
<#ftl output_format="HTML" auto_esc=true>
```

### Anti-Pattern 3: Admin Templates Are Trusted by Default

Business admins are not necessarily safe template authors.

If admins can edit templates, they can accidentally or intentionally inject unsafe markup or exfiltrate data if object model is too broad.

Treat admin-editable templates as semi-trusted at most.

### Anti-Pattern 4: Rich Text Stored as Plain String

Bad:

```java
String body;
```

Used inconsistently:

```ftl
${body}
${body?no_esc}
```

Better:

```java
PlainText bodyText;
SanitizedHtml bodyHtml;
```

### Anti-Pattern 5: Inline JS Data Building in Template

Bad:

```ftl
<script>
  window.user = {
    name: "${user.name}",
    role: "${user.role}"
  };
</script>
```

Better:

```text
External JS + JSON endpoint
```

or carefully generated JSON with safe serializer.

### Anti-Pattern 6: UI Authorization Only

Bad:

```ftl
<#if user.canApprove>
  <button>Approve</button>
</#if>
```

This is okay for UI hiding, but not for enforcement.

Backend must still check permission on approve action.

Security rendering is not authorization enforcement.

---

## 28. FreeMarker File Extensions and Output Format Convention

FreeMarker supports standard file extension recognition in many configurations.

Common convention:

```text
.ftlh -> HTML template
.ftlx -> XML template
.ftl  -> generic/legacy FreeMarker template
```

Using `.ftlh` for HTML templates helps engine/config infer HTML output format and auto-escaping behavior when `recognize_standard_file_extensions` is enabled.

Recommended enterprise convention:

```text
emails/
  case-approved.html.ftlh
  case-approved.text.ftl
pages/
  case-detail.ftlh
xml/
  agency-submission.ftlx
text/
  audit-summary.ftl
```

Even with extension convention, template header or catalog metadata should remain clear.

---

## 29. HTML Safety in Case/Regulatory Systems

For regulatory/case management systems, template output is often legal/official communication.

Risks are broader than browser XSS:

1. Wrong recipient sees hidden field.
2. Raw remarks inject misleading content.
3. Officer comment renders as HTML and changes legal meaning.
4. Tenant-specific footer includes malicious link.
5. Old template version renders new data incorrectly.
6. Appeal/rejection reason contains unescaped HTML.
7. PDF renderer interprets HTML differently from browser.
8. Email preview page runs unsafe HTML.

Design rules:

1. All official text fields are plain text unless explicitly rich text.
2. Rich text must be sanitized and stored with sanitizer version.
3. Rendered output snapshot must be immutable.
4. Template version must be recorded.
5. Data model version must be recorded.
6. Rendering locale/timezone must be recorded.
7. Raw input and rendered output must have controlled access.
8. Preview must use same renderer/config as production.
9. Approval workflow must include security lint results.

---

## 30. Designing Safe Template Slots

A strong template architecture defines slots.

Example:

```text
Slot: recipientName
Type: PlainText
Allowed contexts: HTML text, HTML attribute value, text email
Forbidden contexts: raw HTML, JS, CSS, URL

Slot: detailUrl
Type: SafeUrl
Allowed contexts: href attribute
Forbidden contexts: raw text without link label, JS

Slot: announcementBody
Type: SanitizedHtml
Allowed contexts: HTML body raw slot
Forbidden contexts: attribute, JS, CSS, URL

Slot: badgeColor
Type: EnumCssClass
Allowed contexts: class attribute
Forbidden contexts: style attribute raw value
```

This moves security from “developer remembers escaping” to “system enforces slot contracts”.

---

## 31. Example: Safe Case Notification Email

### 31.1 Java Model

```java
public record CaseDecisionEmailModel(
        String recipientNameText,
        String caseReferenceText,
        String decisionText,
        SafeUrl detailUrl,
        SanitizedHtml additionalInstructionsHtml
) {
    public Map<String, Object> toTemplateModel() {
        return Map.of(
                "recipientNameText", recipientNameText,
                "caseReferenceText", caseReferenceText,
                "decisionText", decisionText,
                "detailUrl", detailUrl.value(),
                "additionalInstructionsHtml", additionalInstructionsHtml.value()
        );
    }
}
```

### 31.2 SafeUrl

```java
public record SafeUrl(String value) {
    public SafeUrl {
        Objects.requireNonNull(value, "value");
        URI uri = URI.create(value);
        String scheme = uri.getScheme();
        if (scheme != null && !scheme.equals("https")) {
            throw new IllegalArgumentException("Only HTTPS URLs are allowed");
        }
    }
}
```

For internal relative links, use a separate type:

```java
public record SafeRelativeUrl(String value) {
    public SafeRelativeUrl {
        Objects.requireNonNull(value, "value");
        if (!value.startsWith("/")) {
            throw new IllegalArgumentException("Relative URL must start with /");
        }
        if (value.startsWith("//")) {
            throw new IllegalArgumentException("Protocol-relative URL is not allowed");
        }
    }
}
```

### 31.3 Template

```ftl
<#ftl output_format="HTML" auto_esc=true>
<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Case Decision</title>
</head>
<body>
  <p>Dear ${recipientNameText},</p>

  <p>
    Your case <strong>${caseReferenceText}</strong> has been
    <strong>${decisionText}</strong>.
  </p>

  <p>
    <a href="${detailUrl}">View case details</a>
  </p>

  <div class="additional-instructions">
    ${additionalInstructionsHtml?no_esc}
  </div>
</body>
</html>
```

Security notes:

1. `recipientNameText`, `caseReferenceText`, `decisionText` are plain text and auto-escaped.
2. `detailUrl` is built/validated in Java.
3. `additionalInstructionsHtml` is sanitized HTML and the only raw slot.
4. `?no_esc` is visible, reviewable, and restricted.

---

## 32. Example: Unsafe vs Safe Review

### Unsafe Template

```ftl
<h1>${title?no_esc}</h1>
<a href="${redirect}">Continue</a>
<script>
  const remarks = '${remarks}';
</script>
<div style="color:${color}">${message}</div>
```

Problems:

1. `title?no_esc` can inject HTML/script.
2. `redirect` may be `javascript:` or phishing URL.
3. `remarks` is inside JavaScript string with wrong escaping.
4. `color` is arbitrary CSS injection.
5. `message` is okay if auto-escaping is enabled, but template does not declare output format.

### Safer Template

```ftl
<#ftl output_format="HTML" auto_esc=true>
<h1>${titleText}</h1>
<a href="${continueUrl}">Continue</a>
<div id="remarks" data-value="${remarksText}"></div>
<div class="${messageColorCssClass}">${messageText}</div>
```

Java must provide:

1. `titleText` as plain text.
2. `continueUrl` as `SafeRelativeUrl` or route-generated URL.
3. `remarksText` as plain text.
4. `messageColorCssClass` as allowlisted enum.
5. `messageText` as plain text.

---

## 33. Production Review Checklist

For every FreeMarker HTML template:

1. Does it declare or inherit HTML output format?
2. Is auto-escaping enabled?
3. Are all attributes quoted?
4. Is `?no_esc` absent or justified?
5. Are dynamic URLs prebuilt or validated?
6. Are dynamic CSS values avoided or allowlisted?
7. Is inline JavaScript avoided?
8. If inline JavaScript exists, is data encoded for JS context?
9. Are raw HTML fields typed as sanitized/trusted HTML?
10. Are dynamic tag/attribute names avoided?
11. Are event handler attributes avoided?
12. Are user values excluded from comments/CDATA/dangerous sinks?
13. Are model fields named semantically?
14. Is object exposure restricted from Part 7?
15. Are template errors fail-fast in production rendering flow?
16. Are XSS payload tests present?
17. Is rendered output audited if legally relevant?
18. Are headers/CSP configured for browser-rendered pages?
19. Is preview using the same config as production?
20. Is there lint/static analysis in CI?

---

## 34. Decision Framework: What Should I Do With This Field?

Ask:

```text
What is the source?
```

Options:

1. System constant.
2. Developer-controlled template fragment.
3. Database value from internal user.
4. Database value from external user.
5. Admin-editable CMS content.
6. External API data.

Then ask:

```text
What is the output context?
```

Options:

1. HTML text.
2. HTML attribute value.
3. URL attribute.
4. JavaScript string.
5. CSS value.
6. Raw HTML.
7. XML text.
8. Plain text protocol.

Then decide:

| Source | Context | Preferred Handling |
|---|---|---|
| User text | HTML text | Auto-escape |
| User text | HTML attribute | Quote attribute + auto-escape |
| User URL | href | Validate scheme + encode/build URL |
| User text | JS string | Avoid; otherwise JS-string escape |
| User text | CSS | Avoid; use enum/class mapping |
| User rich HTML | HTML body | Sanitize + `SanitizedHtml` + restricted raw slot |
| System SVG | HTML raw | Trusted resource + review + restricted raw slot |
| External API text | HTML text | Treat as untrusted + auto-escape |
| Admin template | HTML raw | Semi-trusted; lint + approval + sandbox |

---

## 35. Java 8–25 Considerations

The concepts are stable across Java 8–25, but implementation choices evolve.

### Java 8 Baseline

1. `java.time` available and should be used for date/time rendering inputs.
2. Records are not available; use immutable classes/builders.
3. Sealed types are not available; type discipline is by convention/classes.
4. Use explicit wrapper classes for `SafeUrl`, `SanitizedHtml`, `PlainText`.

### Java 11–17

1. Better runtime/container ergonomics.
2. Java 17 LTS supports records and sealed classes.
3. Records are excellent for template view models.
4. Sealed interfaces can model safe content types.

Example:

```java
public sealed interface RenderableContent permits PlainTextContent, SanitizedHtmlContent {}
public record PlainTextContent(String value) implements RenderableContent {}
public record SanitizedHtmlContent(String value) implements RenderableContent {}
```

### Java 21–25

1. Virtual threads can help with high-concurrency rendering tasks if rendering is combined with blocking I/O, but template rendering itself is CPU/memory work.
2. Structured concurrency can organize batch rendering pipelines, but does not replace model validation/escaping.
3. Pattern matching can simplify safe type handling.
4. Modern GC and compact strings influence memory profile of large rendered outputs.

Important:

```text
New Java versions do not make unsafe template rendering safe.
```

Security is still based on context-correct output handling.

---

## 36. What Top 1% Engineers Do Differently

Average engineer:

```text
“FreeMarker auto-escapes, so XSS is solved.”
```

Strong engineer:

```text
“Auto-escaping handles common HTML output, but context matters.”
```

Top 1% engineer:

```text
“I will design the rendering system so every dynamic value has a semantic type, every template declares output format, every raw slot is explicit, every dangerous context is forbidden or encoded correctly, every URL is built/validated, every template is linted/tested, and every official render is reproducible.”
```

That is the standard for enterprise/regulatory systems.

---

## 37. Summary

FreeMarker output safety rests on several layers:

1. Correct output format.
2. Auto-escaping enabled by default.
3. Context-aware handling for HTML, attributes, JS, CSS, URL, XML.
4. Avoiding dangerous sinks.
5. Strict control of `?no_esc`.
6. Sanitization for rich HTML only when required.
7. Semantic model types: `PlainText`, `SafeUrl`, `SanitizedHtml`, `TrustedHtml`, `CssClass`.
8. Central rendering service.
9. Static template linting.
10. XSS payload tests.
11. CSP/headers as defense-in-depth.
12. Auditability for official outputs.

The key invariant:

```text
A template is safe only when every dynamic value is encoded or validated for the exact context where it appears.
```

---

## 38. Practical Exercises

### Exercise 1 — Classify Contexts

Given template:

```ftl
<h1>${title}</h1>
<a href="${url}">${label}</a>
<script>const x = "${value}";</script>
<div style="color:${color}">${message}</div>
```

Classify every interpolation by context and decide required handling.

### Exercise 2 — Remove Unsafe Raw HTML

Refactor:

```ftl
${body?no_esc}
```

into a safe model with either `PlainText` or `SanitizedHtml`.

### Exercise 3 — Build Safe URL Type

Implement `SafeRelativeUrl` and `SafeExternalHttpsUrl` in Java.

### Exercise 4 — Write XSS Regression Tests

Create test payloads and verify rendered output does not contain executable markup.

### Exercise 5 — Create Lint Rules

Create a simple script that rejects:

```text
?no_esc
<#noautoesc>
onclick=
onerror=
style="${
<script>.*${
```

Then evolve it into allowlist-based linting.

---

## 39. References

1. Apache FreeMarker Manual — Auto-escaping and output formats.
2. Apache FreeMarker Manual — Template language reference and built-ins.
3. Apache FreeMarker API — `Configuration`, output formats, template processing.
4. OWASP Cross Site Scripting Prevention Cheat Sheet.
5. OWASP XSS Filter Evasion Cheat Sheet.
6. PortSwigger Web Security Academy — Cross-site scripting overview.
7. Java SE documentation, Java 8–25, especially `java.time`, records/sealed classes in later Java versions, and modern runtime behavior.

---

## 40. Status Seri

```text
Part 8 selesai.
Seri belum selesai.
Berikutnya: Part 9 — FreeMarker Error Handling, Diagnostics, and Template Observability.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-007.md">⬅️ Part 7 — FreeMarker Object Wrapping, Type Exposure, and Security Boundary</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-009.md">Part 9 — FreeMarker Error Handling, Diagnostics, and Template Observability ➡️</a>
</div>
