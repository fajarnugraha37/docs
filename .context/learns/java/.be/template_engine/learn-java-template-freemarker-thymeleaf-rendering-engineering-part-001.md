# learn-java-template-freemarker-thymeleaf-rendering-engineering-part-001

# Part 1 — Template Engine Landscape di Java: JSP, FreeMarker, Thymeleaf, Mustache, Pebble, Velocity

> Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`  
> Scope Java: Java 8 sampai Java 25  
> Fokus part ini: memahami landscape template engine Java, trade-off pemilihan engine, posisi JSP/Jakarta Pages, FreeMarker, Thymeleaf, Mustache/Handlebars-style engine, Pebble, Velocity, dan bagaimana memilih teknologi rendering yang tepat untuk sistem enterprise.

---

## 1.1 Tujuan Part Ini

Part 0 sudah membangun mental model bahwa template engine bukan sekadar:

```text
HTML + variable = dynamic page
```

Tetapi:

```text
A deterministic rendering subsystem that transforms a validated presentation model
into a target output format under explicit rules for escaping, formatting,
localization, versioning, performance, security, observability, and auditability.
```

Part 1 melangkah ke pertanyaan berikutnya:

```text
Dari banyak pilihan template engine di Java, bagaimana kita memahami landscape-nya,
trade-off-nya, dan memilih engine yang benar untuk konteks sistem nyata?
```

Target setelah menyelesaikan part ini:

1. Bisa membedakan kategori template engine Java berdasarkan model eksekusi dan target output.
2. Bisa menjelaskan mengapa JSP, FreeMarker, Thymeleaf, Mustache, Pebble, dan Velocity lahir dari kebutuhan yang berbeda.
3. Bisa memilih engine berdasarkan output, trust model, team workflow, security, performance, governance, dan lifecycle template.
4. Bisa menghindari kesalahan umum: memilih engine hanya karena default framework, populer, atau familiar.
5. Bisa membuat decision matrix yang defendable untuk sistem enterprise.

---

## 1.2 Masalah yang Sering Terjadi Saat Memilih Template Engine

Banyak keputusan template engine dibuat dengan alasan dangkal:

```text
- Karena Spring Boot tutorial pakai Thymeleaf.
- Karena project lama pakai JSP.
- Karena FreeMarker sudah ada di sistem.
- Karena email template lama sudah .ftl.
- Karena engine X katanya lebih cepat.
- Karena designer lebih suka HTML biasa.
- Karena ingin server-side rendering.
```

Alasan-alasan itu tidak selalu salah, tetapi belum cukup.

Keputusan yang lebih matang harus menjawab:

```text
Apa output yang ingin dibuat?
Siapa penulis template-nya?
Seberapa dipercaya template author-nya?
Seberapa dipercaya data input-nya?
Apakah output butuh escaping context-aware?
Apakah template akan diedit runtime?
Apakah template butuh approval workflow?
Apakah template menjadi legal/audit artifact?
Apakah engine dipakai untuk HTML web, email, PDF pre-render, XML, CSV, source code, atau semua itu sekaligus?
Apakah template perlu natural preview oleh designer?
Apakah template perlu strict logic-less mode?
Apakah template perlu custom DSL?
Apakah sistem perlu multi-tenant template versioning?
```

Top-tier engineer tidak bertanya:

```text
Engine mana yang paling bagus?
```

Tetapi:

```text
Engine mana yang paling cocok untuk invariant, risiko, lifecycle, dan ownership dari output ini?
```

---

## 1.3 Evolusi Java Web Rendering

Untuk memahami landscape sekarang, kita perlu melihat evolusinya.

### 1.3.1 Servlet-Generated HTML

Awal Java web sangat dekat dengan Servlet.

Secara kasar:

```java
protected void doGet(HttpServletRequest request, HttpServletResponse response)
        throws IOException {
    response.setContentType("text/html");
    PrintWriter out = response.getWriter();
    out.println("<html>");
    out.println("<body>");
    out.println("<h1>Hello " + request.getParameter("name") + "</h1>");
    out.println("</body>");
    out.println("</html>");
}
```

Masalahnya jelas:

1. HTML tercampur dengan Java code.
2. Escaping rawan dilupakan.
3. UI sulit dibaca designer.
4. Perubahan markup membutuhkan perubahan Java code.
5. Output kompleks menjadi penuh string concatenation.
6. Testing visual/HTML sulit.
7. Separation of concerns buruk.

Model ini masih bisa diterima untuk output sangat kecil, misalnya health-check HTML sederhana, tetapi bukan untuk UI enterprise.

### 1.3.2 JSP / Jakarta Pages

JSP lahir untuk membalik pendekatan:

```text
Bukan Java code yang mencetak HTML,
tetapi HTML-like template yang bisa mengandung dynamic expression/tag.
```

Jakarta Pages mendefinisikan template engine untuk web application yang mencampur textual content, custom tags, expression language, dan embedded Java code, lalu dikompilasi menjadi Jakarta Servlet.

Mental model:

```text
.jsp file -> translated/generated Servlet -> compiled class -> executed per request
```

Kekuatan JSP:

1. Bagian dari ekosistem Servlet/Jakarta EE.
2. Familiar di banyak legacy enterprise system.
3. Mendukung taglib dan JSTL.
4. Terintegrasi dengan request/session/application scope.
5. Bisa digunakan untuk web page dynamic.

Kelemahan JSP:

1. Cenderung mendorong coupling ke web container.
2. Scriptlet historis membuat business logic masuk view.
3. Sulit digunakan untuk non-web output.
4. Tidak natural HTML seperti Thymeleaf.
5. Kurang cocok untuk email/document generation modern.
6. Runtime model bergantung pada Servlet/JSP container.
7. Migration ke executable jar/container modern kadang lebih merepotkan daripada template library biasa.

JSP bukan otomatis buruk. Banyak sistem production stabil memakai JSP. Tetapi untuk sistem baru, biasanya kita perlu alasan kuat untuk memilih JSP dibanding Thymeleaf atau FreeMarker.

### 1.3.3 JSTL dan EL

JSP awalnya memungkinkan embedded Java code:

```jsp
<% if (user.isAdmin()) { %>
  <a href="/admin">Admin</a>
<% } %>
```

Ini kemudian didorong ke arah Expression Language dan tag library:

```jsp
<c:if test="${user.admin}">
  <a href="/admin">Admin</a>
</c:if>
```

Perubahan ini penting karena memperlihatkan pola evolusi template engine:

```text
Semakin jauh dari arbitrary Java code,
semakin dekat ke declarative rendering language.
```

Tetapi JSP tetap membawa warisan web-container-centric.

### 1.3.4 JSF / Jakarta Faces

JSF/Jakarta Faces mengambil pendekatan component-based server-side UI.

Modelnya berbeda dari FreeMarker/Thymeleaf:

```text
View bukan hanya template text,
tetapi component tree dengan lifecycle, state, converter, validator, event, dan renderer.
```

Kekuatan JSF:

1. Component model matang.
2. Form-heavy enterprise apps.
3. Server-side stateful UI.
4. Rich validation/conversion lifecycle.

Kelemahan relatif:

1. Lifecycle lebih kompleks.
2. Stateful server-side UI bisa berat.
3. Kurang cocok untuk simple text/document/email generation.
4. Debugging lifecycle bisa sulit.

Part ini tidak membahas JSF detail karena seri Jakarta Pages/Faces sebelumnya sudah menyentuh server-side UI. Di sini JSF hanya dipakai sebagai pembanding: tidak semua template/rendering system adalah text template engine.

### 1.3.5 FreeMarker

FreeMarker mengambil posisi sebagai generic text template engine.

Secara konseptual:

```text
Any text output = template + data model
```

Output bisa berupa:

```text
- HTML
- XML
- email
- plain text
- generated source code
- configuration file
- CSV-like text
- SQL script
- PDF pre-render HTML
```

Kekuatan FreeMarker:

1. General-purpose.
2. Tidak terikat Servlet.
3. Cocok untuk email dan document generation.
4. Macro/function/directive kuat.
5. Bisa dipakai di web maupun non-web.
6. Data model abstraction kuat.
7. Output format dan auto-escaping tersedia pada versi modern.
8. Extensible melalui custom directive/method/object wrapper.

Kelemahan FreeMarker:

1. Template language kuat, sehingga bisa disalahgunakan untuk logic berlebihan.
2. Object exposure perlu dikontrol ketat.
3. Natural HTML preview tidak sebaik Thymeleaf.
4. Untuk form web MVC modern, ergonomi kalah dari Thymeleaf di Spring ecosystem.
5. Jika template diedit oleh user semi-trusted, sandbox dan governance harus serius.

### 1.3.6 Thymeleaf

Thymeleaf mengambil posisi sebagai modern server-side Java template engine dengan natural templates.

Mental model:

```text
Valid-ish HTML prototype + th:* attributes + model/context -> rendered HTML
```

Contoh:

```html
<p th:text="${user.name}">Prototype Name</p>
```

Saat dibuka langsung di browser sebagai file statis, teks `Prototype Name` tetap terlihat. Saat dirender runtime, isi diganti oleh `user.name`.

Kekuatan Thymeleaf:

1. Natural template: bisa dipreview sebagai HTML.
2. Sangat kuat untuk Spring MVC form rendering.
3. Fragment/layout system baik.
4. Expression model terintegrasi dengan Spring.
5. Cocok untuk server-side rendered HTML portal/admin app.
6. Default escaped output via `th:text`.
7. Template mode untuk HTML, XML, TEXT, JavaScript, CSS, RAW.

Kelemahan Thymeleaf:

1. Lebih HTML/DOM-oriented dibanding FreeMarker.
2. Untuk generated source/config/plain text yang kompleks, FreeMarker biasanya lebih natural.
3. Untuk email HTML bisa baik, tetapi HTML email punya constraint sendiri.
4. Fragment/expression kompleks bisa menghasilkan render cost dan maintainability issue.
5. Jika dipakai untuk non-web output, perlu disiplin agar tidak memaksakan DOM model ke semua output.

### 1.3.7 SPA + API Era

Banyak sistem modern beralih ke:

```text
Backend REST/GraphQL API + frontend SPA
```

Dengan model ini, backend tidak merender HTML page. Backend mengirim JSON, frontend React/Vue/Angular yang render UI.

Tetapi ini tidak membunuh template engine di backend.

Backend masih sering perlu:

```text
- email template
- PDF letter
- notification message
- document artifact
- server-rendered admin/internal page
- legal correspondence
- XML integration file
- generated config
- fallback error page
```

Jadi pertanyaan modern bukan:

```text
Apakah kita masih perlu template engine kalau sudah SPA?
```

Pertanyaan yang benar:

```text
Output mana yang seharusnya dirender backend,
dan engine apa yang paling cocok untuk masing-masing output?
```

### 1.3.8 SSR Hybrid

Sekarang banyak arsitektur hybrid:

```text
- public/customer UI: SPA atau frontend SSR framework
- internal admin: server-side rendered Java pages
- notification/email: backend template engine
- PDF/legal docs: backend rendering pipeline
- export/integration files: backend generated text/XML/CSV
```

Dalam arsitektur seperti ini, satu sistem bisa memakai lebih dari satu template approach:

```text
Thymeleaf -> internal admin HTML
FreeMarker -> email, PDF pre-render, generated text
Frontend SPA -> customer-facing interactive UI
```

Ini bukan inconsistency jika boundary-nya jelas.

Anti-pattern-nya adalah memakai banyak engine tanpa ownership, guideline, dan separation of use case.

---

## 1.4 Kategori Template Engine Berdasarkan Target Output

Cara pertama memahami landscape adalah berdasarkan output.

### 1.4.1 Web Page Rendering Engine

Target:

```text
HTML response untuk browser.
```

Contoh:

```text
- JSP/Jakarta Pages
- Thymeleaf
- FreeMarker as MVC view
- Pebble as MVC view
- Mustache templates
```

Kebutuhan utama:

1. HTML escaping.
2. URL generation.
3. Form rendering.
4. CSRF integration.
5. Validation error rendering.
6. Fragment/layout reuse.
7. Static assets integration.
8. Authentication/authorization aware rendering.
9. Request/session context integration.

Thymeleaf unggul di sini terutama untuk Spring MVC form-heavy pages.

### 1.4.2 General Text Output Engine

Target:

```text
Any textual output.
```

Contoh:

```text
- FreeMarker
- Velocity
- Pebble
- Mustache
- StringTemplate
```

Output:

```text
- email text
- HTML email
- XML
- JSON-ish text
- YAML/config
- source code
- SQL
- generated scripts
- text report
```

Kebutuhan utama:

1. Flexible syntax.
2. Strong data model abstraction.
3. Includes/macros/functions.
4. Output format control.
5. Template loader and cache.
6. Custom directives.
7. Safe object exposure.

FreeMarker unggul di area ini.

### 1.4.3 Logic-Less Template Engine

Target:

```text
Simple rendering dengan logic minimal.
```

Contoh:

```text
- Mustache
- Handlebars-style engine
```

Ciri:

```text
Template tidak boleh terlalu pintar.
Data model harus sudah siap render.
```

Kekuatan:

1. Mendorong separation of concerns.
2. Lebih aman dari business logic creep.
3. Cocok untuk template sederhana.
4. Mudah dipakai lintas bahasa.

Kelemahan:

1. Kurang fleksibel untuk layout dan kondisi kompleks.
2. Banyak kebutuhan akhirnya dipindah ke pre-processing Java.
3. Untuk enterprise correspondence kompleks, bisa terlalu terbatas.

Logic-less bukan berarti tanpa risiko. Raw insertion, escaping, dan data boundary tetap penting.

### 1.4.4 Component-Oriented Server UI

Target:

```text
Stateful or component-based server-side UI.
```

Contoh:

```text
- JSF/Jakarta Faces
- Vaadin
```

Bukan fokus seri ini, tetapi penting untuk landscape.

Kekuatan:

1. UI component lifecycle.
2. Complex forms.
3. Server-driven interaction.

Kelemahan:

1. Lebih berat dari text template.
2. Lifecycle kompleks.
3. Tidak cocok untuk email/document rendering.

### 1.4.5 Document Rendering Pipeline

Template engine sering hanya bagian awal pipeline.

Contoh:

```text
FreeMarker/Thymeleaf -> HTML -> PDF renderer -> stored PDF artifact
```

Atau:

```text
Template -> XML -> downstream integration system
```

Di sini template engine bukan satu-satunya keputusan. Kita juga harus memilih:

1. HTML-to-PDF renderer.
2. Font strategy.
3. Asset resolver.
4. Storage/archive model.
5. Digital signature/watermark model.
6. Reproducibility strategy.

---

## 1.5 Kategori Berdasarkan Trust Model

Cara kedua memahami landscape adalah berdasarkan siapa yang menulis template.

### 1.5.1 Developer-Owned Trusted Templates

Template disimpan di source code repository.

```text
src/main/resources/templates/approval-email.ftl
src/main/resources/templates/admin/cases/list.html
```

Karakteristik:

1. Ditulis developer.
2. Direview melalui pull request.
3. Diuji di CI.
4. Dirilis bersama aplikasi.
5. Trust level tinggi.

Risiko tetap ada:

1. Developer bisa lupa escaping.
2. Bisa expose sensitive data.
3. Bisa membuat template terlalu kompleks.
4. Bisa menyebabkan performance issue.

Tetapi SSTI dari external template author relatif kecil karena template tidak diedit runtime oleh user.

### 1.5.2 Business-Owned Semi-Trusted Templates

Template bisa diedit oleh admin/business user melalui UI.

Contoh:

```text
- notification template
- email body
- letter template
- agency-specific correspondence
- tenant-specific footer/header
```

Karakteristik:

1. Template berubah tanpa deployment aplikasi.
2. Ada approval workflow.
3. Ada draft/published/retired state.
4. Template author bukan Java developer.
5. Trust level sedang.

Risiko meningkat tajam:

1. Template injection.
2. Data exfiltration.
3. Infinite/huge loops.
4. Unsafe object access.
5. Broken output.
6. Missing variable.
7. Legal/audit inconsistency.

Untuk model ini, engine harus dipakai dengan sandbox/allowlist, model terbatas, validation pipeline, preview, dan approval.

### 1.5.3 User-Owned Untrusted Templates

External user bisa mengirim template bebas.

Contoh:

```text
- SaaS user custom notification template
- uploaded document template
- self-service report template
```

Ini paling berbahaya.

Aturan keras:

```text
Never evaluate untrusted templates with powerful object access.
```

Jika harus mendukung ini:

1. Gunakan engine yang bisa dibatasi ketat.
2. Jangan expose Java object langsung.
3. Gunakan pure map/scalar data model.
4. Disable dangerous features.
5. Batasi output size.
6. Batasi render timeout.
7. Batasi recursion/loop jika engine mendukung.
8. Jalankan di isolated process jika risiko tinggi.
9. Audit semua render.
10. Validasi template sebelum publish.

Top-tier engineer selalu memisahkan:

```text
Trusted data vs untrusted data.
Trusted template vs untrusted template.
```

Karena kombinasi keduanya menghasilkan threat model berbeda.

---

## 1.6 JSP / Jakarta Pages: Posisi Modern

### 1.6.1 Apa Itu JSP/Jakarta Pages?

Jakarta Pages adalah spesifikasi Jakarta EE untuk template engine web application. Ia mendukung pencampuran textual content seperti HTML/XML dengan custom tags, expression language, dan embedded Java code, lalu dikompilasi menjadi Jakarta Servlet.

Mental model:

```text
JSP source -> translated Servlet Java source -> compiled Servlet class -> executed by container
```

Ini berbeda dari FreeMarker/Thymeleaf sebagai library renderer biasa.

JSP sangat terkait dengan Servlet container.

### 1.6.2 Kekuatan JSP

JSP masih relevan pada kondisi tertentu:

1. Legacy Jakarta EE application.
2. Existing large JSP codebase.
3. Banyak custom taglib internal.
4. Team sudah punya tooling dan operational knowledge.
5. Migration cost tidak sebanding dengan benefit.
6. Page sederhana yang sudah stabil.

JSP juga punya keuntungan historis:

```text
It is standard Jakarta EE technology.
```

Untuk organisasi yang sangat standard-driven, ini bisa menjadi faktor.

### 1.6.3 Kelemahan JSP untuk Sistem Baru

Untuk sistem baru, JSP sering kalah dalam beberapa hal:

1. Developer ergonomics lebih rendah dibanding Thymeleaf untuk Spring MVC modern.
2. Tightly coupled ke web container.
3. Tidak natural template.
4. Tidak cocok untuk standalone rendering service.
5. Tidak ideal untuk email/document generation.
6. Scriptlet legacy sering menjadi technical debt.
7. Testing template bisa lebih berat.

### 1.6.4 Kapan Tetap Memakai JSP?

Gunakan JSP jika:

```text
- aplikasi existing sudah JSP-heavy,
- migration risk tinggi,
- halaman relatif stabil,
- taglib internal sangat banyak,
- budget modernization terbatas,
- platform masih full Jakarta EE container,
- tidak ada kebutuhan kuat untuk natural templates atau standalone rendering.
```

Jangan pakai JSP hanya karena:

```text
- “Java web berarti JSP”,
- “dulu semua project pakai JSP”,
- “lebih standard”,
- “sudah familiar”.
```

### 1.6.5 JSP Migration Mindset

Modernisasi JSP bukan harus rewrite total.

Urutan sehat:

```text
1. Inventory JSP.
2. Klasifikasikan page by complexity/risk.
3. Hilangkan scriptlet.
4. Rapikan controller-model boundary.
5. Extract reusable fragments.
6. Tambahkan visual regression test.
7. Migrasikan high-value pages dulu.
8. Pertahankan stable low-risk JSP jika tidak mengganggu.
```

Migration yang buruk:

```text
Rewrite semua JSP ke Thymeleaf tanpa memahami data model, flow, validation, dan security behavior.
```

---

## 1.7 FreeMarker: Posisi, Kekuatan, dan Risiko

### 1.7.1 Apa FreeMarker Secara Praktis?

FreeMarker adalah Java library untuk menghasilkan text output berdasarkan template dan data model.

Mental model:

```text
Configuration + TemplateLoader + Template + DataModel + Writer -> text output
```

Contoh output:

```text
HTML web page
HTML email
plain text email
XML document
configuration file
generated Java source
generated SQL script
```

### 1.7.2 FreeMarker Sebagai Generic Rendering Engine

FreeMarker unggul saat target output bukan hanya HTML page.

Misalnya:

```text
case-approval-letter.ftlh
case-approval-letter.txt.ftl
case-escalation-notice.ftlh
agency-config.yaml.ftl
generated-client.java.ftl
batch-report.csv.ftl
```

Di sini FreeMarker terasa natural karena ia text-first.

### 1.7.3 FreeMarker dan Data Model

FreeMarker memisahkan:

```text
Template language
Data model
Object wrapping
Output writer
```

Ini bagus untuk arsitektur karena kita bisa membuat boundary:

```text
Domain entity -> View model -> FreeMarker data model -> rendered output
```

Jangan langsung:

```text
JPA entity -> FreeMarker template
```

Kenapa?

1. Lazy loading bisa terjadi saat render.
2. Sensitive fields bisa bocor.
3. Template jadi bergantung pada domain internals.
4. Method access bisa membuka surface area besar.
5. Model contract tidak stabil.

### 1.7.4 FreeMarker Macro dan Directive

FreeMarker kuat karena punya:

```text
- macro
- function
- include
- import
- namespace
- custom directive
- custom method
```

Ini membuatnya cocok untuk template library:

```ftl
<@layout.email title="Application Approved">
  <@components.notice type="success">
    Your application has been approved.
  </@components.notice>
</@layout.email>
```

Tetapi kekuatan ini juga risiko.

Jika tidak digovern:

```text
- macro library menjadi framework tersembunyi,
- logic bisnis masuk template,
- dependency antar-template tidak jelas,
- debugging sulit,
- template author perlu terlalu banyak pengetahuan teknis.
```

### 1.7.5 FreeMarker Security Concern

Area penting:

1. Object wrapper.
2. Method exposure.
3. `?api`-style access.
4. Static/member exposure.
5. Unsafe raw output.
6. User-editable template.
7. Unbounded loops/output.

Aturan sehat:

```text
For trusted developer templates:
  Use strict model discipline and output-format auto-escaping.

For semi-trusted templates:
  Use allowlisted model, restricted wrapper, template validation, preview, approval.

For untrusted templates:
  Avoid powerful FreeMarker features or isolate strongly.
```

### 1.7.6 Kapan FreeMarker Pilihan Kuat?

Pilih FreeMarker jika:

```text
- output-nya banyak format text,
- email/document generation penting,
- perlu custom directives/macros,
- rendering dipakai di batch/background process,
- tidak ingin engine bergantung web container,
- template perlu versioning/catalog,
- ingin satu engine untuk HTML email, text email, XML, generated source/config.
```

### 1.7.7 Kapan FreeMarker Kurang Ideal?

Hindari FreeMarker sebagai pilihan utama jika:

```text
- use case utamanya Spring MVC form-heavy SSR,
- designer butuh natural HTML preview kuat,
- template author non-technical dan logic harus sangat dibatasi,
- tim tidak siap mengatur object exposure/security,
- template harus semirip mungkin dengan static HTML prototype.
```

---

## 1.8 Thymeleaf: Posisi, Kekuatan, dan Risiko

### 1.8.1 Apa Thymeleaf Secara Praktis?

Thymeleaf adalah server-side Java template engine untuk web dan standalone environment. Ia terkenal karena natural templates: template bisa dibuka di browser sebagai static prototype sekaligus dirender dinamis oleh server.

Mental model:

```text
HTML prototype + th:* attributes + context/model -> rendered HTML
```

Contoh:

```html
<tr th:each="case : ${cases}">
  <td th:text="${case.referenceNo}">CASE-0001</td>
  <td th:text="${case.status}">OPEN</td>
</tr>
```

Saat dibuka statis, browser masih melihat HTML valid-ish dengan contoh data.

### 1.8.2 Thymeleaf Natural Template Advantage

Natural template berguna ketika:

1. Designer ingin membuka template tanpa server.
2. Static prototype harus dekat dengan runtime template.
3. HTML harus tetap readable.
4. UI collaboration antara backend dan frontend/designer penting.
5. Internal admin portal butuh SSR sederhana.

Ini berbeda dari FreeMarker:

```ftl
<#list cases as case>
  <tr>
    <td>${case.referenceNo}</td>
    <td>${case.status}</td>
  </tr>
</#list>
```

FreeMarker lebih text-template-like; Thymeleaf lebih DOM-attribute transformation.

### 1.8.3 Thymeleaf dan Spring MVC

Thymeleaf sangat kuat di Spring MVC karena:

1. Integrasi dengan model attributes.
2. Form binding.
3. Validation error rendering.
4. CSRF token support via Spring Security integration.
5. MessageSource/i18n integration.
6. URL generation.
7. Spring Expression Language.
8. Fragment/layout composition.

Untuk admin portal CRUD/form-heavy, Thymeleaf sering lebih ergonomis daripada FreeMarker.

### 1.8.4 Thymeleaf Template Modes

Thymeleaf tidak hanya HTML.

Ia mendukung beberapa template mode, seperti:

```text
HTML
XML
TEXT
JAVASCRIPT
CSS
RAW
```

Tetapi perlu hati-hati.

Meskipun Thymeleaf bisa text mode, bukan berarti ia selalu engine terbaik untuk semua text generation. Untuk generated source/config yang sangat text-heavy dan macro-heavy, FreeMarker sering terasa lebih pas.

### 1.8.5 Thymeleaf Security Concern

Security utama:

1. `th:text` escaped output.
2. `th:utext` raw/unescaped output.
3. URL expression injection.
4. Inline JavaScript.
5. Hidden fields leaking sensitive data.
6. Authorization-based UI rendering yang disalahpahami sebagai backend authorization.
7. Expression injection jika template atau expression berasal dari user.

Aturan sehat:

```text
Use th:text by default.
Treat th:utext as security exception.
Never assume hidden UI means forbidden backend action.
Never expose broad entity graph just because template can access it.
```

### 1.8.6 Kapan Thymeleaf Pilihan Kuat?

Pilih Thymeleaf jika:

```text
- output utama adalah HTML page,
- memakai Spring MVC,
- butuh form binding dan validation rendering,
- butuh natural templates,
- butuh reusable HTML fragments,
- ingin server-side rendered admin/internal portal,
- designer/backend collaboration penting,
- HTML correctness dan previewability penting.
```

### 1.8.7 Kapan Thymeleaf Kurang Ideal?

Hindari Thymeleaf sebagai default jika:

```text
- output utama adalah generated source/config/text,
- template bukan HTML-oriented,
- butuh macro DSL yang sangat text-heavy,
- rendering batch besar lebih penting daripada interactive web view,
- template akan diedit sebagai arbitrary text oleh business user,
- natural HTML preview tidak memberi value.
```

---

## 1.9 Mustache dan Handlebars-Style Engine

### 1.9.1 Logic-Less Philosophy

Mustache dikenal dengan philosophy:

```text
logic-less templates
```

Artinya template tidak diberi kemampuan logic yang terlalu kuat.

Contoh konsep:

```mustache
Hello {{name}}

{{#approved}}
Your application has been approved.
{{/approved}}

{{#items}}
- {{label}}
{{/items}}
```

Template tidak melakukan query, transformasi berat, atau business branching kompleks.

### 1.9.2 Kekuatan Logic-Less Template

Kekuatan:

1. Memaksa data model siap render.
2. Lebih mudah diaudit.
3. Lebih sedikit peluang business logic masuk template.
4. Bisa dipakai lintas platform/language.
5. Cocok untuk simple notification/template.

### 1.9.3 Kelemahan Logic-Less Template

Kelemahan:

1. Conditional kompleks menjadi canggung.
2. Layout kompleks butuh extension/helper.
3. Reuse pattern terbatas tergantung implementation.
4. Banyak logic pindah ke Java pre-rendering layer.
5. Bisa menyebabkan view model explosion.

### 1.9.4 Kapan Mustache Cocok?

Cocok jika:

```text
- template sederhana,
- template author non-technical,
- output sederhana,
- logic harus dibatasi,
- same template ingin dipakai lintas bahasa,
- rendering contract sangat eksplisit.
```

Kurang cocok jika:

```text
- correspondence punya banyak conditional/legal clause,
- layout kompleks,
- perlu macro/component library kaya,
- perlu custom formatting/directives mendalam.
```

### 1.9.5 Logic-Less Bukan Berarti Aman Otomatis

Kesalahan umum:

```text
Mustache logic-less, berarti aman.
```

Tidak.

Masih ada risiko:

1. Raw/unescaped insertion.
2. Wrong escaping context.
3. Template injection jika template user-controlled.
4. Sensitive data leakage.
5. Prompt/template injection untuk non-HTML output.
6. Structural injection jika output masuk sistem lain.

Escaping harus selalu dipahami berdasarkan target output, bukan berdasarkan nama engine.

---

## 1.10 Pebble

### 1.10.1 Posisi Pebble

Pebble adalah Java template engine yang banyak terinspirasi oleh Twig/Jinja-style syntax.

Secara konsep:

```text
Readable template syntax + inheritance + filters/functions + autoescaping support
```

Contoh gaya syntax:

```twig
{% extends "layout" %}

{% block content %}
  <h1>{{ title }}</h1>
{% endblock %}
```

Pebble sering menarik bagi engineer yang menyukai syntax ala Twig/Jinja.

### 1.10.2 Kekuatan Pebble

Kekuatan umum:

1. Syntax familiar untuk banyak developer web.
2. Template inheritance model jelas.
3. Filters/functions expressive.
4. Bisa dipakai untuk web dan text rendering.
5. Autoescaping support pada konfigurasi yang tepat.
6. Lebih modern dibanding Velocity dalam beberapa aspek.

### 1.10.3 Kelemahan Pebble dalam Enterprise Java

Kelemahan relatif:

1. Ekosistem tidak se-dominan Thymeleaf di Spring MVC.
2. Tidak se-historis FreeMarker untuk enterprise text generation.
3. Knowledge base tim mungkin lebih kecil.
4. Jika organisasi sudah punya FreeMarker/Thymeleaf, tambahan engine perlu justifikasi kuat.

### 1.10.4 Kapan Pebble Layak Dipilih?

Pebble layak jika:

```text
- tim menyukai Twig/Jinja-style syntax,
- butuh inheritance/filter model yang rapi,
- use case web/text general-purpose,
- framework integration tersedia dan stabil,
- organisasi belum terkunci pada FreeMarker/Thymeleaf,
- template author trusted developer.
```

Tetapi untuk seri ini, fokus utama tetap FreeMarker dan Thymeleaf karena keduanya sangat umum dalam Java/Spring/Jakarta ecosystem dan mencakup dua kutub besar: generic text rendering dan natural HTML rendering.

---

## 1.11 Apache Velocity

### 1.11.1 Posisi Velocity

Velocity adalah template engine lama di ekosistem Java. Banyak legacy system masih memilikinya.

Gaya syntax:

```velocity
Hello $user.name

#foreach($item in $items)
  - $item.label
#end
```

Velocity penting untuk dipahami terutama dalam konteks legacy modernization.

### 1.11.2 Kekuatan Velocity

1. Sederhana.
2. Historis banyak dipakai.
3. Cocok untuk text generation sederhana.
4. Banyak engineer lama familiar.

### 1.11.3 Kelemahan Velocity Dibanding Alternatif Modern

Dalam sistem baru, Velocity sering kalah karena:

1. FreeMarker lebih kuat dan matang untuk banyak kebutuhan advanced.
2. Thymeleaf lebih baik untuk HTML natural templates.
3. Security/escaping modern perlu perhatian ekstra.
4. Tooling/ekosistem modern lebih sering mengarah ke FreeMarker/Thymeleaf.
5. Legacy Velocity template sering penuh logic dan implicit assumptions.

### 1.11.4 Kapan Velocity Masih Relevan?

Velocity masih relevan jika:

```text
- sistem existing sudah Velocity-heavy,
- template stabil,
- migration tidak memberi value besar,
- risiko perubahan lebih tinggi dari manfaat,
- ada wrapper rendering service yang aman.
```

Tetapi untuk sistem baru, biasanya lebih masuk akal memilih FreeMarker, Thymeleaf, Pebble, atau Mustache tergantung kebutuhan.

---

## 1.12 Comparison Matrix

Matrix berikut bukan angka absolut, tetapi cara berpikir.

### 1.12.1 High-Level Comparison

| Engine | Best Fit | Output Orientation | Strength | Main Risk |
|---|---|---:|---|---|
| JSP / Jakarta Pages | Legacy Jakarta EE web page | HTML web | Standard Servlet/Jakarta integration | Legacy scriptlet, container coupling |
| FreeMarker | Email, document, generated text, mixed output | General text | Powerful macros/directives, generic output | Too much logic, object exposure |
| Thymeleaf | Spring MVC SSR, admin portal, form-heavy HTML | HTML/DOM | Natural templates, Spring integration | Misuse for non-HTML, `th:utext`, complex fragments |
| Mustache | Simple safe-ish template with prepared model | Simple text/HTML | Logic-less discipline | Too limited for complex workflows |
| Pebble | Twig/Jinja-like Java templates | Web/text | Inheritance/filter model | Smaller mindshare than FreeMarker/Thymeleaf |
| Velocity | Legacy text generation | General text | Simple, familiar legacy engine | Less attractive for new systems |

### 1.12.2 Expressiveness

| Engine | Expressiveness | Notes |
|---|---:|---|
| FreeMarker | High | Macro, function, directive, object wrapping, built-ins |
| Thymeleaf | High for HTML | Strong expressions/fragments, especially Spring MVC |
| JSP | Medium-High | EL/taglibs/scriptlets, but legacy risk |
| Pebble | Medium-High | Inheritance, filters/functions |
| Velocity | Medium | Simple scripting-like template language |
| Mustache | Low-Medium | Intentionally limited |

High expressiveness is not always good. It gives power but increases governance burden.

### 1.12.3 Safety by Default

| Engine | Safety Consideration |
|---|---|
| Thymeleaf | `th:text` escapes, but `th:utext` is dangerous if misused |
| FreeMarker | Modern output formats/auto-escaping help, but configuration matters |
| Mustache | Usually escaped variable by default depending implementation, raw insertion still risky |
| JSP | EL/taglibs can be safe, but legacy scriptlets/raw output common |
| Pebble | Can support autoescaping depending configuration |
| Velocity | Requires careful escaping discipline |

Important:

```text
No engine is safe if data model and output context are wrong.
```

### 1.12.4 Designer-Friendliness

| Engine | Designer-Friendliness | Why |
|---|---:|---|
| Thymeleaf | High | Natural HTML templates |
| JSP | Medium | HTML-like but JSP tags/scriptlets reduce static preview quality |
| FreeMarker | Medium | Readable but not natural HTML |
| Mustache | Medium | Simple syntax, but preview depends tooling |
| Pebble | Medium | Clean syntax, not natural HTML |
| Velocity | Medium-Low | Legacy syntax mixed into output |

### 1.12.5 Email Suitability

| Engine | Email Suitability | Notes |
|---|---:|---|
| FreeMarker | Very High | Text/HTML email, macros, non-web rendering |
| Thymeleaf | High | Good HTML email support, natural HTML useful |
| Mustache | Medium-High | Good for simple email |
| Pebble | Medium-High | Good if team adopts it |
| Velocity | Medium | Legacy email systems often use it |
| JSP | Low | Tied to web container; not ideal for email rendering |

### 1.12.6 Document Generation Suitability

| Engine | Suitability | Notes |
|---|---:|---|
| FreeMarker | Very High | HTML/XML/text pre-render, source/config generation |
| Thymeleaf | High for HTML/XML documents | Especially HTML-to-PDF pre-render |
| Pebble | Medium-High | Good general template engine |
| Mustache | Medium | Good for simple docs |
| Velocity | Medium | Legacy text generation |
| JSP | Low | Web page-oriented |

### 1.12.7 Spring MVC Suitability

| Engine | Suitability |
|---|---:|
| Thymeleaf | Very High |
| FreeMarker | Medium-High |
| JSP | Medium, depending app packaging/container |
| Pebble | Medium |
| Mustache | Medium |
| Velocity | Low-Medium for new systems |

### 1.12.8 Runtime Template Editing Suitability

| Engine | Suitability | Warning |
|---|---:|---|
| Mustache | High for simple safe templates | Still needs escaping/model controls |
| FreeMarker | High capability | Needs serious sandbox/governance |
| Pebble | Medium-High | Needs feature controls |
| Thymeleaf | Medium | Better for developer-owned HTML templates |
| Velocity | Medium | Legacy risks |
| JSP | Low | Not intended for business-owned runtime templates |

---

## 1.13 Decision Framework: Memilih Engine Berdasarkan Use Case

### 1.13.1 Use Case: Internal Admin Portal

Kebutuhan:

```text
- HTML pages
- forms
- validation errors
- CSRF
- role-based UI
- pagination
- table/list/detail
- moderate interactivity
- Spring MVC integration
```

Pilihan utama:

```text
Thymeleaf
```

Alternatif:

```text
FreeMarker if already standardized
JSP if legacy Jakarta EE
SPA if interactivity high
```

Rule of thumb:

```text
If it is Spring MVC + forms + SSR, start by considering Thymeleaf.
```

### 1.13.2 Use Case: Email Notification Platform

Kebutuhan:

```text
- HTML email
- plain text alternative
- localization
- tenant branding
- versioning
- preview
- batch rendering
- audit trail
```

Pilihan utama:

```text
FreeMarker or Thymeleaf
```

FreeMarker lebih kuat jika:

```text
- banyak non-HTML output,
- macro library text-heavy,
- template catalog general-purpose,
- email + generated documents berbagi engine.
```

Thymeleaf lebih kuat jika:

```text
- email HTML design collaboration penting,
- natural template preview memberi value,
- tim sudah kuat Thymeleaf.
```

### 1.13.3 Use Case: PDF Letter / Legal Document

Kebutuhan:

```text
- reproducible output
- versioned template
- immutable snapshot
- precise layout
- HTML-to-PDF or document pipeline
- audit/legal defensibility
```

Pilihan utama:

```text
FreeMarker for generic text/HTML pre-render
Thymeleaf for HTML-oriented pre-render
```

Keputusan tidak hanya engine. Harus mencakup:

```text
- PDF renderer
- font strategy
- asset strategy
- storage/archive
- template version
- data snapshot
- test strategy
```

### 1.13.4 Use Case: Generated Source Code / Config

Kebutuhan:

```text
- plain text generation
- structured indentation
- loops
- conditionals
- macro reuse
- deterministic output
```

Pilihan utama:

```text
FreeMarker
```

Alternatif:

```text
Pebble
Mustache for very simple generation
StringTemplate for strict code generation style
```

Thymeleaf biasanya bukan pilihan natural untuk generated source/config.

### 1.13.5 Use Case: Business-Editable Notification Templates

Kebutuhan:

```text
- runtime editing
- preview
- approval
- versioning
- restricted variables
- safe rendering
- audit
```

Pilihan bisa:

```text
Mustache for simple templates
FreeMarker with restricted configuration for advanced templates
Pebble with controls
```

Hindari:

```text
Full-power templates exposed to business users without sandbox.
```

Jika business user hanya butuh placeholders sederhana:

```text
Dear {{recipientName}}, your case {{caseNo}} is approved.
```

Maka jangan beri FreeMarker full power.

Gunakan placeholder DSL sederhana atau restricted Mustache-like system.

### 1.13.6 Use Case: Legacy JSP Modernization

Kebutuhan:

```text
- reduce scriptlet
- modernize UI gradually
- preserve behavior
- avoid big-bang rewrite
```

Pilihan:

```text
JSP cleanup first
Then migrate selected pages to Thymeleaf or SPA
Use FreeMarker for non-web templates
```

Jangan langsung rewrite semua.

### 1.13.7 Use Case: Multi-Tenant Correspondence System

Kebutuhan:

```text
- tenant template override
- agency branding
- effective date
- approval flow
- immutable rendered artifact
- localization
- role-based variable exposure
```

Pilihan utama:

```text
FreeMarker with governance layer
or restricted template DSL on top of FreeMarker/Mustache
```

Thymeleaf bisa untuk HTML preview/document layout, tetapi governance layer tetap wajib.

---

## 1.14 Decision Matrix yang Bisa Dipakai di Architecture Review

Gunakan matrix ini saat membuat ADR.

### 1.14.1 Questions

```text
1. What output formats must be supported?
2. Is the output primarily HTML page, HTML email, text, XML, PDF pre-render, or generated code?
3. Is the template developer-owned, business-owned, or user-owned?
4. Are templates deployed with application or edited at runtime?
5. What is the trust level of template authors?
6. What is the trust level of data inputs?
7. Is auto-escaping available and enabled for the target format?
8. Does the engine support the required localization model?
9. Does the team need natural HTML preview?
10. Does the team need macro/component reuse?
11. Does the system require form binding and validation rendering?
12. Does the output become legal/audit artifact?
13. Does the system need versioned template publishing?
14. What are render latency and throughput requirements?
15. How will template failures be observed and classified?
16. Can templates be tested in CI?
17. Can unsafe features be restricted?
18. What is the migration/operational cost?
```

### 1.14.2 Scoring Example

| Criterion | Weight | JSP | FreeMarker | Thymeleaf | Mustache | Pebble |
|---|---:|---:|---:|---:|---:|---:|
| HTML page rendering | 5 | 3 | 3 | 5 | 3 | 4 |
| Email rendering | 5 | 1 | 5 | 4 | 4 | 4 |
| PDF pre-render | 4 | 1 | 5 | 4 | 3 | 4 |
| Natural HTML preview | 3 | 2 | 2 | 5 | 2 | 2 |
| Runtime business editing | 5 | 1 | 3 | 2 | 4 | 3 |
| Expressiveness | 4 | 3 | 5 | 4 | 2 | 4 |
| Safety governability | 5 | 2 | 3 | 4 | 4 | 3 |
| Spring MVC forms | 5 | 2 | 3 | 5 | 2 | 3 |
| Non-web output | 5 | 1 | 5 | 3 | 3 | 4 |
| Legacy compatibility | 3 | 5 | 3 | 3 | 2 | 2 |

Important:

```text
Score is not universal.
Weight depends on system context.
```

For example:

```text
If the system is an internal Spring MVC admin portal,
Thymeleaf likely wins.

If the system is an enterprise correspondence generator,
FreeMarker likely wins.

If the system is a simple business-editable notification platform,
Mustache or a restricted placeholder DSL may win.
```

---

## 1.15 Anti-Pattern Memilih Template Engine

### 1.15.1 Karena Default Tutorial

```text
Spring tutorial pakai Thymeleaf, jadi semua output pakai Thymeleaf.
```

Salah.

Thymeleaf bagus untuk SSR HTML. Tapi untuk generated source/config atau text-heavy templates, FreeMarker bisa lebih tepat.

### 1.15.2 Karena Sudah Ada di Classpath

```text
FreeMarker sudah dipakai email, jadi admin portal juga pakai FreeMarker.
```

Mungkin benar, mungkin tidak.

Reuse library mengurangi complexity, tetapi jangan memaksakan engine yang tidak cocok untuk use case.

### 1.15.3 Karena Engine Lebih Cepat Menurut Benchmark Umum

Benchmark umum sering tidak relevan.

Yang penting:

```text
- template size,
- cache behavior,
- model shape,
- output size,
- escaping,
- macro/fragment complexity,
- I/O sink,
- concurrency model,
- warmup,
- GC profile.
```

Engine tercepat di microbenchmark belum tentu terbaik untuk maintainability atau security.

### 1.15.4 Karena Designer Friendly Saja

Natural template bagus, tapi bukan satu-satunya faktor.

Untuk email/legal document, mungkin designer preview penting. Tetapi auditability, versioning, escaping, and reproducibility bisa lebih penting.

### 1.15.5 Karena Ingin Business User Bisa Edit Template

Business-editable templates bukan sekadar menyimpan `.ftl` di database.

Butuh:

1. Template lifecycle.
2. Approval flow.
3. Sandbox.
4. Preview.
5. Model contract validation.
6. Audit trail.
7. Rollback.
8. Compatibility checking.
9. Security review.

Tanpa ini, runtime editable template menjadi production risk.

### 1.15.6 Karena Ingin Semua Output Pakai Satu Engine

Standardisasi bagus, tetapi terlalu ekstrem berbahaya.

Contoh buruk:

```text
Semua: HTML page, email, PDF, XML, generated Java, config, notification
harus pakai Thymeleaf karena satu engine.
```

Lebih sehat:

```text
Use one default engine per output class, not one engine for all things blindly.
```

Contoh:

```text
Thymeleaf -> SSR admin pages
FreeMarker -> email/document/text generation
Mustache/restricted DSL -> simple business-editable snippets
```

---

## 1.16 Template Engine dan Architectural Boundaries

Template engine tidak boleh menjadi tempat semua boundary bocor.

### 1.16.1 Controller Boundary

Buruk:

```java
model.addAttribute("case", caseEntity);
model.addAttribute("user", currentUserEntity);
model.addAttribute("permissions", permissionService);
```

Template bisa mengakses terlalu banyak.

Lebih baik:

```java
CaseDetailView view = casePresenter.toDetailView(caseId, currentUser);
model.addAttribute("view", view);
```

Template hanya tahu:

```text
view.referenceNo
view.statusLabel
view.canApprove
view.canReject
view.timeline
view.visibleActions
```

### 1.16.2 Domain Boundary

Template tidak boleh memanggil domain behavior penting.

Buruk:

```text
${case.calculatePenalty()}
${case.canTransitionTo('APPROVED')}
```

Lebih baik:

```text
${view.penaltyDisplay}
${view.allowedActions.approve}
```

Domain decision terjadi sebelum rendering.

### 1.16.3 Persistence Boundary

Template tidak boleh memicu lazy loading/N+1.

Buruk:

```html
<tr th:each="item : ${cases}">
  <td th:text="${item.owner.department.name}"></td>
</tr>
```

Jika `owner.department` lazy, render bisa memicu banyak query.

Lebih baik:

```text
Repository query -> projection -> view model -> template
```

### 1.16.4 Security Boundary

Template boleh menyembunyikan tombol, tapi backend tetap harus enforce permission.

Buruk mental model:

```text
User tidak melihat button Approve, jadi aman.
```

Benar:

```text
UI rendering improves UX.
Backend authorization enforces security.
```

### 1.16.5 Audit Boundary

Untuk dokumen legal/correspondence, hasil render adalah artifact.

Harus tahu:

```text
- template id
- template version
- model snapshot
- render timestamp
- locale/timezone
- renderer version
- output hash
```

Tanpa itu, sulit menjelaskan dokumen yang pernah dikirim.

---

## 1.17 Multi-Engine Architecture: Kapan Boleh?

Banyak engineer takut memakai lebih dari satu engine.

Padahal multi-engine bisa benar jika boundary jelas.

### 1.17.1 Contoh Multi-Engine yang Sehat

```text
Spring MVC admin portal:
  Thymeleaf

Email and letter generation:
  FreeMarker

Business-editable short SMS templates:
  Restricted Mustache-like placeholder engine
```

Kenapa sehat?

1. Tiap engine punya output class jelas.
2. Ownership jelas.
3. Security profile berbeda.
4. Testing pipeline berbeda.
5. Template repository/catalog jelas.

### 1.17.2 Contoh Multi-Engine yang Buruk

```text
Some emails use JSP.
Some emails use FreeMarker.
Some emails use Thymeleaf.
Some admin pages use FreeMarker.
Some use Thymeleaf.
Some generated PDFs use Velocity.
No one knows why.
```

Masalah:

1. Knowledge fragmented.
2. Testing sulit.
3. Security rules inconsistent.
4. Template versioning kacau.
5. Migration sulit.
6. Operational debugging sulit.

### 1.17.3 Rule of Thumb

```text
Multiple engines are acceptable when separated by output class and governance.
Multiple engines are dangerous when separated by accident and history only.
```

---

## 1.18 Template Engine dan Java 8–25

Seri ini mencakup Java 8 sampai Java 25. Pilihan template engine perlu mempertimbangkan runtime Java.

### 1.18.1 Java 8 Baseline

Banyak enterprise system masih punya Java 8 legacy.

Hal yang relevan:

1. `java.time` tersedia sejak Java 8.
2. Lambda/stream bisa membantu model preparation, tetapi jangan overuse.
3. Banyak versi library modern mungkin sudah menaikkan baseline Java.
4. Jika engine versi terbaru tidak support Java 8, gunakan versi kompatibel atau rencanakan upgrade.

### 1.18.2 Java 11/17 LTS Baseline

Java 11/17 sering menjadi baseline enterprise modern.

Relevansi:

1. Better runtime performance.
2. Better container awareness dibanding Java 8 update lama.
3. String/memory behavior lebih baik dibanding era awal.
4. Spring Boot modern cenderung bergerak ke baseline Java lebih tinggi.

### 1.18.3 Java 21/25 Modern Runtime

Untuk Java 21+ dan Java 25:

1. Virtual threads bisa membantu workload I/O-bound sekitar render-send pipeline, tetapi render CPU-bound tetap CPU-bound.
2. Structured concurrency dapat membantu orchestration batch rendering jika digunakan dengan benar.
3. Modern GC dapat membantu workload banyak allocation, tetapi jangan jadikan GC sebagai alasan membuat output besar di memory tanpa kontrol.
4. JFR sangat berguna untuk profiling render latency/allocation.

### 1.18.4 Prinsip Kompatibilitas

Template system harus dirancang agar:

```text
- engine version jelas,
- Java baseline jelas,
- template syntax version jelas,
- output rendering deterministic,
- migration test tersedia,
- generated artifact bisa dibandingkan antar versi runtime.
```

Jika upgrade Java mengubah formatting locale/date/number tertentu, test harus menangkap.

---

## 1.19 Performance Landscape

Performance template engine harus dilihat sebagai pipeline.

```text
resolve template
load template
parse/compile internal representation
cache template
evaluate model/expression
apply escaping/formatting
write output
flush to sink
```

### 1.19.1 Bottleneck Umum

1. Template tidak tercache.
2. Template loader lambat.
3. Data model terlalu besar.
4. Template memicu lazy loading.
5. Macro/fragment terlalu nested.
6. Output besar ditampung penuh di `StringWriter`.
7. Escaping/formatting berulang.
8. Rendering batch tanpa backpressure.
9. PDF generation dianggap bagian dari template engine padahal bottleneck di PDF renderer.
10. Email send latency disangka render latency.

### 1.19.2 FreeMarker vs Thymeleaf Performance

Jangan klaim absolut tanpa benchmark.

Secara mental model:

```text
FreeMarker often feels lean for text generation.
Thymeleaf does more DOM/template-mode oriented processing for HTML use cases.
```

Tetapi performa nyata tergantung:

1. Template size.
2. Cache enabled/disabled.
3. Model access pattern.
4. Escaping mode.
5. Macro/fragment complexity.
6. Output size.
7. JVM warmup.
8. Allocation behavior.

Part 30 akan membahas benchmark lab.

### 1.19.3 Performance Decision Rule

```text
Choose engine based on fit first.
Then benchmark your own templates.
Then optimize cache/model/output pipeline.
```

Jangan memilih engine hanya dari benchmark blog.

---

## 1.20 Security Landscape

Template engine berada di boundary output. Security tidak bisa diperlakukan sebagai fitur tambahan.

### 1.20.1 Tiga Jenis Risiko Besar

```text
1. Output injection
2. Template injection
3. Data leakage
```

### 1.20.2 Output Injection

Contoh:

```text
User input masuk HTML tanpa escaping -> XSS.
User input masuk JS string tanpa JS escaping -> script injection.
User input masuk URL tanpa validation -> unsafe redirect/link.
User input masuk XML tanpa escaping -> broken XML/injection.
```

Rule:

```text
Escaping depends on output context.
HTML escaping is not universal escaping.
```

### 1.20.3 Template Injection

Terjadi jika attacker bisa mengontrol template expression.

Contoh konseptual:

```text
Hello ${attackerControlledExpression}
```

Jika engine mengevaluasi expression dengan akses object kuat, risiko bisa besar.

Rule:

```text
Untrusted users should control data, not executable template logic.
```

### 1.20.4 Data Leakage

Template bisa membocorkan data jika model terlalu luas.

Buruk:

```text
Expose currentUser entity with email, roles, internal flags, tokens, audit fields.
```

Lebih baik:

```text
Expose CurrentUserView(name, displayRole, allowedActions)
```

Security bukan hanya escaping. Security juga tentang data minimization.

### 1.20.5 Template Author Trust Matrix

| Template Author | Recommended Approach |
|---|---|
| Developer | Full engine features allowed with code review and tests |
| Internal business admin | Restricted features, approved variable catalog, preview, approval |
| External user | Minimal placeholder DSL or strongly sandboxed engine |
| Unknown/untrusted | Do not execute arbitrary template logic |

---

## 1.21 Maintainability Landscape

Template code juga code.

### 1.21.1 Template Smells

1. Nested conditionals lebih dari 3 level.
2. Loop dalam loop dalam loop.
3. Template membaca deep graph: `a.b.c.d.e`.
4. Banyak duplicated fragments.
5. Business terms dihitung di template.
6. `raw`/unescaped output tersebar.
7. Template bergantung pada entity internals.
8. Tidak ada sample model.
9. Tidak ada snapshot tests.
10. Tidak ada owner.

### 1.21.2 Maintainability Rule

```text
If a template is hard to read, first fix the model.
```

Sering template kompleks bukan karena syntax engine buruk, tetapi karena view model buruk.

### 1.21.3 Template as API Consumer

Template adalah consumer dari model API.

Jika Java code menyediakan:

```json
{
  "case": {
    "status": "A",
    "workflow": {
      "state": {
        "code": "APPROVED"
      }
    }
  }
}
```

Template akan menjadi penuh mapping:

```text
<#if case.workflow.state.code == "APPROVED">
```

Lebih baik model rendering:

```json
{
  "statusLabel": "Approved",
  "approved": true,
  "visibleActions": []
}
```

Template menjadi:

```text
<#if approved>
```

Atau Thymeleaf:

```html
<section th:if="${view.approved}">
```

---

## 1.22 Governance Landscape

Enterprise template system butuh governance.

### 1.22.1 Template Inventory

Harus tahu:

```text
- template id
- file/path/source
- output format
- owner
- engine
- model contract
- version
- last modified
- active/retired
- dependencies
```

### 1.22.2 Template Lifecycle

Untuk template penting:

```text
draft -> reviewed -> approved -> active -> retired
```

### 1.22.3 Template Versioning

Pertanyaan:

```text
Jika template berubah hari ini, apakah dokumen lama ikut berubah saat di-render ulang?
```

Untuk legal/audit artifact, jawaban biasanya:

```text
No. Use the exact template version and data snapshot used at original rendering.
```

### 1.22.4 Template Ownership

Setiap template harus punya owner:

```text
- technical owner
- business owner
- approver
- security reviewer if high-risk
```

Tanpa owner, template menjadi configuration debt.

---

## 1.23 Engine Selection by Output Class

Gunakan mapping ini sebagai starting point.

### 1.23.1 HTML Web Pages

Default consideration:

```text
Thymeleaf for Spring MVC SSR.
JSP only for existing Jakarta EE legacy.
FreeMarker if already standardized and page complexity moderate.
```

### 1.23.2 HTML Email

Default consideration:

```text
FreeMarker or Thymeleaf.
```

FreeMarker jika email bagian dari correspondence/document platform.

Thymeleaf jika HTML design/prototype workflow lebih penting.

### 1.23.3 Plain Text Email/SMS

Default consideration:

```text
FreeMarker for advanced templates.
Mustache/restricted placeholder for simple business-editable templates.
```

### 1.23.4 PDF Pre-Render HTML

Default consideration:

```text
FreeMarker or Thymeleaf.
```

Pilih berdasarkan:

```text
- HTML natural preview needed? Thymeleaf.
- Mixed text outputs and macros? FreeMarker.
```

### 1.23.5 XML

Default consideration:

```text
FreeMarker or Thymeleaf XML mode.
```

Tetapi untuk complex XML, pertimbangkan juga:

```text
Use XML APIs or marshalling if strict schema binding is needed.
```

Template XML rawan broken output jika escaping/structure tidak disiplin.

### 1.23.6 CSV

Hati-hati.

CSV terlihat sederhana tetapi punya escaping sendiri.

Jika CSV kompleks:

```text
Use CSV library.
```

Template engine bisa untuk fixed report sederhana, tetapi jangan abaikan CSV injection, quote escaping, delimiter, newline.

### 1.23.7 Generated Java/SQL/Config

Default consideration:

```text
FreeMarker.
```

Tetapi untuk generated Java code serius, pertimbangkan:

```text
JavaPoet-like code generation model
or structured generator
```

Template engine bagus untuk output text, tetapi AST/code model bisa lebih aman untuk source code kompleks.

---

## 1.24 Practical Architecture Patterns

### 1.24.1 Pattern: Dedicated Rendering Service Layer

Jangan panggil engine langsung dari semua tempat.

Buruk:

```java
configuration.getTemplate("x.ftl").process(model, writer);
```

tersebar di controller, service, batch, listener.

Lebih baik:

```java
public interface TemplateRenderingService {
    RenderedOutput render(RenderRequest request);
}
```

Dengan request:

```java
public record RenderRequest(
    TemplateId templateId,
    TemplateVersion version,
    OutputFormat outputFormat,
    Locale locale,
    ZoneId zoneId,
    Map<String, Object> model,
    RenderPurpose purpose
) {}
```

Keuntungan:

1. Centralized error handling.
2. Centralized metrics.
3. Centralized security checks.
4. Centralized model validation.
5. Easier engine migration.
6. Easier testing.

### 1.24.2 Pattern: Presenter/ViewModel Before Template

```text
Domain -> Application service -> Presenter -> ViewModel -> Template
```

Bukan:

```text
Domain Entity -> Template
```

### 1.24.3 Pattern: Template Catalog

```text
TemplateId: correspondence.approval.notice
Engine: FreeMarker
Output: HTML_EMAIL
Version: 3.2.0
Locale: en-SG
Status: ACTIVE
Path: templates/correspondence/approval-notice.ftlh
Model contract: ApprovalNoticeModel v2
```

### 1.24.4 Pattern: Render Result Metadata

Rendered output harus membawa metadata:

```java
public record RenderedOutput(
    byte[] content,
    String contentType,
    Charset charset,
    TemplateId templateId,
    TemplateVersion templateVersion,
    Instant renderedAt,
    String contentHash
) {}
```

### 1.24.5 Pattern: Preview with Sample Models

Untuk business template:

```text
Template + sample model -> preview output
```

Sample model harus versioned.

---

## 1.25 Case Study: Memilih Engine untuk Regulatory Case Management

Bayangkan sistem case management enterprise dengan kebutuhan:

```text
- Internal officer portal
- Case detail page
- Approval/rejection forms
- Email notifications
- Official notice PDF
- Reminder letters
- Audit trail
- Multi-agency branding
- Template approval workflow
```

### 1.25.1 Bad Architecture

```text
Use Thymeleaf for everything because Spring Boot.
```

Masalah:

1. Email/PDF/text generation dipaksa DOM-oriented.
2. Business-owned templates sulit digovern.
3. Generated plain text jadi tidak natural.
4. Template responsibilities kabur.

Atau:

```text
Use FreeMarker for everything because powerful.
```

Masalah:

1. Admin forms lebih manual.
2. Designer preview kurang natural.
3. Spring MVC form binding kurang ergonomis.

### 1.25.2 Better Architecture

```text
Officer portal SSR:
  Thymeleaf

Email and official notice rendering:
  FreeMarker

Simple business editable SMS snippets:
  Restricted placeholder DSL / Mustache-like engine

PDF generation:
  FreeMarker HTML pre-render -> PDF renderer -> archive
```

### 1.25.3 Boundary

```text
Thymeleaf templates cannot be used for legal correspondence unless registered in template catalog.
FreeMarker correspondence templates must have version and approval.
Business-editable templates cannot access Java objects directly.
All rendered legal artifacts store template version + data snapshot hash.
```

Ini contoh keputusan top-tier: bukan fanboy engine, tetapi architecture by invariant.

---

## 1.26 Common Misconceptions

### 1.26.1 “Template Engine Itu Cuma View Layer”

Salah.

Untuk web page, iya, ia view layer.

Tetapi untuk enterprise system, template engine bisa menjadi:

```text
- correspondence generator
- notification renderer
- legal artifact producer
- integration file generator
- code/config generator
- audit artifact renderer
```

### 1.26.2 “Kalau Sudah SPA, Backend Tidak Butuh Template”

Salah.

Backend masih sering bertanggung jawab atas:

```text
- email
- PDF
- exports
- server-rendered error pages
- notification bodies
- legal documents
```

### 1.26.3 “FreeMarker Lebih Powerful, Jadi Selalu Lebih Baik”

Powerful berarti governance burden lebih besar.

Jika template hanya butuh placeholder sederhana, engine powerful bisa overkill dan berisiko.

### 1.26.4 “Thymeleaf Modern, Jadi Selalu Lebih Baik dari JSP”

Untuk project baru Spring MVC, sering iya.

Untuk legacy JSP besar yang stabil, migration bisa tidak worth it.

### 1.26.5 “Logic-Less Template Selalu Aman”

Tidak.

Escaping, raw output, data leakage, and template ownership tetap penting.

### 1.26.6 “Escaping HTML Cukup untuk Semua Output”

Salah.

HTML escaping tidak sama dengan:

```text
- JavaScript string escaping
- CSS escaping
- URL encoding
- XML escaping
- CSV escaping
- SQL escaping
- shell escaping
- Markdown escaping
- prompt/message structural separation
```

---

## 1.27 Practical Heuristics

### 1.27.1 Start with Output

```text
What are we rendering?
```

Jika jawabannya HTML page:

```text
Consider Thymeleaf.
```

Jika jawabannya email/document/generated text:

```text
Consider FreeMarker.
```

Jika jawabannya simple placeholder controlled by business user:

```text
Consider restricted Mustache-like DSL.
```

### 1.27.2 Start with Author Trust

```text
Who controls the template?
```

Developer-owned:

```text
Full engine possible with tests and review.
```

Business-owned:

```text
Restrict, validate, preview, approve.
```

External user-owned:

```text
Do not expose powerful engine directly.
```

### 1.27.3 Start with Model Contract

```text
Can we define the model shape explicitly?
```

If no, do not proceed.

A template without a model contract is a runtime failure waiting to happen.

### 1.27.4 Start with Failure Mode

Ask:

```text
What happens if rendering fails?
```

For web page:

```text
Show error page.
```

For email:

```text
Do not send broken email; mark notification failed; retry only if model/template issue is transient.
```

For legal notice:

```text
Block issuance and require remediation.
```

For batch export:

```text
Fail item or fail batch depending consistency requirement.
```

### 1.27.5 Start with Audit Requirement

If output has legal/business consequence, store metadata.

```text
No template version, no defensibility.
No data snapshot, no reproducibility.
No output hash, no integrity check.
```

---

## 1.28 Recommended Default Choices

Untuk seri ini, rekomendasi default yang akan dipakai:

### 1.28.1 FreeMarker Default Use

Gunakan FreeMarker untuk:

```text
- email rendering
- plain text rendering
- PDF pre-render HTML
- XML/text document generation
- source/config generation
- batch-generated artifacts
- template catalog with versioned correspondence
```

### 1.28.2 Thymeleaf Default Use

Gunakan Thymeleaf untuk:

```text
- Spring MVC server-side rendered pages
- internal admin portals
- form-heavy pages
- validation error rendering
- natural HTML templates
- fragment-based HTML design system
```

### 1.28.3 JSP Default Use

Gunakan JSP untuk:

```text
- existing legacy Jakarta EE systems
- stable pages with low migration value
- migration staging where rewriting all at once is too risky
```

### 1.28.4 Mustache/Restricted DSL Default Use

Gunakan Mustache/restricted DSL untuk:

```text
- simple user/business-editable messages
- low-logic placeholders
- safe template editing workflows
```

### 1.28.5 Pebble/Velocity

Gunakan Pebble jika organisasi memilih Twig/Jinja-like syntax dengan alasan jelas.

Gunakan Velocity terutama untuk legacy maintenance, bukan default sistem baru.

---

## 1.29 What Top 1% Engineers See That Others Miss

### 1.29.1 Template Engine Is a Policy Surface

Template menentukan:

```text
- what data appears,
- how it appears,
- what is hidden,
- what is escaped,
- what is localized,
- what is legally communicated,
- what is archived.
```

Itu policy surface, bukan hanya view.

### 1.29.2 Template Model Is an API

Jika template memakai:

```text
${case.status}
```

Maka `status` adalah API contract.

Jika berubah, template bisa rusak.

### 1.29.3 Template Author Trust Is Architectural

Bukan detail implementasi.

Trusted developer templates dan business-editable templates harus diperlakukan sebagai dua kategori arsitektur berbeda.

### 1.29.4 Rendering Failure Is Business Failure

Email gagal render bisa berarti user tidak menerima notifikasi.

Notice gagal render bisa berarti proses hukum/regulatory tertunda.

Page gagal render bisa berarti officer tidak bisa memproses case.

### 1.29.5 Output Context Determines Escaping

Tidak ada escaping universal.

```text
HTML body != HTML attribute != JavaScript string != URL != XML != CSV != plain text.
```

### 1.29.6 One Engine Is Not Always Simpler

Kadang satu engine untuk semua output membuat semua output menjadi buruk.

Simpler secara dependency belum tentu simpler secara architecture.

### 1.29.7 Template Governance Is Part of SDLC

Template harus punya:

```text
- review
- test
- owner
- version
- approval
- rollback
- audit
```

Terutama jika output memiliki konsekuensi bisnis/legal.

---

## 1.30 Checklist Memilih Template Engine

Gunakan checklist ini sebelum memilih engine.

```text
[ ] Output utama sudah jelas.
[ ] Secondary output sudah jelas.
[ ] Template author trust level sudah jelas.
[ ] Data trust level sudah jelas.
[ ] Runtime editing requirement sudah jelas.
[ ] Template lifecycle sudah jelas.
[ ] Escaping requirement per output context sudah jelas.
[ ] Localization requirement sudah jelas.
[ ] Model contract strategy sudah jelas.
[ ] Testing strategy sudah jelas.
[ ] Error handling strategy sudah jelas.
[ ] Observability strategy sudah jelas.
[ ] Versioning/audit requirement sudah jelas.
[ ] Performance budget sudah jelas.
[ ] Migration/legacy constraints sudah jelas.
[ ] Team skill and ownership sudah jelas.
```

Jika banyak jawaban belum jelas, jangan langsung memilih engine.

---

## 1.31 Mini ADR Template

Gunakan format ini untuk architecture decision.

```markdown
# ADR: Template Engine Selection for <System/Module>

## Context
We need to render <output types> for <business use cases>.
Templates are authored by <developer/business/external users>.
Outputs are <legal/audit/non-critical> artifacts.

## Requirements
- Output formats:
- Runtime editing:
- Localization:
- Security:
- Versioning:
- Performance:
- Testing:
- Operational observability:

## Options Considered
1. JSP / Jakarta Pages
2. FreeMarker
3. Thymeleaf
4. Mustache/restricted DSL
5. Pebble
6. Keep legacy Velocity

## Decision
Use <engine> for <output class>.
Use <engine> for <other output class>.

## Rationale
- <reason 1>
- <reason 2>
- <reason 3>

## Consequences
Positive:
- ...

Negative:
- ...

Mitigations:
- ...

## Security Controls
- ...

## Testing Controls
- ...

## Migration Plan
- ...
```

---

## 1.32 Summary

Landscape template engine Java tidak bisa disederhanakan menjadi “engine mana paling bagus”.

Peta yang lebih benar:

```text
JSP / Jakarta Pages:
  Standard legacy web template compiled to Servlet. Good for existing Jakarta EE systems.

FreeMarker:
  Strong generic text rendering engine. Excellent for email, document, generated text, correspondence, and multi-output rendering.

Thymeleaf:
  Strong natural HTML server-side template engine. Excellent for Spring MVC SSR, admin portals, forms, validation, fragments.

Mustache / Handlebars-style:
  Good for simple low-logic templates and restricted business-editable placeholders.

Pebble:
  Modern Twig/Jinja-like option with clean syntax, useful if chosen deliberately.

Velocity:
  Important legacy engine, usually maintenance/migration context rather than default new choice.
```

Final mental model:

```text
Choose template engine by output class, author trust, data boundary,
escaping model, lifecycle, testing, governance, and operational failure mode.
```

A top-tier Java engineer does not merely know syntax like `${name}` or `th:text`.

A top-tier engineer can design a rendering subsystem where:

```text
- the right engine is used for the right output,
- the data model is explicit,
- escaping is correct,
- templates are versioned,
- failures are observable,
- output is reproducible,
- security boundaries are enforced,
- and template governance fits the business risk.
```

---

## 1.33 Latihan Berpikir

Jawab pertanyaan berikut sebelum lanjut ke Part 2.

### Exercise 1 — Engine Selection

Sistem Anda butuh:

```text
- internal officer portal,
- email notification,
- official PDF notice,
- business-editable short SMS template.
```

Pilih engine untuk masing-masing output dan jelaskan alasannya.

### Exercise 2 — Trust Model

Sebuah agency ingin admin bisa mengedit email template langsung di production.

Tentukan:

```text
- trust model,
- allowed variables,
- prohibited constructs,
- preview requirement,
- approval flow,
- audit metadata.
```

### Exercise 3 — Migration

Legacy app punya 300 JSP.

Tentukan strategi:

```text
- mana yang tetap JSP,
- mana yang dimigrasi ke Thymeleaf,
- mana yang output non-web dipindah ke FreeMarker,
- bagaimana test dan rollback.
```

### Exercise 4 — Security

Template email punya field:

```text
${recipient.displayName}
${case.description}
${officerRemarks}
```

Tentukan escaping dan sanitization strategy untuk:

```text
- HTML email body,
- plain text email,
- PDF pre-render HTML,
- audit log preview.
```

---

## 1.34 Referensi Resmi dan Bacaan Lanjutan

Referensi utama yang relevan untuk Part 1:

1. Apache FreeMarker official site dan manual: FreeMarker sebagai Java template engine untuk menghasilkan text output seperti HTML, email, config, source code; konsep template + data model = output; output formats dan auto-escaping.
2. Thymeleaf official documentation: Thymeleaf sebagai modern server-side Java template engine untuk web dan standalone environment, natural templates, template modes, Spring integration.
3. Spring Framework reference: Thymeleaf sebagai view technology untuk Spring MVC, natural HTML templates yang bisa dipreview di browser.
4. Jakarta Pages specification: Jakarta Pages/JSP sebagai template engine web application yang mencampur textual content, custom tags, expression language, embedded Java code, dan dikompilasi menjadi Servlet.
5. Jakarta EE specification guides: Servlet, Faces, dan Server Pages positioning.

---

## 1.35 Status Seri

```text
Part 1 selesai.
Seri belum selesai.
Berikutnya: Part 2 — Core Rendering Model: Template + Data Model = Output.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-000.md">⬅️ Part 0 — Orientation: Mental Model Template Engineering</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-002.md">Part 2 — Core Rendering Model: Template + Data Model = Output ➡️</a>
</div>
