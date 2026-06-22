# Part 9 — Custom Tags and Tag Files: Reusable View Components Before Component Frameworks

> Seri: `learn-java-jakarta-pages-el-tags-faces-server-side-ui`  
> File: `09-custom-tags-and-tag-files-reusable-view-components.md`  
> Fokus: membangun reusable view abstraction di Jakarta Pages/JSP melalui custom tags, tag files, TLD, tag handlers, body content, dynamic attributes, packaging, thread-safety, dan design library internal enterprise.  
> Target Java: Java 8 sampai Java 25.  
> Target namespace: legacy `javax.servlet.jsp.tagext.*` dan modern `jakarta.servlet.jsp.tagext.*`.

---

## 1. Posisi Materi Ini dalam Seri

Sampai bagian sebelumnya, kita sudah memahami:

1. JSP/Jakarta Pages diterjemahkan dan dikompilasi menjadi servlet.
2. JSP punya syntax legacy seperti scriptlet, declaration, expression, standard actions.
3. Data view seharusnya mengalir melalui scope yang tepat: page, request, session, application.
4. EL adalah expression evaluation layer.
5. JSTL/Jakarta Tags menyediakan tag umum untuk condition, iteration, URL, formatting, XML, dan SQL.

Sekarang kita naik satu level: **membuat tag sendiri**.

Custom tag adalah mekanisme untuk membuat elemen view reusable seperti:

```jsp
<app:statusBadge status="${case.status}" />
<app:money value="${invoice.total}" currency="SGD" />
<app:field label="Email" error="${errors.email}">
    <input type="email" name="email" value="${form.email}" />
</app:field>
<app:pagination page="${result.page}" totalPages="${result.totalPages}" />
```

Tujuan custom tag bukan membuat JSP terlihat “keren”, tetapi:

1. menghilangkan duplikasi markup,
2. menyembunyikan aturan rendering yang berulang,
3. menjaga konsistensi UI,
4. mengurangi scriptlet,
5. membuat view logic lebih mudah diaudit,
6. membuat migration path dari legacy JSP menuju arsitektur yang lebih bersih.

Namun custom tag juga bisa menjadi sumber masalah besar kalau salah desain:

1. tag menjadi business layer tersembunyi,
2. tag handler tidak thread-safe,
3. tag terlalu banyak melakukan database/service call,
4. tag menelan exception,
5. tag membuat output tidak aman dari XSS,
6. tag terlalu abstrak sehingga JSP sulit dibaca,
7. library internal menjadi framework mini yang tidak terdokumentasi.

Bagian ini membahas custom tag sebagai **engineering tool**, bukan sekadar syntax.

---

## 2. Mental Model: Custom Tag adalah View-Level Function dengan Lifecycle

Secara konseptual, custom tag mirip function di layer view.

Kalau function Java biasa:

```java
String renderStatusBadge(Status status) { ... }
```

Custom tag memungkinkan pemanggilan dari JSP:

```jsp
<app:statusBadge status="${case.status}" />
```

Namun ada perbedaan besar.

Function Java:

1. dipanggil langsung oleh kode Java,
2. punya parameter eksplisit,
3. return value eksplisit,
4. lifecycle sederhana,
5. berjalan dalam stack method biasa.

Custom tag JSP:

1. dipanggil oleh generated servlet hasil translation JSP,
2. menerima attribute dari literal atau EL,
3. bisa punya body content,
4. bisa menulis langsung ke response output,
5. bisa berinteraksi dengan `PageContext`,
6. bisa berinteraksi dengan parent tag,
7. bisa dipooling oleh container,
8. punya lifecycle translation-time dan request-time.

Jadi mental model yang lebih akurat:

> Custom tag adalah reusable view component kecil yang dieksekusi oleh JSP runtime, punya kontrak metadata melalui TLD/tag file, menerima input dari JSP/EL, bisa memproses body, dan menulis output ke page.

---

## 3. Kenapa Custom Tag Ada?

Sebelum component framework seperti Jakarta Faces, server-side UI Java membutuhkan mekanisme reusable selain include.

### 3.1 Masalah dengan Copy-Paste Markup

Misalnya banyak JSP memiliki status badge:

```jsp
<c:choose>
    <c:when test="${case.status == 'OPEN'}">
        <span class="badge badge-open">Open</span>
    </c:when>
    <c:when test="${case.status == 'CLOSED'}">
        <span class="badge badge-closed">Closed</span>
    </c:when>
    <c:otherwise>
        <span class="badge badge-unknown">Unknown</span>
    </c:otherwise>
</c:choose>
```

Kalau ini muncul di 80 halaman, masalahnya bukan hanya duplikasi. Masalahnya adalah:

1. aturan status tersebar,
2. style mudah tidak konsisten,
3. perubahan UI mahal,
4. security escaping bisa berbeda-beda,
5. translation/i18n sulit distandarisasi,
6. reviewer harus mengecek pola yang sama berulang kali.

Dengan tag:

```jsp
<app:statusBadge status="${case.status}" />
```

Aturan rendering status menjadi satu tempat.

### 3.2 Masalah dengan Include

Dynamic include bisa membantu:

```jsp
<jsp:include page="/WEB-INF/views/fragments/statusBadge.jsp" />
```

Tetapi include punya beberapa batas:

1. parameter passing lebih canggung,
2. kontrak input tidak eksplisit,
3. nested composition kurang nyaman,
4. fragment mudah bergantung pada variable ambient dari request scope,
5. sulit dipaketkan sebagai library JAR reusable.

Custom tag memberi kontrak yang lebih jelas:

```jsp
<app:statusBadge status="${case.status}" label="${case.statusLabel}" />
```

### 3.3 Masalah dengan Utility Method di EL

EL function bagus untuk transformasi sederhana:

```jsp
${app:formatStatus(case.status)}
```

Tetapi kalau output-nya markup kompleks, EL function bukan tempat ideal. EL function sebaiknya pure dan sederhana. Custom tag lebih tepat untuk rendering markup reusable.

---

## 4. Jenis Custom Tag di JSP/Jakarta Pages

Ada beberapa cara membuat custom tag.

| Jenis | Bentuk | Cocok untuk | Catatan |
|---|---|---|---|
| Tag file | `.tag` / `.tagx` | reusable markup sederhana-menengah | paling mudah dan maintainable |
| Simple tag handler | class extends `SimpleTagSupport` | logic rendering custom, body processing sederhana | modern dan relatif mudah |
| Classic tag handler | class extends `TagSupport` / `BodyTagSupport` | legacy, kontrol lifecycle detail | lebih kompleks, banyak ditemukan di sistem lama |
| EL function | static Java method + TLD | transformasi value | bukan untuk markup kompleks |
| JSP include | fragment JSP | layout/fragment sederhana | kontrak kurang kuat dibanding tag |

Dalam sistem modern berbasis JSP, prioritas umumnya:

1. Gunakan **tag file** untuk markup reusable.
2. Gunakan **simple tag handler** untuk logic reusable yang butuh Java.
3. Gunakan **classic tag handler** hanya untuk legacy atau kasus sangat khusus.
4. Gunakan **EL function** untuk transformasi value kecil.
5. Hindari scriptlet.

---

## 5. Tag File: Cara Termudah Membuat Custom Tag

Tag file adalah file berbasis JSP-like syntax yang dapat dipanggil sebagai tag.

Biasanya ditempatkan di:

```text
WEB-INF/
  tags/
    statusBadge.tag
    field.tag
    pagination.tag
```

File di bawah `/WEB-INF/tags` tidak bisa diakses langsung lewat browser, tetapi bisa dipakai oleh JSP.

### 5.1 Contoh Tag File Sederhana

`/WEB-INF/tags/statusBadge.tag`:

```jsp
<%@ tag pageEncoding="UTF-8" body-content="empty" %>
<%@ attribute name="status" required="true" type="java.lang.String" %>

<c:choose>
    <c:when test="${status == 'OPEN'}">
        <span class="badge badge-open">Open</span>
    </c:when>
    <c:when test="${status == 'CLOSED'}">
        <span class="badge badge-closed">Closed</span>
    </c:when>
    <c:otherwise>
        <span class="badge badge-unknown"><c:out value="${status}" /></span>
    </c:otherwise>
</c:choose>
```

Pemakaian di JSP:

```jsp
<%@ taglib prefix="app" tagdir="/WEB-INF/tags" %>

<app:statusBadge status="${case.status}" />
```

Hal penting:

1. `tagdir` menunjuk direktori tag file.
2. Nama file menjadi nama tag.
3. Attribute dideklarasikan dengan directive `attribute`.
4. Body behavior didefinisikan dengan `body-content`.

### 5.2 Apa yang Terjadi di Runtime?

Tag file juga diterjemahkan oleh container menjadi handler class internal.

Jadi:

```text
statusBadge.tag
   ↓ translation
Generated tag handler class
   ↓ runtime invocation
writes markup to JSP output
```

Mental modelnya mirip JSP mini yang dipanggil sebagai tag.

---

## 6. Directive dalam Tag File

Tag file memiliki directive sendiri.

### 6.1 `tag` Directive

Contoh:

```jsp
<%@ tag pageEncoding="UTF-8" body-content="empty" %>
```

Fungsi:

1. mendefinisikan metadata tag,
2. menentukan encoding,
3. menentukan apakah tag menerima body,
4. menentukan dynamic attributes kalau didukung.

Common attributes:

| Attribute | Fungsi |
|---|---|
| `body-content` | apakah tag menerima body dan jenis body-nya |
| `pageEncoding` | encoding tag file |
| `dynamic-attributes` | nama variable untuk menampung dynamic attributes |
| `description` | dokumentasi |
| `display-name` | nama display |
| `import` | import class Java, sebaiknya minimal |

### 6.2 `attribute` Directive

Contoh:

```jsp
<%@ attribute name="label" required="true" type="java.lang.String" %>
<%@ attribute name="error" required="false" type="java.lang.String" %>
<%@ attribute name="required" required="false" type="java.lang.Boolean" %>
```

Attribute directive adalah kontrak input.

Common attributes:

| Attribute | Fungsi |
|---|---|
| `name` | nama attribute |
| `required` | wajib atau opsional |
| `type` | tipe Java target |
| `rtexprvalue` | apakah boleh runtime expression |
| `fragment` | apakah attribute berupa fragment |
| `description` | dokumentasi |

Contoh penggunaan:

```jsp
<app:field label="Email" error="${errors.email}" required="true" />
```

### 6.3 `variable` Directive

`variable` directive memungkinkan tag mengekspos variable ke caller JSP.

Contoh konseptual:

```jsp
<%@ variable name-given="normalizedStatus" variable-class="java.lang.String" scope="AT_END" %>
```

Namun dalam desain modern, tag yang mengekspos variable harus dipakai hati-hati. Terlalu banyak output variable membuat JSP sulit dipahami karena control/data flow tersembunyi.

Rule of thumb:

> Tag sebaiknya merender output. Kalau tag mulai menjadi data provider, evaluasi ulang apakah logic itu seharusnya ada di controller/service.

---

## 7. Body Content dalam Tag File

Custom tag bisa punya body.

Contoh tag `field.tag`:

```jsp
<%@ tag pageEncoding="UTF-8" body-content="scriptless" %>
<%@ attribute name="label" required="true" type="java.lang.String" %>
<%@ attribute name="error" required="false" type="java.lang.String" %>
<%@ attribute name="required" required="false" type="java.lang.Boolean" %>

<div class="form-field ${not empty error ? 'has-error' : ''}">
    <label>
        <c:out value="${label}" />
        <c:if test="${required}">
            <span class="required-marker">*</span>
        </c:if>
    </label>

    <div class="form-control">
        <jsp:doBody />
    </div>

    <c:if test="${not empty error}">
        <div class="field-error"><c:out value="${error}" /></div>
    </c:if>
</div>
```

Pemakaian:

```jsp
<app:field label="Email" error="${errors.email}" required="true">
    <input type="email" name="email" value="${form.email}" />
</app:field>
```

`<jsp:doBody />` mengeksekusi body yang diberikan caller.

### 7.1 Jenis `body-content`

| Value | Makna | Kapan dipakai |
|---|---|---|
| `empty` | tag tidak punya body | badge, icon, formatted output |
| `scriptless` | body boleh template text, EL, actions, tapi tidak scriptlet | default terbaik untuk modern JSP |
| `tagdependent` | body diproses oleh tag sebagai raw text | template DSL, SQL/XML-like legacy |

Untuk code modern, pilih:

```jsp
body-content="scriptless"
```

kalau tag menerima body, dan:

```jsp
body-content="empty"
```

kalau tidak.

Hindari body yang mengizinkan scriptlet.

---

## 8. Fragment Attribute: Body Kecil yang Dikirim sebagai Parameter

Kadang kita butuh attribute yang berupa fragment markup, bukan sekadar string.

Contoh use case:

```jsp
<app:panel title="Case Detail">
    <jsp:attribute name="actions">
        <a href="${editUrl}" class="btn">Edit</a>
    </jsp:attribute>
    <jsp:body>
        <p>Case information...</p>
    </jsp:body>
</app:panel>
```

`panel.tag`:

```jsp
<%@ tag pageEncoding="UTF-8" body-content="scriptless" %>
<%@ attribute name="title" required="true" type="java.lang.String" %>
<%@ attribute name="actions" fragment="true" required="false" %>

<section class="panel">
    <header class="panel-header">
        <h2><c:out value="${title}" /></h2>
        <div class="panel-actions">
            <c:if test="${not empty actions}">
                <jsp:invoke fragment="actions" />
            </c:if>
        </div>
    </header>
    <div class="panel-body">
        <jsp:doBody />
    </div>
</section>
```

Fragment attribute berguna untuk layouting yang fleksibel.

Namun jangan berlebihan. Kalau tag punya terlalu banyak fragment, ia mulai menjadi mini component framework yang sulit dipakai.

---

## 9. Dynamic Attributes

Dynamic attributes memungkinkan tag menerima attribute yang tidak dideklarasikan satu per satu.

Contoh:

```jsp
<app:button type="submit" class="btn primary" data-tracking="save-case" aria-label="Save case">
    Save
</app:button>
```

Tag file bisa menampung dynamic attributes:

```jsp
<%@ tag pageEncoding="UTF-8" body-content="scriptless" dynamic-attributes="dyn" %>
```

Secara konsep, dynamic attributes cocok untuk pass-through HTML attributes seperti:

1. `class`,
2. `id`,
3. `data-*`,
4. `aria-*`,
5. `disabled`,
6. `placeholder`.

Tapi dynamic attributes punya risiko:

1. raw output bisa menyebabkan attribute injection,
2. attribute event handler seperti `onclick` bisa membuka XSS,
3. attribute kontrak menjadi kabur,
4. caller bisa memasukkan attribute yang tidak didukung.

Desain aman:

1. whitelist attribute yang boleh diteruskan,
2. escape attribute value sesuai HTML attribute context,
3. jangan pass-through event handler arbitrary kecuali benar-benar diperlukan,
4. dokumentasikan behavior.

---

## 10. Simple Tag Handler: Custom Tag Berbasis Java Modern

Tag file cocok untuk markup-heavy tags. Kalau logic-nya cukup kompleks, gunakan Java class.

Simple tag handler biasanya extend:

Legacy Java EE:

```java
javax.servlet.jsp.tagext.SimpleTagSupport
```

Jakarta EE modern:

```java
jakarta.servlet.jsp.tagext.SimpleTagSupport
```

### 10.1 Contoh SimpleTagSupport

```java
package com.example.web.tags;

import jakarta.servlet.jsp.JspException;
import jakarta.servlet.jsp.JspWriter;
import jakarta.servlet.jsp.tagext.SimpleTagSupport;
import java.io.IOException;

public class StatusBadgeTag extends SimpleTagSupport {

    private String status;

    public void setStatus(String status) {
        this.status = status;
    }

    @Override
    public void doTag() throws JspException, IOException {
        JspWriter out = getJspContext().getOut();

        if (status == null || status.isBlank()) {
            out.write("<span class=\"badge badge-unknown\">Unknown</span>");
            return;
        }

        switch (status) {
            case "OPEN" -> out.write("<span class=\"badge badge-open\">Open</span>");
            case "CLOSED" -> out.write("<span class=\"badge badge-closed\">Closed</span>");
            default -> {
                out.write("<span class=\"badge badge-unknown\">");
                out.write(escapeHtml(status));
                out.write("</span>");
            }
        }
    }

    private static String escapeHtml(String value) {
        return value
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#x27;");
    }
}
```

Untuk Java 8 compatibility, switch expression tidak bisa dipakai. Versi Java 8:

```java
package com.example.web.tags;

import jakarta.servlet.jsp.JspException;
import jakarta.servlet.jsp.JspWriter;
import jakarta.servlet.jsp.tagext.SimpleTagSupport;
import java.io.IOException;

public class StatusBadgeTag extends SimpleTagSupport {

    private String status;

    public void setStatus(String status) {
        this.status = status;
    }

    @Override
    public void doTag() throws JspException, IOException {
        JspWriter out = getJspContext().getOut();

        if (status == null || status.trim().isEmpty()) {
            out.write("<span class=\"badge badge-unknown\">Unknown</span>");
            return;
        }

        if ("OPEN".equals(status)) {
            out.write("<span class=\"badge badge-open\">Open</span>");
        } else if ("CLOSED".equals(status)) {
            out.write("<span class=\"badge badge-closed\">Closed</span>");
        } else {
            out.write("<span class=\"badge badge-unknown\">");
            out.write(escapeHtml(status));
            out.write("</span>");
        }
    }

    private static String escapeHtml(String value) {
        return value
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#x27;");
    }
}
```

### 10.2 TLD untuk Simple Tag

`/WEB-INF/app-tags.tld`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<taglib xmlns="https://jakarta.ee/xml/ns/jakartaee"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="https://jakarta.ee/xml/ns/jakartaee https://jakarta.ee/xml/ns/jakartaee/web-jsptaglibrary_3_0.xsd"
        version="3.0">

    <tlib-version>1.0</tlib-version>
    <short-name>app</short-name>
    <uri>https://example.com/tags/app</uri>

    <tag>
        <name>statusBadge</name>
        <tag-class>com.example.web.tags.StatusBadgeTag</tag-class>
        <body-content>empty</body-content>
        <attribute>
            <name>status</name>
            <required>true</required>
            <rtexprvalue>true</rtexprvalue>
            <type>java.lang.String</type>
        </attribute>
    </tag>
</taglib>
```

Pemakaian:

```jsp
<%@ taglib prefix="app" uri="https://example.com/tags/app" %>

<app:statusBadge status="${case.status}" />
```

Catatan namespace:

1. Untuk Jakarta EE 9+, package berubah dari `javax.*` ke `jakarta.*`.
2. TLD schema dan versi bergantung pada spec/container.
3. Banyak sistem lama masih memakai TLD versi 2.x dengan namespace lama; migrasi harus diuji di container target.

---

## 11. Classic Tag Handler: `TagSupport` dan `BodyTagSupport`

Classic tag handler adalah model lama, tetapi sangat penting untuk membaca sistem legacy.

Package legacy:

```java
javax.servlet.jsp.tagext.TagSupport
javax.servlet.jsp.tagext.BodyTagSupport
```

Package modern:

```java
jakarta.servlet.jsp.tagext.TagSupport
jakarta.servlet.jsp.tagext.BodyTagSupport
```

### 11.1 Lifecycle Classic Tag

Classic tag memiliki callback seperti:

1. `setPageContext(PageContext pageContext)`
2. `setParent(Tag parent)`
3. setter attributes
4. `doStartTag()`
5. body evaluation jika ada
6. `doAfterBody()`
7. `doEndTag()`
8. `release()`

Return value penting:

| Method | Return | Makna |
|---|---|---|
| `doStartTag()` | `SKIP_BODY` | jangan evaluasi body |
| `doStartTag()` | `EVAL_BODY_INCLUDE` | evaluasi body langsung ke output |
| `doEndTag()` | `EVAL_PAGE` | lanjutkan page |
| `doEndTag()` | `SKIP_PAGE` | hentikan page setelah tag |
| `doAfterBody()` | `EVAL_BODY_AGAIN` | ulangi body |
| `doAfterBody()` | `SKIP_BODY` | selesai body |

### 11.2 Contoh Classic Tag

```java
package com.example.web.tags;

import jakarta.servlet.jsp.JspException;
import jakarta.servlet.jsp.JspWriter;
import jakarta.servlet.jsp.tagext.TagSupport;
import java.io.IOException;

public class AlertTag extends TagSupport {

    private String type;
    private String message;

    public void setType(String type) {
        this.type = type;
    }

    public void setMessage(String message) {
        this.message = message;
    }

    @Override
    public int doStartTag() throws JspException {
        try {
            JspWriter out = pageContext.getOut();
            String safeType = normalizeType(type);

            out.write("<div class=\"alert alert-");
            out.write(safeType);
            out.write("\">");
            out.write(escapeHtml(message));
            out.write("</div>");

            return SKIP_BODY;
        } catch (IOException e) {
            throw new JspException("Failed to render alert tag", e);
        }
    }

    @Override
    public void release() {
        super.release();
        this.type = null;
        this.message = null;
    }

    private static String normalizeType(String type) {
        if ("success".equals(type) || "warning".equals(type) || "error".equals(type)) {
            return type;
        }
        return "info";
    }

    private static String escapeHtml(String value) {
        if (value == null) {
            return "";
        }
        return value
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#x27;");
    }
}
```

Classic tag masih banyak ditemukan di enterprise apps lama karena:

1. framework lama dibuat sebelum `SimpleTagSupport`,
2. library internal sudah lama ada,
3. custom tags dipakai untuk layout/table/form generator,
4. migrasi ke tag file/simple tag belum dilakukan.

---

## 12. BodyTagSupport: Ketika Tag Perlu Membaca dan Mengubah Body

`BodyTagSupport` memberi akses ke `BodyContent`.

Use case:

1. membungkus body,
2. memfilter body,
3. mengulang body,
4. melakukan transformasi kecil pada body.

Contoh konseptual:

```java
public class UppercaseTag extends BodyTagSupport {

    @Override
    public int doStartTag() {
        return EVAL_BODY_BUFFERED;
    }

    @Override
    public int doEndTag() throws JspException {
        try {
            String body = getBodyContent().getString();
            pageContext.getOut().write(body.toUpperCase(Locale.ROOT));
            return EVAL_PAGE;
        } catch (IOException e) {
            throw new JspException(e);
        }
    }

    @Override
    public void release() {
        super.release();
    }
}
```

Tetapi hati-hati: transformasi body raw mudah berbahaya untuk security dan encoding. Untuk modern apps, lebih sering cukup memakai tag file atau `SimpleTagSupport` dengan `JspFragment`.

---

## 13. `SimpleTagSupport` dengan Body: `JspFragment`

Simple tag bisa mengeksekusi body melalui `JspFragment`.

```java
package com.example.web.tags;

import jakarta.servlet.jsp.JspException;
import jakarta.servlet.jsp.JspWriter;
import jakarta.servlet.jsp.tagext.SimpleTagSupport;
import java.io.IOException;

public class PanelTag extends SimpleTagSupport {

    private String title;

    public void setTitle(String title) {
        this.title = title;
    }

    @Override
    public void doTag() throws JspException, IOException {
        JspWriter out = getJspContext().getOut();

        out.write("<section class=\"panel\">");
        out.write("<header class=\"panel-header\"><h2>");
        out.write(escapeHtml(title));
        out.write("</h2></header>");
        out.write("<div class=\"panel-body\">");

        if (getJspBody() != null) {
            getJspBody().invoke(null);
        }

        out.write("</div></section>");
    }

    private static String escapeHtml(String value) {
        if (value == null) return "";
        return value
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#x27;");
    }
}
```

TLD:

```xml
<tag>
    <name>panel</name>
    <tag-class>com.example.web.tags.PanelTag</tag-class>
    <body-content>scriptless</body-content>
    <attribute>
        <name>title</name>
        <required>true</required>
        <rtexprvalue>true</rtexprvalue>
        <type>java.lang.String</type>
    </attribute>
</tag>
```

Usage:

```jsp
<app:panel title="Case Detail">
    <p>Case no: <c:out value="${case.caseNo}" /></p>
</app:panel>
```

---

## 14. Tag Library Descriptor atau TLD

TLD adalah metadata contract untuk tag library.

TLD menjawab pertanyaan:

1. library ini dipanggil dengan URI apa?
2. prefix apa yang umum digunakan?
3. tag apa saja yang tersedia?
4. class handler apa yang menjalankan tag?
5. attribute apa yang diterima?
6. apakah body boleh ada?
7. function apa yang tersedia?
8. validator/listener apa yang dipakai?

### 14.1 Struktur Minimal TLD

```xml
<taglib xmlns="https://jakarta.ee/xml/ns/jakartaee"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="https://jakarta.ee/xml/ns/jakartaee https://jakarta.ee/xml/ns/jakartaee/web-jsptaglibrary_3_0.xsd"
        version="3.0">

    <description>Application UI tags</description>
    <tlib-version>1.0</tlib-version>
    <short-name>app</short-name>
    <uri>https://example.com/tags/app</uri>

    <tag>
        <name>statusBadge</name>
        <tag-class>com.example.web.tags.StatusBadgeTag</tag-class>
        <body-content>empty</body-content>
        <attribute>
            <name>status</name>
            <required>true</required>
            <rtexprvalue>true</rtexprvalue>
            <type>java.lang.String</type>
        </attribute>
    </tag>
</taglib>
```

### 14.2 URI Bukan Selalu URL yang Diakses

Dalam taglib directive:

```jsp
<%@ taglib prefix="app" uri="https://example.com/tags/app" %>
```

`uri` adalah identifier. Container mencocokkannya dengan TLD yang ditemukan. Ia tidak selalu melakukan HTTP request ke URL tersebut.

Praktik baik:

1. gunakan URI stabil,
2. jangan pakai URI yang berubah per environment,
3. jangan embed versi patch jika tidak perlu,
4. kalau ada breaking change, pertimbangkan URI baru.

---

## 15. Packaging Tag Library dalam JAR

Untuk enterprise reuse, custom tags sering dipaketkan sebagai JAR.

Struktur umum:

```text
app-ui-tags.jar
  META-INF/
    app-tags.tld
  com/example/web/tags/
    StatusBadgeTag.class
    PanelTag.class
    MoneyTag.class
```

Lalu aplikasi web menambahkan JAR ke:

```text
WEB-INF/lib/app-ui-tags.jar
```

Container akan scan TLD dalam `META-INF`.

Manfaat packaging JAR:

1. reusable lintas modul/aplikasi,
2. versioned artifact,
3. bisa diuji terpisah,
4. bisa punya release lifecycle,
5. bisa menjadi internal design system.

Risiko packaging JAR:

1. dependency conflict,
2. container scanning overhead,
3. backward compatibility burden,
4. upgrade sulit jika terlalu banyak aplikasi bergantung,
5. undocumented behavior menjadi legacy framework internal.

Rule:

> Kalau tag library dipakai lebih dari satu aplikasi, perlakukan seperti public API internal.

Artinya perlu:

1. semantic versioning,
2. changelog,
3. compatibility tests,
4. deprecation policy,
5. migration guide,
6. documented examples.

---

## 16. Attribute Design: Kontrak Input yang Baik

Custom tag bagus bukan karena implementation-nya canggih, tetapi karena kontraknya jelas.

### 16.1 Attribute Harus Bermakna, Bukan Meniru HTML Mentah Berlebihan

Buruk:

```jsp
<app:statusBadge cssClass="x" htmlBefore="..." htmlAfter="..." mode="1" flag="Y" />
```

Baik:

```jsp
<app:statusBadge status="${case.status}" variant="compact" />
```

Desain attribute yang baik:

1. representasi domain/view concept,
2. jumlah minimal,
3. tipe jelas,
4. default jelas,
5. required hanya untuk input benar-benar wajib,
6. naming konsisten,
7. tidak membuat caller harus tahu internal markup.

### 16.2 Attribute Boolean

Contoh:

```jsp
<app:field label="Email" required="true" />
```

Handler:

```java
private boolean required;

public void setRequired(boolean required) {
    this.required = required;
}
```

Untuk wrapper object:

```java
private Boolean required;
```

Wrapper berguna kalau perlu membedakan:

1. tidak diisi,
2. eksplisit false,
3. eksplisit true.

Namun untuk kebanyakan tag, primitive boolean + default false cukup.

### 16.3 Attribute Enum

Lebih aman daripada string bebas.

```java
public enum BadgeVariant {
    DEFAULT,
    COMPACT,
    OUTLINE
}
```

Tapi setter dari JSP biasanya menerima String lebih mudah:

```java
public void setVariant(String variant) {
    this.variant = BadgeVariant.valueOf(variant.toUpperCase(Locale.ROOT));
}
```

Pastikan error message jelas.

---

## 17. Output Encoding: Custom Tag Harus Aman by Default

Custom tag yang menulis output langsung harus meng-escape sesuai konteks.

### 17.1 HTML Text Context

```html
<span>USER_VALUE</span>
```

Escape:

1. `&` → `&amp;`
2. `<` → `&lt;`
3. `>` → `&gt;`

Biasanya juga escape quote untuk aman.

### 17.2 HTML Attribute Context

```html
<input value="USER_VALUE">
```

Escape minimal:

1. `&`,
2. `<`,
3. `>`,
4. `"`,
5. `'`.

### 17.3 JavaScript Context

```html
<script>
  const name = "USER_VALUE";
</script>
```

Ini bukan HTML escaping biasa. Butuh JavaScript string escaping. Sebaiknya hindari custom tag yang inject user value langsung ke JS inline.

### 17.4 URL Context

```html
<a href="/case?id=USER_VALUE">
```

Butuh URL encoding untuk parameter, bukan HTML escaping saja.

### 17.5 Rule Aman

> Custom tag tidak boleh menganggap caller sudah melakukan escaping, kecuali kontraknya eksplisit dan namanya jelas seperti `rawHtml`.

Kalau menerima `rawHtml`, dokumentasikan sebagai dangerous:

```jsp
<app:richText rawHtml="${trustedSanitizedHtml}" />
```

Dan pastikan input sudah melalui HTML sanitizer, bukan sekadar escaping.

---

## 18. Thread-Safety dan Tag Pooling

Ini bagian yang sering dilupakan.

JSP container dapat melakukan **tag handler pooling**. Artinya instance tag handler bisa dipakai ulang untuk request berikutnya.

### 18.1 Apa Implikasinya?

Kalau handler punya field:

```java
private String status;
```

Field ini diisi melalui setter sebelum tag dieksekusi.

Setelah selesai, instance bisa dipakai ulang. Jika field tidak di-reset, nilai request sebelumnya bisa terbawa.

Contoh bug:

```java
public class DangerousTag extends TagSupport {
    private String message;

    public void setMessage(String message) {
        this.message = message;
    }

    @Override
    public int doStartTag() throws JspException {
        // uses message
        return SKIP_BODY;
    }
}
```

Jika pada request berikutnya attribute `message` tidak di-set karena optional, nilai lama bisa bocor.

### 18.2 Reset State

Untuk classic tag:

```java
@Override
public void release() {
    super.release();
    this.message = null;
    this.type = null;
}
```

Namun `release()` tidak selalu dipanggil setelah setiap invocation. Lebih aman juga reset di `doEndTag()` atau desain supaya semua optional punya default eksplisit saat execution.

Contoh:

```java
@Override
public int doEndTag() throws JspException {
    this.message = null;
    this.type = null;
    return EVAL_PAGE;
}
```

Untuk `SimpleTagSupport`, jangan simpan mutable state static. Field instance tetap harus diperlakukan sebagai per-invocation input dan jangan diasumsikan bersih jika pooling/container behavior berubah.

### 18.3 Jangan Pakai Static Mutable State

Buruk:

```java
private static final Map<String, String> CACHE = new HashMap<>();
```

Kalau perlu cache:

1. gunakan thread-safe cache,
2. batasi ukuran,
3. pertimbangkan lifecycle aplikasi,
4. jangan cache user/session-specific data,
5. jangan cache authorization decision tanpa invalidation.

### 18.4 Jangan Inject Request-Specific Data ke Singleton Global

Custom tag berjalan di request path. Hindari:

1. menyimpan current user di static field,
2. menyimpan request object di application singleton,
3. menyimpan `PageContext` di field static,
4. menyimpan `JspWriter` di field luar method.

---

## 19. Parent-Child Tags

Custom tag bisa berkomunikasi dengan parent tag.

Contoh use case:

```jsp
<app:table items="${cases}">
    <app:column header="Case No" value="${row.caseNo}" />
    <app:column header="Status" value="${row.status}" />
</app:table>
```

Di sini `column` harus mendaftarkan dirinya ke parent `table`.

Classic tags menyediakan parent melalui `getParent()`.

Simple tags juga punya parent via `getParent()` dari `SimpleTagSupport`.

Contoh konseptual:

```java
TableTag parent = (TableTag) findAncestorWithClass(this, TableTag.class);
parent.addColumn(columnDefinition);
```

Risiko parent-child tags:

1. lifecycle lebih kompleks,
2. ordering penting,
3. nested tag salah parent,
4. sulit debugging,
5. mudah menjadi component framework mini.

Gunakan hanya kalau manfaatnya besar, misalnya table/form DSL internal yang benar-benar konsisten.

---

## 20. Designing Enterprise Tag Libraries

Custom tag library internal sebaiknya dirancang seperti API produk.

### 20.1 Layer Tag Library

Pisahkan tag berdasarkan level abstraksi.

#### Low-Level UI Tags

Contoh:

```jsp
<app:icon name="warning" />
<app:badge text="Open" variant="success" />
<app:money value="${amount}" currency="SGD" />
```

Karakteristik:

1. reusable luas,
2. tidak domain-specific,
3. sedikit dependency,
4. aman digunakan di banyak halaman.

#### Domain UI Tags

Contoh:

```jsp
<case:statusBadge status="${case.status}" />
<case:priorityIndicator priority="${case.priority}" />
<case:assignmentSummary assignment="${case.assignment}" />
```

Karakteristik:

1. merepresentasikan domain view concept,
2. bisa punya aturan rendering domain,
3. tidak boleh menjalankan business decision baru,
4. harus menerima view model/display model, bukan entity lazy.

#### Layout Tags

Contoh:

```jsp
<layout:page title="Case Detail">
    <layout:section title="Applicant">
        ...
    </layout:section>
</layout:page>
```

Karakteristik:

1. mengatur struktur halaman,
2. mengurangi duplikasi layout,
3. harus stabil dan terdokumentasi.

### 20.2 Jangan Buat Tag Terlalu Pintar

Buruk:

```jsp
<case:detail caseId="${param.id}" />
```

Kalau tag ini:

1. query database,
2. cek permission,
3. load documents,
4. render buttons,
5. mutate session,
6. log audit,

maka tag sudah menjadi controller/service tersembunyi.

Lebih baik:

```jsp
<case:detail model="${caseDetailView}" />
```

Controller menyiapkan `caseDetailView`, service menjalankan business logic, tag hanya render.

---

## 21. Boundary: Apa yang Boleh dan Tidak Boleh Ada di Custom Tag

### 21.1 Boleh Ada di Custom Tag

1. HTML markup reusable.
2. CSS class mapping sederhana.
3. i18n display label.
4. formatting output.
5. URL rendering berbasis input yang sudah disiapkan.
6. rendering condition yang murni view-level.
7. escaping output.
8. accessibility attributes.
9. error message display.
10. layout shell.

### 21.2 Sebaiknya Tidak Ada di Custom Tag

1. database query,
2. remote API call,
3. transaction boundary,
4. authorization enforcement,
5. business state transition,
6. workflow mutation,
7. email sending,
8. file write,
9. session mutation besar,
10. hidden caching user-specific,
11. complex sorting/filtering,
12. domain aggregate construction.

### 21.3 Ambiguous Area

Beberapa hal bisa diperdebatkan:

| Logic | Boleh di tag? | Catatan |
|---|---:|---|
| format tanggal | Ya | gunakan locale/timezone jelas |
| format status label | Ya | jika mapping display-only |
| cek `canEdit` untuk render button | Ya, jika value sudah dari view model | enforcement tetap di backend |
| build URL detail | Ya | dari route/id yang sudah aman |
| load user display name by id | Tidak ideal | siapkan di controller/view model |
| hide section jika empty | Ya | view concern |
| query count comments | Tidak | siapkan di service/controller |

---

## 22. Custom Tag untuk Form Field: Contoh Enterprise Pattern

Masalah umum dalam JSP enterprise: form field markup berulang.

Tanpa tag:

```jsp
<div class="form-group ${not empty errors.email ? 'has-error' : ''}">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" value="${form.email}" />
    <c:if test="${not empty errors.email}">
        <div class="error"><c:out value="${errors.email}" /></div>
    </c:if>
</div>
```

Dengan tag:

```jsp
<app:field name="email" label="Email" error="${errors.email}" required="true">
    <input id="email" name="email" type="email" value="${fn:escapeXml(form.email)}" />
</app:field>
```

`field.tag`:

```jsp
<%@ tag pageEncoding="UTF-8" body-content="scriptless" %>
<%@ attribute name="name" required="true" type="java.lang.String" %>
<%@ attribute name="label" required="true" type="java.lang.String" %>
<%@ attribute name="error" required="false" type="java.lang.String" %>
<%@ attribute name="required" required="false" type="java.lang.Boolean" %>

<div class="form-group ${not empty error ? 'has-error' : ''}">
    <label for="${name}">
        <c:out value="${label}" />
        <c:if test="${required}"><span aria-hidden="true">*</span></c:if>
    </label>

    <jsp:doBody />

    <c:if test="${not empty error}">
        <div id="${name}-error" class="error" role="alert">
            <c:out value="${error}" />
        </div>
    </c:if>
</div>
```

Keuntungan:

1. error rendering konsisten,
2. label rendering konsisten,
3. required marker konsisten,
4. accessibility bisa distandarisasi,
5. security escaping label/error ada di satu tempat.

Keterbatasan:

1. input masih ditulis caller,
2. caller harus mengatur `aria-describedby` jika ingin lengkap,
3. value input harus di-escape sesuai attribute context,
4. tag belum otomatis bind ke validation framework.

Versi lebih advanced bisa membuat `inputText` tag sendiri, tapi hati-hati supaya tidak berubah menjadi framework form besar yang sulit dirawat.

---

## 23. Custom Tag untuk Pagination

Pagination adalah contoh bagus untuk custom tag karena markup dan URL pattern sering berulang.

Usage:

```jsp
<app:pagination page="${result.page}"
                totalPages="${result.totalPages}"
                baseUrl="${pageContext.request.contextPath}/cases"
                queryString="${result.queryString}" />
```

Design decisions:

1. Apakah tag membangun URL sendiri?
2. Apakah query params sudah disiapkan controller?
3. Bagaimana encoding parameter?
4. Apakah page index 0-based atau 1-based?
5. Bagaimana handle first/last/prev/next?
6. Apakah support accessibility label?
7. Apakah support disabled state?

Better contract:

```jsp
<app:pagination model="${result.pagination}" />
```

View model:

```java
public class PaginationView {
    private int currentPage;
    private int totalPages;
    private List<PageLinkView> links;
}

public class PageLinkView {
    private String label;
    private String url;
    private boolean active;
    private boolean disabled;
}
```

Custom tag hanya render.

Ini menghindari URL/business/query logic di tag.

---

## 24. Custom Tag untuk Authorization-Aware Rendering

Contoh:

```jsp
<app:ifAllowed action="CASE_EDIT" resourceId="${case.id}">
    <a href="${editUrl}">Edit</a>
</app:ifAllowed>
```

Ini terlihat menarik, tetapi berbahaya jika disalahpahami.

Ada dua jenis authorization:

1. **render-time visibility**: apakah tombol/link ditampilkan,
2. **enforcement**: apakah action benar-benar boleh dilakukan di backend.

Custom tag hanya boleh membantu visibility. Enforcement tetap wajib di controller/service/security layer.

Lebih aman:

```jsp
<c:if test="${caseView.canEdit}">
    <a href="${caseView.editUrl}">Edit</a>
</c:if>
```

atau:

```jsp
<app:actionButton visible="${caseView.canEdit}"
                  href="${caseView.editUrl}"
                  label="Edit" />
```

Dengan begitu authorization decision dibuat di service/controller, bukan tag.

Rule:

> Jangan jadikan custom tag sebagai satu-satunya tempat authorization decision.

---

## 25. Error Handling dalam Custom Tag

Custom tag tidak boleh menelan error diam-diam.

Buruk:

```java
try {
    out.write(render());
} catch (Exception e) {
    // ignore
}
```

Masalah:

1. halaman terlihat setengah benar,
2. data hilang tanpa trace,
3. debugging sulit,
4. production defect tidak terlihat,
5. security issue bisa tersembunyi.

Lebih baik:

```java
try {
    out.write(render());
} catch (IOException e) {
    throw new JspException("Failed to render statusBadge tag", e);
}
```

Untuk expected invalid input, berikan error jelas:

```java
if (status == null) {
    throw new JspException("Attribute 'status' is required for app:statusBadge");
}
```

Namun jangan bocorkan sensitive detail ke user. Exception detail masuk log; error page user-friendly ditangani global.

---

## 26. Logging dan Observability

Custom tag sebaiknya tidak logging terlalu noisy. Tag bisa dipanggil ribuan kali dalam satu page.

Jangan:

```java
log.info("Rendering row tag for {}", id);
```

Kalau tag dalam loop 1000 row, log meledak.

Gunakan logging untuk:

1. unexpected configuration error,
2. invalid attribute contract,
3. deprecated tag usage saat development,
4. debug mode terbatas.

Metrics yang mungkin berguna untuk tag library besar:

1. jumlah render tag tertentu,
2. render duration untuk tag mahal,
3. exception count per tag,
4. deprecation usage count,
5. output size untuk component besar.

Tetapi jangan instrument semua tag secara agresif kalau overhead tidak dibutuhkan.

---

## 27. Performance Model Custom Tags

Custom tag menambah abstraction cost. Biasanya cost kecil, tetapi bisa signifikan kalau:

1. dipakai dalam loop besar,
2. banyak EL attribute dievaluasi,
3. tag melakukan reflection/formatting berat,
4. tag melakukan string concatenation buruk,
5. tag melakukan service/database call,
6. body dievaluasi berulang,
7. output terlalu besar,
8. tag library scanning memperlambat startup.

### 27.1 Rendering dalam Loop

Contoh:

```jsp
<c:forEach items="${cases}" var="case">
    <app:statusBadge status="${case.status}" />
</c:forEach>
```

Jika 50 rows, aman.

Jika 10.000 rows, problem bukan hanya tag. Problem arsitektur: page terlalu besar.

Solusi:

1. server-side pagination,
2. limit row count,
3. precompute display fields,
4. avoid expensive getter,
5. avoid service call in tag,
6. measure output size.

### 27.2 String Building

Untuk output kecil:

```java
out.write("<span>...");
```

cukup.

Untuk output kompleks, pertimbangkan helper renderer dengan `StringBuilder`, tetapi tetap hati-hati memory.

### 27.3 Formatting Cache

Formatter seperti date/number bisa mahal atau tidak thread-safe tergantung API.

Legacy `SimpleDateFormat` tidak thread-safe. Jangan simpan sebagai static mutable formatter.

Modern Java:

```java
private static final DateTimeFormatter DATE_FORMATTER = DateTimeFormatter.ofPattern("dd MMM uuuu");
```

`DateTimeFormatter` immutable dan thread-safe.

Untuk Java 8+, `java.time` sudah tersedia. Untuk legacy `java.util.Date`, convert dengan timezone jelas.

---

## 28. Testing Custom Tags

Custom tag sering tidak dites karena dianggap view-only. Itu berbahaya untuk tag library internal besar.

### 28.1 Test Level

| Level | Apa yang dites |
|---|---|
| Unit test helper renderer | escaping, mapping, formatting |
| Unit test tag handler | setter + `doTag()` output |
| Integration test JSP | tag resolution, TLD, container behavior |
| HTML assertion test | output structure |
| Security test | XSS escaping |
| Compatibility test | Java/container/Jakarta version |

### 28.2 Extract Renderer agar Mudah Dites

Daripada semua logic di tag:

```java
public class StatusBadgeTag extends SimpleTagSupport {
    // all rendering logic here
}
```

Pisahkan:

```java
public final class StatusBadgeRenderer {
    public String render(String status) {
        // pure rendering logic
    }
}
```

Tag:

```java
@Override
public void doTag() throws JspException, IOException {
    getJspContext().getOut().write(renderer.render(status));
}
```

Renderer pure lebih mudah dites.

### 28.3 Security Regression Test

Input:

```text
<script>alert(1)</script>
```

Expected output:

```html
&lt;script&gt;alert(1)&lt;/script&gt;
```

Test seperti ini wajib untuk tag yang menerima user-controlled text.

---

## 29. Migration dari `javax` ke `jakarta`

Custom tag migration biasanya menyentuh beberapa area.

### 29.1 Java Imports

Legacy:

```java
import javax.servlet.jsp.JspException;
import javax.servlet.jsp.JspWriter;
import javax.servlet.jsp.tagext.SimpleTagSupport;
```

Modern:

```java
import jakarta.servlet.jsp.JspException;
import jakarta.servlet.jsp.JspWriter;
import jakarta.servlet.jsp.tagext.SimpleTagSupport;
```

### 29.2 Dependencies

Legacy Java EE/Jakarta EE 8:

```xml
<dependency>
    <groupId>javax.servlet.jsp</groupId>
    <artifactId>javax.servlet.jsp-api</artifactId>
    <version>2.x.x</version>
    <scope>provided</scope>
</dependency>
```

Modern Jakarta:

```xml
<dependency>
    <groupId>jakarta.servlet.jsp</groupId>
    <artifactId>jakarta.servlet.jsp-api</artifactId>
    <version>4.0.0</version>
    <scope>provided</scope>
</dependency>
```

Versi persis bergantung container/platform.

### 29.3 TLD Schema

TLD schema mungkin perlu disesuaikan dari namespace lama ke Jakarta namespace.

Legacy banyak memakai:

```xml
<taglib xmlns="http://java.sun.com/xml/ns/javaee" version="2.1">
```

Modern Jakarta memakai namespace Jakarta EE:

```xml
<taglib xmlns="https://jakarta.ee/xml/ns/jakartaee" version="3.0">
```

Uji di container target. Tidak semua kombinasi schema lama/baru diterima sama.

### 29.4 Taglib URI

Custom URI milik aplikasi bisa tetap sama kalau TLD-nya ditemukan. Namun JSTL/Jakarta Tags URI berubah di Jakarta Tags 3.0 menjadi format `jakarta.tags.*`.

Custom tag internal sebaiknya menggunakan URI milik organisasi/aplikasi, bukan URI JSTL.

---

## 30. Java 8 sampai Java 25: Dampak ke Custom Tags

Custom tags sendiri tidak terlalu bergantung pada fitur Java terbaru. Namun implementation dan runtime-nya terpengaruh.

### 30.1 Java 8

Ciri:

1. banyak legacy JSP/JSF masih di sini,
2. namespace sering `javax.*`,
3. app server lama,
4. `java.time` tersedia tetapi belum selalu dipakai,
5. tidak ada records, var, switch expression.

Tag handler harus ditulis dengan syntax Java 8 jika target runtime Java 8.

### 30.2 Java 11

Ciri:

1. banyak enterprise mulai migrasi dari Java 8,
2. module system sudah ada dari Java 9,
3. beberapa library lama bermasalah dengan JAXB removal dari JDK,
4. container Jakarta EE 9/10 mulai umum.

### 30.3 Java 17

Ciri:

1. baseline penting untuk Jakarta EE 11,
2. LTS populer,
3. records bisa dipakai untuk view model kalau build/runtime mendukung,
4. pattern matching mulai membantu internal code.

Contoh view model record:

```java
public record BadgeView(String text, String variant) {}
```

Namun JSP/EL property access terhadap records harus diuji di stack target. Jangan asumsi semua resolver/library memperlakukan record component sama seperti bean getter pada container lama.

### 30.4 Java 21

Ciri:

1. LTS,
2. virtual threads tersedia,
3. modern server runtime mulai mengadopsi.

Custom tag tidak otomatis mendapat manfaat virtual threads. Tag tetap berjalan di request thread. Yang penting: jangan blocking remote call di tag.

### 30.5 Java 25

Ciri:

1. LTS terbaru setelah Java 21,
2. cocok untuk modern runtime jangka panjang,
3. legacy JSP libraries perlu diuji ketat,
4. bytecode version harus cocok dengan runtime/container build chain.

Guideline:

> Custom tag library harus dikompilasi sesuai minimum runtime aplikasi paling tua yang didukung.

Kalau satu library dipakai oleh aplikasi Java 8 dan Java 21, compile target harus Java 8 atau pisahkan artifact.

---

## 31. Anti-Patterns Custom Tags

### 31.1 Tag yang Query Database

```jsp
<app:userName userId="${case.assigneeId}" />
```

Jika tag melakukan DB query untuk setiap row table, ini N+1 rendering disaster.

Solusi:

```jsp
<c:out value="${case.assigneeName}" />
```

Controller/service menyiapkan nama.

### 31.2 Tag yang Mutasi Business State

```jsp
<case:markAsViewed caseId="${case.id}" />
```

Rendering page tidak boleh mutate business state secara tersembunyi.

### 31.3 Tag yang Bergantung pada Request Attribute Tersembunyi

Buruk:

```jsp
<app:menu />
```

lalu tag diam-diam membaca:

```java
pageContext.getRequest().getAttribute("currentUser")
```

Lebih baik:

```jsp
<app:menu model="${menuView}" />
```

Dependency eksplisit.

### 31.4 Tag dengan Terlalu Banyak Attribute

```jsp
<app:table a="" b="" c="" d="" e="" f="" g="" h="" />
```

Kalau tag butuh 20 attribute, mungkin perlu view model object.

```jsp
<app:table model="${caseTable}" />
```

### 31.5 Tag yang Tidak Escape Output

```java
out.write("<span>" + label + "</span>");
```

Ini XSS risk jika `label` user-controlled.

### 31.6 Tag yang Menelan Exception

Sudah dibahas: jangan ignore exception.

### 31.7 Tag yang Menjadi Framework Internal Tidak Terkontrol

Kalau custom tag library punya:

1. routing sendiri,
2. permission sendiri,
3. query engine sendiri,
4. form binding sendiri,
5. validation sendiri,
6. workflow sendiri,

maka ia bukan tag library lagi. Ia framework. Framework butuh governance yang jauh lebih serius.

---

## 32. Design Heuristics: Kapan Membuat Custom Tag?

Buat custom tag jika:

1. markup berulang minimal 3 kali,
2. aturan rendering harus konsisten,
3. security escaping perlu distandarisasi,
4. layout fragment sering dipakai,
5. ada domain display pattern yang stabil,
6. perubahan UI harus bisa dilakukan di satu tempat,
7. tag bisa tetap pure rendering.

Jangan buat custom tag jika:

1. hanya dipakai sekali,
2. logic-nya business-heavy,
3. tag perlu query data sendiri,
4. attribute contract belum jelas,
5. markup masih sangat volatile,
6. lebih sederhana dengan include biasa,
7. abstraction membuat JSP kurang terbaca.

Pertanyaan desain:

1. Apakah tag ini mengurangi kompleksitas total atau hanya memindahkannya?
2. Apakah caller bisa memahami tag dari nama dan attribute-nya?
3. Apakah tag aman by default?
4. Apakah tag bisa dites?
5. Apakah tag punya dependency tersembunyi?
6. Apakah tag akan membuat migration lebih mudah atau lebih sulit?

---

## 33. Checklist Custom Tag Production-Ready

### 33.1 API Contract

- [ ] Nama tag jelas.
- [ ] Prefix konsisten.
- [ ] Attribute required/optional jelas.
- [ ] Tipe attribute jelas.
- [ ] Default behavior jelas.
- [ ] Dynamic attributes dibatasi jika ada.
- [ ] Dokumentasi contoh tersedia.

### 33.2 Security

- [ ] Output text di-escape.
- [ ] Attribute value di-escape sesuai HTML attribute context.
- [ ] URL parameter di-encode.
- [ ] Tidak render raw HTML kecuali explicit trusted input.
- [ ] Tidak menjadi authorization enforcement tunggal.
- [ ] Tidak menulis sensitive data ke hidden fields/log.

### 33.3 State and Thread-Safety

- [ ] Tidak ada static mutable request/user state.
- [ ] Field optional di-reset atau diberi default aman.
- [ ] Tidak menyimpan `PageContext`/`JspWriter` di static field.
- [ ] Aman terhadap tag handler reuse/pooling.
- [ ] Tidak menyimpan data session besar.

### 33.4 Architecture

- [ ] Tidak query database.
- [ ] Tidak call remote API.
- [ ] Tidak mutate business state.
- [ ] Tidak membuka transaction.
- [ ] Tidak melakukan authorization decision kompleks.
- [ ] Menerima view model/display model jika kompleks.

### 33.5 Performance

- [ ] Aman dipakai dalam loop wajar.
- [ ] Tidak melakukan expensive operation per render tanpa alasan.
- [ ] Tidak logging noisy.
- [ ] Tidak membuat output terlalu besar.
- [ ] Formatting/caching thread-safe.

### 33.6 Testing

- [ ] Unit test renderer/helper.
- [ ] Test escaping XSS.
- [ ] Test null/default behavior.
- [ ] Test invalid attribute behavior.
- [ ] Test TLD resolution minimal.
- [ ] Test migration namespace jika relevan.

---

## 34. Contoh Mini Library Internal

Bayangkan aplikasi case management punya tags:

```text
app-ui-tags/
  layout/
    page.tag
    section.tag
    panel.tag
  form/
    field.tag
    errorSummary.tag
    submitBar.tag
  display/
    statusBadge.tag
    priorityBadge.tag
    dateTime.tag
    money.tag
  navigation/
    breadcrumb.tag
    pagination.tag
  security-visibility/
    actionButton.tag
```

### 34.1 Prinsip Pembagian

1. `layout:*` tidak tahu domain.
2. `form:*` fokus pada markup form dan error display.
3. `display:*` fokus rendering value.
4. `navigation:*` fokus link/paging/breadcrumb yang sudah disiapkan view model.
5. `security-visibility:*` hanya visibility, bukan enforcement.

### 34.2 Contoh JSP Setelah Ada Tag Library

```jsp
<layout:page title="Case Detail">
    <layout:section title="Summary">
        <dl>
            <dt>Case No</dt>
            <dd><c:out value="${caseView.caseNo}" /></dd>

            <dt>Status</dt>
            <dd><case:statusBadge status="${caseView.status}" /></dd>

            <dt>Priority</dt>
            <dd><case:priorityBadge priority="${caseView.priority}" /></dd>
        </dl>
    </layout:section>

    <layout:section title="Actions">
        <app:actionButton visible="${caseView.canAssign}"
                          href="${caseView.assignUrl}"
                          label="Assign" />
        <app:actionButton visible="${caseView.canClose}"
                          href="${caseView.closeUrl}"
                          label="Close" />
    </layout:section>
</layout:page>
```

JSP masih jelas. Ia tidak penuh duplikasi, tapi juga tidak menyembunyikan seluruh halaman dalam satu tag raksasa.

---

## 35. Refactoring Legacy JSP Menuju Custom Tags

Misalnya ada JSP legacy:

```jsp
<% if (caseObj.getStatus().equals("OPEN")) { %>
    <span class="green">Open</span>
<% } else if (caseObj.getStatus().equals("CLOSED")) { %>
    <span class="grey">Closed</span>
<% } else { %>
    <span class="red"><%= caseObj.getStatus() %></span>
<% } %>
```

Refactoring bertahap:

### Step 1 — Hilangkan Scriptlet dengan JSTL

```jsp
<c:choose>
    <c:when test="${case.status == 'OPEN'}">
        <span class="green">Open</span>
    </c:when>
    <c:when test="${case.status == 'CLOSED'}">
        <span class="grey">Closed</span>
    </c:when>
    <c:otherwise>
        <span class="red"><c:out value="${case.status}" /></span>
    </c:otherwise>
</c:choose>
```

### Step 2 — Buat Tag File

```jsp
<app:statusBadge status="${case.status}" />
```

### Step 3 — Pindahkan Display Mapping ke View Model Jika Perlu

```jsp
<app:badge text="${case.statusLabel}" variant="${case.statusVariant}" />
```

View model:

```java
public class CaseRowView {
    private String statusLabel;
    private String statusVariant;
}
```

### Step 4 — Standardisasi Library

Semua halaman memakai:

```jsp
<app:badge text="..." variant="..." />
```

atau domain-specific:

```jsp
<case:statusBadge status="..." />
```

Pilih berdasarkan seberapa domain-specific aturan rendering-nya.

---

## 36. Custom Tags vs Jakarta Faces Components

Custom tags JSP dan Jakarta Faces components sering terlihat mirip, tetapi modelnya berbeda.

| Aspek | JSP Custom Tag | Jakarta Faces Component |
|---|---|---|
| Model utama | template/request-time rendering | component tree/lifecycle |
| State | biasanya minimal | component state/view state |
| Validation lifecycle | tidak built-in | built-in lifecycle |
| Binding | EL sederhana | value/method binding + component model |
| Ajax partial lifecycle | tidak native seperti Faces | built-in Faces Ajax |
| Use case | reusable markup/rendering | interactive stateful UI component |
| Complexity | lebih ringan | lebih kompleks |

Custom JSP tag cocok untuk:

1. server-rendered pages,
2. reusable view fragments,
3. simple forms,
4. listing/detail screens,
5. legacy JSP modernization.

Faces component cocok untuk:

1. component-based UI,
2. validation/conversion lifecycle,
3. postback-heavy forms,
4. Ajax partial rendering,
5. rich UI library ecosystem.

Materi Faces akan dibahas mulai Part 14.

---

## 37. Failure Modeling

### 37.1 Cross-User Data Leak

Cause:

1. tag handler pooled,
2. optional field tidak di-reset,
3. request A set `message`, request B tidak set `message`,
4. request B melihat message lama.

Mitigation:

1. reset fields,
2. default values,
3. avoid static mutable state,
4. tests for optional attribute behavior.

### 37.2 XSS dari Custom Tag

Cause:

1. tag menerima label dari user/admin,
2. tag menulis raw output,
3. malicious label masuk HTML.

Mitigation:

1. escape by default,
2. context-aware encoding,
3. security tests,
4. avoid raw HTML contracts.

### 37.3 N+1 Query Saat Rendering Table

Cause:

1. tag menerima id,
2. tag lookup display name dari DB,
3. dipanggil per row.

Mitigation:

1. prepare display value in controller/service,
2. batch load,
3. pass view model,
4. detect slow page rendering.

### 37.4 Tag Library Upgrade Breaks Many Pages

Cause:

1. internal tag behavior changed,
2. no semantic versioning,
3. no compatibility test,
4. many apps depend on same JAR.

Mitigation:

1. versioned artifact,
2. deprecation policy,
3. compatibility suite,
4. changelog,
5. staged rollout.

### 37.5 Invalid Markup dari Nested Tags

Cause:

1. layout tag emits unclosed tag,
2. caller body emits incompatible structure,
3. parent-child tag ordering wrong.

Mitigation:

1. validate generated HTML,
2. keep layout contracts simple,
3. document allowed nesting,
4. use integration/snapshot tests.

---

## 38. Practical Decision Matrix

| Problem | Best Tool | Reason |
|---|---|---|
| Repeated small display markup | Tag file | simple and readable |
| Repeated display with Java formatting | Simple tag handler | controlled Java logic |
| Repeated value transformation only | EL function | no markup needed |
| Large shared layout | Tag file or include | depends on contract complexity |
| Legacy tag with body lifecycle | Classic tag handler | for compatibility |
| Complex interactive component | Jakarta Faces | component lifecycle needed |
| Authorization enforcement | Security/service layer | not view tag |
| DB lookup for display | Service/controller | avoid N+1 in view |
| Rich table with sorting/filtering | View model + maybe tag | tag only renders prepared model |
| Raw HTML rendering | Avoid or sanitize explicitly | XSS risk |

---

## 39. Top 1% Engineer Mental Model

Engineer biasa melihat custom tag sebagai cara “biar JSP pendek”.

Engineer kuat melihat custom tag sebagai **abstraction boundary**.

Pertanyaan yang harus muncul:

1. Apakah tag ini murni view concern?
2. Apa kontrak input-output-nya?
3. Apakah output aman terhadap XSS?
4. Apakah tag thread-safe dalam pooling container?
5. Apakah tag bisa dipakai di loop besar?
6. Apakah tag menyembunyikan dependency request/session?
7. Apakah tag membuat migration lebih mudah?
8. Apakah tag bisa dites tanpa container penuh?
9. Apakah tag library punya governance?
10. Apakah tag ini mengurangi complexity total?

Custom tag yang baik membuat sistem lebih sederhana.

Custom tag yang buruk membuat sistem terlihat bersih di JSP, tetapi menyembunyikan kompleksitas di runtime.

---

## 40. Ringkasan

Custom tags dan tag files adalah mekanisme reusable view component untuk JSP/Jakarta Pages.

Poin utama:

1. Tag file adalah pilihan pertama untuk reusable markup.
2. `SimpleTagSupport` cocok untuk custom rendering berbasis Java.
3. Classic `TagSupport`/`BodyTagSupport` penting untuk legacy dan kontrol lifecycle detail.
4. TLD adalah kontrak metadata tag library.
5. Attribute design menentukan kualitas tag.
6. Body content dan fragment memungkinkan composition.
7. Dynamic attributes berguna tetapi perlu security boundary.
8. Output encoding harus aman by default.
9. Tag handler harus thread-safe dan aman terhadap pooling.
10. Custom tag tidak boleh menjadi business/service/controller tersembunyi.
11. Tag library internal harus diperlakukan sebagai API dengan versioning dan compatibility tests.
12. Migrasi `javax.*` ke `jakarta.*` menyentuh imports, dependencies, TLD, dan container compatibility.
13. Custom tags adalah stepping stone penting sebelum memahami component model Jakarta Faces.

---

## 41. Referensi

1. Jakarta Pages/Jakarta Server Pages specification and API documentation, especially `jakarta.servlet.jsp.tagext` package, which defines tag extension APIs and describes tag libraries as TLD plus tag files or tag handler classes.
2. Jakarta Standard Tag Library 3.0 specification, which defines standard tags and the framework for integrating custom tags with Jakarta Pages.
3. Jakarta EE Platform specifications for namespace migration and platform compatibility context.
4. Servlet/JSP container documentation for tag pooling, TLD scanning, generated servlet behavior, and deployment-specific behavior.

---

## 42. Status Seri

Seri **belum selesai**.

Bagian yang sudah selesai:

1. Part 0 — Orientation: Mental Model Server-Side UI di Java.
2. Part 1 — Historical Evolution dan Compatibility Matrix.
3. Part 2 — Jakarta Pages/JSP Internal Architecture.
4. Part 3 — JSP Syntax Deep Dive.
5. Part 4 — Request, Session, Application Scope.
6. Part 5 — Expression Language Fundamentals.
7. Part 6 — Advanced EL.
8. Part 7 — Jakarta Standard Tag Library Core Tags.
9. Part 8 — Formatting, I18N, XML, and SQL Tags.
10. Part 9 — Custom Tags and Tag Files.

Bagian berikutnya:

**Part 10 — JSP Layouting: Includes, Templates, Tiles-like Composition, and Maintainability**

File berikutnya:

```text
10-jsp-layouting-includes-templates-composition-maintainability.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./08-formatting-i18n-xml-sql-tags-what-to-use-and-avoid.md">⬅️ Part 8 — Formatting, I18N, XML, and SQL Tags: What to Use and What to Avoid</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./10-jsp-layouting-includes-templates-composition-maintainability.md">Part 10 — JSP Layouting: Includes, Templates, Composition, and Maintainability ➡️</a>
</div>
