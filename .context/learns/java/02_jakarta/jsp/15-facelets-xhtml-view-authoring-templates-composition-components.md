# Part 15 — Facelets and XHTML View Authoring: Templates, Composition, and Components

> Seri: `learn-java-jakarta-pages-el-tags-faces-server-side-ui`  
> File: `15-facelets-xhtml-view-authoring-templates-composition-components.md`  
> Fokus: Facelets, XHTML, template composition, namespace, component tree authoring, dan failure model view declaration Jakarta Faces modern.

---

## 0. Posisi Materi Ini dalam Seri

Pada bagian sebelumnya, kita membahas **Jakarta Faces sebagai component-based MVC framework**. Kita melihat bahwa Faces bukan sekadar template engine seperti JSP. Faces membangun **component tree**, menjalankan lifecycle, mengelola state, melakukan conversion/validation, memanggil action, lalu me-render response.

Bagian ini menjawab pertanyaan berikut:

> Kalau Faces bekerja dengan component tree, bagaimana kita “menulis” tree itu di file view?

Jawabannya adalah **Facelets**.

Facelets adalah **view declaration language** utama untuk Jakarta Faces modern. Ia biasanya ditulis sebagai file `.xhtml`, memakai tag-tag seperti:

```xhtml
<h:form>
    <h:inputText value="#{caseBean.referenceNo}" />
    <h:commandButton value="Search" action="#{caseBean.search}" />
</h:form>
```

Namun jangan salah mental model. File `.xhtml` di Faces bukan hanya HTML dengan expression. File itu adalah **blueprint untuk membangun component tree**.

Ini perbedaan besar dibanding JSP:

```text
JSP / Jakarta Pages
  .jsp template
      -> translated/compiled servlet
      -> executes tags/EL
      -> writes text response

Jakarta Faces + Facelets
  .xhtml view declaration
      -> parsed by Facelets
      -> builds/restores UIComponent tree
      -> lifecycle processes tree
      -> renderer encodes tree into HTML response
```

Jadi ketika menulis Facelets, kita tidak sedang “menulis HTML final”. Kita sedang menulis **deklarasi UI components** yang nanti akan diubah menjadi HTML oleh renderer.

---

## 1. Apa Itu Facelets?

Facelets adalah **page declaration language** untuk Jakarta Faces.

Secara praktis, Facelets memberikan kemampuan:

1. Menulis view dalam bentuk XHTML.
2. Menggunakan Jakarta Faces component tags.
3. Menggunakan EL untuk binding ke bean.
4. Membuat template/layout reusable.
5. Membuat fragment reusable.
6. Membuat composite component.
7. Mengintegrasikan tag library Faces, Facelets, JSTL, dan custom tag.
8. Membangun component tree yang kemudian diproses oleh Faces lifecycle.

Mental model penting:

```text
Facelets file is not the final page.
Facelets file is the source code of a component tree.
```

Atau dalam Bahasa Indonesia:

> File `.xhtml` adalah source code view tree, bukan sekadar dokumen HTML.

---

## 2. Kenapa Facelets Menggantikan JSP untuk Faces Modern?

Historically, JSF/Faces pernah bisa dipakai dengan JSP. Namun kombinasi itu bermasalah secara model.

JSP adalah teknologi **text streaming**:

```text
execute page -> write characters to response
```

Faces adalah teknologi **component tree lifecycle**:

```text
restore/build tree -> decode -> validate -> update model -> invoke action -> render tree
```

Keduanya punya mental model berbeda.

Masalah ketika Faces dipakai dengan JSP:

1. JSP menulis output terlalu awal.
2. Faces butuh membangun component tree dulu.
3. JSP tag execution tidak selalu cocok dengan lifecycle Faces.
4. Reuse component dan templating menjadi awkward.
5. Error/debugging menjadi sulit.
6. Partial state saving dan Ajax lebih natural dengan Facelets.

Facelets didesain khusus untuk Faces. Karena itu, untuk aplikasi Faces modern, gunakan:

```text
.xhtml + Facelets + Faces tags
```

Bukan:

```text
.jsp + JSF tags
```

Rule praktis:

> Untuk Jakarta Faces modern, anggap JSP sebagai legacy integration concern, bukan view technology utama.

---

## 3. XHTML: Kenapa Faces View Sering Ditulis sebagai `.xhtml`?

Facelets umumnya menggunakan XHTML-style markup.

Contoh minimal:

```xhtml
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:h="jakarta.faces.html"
      xmlns:f="jakarta.faces.core">
<h:head>
    <title>Hello Faces</title>
</h:head>
<h:body>
    <h:form>
        <h:outputText value="Hello #{userBean.name}" />
    </h:form>
</h:body>
</html>
```

Perhatikan bahwa tag seperti `h:form`, `h:inputText`, `h:commandButton`, `ui:composition`, `f:metadata` bukan HTML biasa. Itu tag yang diproses Facelets/Faces.

XHTML-style penting karena Facelets perlu parsing markup secara konsisten.

Contoh yang harus dihindari:

```xhtml
<input type="text">
<br>
<img src="logo.png">
```

Dalam XHTML-style, sebaiknya menjadi:

```xhtml
<input type="text" />
<br />
<img src="logo.png" alt="Logo" />
```

Namun dalam Faces, lebih sering Anda memakai component:

```xhtml
<h:inputText value="#{bean.name}" />
```

Bukan raw:

```xhtml
<input type="text" name="name" />
```

Karena raw input tidak otomatis ikut lifecycle Faces.

---

## 4. Facelets View Bukan HTML Final

Ini salah satu kesalahan paling umum.

Ketika Anda menulis:

```xhtml
<h:form id="searchForm">
    <h:inputText id="keyword" value="#{searchBean.keyword}" />
    <h:commandButton id="submit" value="Search" action="#{searchBean.search}" />
</h:form>
```

HTML final bisa menjadi kira-kira:

```html
<form id="searchForm" name="searchForm" method="post" action="/app/search.xhtml">
    <input id="searchForm:keyword" name="searchForm:keyword" type="text" value="" />
    <input id="searchForm:submit" name="searchForm:submit" type="submit" value="Search" />
    <input type="hidden" name="jakarta.faces.ViewState" value="..." />
</form>
```

Ada beberapa konsekuensi:

1. ID client tidak selalu sama dengan ID component.
2. Faces menambahkan hidden view state.
3. Component renderer menentukan HTML final.
4. Naming container mempengaruhi generated client ID.
5. JavaScript selector yang hardcoded bisa rusak.
6. Ajax render target harus memakai ID component/naming-container-aware.

Mental model:

```text
Facelets source id
  -> component id
  -> client id
  -> rendered HTML id/name
```

Bug umum:

```javascript
document.getElementById("keyword") // null
```

Karena HTML final mungkin:

```html
<input id="searchForm:keyword" ...>
```

Solusi:

1. Jangan hardcode client ID tanpa memahami naming container.
2. Gunakan pass-through atau style class untuk selector JS.
3. Gunakan `@form`, `@this`, atau resolved component target untuk Ajax.
4. Untuk integration JS serius, desain explicit hook seperti `data-testid`, `data-role`, atau class stabil.

---

## 5. Namespace Penting dalam Facelets

Facelets memakai XML namespaces untuk membedakan tag library.

Contoh umum:

```xhtml
<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:h="jakarta.faces.html"
      xmlns:f="jakarta.faces.core"
      xmlns:ui="jakarta.faces.facelets"
      xmlns:c="jakarta.tags.core"
      xmlns:pt="jakarta.faces.passthrough"
      xmlns:cc="jakarta.faces.composite">
```

### 5.1 `h` — HTML Component Tags

Namespace:

```xhtml
xmlns:h="jakarta.faces.html"
```

Dipakai untuk komponen HTML Faces:

```xhtml
<h:form>
<h:inputText>
<h:outputText>
<h:commandButton>
<h:dataTable>
<h:messages>
<h:link>
<h:button>
<h:panelGroup>
```

Tag `h:*` biasanya menghasilkan HTML output, tetapi tetap merupakan **Faces component**.

### 5.2 `f` — Core Faces Tags

Namespace:

```xhtml
xmlns:f="jakarta.faces.core"
```

Dipakai untuk behavior/core metadata:

```xhtml
<f:metadata>
<f:viewParam>
<f:viewAction>
<f:ajax>
<f:facet>
<f:converter>
<f:validator>
<f:attribute>
<f:param>
<f:selectItem>
<f:selectItems>
```

Tag `f:*` sering tidak langsung menghasilkan HTML. Banyak yang memodifikasi component tree, menambahkan metadata, converter, validator, facet, atau behavior.

### 5.3 `ui` — Facelets Templating Tags

Namespace:

```xhtml
xmlns:ui="jakarta.faces.facelets"
```

Dipakai untuk templating/composition:

```xhtml
<ui:composition>
<ui:define>
<ui:insert>
<ui:include>
<ui:param>
<ui:fragment>
<ui:decorate>
<ui:repeat>
<ui:remove>
```

`ui:*` adalah jantung layout Facelets.

### 5.4 `c` — Jakarta Tags / JSTL Core

Namespace modern:

```xhtml
xmlns:c="jakarta.tags.core"
```

Dipakai untuk conditional/iteration tag JSTL:

```xhtml
<c:if>
<c:choose>
<c:forEach>
<c:set>
```

Namun pemakaiannya di Facelets harus hati-hati karena JSTL bekerja pada **view build time**, sedangkan Faces component bekerja pada **component lifecycle/render time**. Kita bahas detail nanti.

### 5.5 `pt` — Pass-through Attributes

Namespace:

```xhtml
xmlns:pt="jakarta.faces.passthrough"
```

Dipakai untuk meneruskan attribute HTML5 ke output:

```xhtml
<h:inputText value="#{bean.email}"
             pt:placeholder="Email address"
             pt:autocomplete="email"
             pt:data-testid="email-input" />
```

Ini berguna ketika HTML attribute modern belum punya properti langsung di component.

### 5.6 `cc` — Composite Component

Namespace:

```xhtml
xmlns:cc="jakarta.faces.composite"
```

Dipakai saat membuat composite component:

```xhtml
<cc:interface>
    <cc:attribute name="value" required="true" />
</cc:interface>

<cc:implementation>
    <h:inputText value="#{cc.attrs.value}" />
</cc:implementation>
```

Composite component akan dibahas lebih dalam di Part 23.

---

## 6. Struktur File Facelets Umum

Struktur sederhana:

```text
src/main/webapp/
  index.xhtml
  login.xhtml
  cases/
    list.xhtml
    detail.xhtml
    edit.xhtml
  WEB-INF/
    templates/
      main.xhtml
      error.xhtml
    includes/
      menu.xhtml
      breadcrumb.xhtml
  resources/
    css/
      app.css
    js/
      app.js
    images/
      logo.svg
```

Rekomendasi:

```text
Public views:
  /login.xhtml
  /public/*.xhtml

Protected views:
  /cases/*.xhtml
  /admin/*.xhtml

Templates/fragments not directly requested:
  /WEB-INF/templates/*.xhtml
  /WEB-INF/includes/*.xhtml

Static resources managed by Faces:
  /resources/{library}/{resource}
```

Kenapa template sebaiknya di `/WEB-INF`?

Karena resource di bawah `/WEB-INF` tidak dapat diakses langsung oleh browser. Ini mencegah user membuka template partial secara langsung.

---

## 7. Minimal Faces View

Contoh minimal:

```xhtml
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:h="jakarta.faces.html">
<h:head>
    <title>Hello</title>
</h:head>
<h:body>
    <h:form>
        <h:outputLabel for="name" value="Name" />
        <h:inputText id="name" value="#{helloBean.name}" />
        <h:commandButton value="Submit" action="#{helloBean.submit}" />
    </h:form>
</h:body>
</html>
```

Backing bean:

```java
import jakarta.enterprise.context.RequestScoped;
import jakarta.inject.Named;

@Named
@RequestScoped
public class HelloBean {
    private String name;

    public String submit() {
        return "result";
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }
}
```

Yang terjadi:

```text
GET /hello.xhtml
  -> build component tree
  -> render form

POST /hello.xhtml
  -> restore component tree
  -> decode request parameter
  -> convert/validate
  -> update helloBean.name
  -> invoke helloBean.submit()
  -> navigate/render
```

Facelets file adalah deklarasi component tree yang lifecycle-aware.

---

## 8. `h:head` dan `h:body` vs HTML `<head>` dan `<body>`

Dalam Faces, sebaiknya gunakan:

```xhtml
<h:head>
    <title>Case Management</title>
</h:head>
<h:body>
    ...
</h:body>
```

Bukan hanya:

```xhtml
<head>...</head>
<body>...</body>
```

Kenapa?

Karena `h:head` dan `h:body` memberi Faces tempat untuk menyisipkan resource yang dikelola framework, misalnya CSS/JS yang diminta komponen.

Contoh:

```xhtml
<h:outputStylesheet library="css" name="app.css" />
<h:outputScript library="js" name="app.js" target="body" />
```

Faces resource handling lebih lifecycle-aware dibanding hardcoded:

```html
<link rel="stylesheet" href="/resources/css/app.css">
```

Hardcoded path raw sering gagal saat:

1. Context path berubah.
2. Deployment di reverse proxy.
3. Resource versioning diperlukan.
4. Component library menyisipkan resource otomatis.

---

## 9. Facelets Template Composition

Template composition adalah fitur besar Facelets.

Problem yang diselesaikan:

> Banyak halaman butuh layout sama: header, menu, breadcrumb, content, footer, scripts.

Tanpa template, kita mengulang struktur di setiap halaman.

Dengan Facelets, kita buat template:

```xhtml
<!-- /WEB-INF/templates/main.xhtml -->
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:h="jakarta.faces.html"
      xmlns:ui="jakarta.faces.facelets">
<h:head>
    <title>
        <ui:insert name="title">Application</ui:insert>
    </title>
    <h:outputStylesheet library="css" name="app.css" />
    <ui:insert name="head" />
</h:head>
<h:body>
    <header>
        <ui:include src="/WEB-INF/includes/header.xhtml" />
    </header>

    <nav>
        <ui:include src="/WEB-INF/includes/menu.xhtml" />
    </nav>

    <main>
        <ui:insert name="content" />
    </main>

    <footer>
        <ui:include src="/WEB-INF/includes/footer.xhtml" />
    </footer>

    <h:outputScript library="js" name="app.js" target="body" />
    <ui:insert name="scripts" />
</h:body>
</html>
```

Lalu halaman memakai template:

```xhtml
<!-- /cases/list.xhtml -->
<ui:composition xmlns="http://www.w3.org/1999/xhtml"
                xmlns:h="jakarta.faces.html"
                xmlns:ui="jakarta.faces.facelets"
                template="/WEB-INF/templates/main.xhtml">

    <ui:define name="title">Case List</ui:define>

    <ui:define name="content">
        <h1>Case List</h1>

        <h:form id="searchForm">
            <h:inputText id="keyword" value="#{caseListBean.keyword}" />
            <h:commandButton value="Search" action="#{caseListBean.search}" />
        </h:form>
    </ui:define>

</ui:composition>
```

Mental model:

```text
Template defines slots:
  ui:insert name="title"
  ui:insert name="content"
  ui:insert name="scripts"

Page fills slots:
  ui:define name="title"
  ui:define name="content"
  ui:define name="scripts"
```

---

## 10. `ui:composition`

`ui:composition` defines a Facelets composition. Biasanya dipakai sebagai root halaman yang memakai template.

Contoh:

```xhtml
<ui:composition xmlns="http://www.w3.org/1999/xhtml"
                xmlns:ui="jakarta.faces.facelets"
                xmlns:h="jakarta.faces.html"
                template="/WEB-INF/templates/main.xhtml">
    ...
</ui:composition>
```

Karakter penting:

1. Bisa memakai attribute `template`.
2. Semua markup di luar composition biasanya diabaikan oleh Facelets composition processing.
3. Cocok untuk halaman yang ingin tetap well-formed XHTML tetapi content real-nya hanya composition.

Anti-pattern:

```xhtml
<html ...>
<body>
    <ui:composition template="/WEB-INF/templates/main.xhtml">
        ...
    </ui:composition>
</body>
</html>
```

Dalam banyak kasus, markup `<html>` dan `<body>` luar tidak dipakai sebagaimana Anda kira. Lebih jelas gunakan `ui:composition` sebagai root.

---

## 11. `ui:define` dan `ui:insert`

`ui:insert` berada di template.

```xhtml
<ui:insert name="content">
    Default content
</ui:insert>
```

`ui:define` berada di page client.

```xhtml
<ui:define name="content">
    Actual page content
</ui:define>
```

Jika page tidak menyediakan `ui:define`, default content dalam `ui:insert` dipakai.

Contoh template:

```xhtml
<title><ui:insert name="title">Default Title</ui:insert></title>
```

Contoh page:

```xhtml
<ui:define name="title">Application Detail</ui:define>
```

Design heuristic:

1. Gunakan nama slot yang stabil: `title`, `head`, `breadcrumb`, `content`, `actions`, `scripts`.
2. Jangan buat terlalu banyak slot kecil.
3. Jangan buat template terlalu pintar.
4. Template sebaiknya mengatur structure, bukan business decision.

---

## 12. `ui:include`

`ui:include` memasukkan Facelets fragment lain.

```xhtml
<ui:include src="/WEB-INF/includes/menu.xhtml" />
```

Dengan parameter:

```xhtml
<ui:include src="/WEB-INF/includes/page-title.xhtml">
    <ui:param name="title" value="Case Detail" />
    <ui:param name="subtitle" value="Review enforcement case" />
</ui:include>
```

Included file:

```xhtml
<ui:composition xmlns="http://www.w3.org/1999/xhtml"
                xmlns:h="jakarta.faces.html">
    <section class="page-title">
        <h1>#{title}</h1>
        <p>#{subtitle}</p>
    </section>
</ui:composition>
```

Use cases:

1. Header.
2. Footer.
3. Menu.
4. Breadcrumb.
5. Reusable static fragment.
6. Search panel shared by multiple pages.
7. Standard error summary.

Jangan gunakan `ui:include` untuk membuat component yang punya banyak behavior kompleks. Untuk itu lebih baik composite component atau custom component.

---

## 13. `ui:param`

`ui:param` meneruskan parameter ke template/include.

Contoh:

```xhtml
<ui:include src="/WEB-INF/includes/action-bar.xhtml">
    <ui:param name="showApprove" value="#{casePermissionBean.canApprove(caseBean.caseItem)}" />
    <ui:param name="showReject" value="#{casePermissionBean.canReject(caseBean.caseItem)}" />
</ui:include>
```

Fragment:

```xhtml
<ui:composition xmlns="http://www.w3.org/1999/xhtml"
                xmlns:h="jakarta.faces.html">
    <h:panelGroup rendered="#{showApprove}">
        <h:commandButton value="Approve" action="#{caseBean.approve}" />
    </h:panelGroup>
    <h:panelGroup rendered="#{showReject}">
        <h:commandButton value="Reject" action="#{caseBean.reject}" />
    </h:panelGroup>
</ui:composition>
```

Caution:

`ui:param` cocok untuk parameter ringan. Jangan kirim object besar atau membuat include menjadi black box dengan terlalu banyak parameter.

Jika include butuh 15 parameter, kemungkinan Anda butuh:

1. View model object.
2. Composite component.
3. Backing bean method.
4. Desain UI yang lebih eksplisit.

---

## 14. `ui:fragment`

`ui:fragment` berguna sebagai grouping component ringan yang tetap masuk component tree.

Contoh:

```xhtml
<ui:fragment rendered="#{caseBean.editable}">
    <h:commandButton value="Save" action="#{caseBean.save}" />
</ui:fragment>
```

Bandingkan dengan raw HTML:

```xhtml
<div rendered="#{caseBean.editable}">
    ...
</div>
```

`rendered` bukan attribute valid untuk raw HTML element. Untuk condition yang lifecycle-aware, gunakan Faces component/tag yang mendukung `rendered`, misalnya:

```xhtml
<h:panelGroup rendered="#{caseBean.editable}" layout="block">
    ...
</h:panelGroup>
```

atau:

```xhtml
<ui:fragment rendered="#{caseBean.editable}">
    ...
</ui:fragment>
```

Perbedaan praktis:

```text
c:if
  build-time conditional
  component mungkin tidak pernah dibuat

rendered="..."
  component ada di tree
  render-time conditional
  lebih cocok untuk Faces lifecycle
```

---

## 15. `ui:remove`

`ui:remove` menghapus content dari Facelets output/tree.

Contoh:

```xhtml
<ui:remove>
    Developer note:
    This sample is intentionally removed from component tree and output.
</ui:remove>
```

Gunakan untuk comment yang tidak boleh muncul di HTML output.

Jangan pakai HTML comment untuk data sensitif:

```html
<!-- TODO: temporary admin bypass here -->
```

Karena HTML comment dikirim ke browser.

---

## 16. `ui:repeat` vs `c:forEach` vs `h:dataTable`

Ada tiga mekanisme umum untuk iterasi:

### 16.1 `c:forEach`

```xhtml
<c:forEach items="#{caseBean.cases}" var="item">
    <h:outputText value="#{item.referenceNo}" />
</c:forEach>
```

JSTL `c:forEach` berjalan saat build view. Ia menggandakan component saat view dibangun.

Cocok untuk:

1. Struktur statis saat build view.
2. Menu kecil.
3. Template-level static-ish repetition.

Berisiko untuk:

1. Input components dinamis.
2. Postback state.
3. Ajax update.
4. Data yang berubah antar request.
5. Component ID duplication.

### 16.2 `ui:repeat`

```xhtml
<ui:repeat value="#{caseBean.cases}" var="item">
    <h:outputText value="#{item.referenceNo}" />
</ui:repeat>
```

Lebih Facelets/Faces-aware dibanding `c:forEach`.

Cocok untuk repeated component markup sederhana.

### 16.3 `h:dataTable`

```xhtml
<h:dataTable value="#{caseBean.cases}" var="item">
    <h:column>
        <f:facet name="header">Reference</f:facet>
        <h:outputText value="#{item.referenceNo}" />
    </h:column>
</h:dataTable>
```

Cocok untuk table-style component dengan column/facet semantics.

Rule praktis:

```text
Static-ish markup repetition:
  c:forEach may be acceptable, but be careful.

Faces component repetition:
  prefer ui:repeat.

Tabular UI:
  use h:dataTable or component library table.

Editable rows / complex table / pagination:
  use data component designed for it, not raw c:forEach hacks.
```

---

## 17. Build Time vs Render Time: Konsep yang Wajib Paham

Ini inti dari Facelets.

Banyak bug terjadi karena developer menyamakan semua tag sebagai “dieksekusi saat render”. Tidak benar.

Ada dua lapisan waktu penting:

```text
View build time
  Facelets parses .xhtml
  Tags create/configure component tree
  Some tag handlers execute now

Render/lifecycle time
  Existing component tree is processed
  decode / validate / update / action / render
  Component attributes evaluated as needed
```

### 17.1 JSTL `c:if` adalah build-time-ish

```xhtml
<c:if test="#{bean.showInput}">
    <h:inputText id="name" value="#{bean.name}" />
</c:if>
```

Jika `showInput` false saat build view, component `name` tidak dibuat.

Pada postback, jika component tidak ada, request parameter tidak diproses, validation tidak jalan, model tidak update.

### 17.2 `rendered` adalah component attribute

```xhtml
<h:inputText id="name"
             value="#{bean.name}"
             rendered="#{bean.showInput}" />
```

Component tetap bagian dari tree, tetapi renderer bisa tidak menampilkannya.

Namun caution: jika component tidak rendered, biasanya ia juga tidak participate dalam decode/render sebagaimana visible component. Untuk dynamic forms, pahami lifecycle lebih detail.

### 17.3 Kenapa Ini Penting?

Misalnya:

```xhtml
<c:if test="#{caseBean.editMode}">
    <h:inputText id="remarks" value="#{caseBean.remarks}" />
</c:if>
```

Jika `editMode` berubah antara GET dan POST, tree shape berubah. Ini bisa menyebabkan:

1. Submitted value hilang.
2. Validation tidak jalan.
3. Component id mismatch.
4. View state mismatch.
5. Action tidak terpanggil.

Safer pattern:

```xhtml
<h:panelGroup id="remarksBlock" rendered="#{caseBean.editMode}" layout="block">
    <h:inputText id="remarks" value="#{caseBean.remarks}" />
</h:panelGroup>
```

Untuk Ajax:

```xhtml
<h:panelGroup id="remarksContainer" layout="block">
    <h:panelGroup rendered="#{caseBean.editMode}" layout="block">
        <h:inputText id="remarks" value="#{caseBean.remarks}" />
    </h:panelGroup>
</h:panelGroup>
```

Kenapa wrapper selalu rendered?

Karena Ajax perlu target yang ada di DOM/component tree untuk di-update.

---

## 18. Template Composition dan `f:metadata`

`f:metadata` dipakai untuk view parameters dan view actions.

Contoh:

```xhtml
<f:metadata>
    <f:viewParam name="id" value="#{caseDetailBean.caseId}" required="true" />
    <f:viewAction action="#{caseDetailBean.load}" />
</f:metadata>
```

Masalah muncul saat halaman memakai template:

```xhtml
<ui:composition template="/WEB-INF/templates/main.xhtml">
    <f:metadata>
        ...
    </f:metadata>

    <ui:define name="content">
        ...
    </ui:define>
</ui:composition>
```

Tidak selalu sesuai harapan karena metadata punya posisi khusus dalam view.

Pattern yang lebih eksplisit:

Template menyediakan slot metadata:

```xhtml
<!-- main.xhtml -->
<f:view xmlns="http://www.w3.org/1999/xhtml"
        xmlns:f="jakarta.faces.core"
        xmlns:h="jakarta.faces.html"
        xmlns:ui="jakarta.faces.facelets">

    <ui:insert name="metadata" />

    <h:head>
        <title><ui:insert name="title">Application</ui:insert></title>
    </h:head>
    <h:body>
        <ui:insert name="content" />
    </h:body>
</f:view>
```

Page:

```xhtml
<ui:composition xmlns="http://www.w3.org/1999/xhtml"
                xmlns:f="jakarta.faces.core"
                xmlns:h="jakarta.faces.html"
                xmlns:ui="jakarta.faces.facelets"
                template="/WEB-INF/templates/main.xhtml">

    <ui:define name="metadata">
        <f:metadata>
            <f:viewParam name="id" value="#{caseDetailBean.caseId}" required="true" />
            <f:viewAction action="#{caseDetailBean.load}" />
        </f:metadata>
    </ui:define>

    <ui:define name="content">
        <h1>Case Detail</h1>
    </ui:define>
</ui:composition>
```

Design rule:

> Jika aplikasi banyak memakai bookmarkable page dengan `f:viewParam`, desain template sejak awal untuk metadata slot.

---

## 19. Raw HTML vs Faces Component

Facelets membolehkan raw HTML dan Faces components bercampur.

Contoh raw HTML aman:

```xhtml
<section class="card">
    <h2>Summary</h2>
    <p>Current case status</p>
</section>
```

Contoh Faces component:

```xhtml
<h:outputText value="#{caseBean.status}" />
```

Kapan raw HTML cukup?

1. Static structure.
2. Layout markup.
3. CSS hooks.
4. Non-form content.
5. Semantic HTML.

Kapan perlu Faces component?

1. Value binding.
2. Form input.
3. Validation.
4. Conversion.
5. Ajax behavior.
6. Conditional rendering lifecycle-aware.
7. Messages.
8. Navigation/action.
9. Component library integration.

Anti-pattern:

```xhtml
<input type="text" value="#{bean.name}" />
```

Ini hanya menulis initial value. Pada POST, Faces tidak otomatis update `bean.name` karena raw input bukan Faces component.

Gunakan:

```xhtml
<h:inputText value="#{bean.name}" />
```

---

## 20. `h:panelGroup` dan Semantic HTML

Faces standard component sering memakai `h:panelGroup` untuk grouping.

```xhtml
<h:panelGroup id="filters" layout="block" styleClass="filters">
    ...
</h:panelGroup>
```

`layout="block"` biasanya render sebagai `div`.

Namun untuk semantic HTML, raw elements tetap boleh:

```xhtml
<section class="case-summary">
    <h2>Case Summary</h2>
    <h:outputText value="#{caseBean.summary}" />
</section>
```

Rule:

```text
Use raw HTML for semantics.
Use Faces component when lifecycle participation is needed.
```

Untuk Ajax update target, gunakan component dengan stable id:

```xhtml
<h:panelGroup id="caseSummary" layout="block" styleClass="case-summary">
    <h2>Case Summary</h2>
    <h:outputText value="#{caseBean.summary}" />
</h:panelGroup>
```

---

## 21. Pass-through Attributes

HTML terus berkembang. Faces component tidak selalu punya properti eksplisit untuk semua attribute modern.

Gunakan pass-through:

```xhtml
<h:inputText id="email"
             value="#{userBean.email}"
             pt:type="email"
             pt:placeholder="name@example.com"
             pt:autocomplete="email"
             pt:data-testid="email" />
```

Dengan namespace:

```xhtml
xmlns:pt="jakarta.faces.passthrough"
```

Use cases:

1. `placeholder`.
2. `autocomplete`.
3. `inputmode`.
4. `data-*` attributes.
5. ARIA attributes.
6. Browser-native hints.

Caution:

Pass-through attribute bukan pengganti server-side validation.

```xhtml
pt:required="required"
pt:maxlength="10"
```

Tetap perlu server-side validation:

```xhtml
<h:inputText value="#{bean.code}" required="true" maxlength="10" />
```

Dan domain validation di service layer.

---

## 22. Resource Handling di Facelets

Faces punya resource convention:

```text
/resources/{library}/{resourceName}
```

Contoh:

```text
src/main/webapp/resources/css/app.css
src/main/webapp/resources/js/app.js
src/main/webapp/resources/images/logo.svg
```

Render:

```xhtml
<h:outputStylesheet library="css" name="app.css" />
<h:outputScript library="js" name="app.js" target="body" />
<h:graphicImage library="images" name="logo.svg" alt="Logo" />
```

Keuntungan:

1. Context-path aware.
2. Integrasi dengan Faces resource handler.
3. Bisa dipakai component library.
4. Mendukung target injection untuk script.
5. Lebih portable antar deployment.

Anti-pattern:

```xhtml
<script src="/js/app.js"></script>
<link rel="stylesheet" href="/css/app.css" />
```

Masalah:

1. Rusak saat app deploy di `/aceas` bukan root.
2. Proxy/rewrite bisa mengubah path.
3. Tidak terintegrasi dengan resource handling Faces.

---

## 23. Designing a Main Enterprise Template

Template enterprise sebaiknya menangani cross-cutting UI secara eksplisit.

Contoh slot yang umum:

```text
metadata
pageTitle
title
head
breadcrumb
globalMessages
content
actions
scripts
```

Template:

```xhtml
<f:view xmlns="http://www.w3.org/1999/xhtml"
        xmlns:f="jakarta.faces.core"
        xmlns:h="jakarta.faces.html"
        xmlns:ui="jakarta.faces.facelets">

    <ui:insert name="metadata" />

    <html>
    <h:head>
        <title><ui:insert name="title">ACEAS</ui:insert></title>
        <h:outputStylesheet library="css" name="app.css" />
        <ui:insert name="head" />
    </h:head>
    <h:body>
        <header class="app-header">
            <ui:include src="/WEB-INF/includes/header.xhtml" />
        </header>

        <div class="app-shell">
            <aside class="app-sidebar">
                <ui:include src="/WEB-INF/includes/menu.xhtml" />
            </aside>

            <main class="app-main">
                <section class="breadcrumb">
                    <ui:insert name="breadcrumb" />
                </section>

                <section class="page-header">
                    <h1><ui:insert name="pageTitle" /></h1>
                    <div class="page-actions">
                        <ui:insert name="actions" />
                    </div>
                </section>

                <h:messages id="globalMessages"
                            globalOnly="true"
                            layout="list"
                            styleClass="messages" />

                <section class="page-content">
                    <ui:insert name="content" />
                </section>
            </main>
        </div>

        <h:outputScript library="js" name="app.js" target="body" />
        <ui:insert name="scripts" />
    </h:body>
    </html>
</f:view>
```

Catatan:

1. `h:messages` di template membantu standardisasi error display.
2. `actions` slot memungkinkan page action area konsisten.
3. `metadata` slot penting untuk `f:viewParam`.
4. Header/menu include sebaiknya tidak memuat business query berat.
5. Template jangan terlalu banyak tahu tentang modul spesifik.

---

## 24. Page Example: Case Detail

```xhtml
<ui:composition xmlns="http://www.w3.org/1999/xhtml"
                xmlns:f="jakarta.faces.core"
                xmlns:h="jakarta.faces.html"
                xmlns:ui="jakarta.faces.facelets"
                template="/WEB-INF/templates/main.xhtml">

    <ui:define name="metadata">
        <f:metadata>
            <f:viewParam name="id"
                         value="#{caseDetailBean.caseId}"
                         required="true"
                         requiredMessage="Case id is required" />
            <f:viewAction action="#{caseDetailBean.load}" />
        </f:metadata>
    </ui:define>

    <ui:define name="title">Case Detail</ui:define>

    <ui:define name="breadcrumb">
        <h:link outcome="/cases/list" value="Cases" />
        <span>/</span>
        <span>Detail</span>
    </ui:define>

    <ui:define name="pageTitle">
        Case #{caseDetailBean.caseView.referenceNo}
    </ui:define>

    <ui:define name="actions">
        <h:form id="actionForm">
            <h:commandButton value="Approve"
                             action="#{caseDetailBean.approve}"
                             rendered="#{caseDetailBean.canApprove}" />
            <h:commandButton value="Reject"
                             action="#{caseDetailBean.reject}"
                             rendered="#{caseDetailBean.canReject}" />
        </h:form>
    </ui:define>

    <ui:define name="content">
        <h:panelGroup id="caseSummary" layout="block" styleClass="card">
            <h2>Summary</h2>
            <dl>
                <dt>Status</dt>
                <dd><h:outputText value="#{caseDetailBean.caseView.statusLabel}" /></dd>

                <dt>Officer</dt>
                <dd><h:outputText value="#{caseDetailBean.caseView.assignedOfficerName}" /></dd>

                <dt>Created Date</dt>
                <dd>
                    <h:outputText value="#{caseDetailBean.caseView.createdAt}">
                        <f:convertDateTime type="localDateTime" pattern="dd MMM yyyy HH:mm" />
                    </h:outputText>
                </dd>
            </dl>
        </h:panelGroup>
    </ui:define>
</ui:composition>
```

Yang perlu diperhatikan:

1. Page tidak query database langsung.
2. Page membaca `caseView`, bukan entity JPA mentah.
3. Permission digunakan untuk visibility, bukan enforcement utama.
4. Action harus tetap enforce permission di server-side method/service.
5. Date formatting dilakukan via converter.
6. Template menyediakan cross-cutting layout.

---

## 25. Component vs Tag: Perbedaan yang Sering Diabaikan

Tidak semua markup di Facelets menjadi `UIComponent`.

Secara kasar:

```text
h:* tags
  usually create UIComponent instances

f:* tags
  often attach metadata/converter/validator/behavior/facet to components

ui:* tags
  often act as Facelets tag handlers for templating/composition

c:* tags
  JSTL tag handlers, often affect build-time view structure

raw HTML
  may become pass-through markup or literal output depending context
```

Kenapa penting?

Karena hanya component yang masuk tree yang bisa:

1. Punya component ID.
2. Punya client ID.
3. Ikut lifecycle.
4. Diproses Ajax execute/render.
5. Menyimpan state.
6. Menjadi target messages/converter/validator.

Contoh:

```xhtml
<div id="summary">
    <h:outputText value="#{bean.summary}" />
</div>
```

Apakah `summary` bisa menjadi target Ajax render?

Belum tentu sebagai Faces component target, karena raw `div` bukan component dengan id Faces. Lebih aman:

```xhtml
<h:panelGroup id="summary" layout="block">
    <h:outputText value="#{bean.summary}" />
</h:panelGroup>
```

---

## 26. Conditional Rendering: `rendered`, `c:if`, dan Security

### 26.1 UI Visibility

```xhtml
<h:commandButton value="Approve"
                 action="#{caseBean.approve}"
                 rendered="#{caseBean.canApprove}" />
```

Ini baik untuk UI visibility.

Tapi bukan security enforcement.

User bisa:

1. Craft POST request.
2. Reuse stale page.
3. Manipulate hidden fields.
4. Trigger endpoint/action dari state lama.

Server-side action tetap wajib check:

```java
public String approve() {
    casePermissionService.requireCanApprove(caseId, currentUser);
    caseWorkflowService.approve(caseId, currentUser);
    return "detail?faces-redirect=true&id=" + caseId;
}
```

Rule:

```text
rendered = UX visibility
service/action authorization = security enforcement
```

### 26.2 `c:if` untuk Permission?

```xhtml
<c:if test="#{caseBean.canApprove}">
    <h:commandButton value="Approve" action="#{caseBean.approve}" />
</c:if>
```

Bisa terlihat bekerja, tapi berisiko jika condition berubah antara build/postback.

Untuk component action, prefer:

```xhtml
<h:commandButton value="Approve"
                 action="#{caseBean.approve}"
                 rendered="#{caseBean.canApprove}" />
```

---

## 27. Forms in Facelets

Faces input/action components perlu berada dalam `h:form`.

```xhtml
<h:form id="caseForm">
    <h:inputText id="referenceNo" value="#{caseBean.referenceNo}" />
    <h:commandButton value="Save" action="#{caseBean.save}" />
</h:form>
```

Common rules:

1. Jangan nest form.
2. Jangan letakkan command button di luar form.
3. Satu halaman bisa punya beberapa form, tapi Ajax target/execute harus jelas.
4. Untuk page action kecil, separate form bisa baik.
5. Untuk editable detail, satu main form lebih sederhana.

Anti-pattern:

```xhtml
<h:form id="mainForm">
    ...
    <h:form id="nestedForm">
        ...
    </h:form>
</h:form>
```

HTML tidak mendukung nested form dengan benar. Faces pun akan bermasalah.

---

## 28. Naming Containers dan Client IDs

Faces component ID bisa berubah menjadi client ID dengan prefix naming container.

Contoh:

```xhtml
<h:form id="searchForm">
    <h:inputText id="keyword" value="#{bean.keyword}" />
</h:form>
```

Client ID kemungkinan:

```text
searchForm:keyword
```

Dalam table/repeat, bisa lebih kompleks:

```text
caseTable:0:action
caseTable:1:action
```

Konsekuensi:

1. Jangan asumsi HTML ID sama dengan `id` di Facelets.
2. Ajax render/execute harus naming-container-aware.
3. JavaScript integration perlu stable hook.

Example safe JS hook:

```xhtml
<h:inputText id="keyword"
             value="#{bean.keyword}"
             pt:data-testid="case-keyword" />
```

JavaScript:

```javascript
document.querySelector('[data-testid="case-keyword"]')
```

---

## 29. Ajax Targeting and Facelets Structure

Contoh:

```xhtml
<h:form id="searchForm">
    <h:inputText id="keyword" value="#{caseListBean.keyword}" />
    <h:commandButton value="Search" action="#{caseListBean.search}">
        <f:ajax execute="@form" render="results messages" />
    </h:commandButton>

    <h:messages id="messages" />

    <h:panelGroup id="results" layout="block">
        <ui:repeat value="#{caseListBean.results}" var="item">
            <div class="result-row">
                <h:outputText value="#{item.referenceNo}" />
            </div>
        </ui:repeat>
    </h:panelGroup>
</h:form>
```

Important:

`results` harus component yang ada di tree. Jika target hanya raw HTML id, render bisa gagal.

Bad:

```xhtml
<div id="results">
    ...
</div>
```

Safer:

```xhtml
<h:panelGroup id="results" layout="block">
    ...
</h:panelGroup>
```

---

## 30. Facelets and CDI Bean Binding

Facelets memakai EL untuk binding:

```xhtml
<h:outputText value="#{caseBean.referenceNo}" />
<h:commandButton action="#{caseBean.save}" />
```

Bean:

```java
@Named
@ViewScoped
public class CaseBean implements Serializable {
    private String referenceNo;

    public String save() {
        // save
        return null;
    }

    public String getReferenceNo() {
        return referenceNo;
    }

    public void setReferenceNo(String referenceNo) {
        this.referenceNo = referenceNo;
    }
}
```

Critical design rules:

1. Getter used by view should be cheap.
2. Getter must not perform database write.
3. Avoid expensive database calls in getters.
4. Avoid hidden side effects in EL methods used during render.
5. Put load/init logic in view action, service call, or explicit method.

Bad:

```java
public List<CaseRow> getRows() {
    return caseService.search(criteria); // called multiple times during render
}
```

Better:

```java
private List<CaseRow> rows;

public void search() {
    rows = caseService.search(criteria);
}

public List<CaseRow> getRows() {
    return rows;
}
```

---

## 31. Template Includes and Authorization-Aware Menu

Menu sering menjadi sumber coupling dan performance issue.

Naive menu:

```xhtml
<ui:composition xmlns="http://www.w3.org/1999/xhtml"
                xmlns:h="jakarta.faces.html">
    <ul>
        <li rendered="#{permissionBean.canViewCases}">
            <h:link outcome="/cases/list" value="Cases" />
        </li>
    </ul>
</ui:composition>
```

Masalah:

`rendered` pada raw `<li>` tidak berlaku sebagai Faces attribute.

Correct:

```xhtml
<ui:composition xmlns="http://www.w3.org/1999/xhtml"
                xmlns:h="jakarta.faces.html">
    <ul>
        <h:panelGroup rendered="#{permissionBean.canViewCases}" layout="block">
            <li>
                <h:link outcome="/cases/list" value="Cases" />
            </li>
        </h:panelGroup>
    </ul>
</ui:composition>
```

Namun ini bisa menghasilkan invalid-ish markup tergantung renderer/layout.

Alternative:

```xhtml
<ui:fragment rendered="#{permissionBean.canViewCases}">
    <li>
        <h:link outcome="/cases/list" value="Cases" />
    </li>
</ui:fragment>
```

Better architecture:

```xhtml
<ui:repeat value="#{navigationBean.visibleMenuItems}" var="item">
    <li>
        <h:link outcome="#{item.outcome}" value="#{item.label}" />
    </li>
</ui:repeat>
```

Bean prepares view model:

```java
public List<MenuItemView> getVisibleMenuItems() {
    return navigationService.getVisibleMenu(currentUser);
}
```

Even better: cache per user/session carefully if menu permission is expensive and stable.

---

## 32. Avoiding “Smart Templates”

Bad template:

```xhtml
<ui:insert name="content" />

<h:panelGroup rendered="#{caseBean.status eq 'PENDING_APPROVAL'}">
    <h:commandButton value="Approve" action="#{caseBean.approve}" />
</h:panelGroup>
```

Kenapa buruk?

1. Template tahu modul case.
2. Semua page yang pakai template mendapat dependency ke `caseBean`.
3. Template tidak reusable.
4. Debugging sulit.
5. Unexpected bean creation.

Better:

Template hanya punya slot:

```xhtml
<div class="page-actions">
    <ui:insert name="actions" />
</div>
```

Page case mengisi actions:

```xhtml
<ui:define name="actions">
    <h:form>
        <h:commandButton value="Approve"
                         action="#{caseBean.approve}"
                         rendered="#{caseBean.canApprove}" />
    </h:form>
</ui:define>
```

Rule:

```text
Template owns structure.
Page owns page-specific behavior.
Service owns business rules.
```

---

## 33. Error Message Placement

Faces punya `h:message` dan `h:messages`.

Global messages:

```xhtml
<h:messages id="globalMessages" globalOnly="true" />
```

Field message:

```xhtml
<h:outputLabel for="email" value="Email" />
<h:inputText id="email" value="#{userBean.email}" required="true" />
<h:message for="email" />
```

Template bisa menyediakan global messages. Field messages tetap di dekat field.

Good pattern:

```xhtml
<h:form id="userForm">
    <h:messages id="formMessages" globalOnly="true" />

    <div class="field">
        <h:outputLabel for="email" value="Email" />
        <h:inputText id="email" value="#{userBean.email}" required="true" />
        <h:message for="email" />
    </div>

    <h:commandButton value="Save" action="#{userBean.save}" />
</h:form>
```

For Ajax:

```xhtml
<h:commandButton value="Save" action="#{userBean.save}">
    <f:ajax execute="@form" render="@form" />
</h:commandButton>
```

---

## 34. Facelets Commenting and Sensitive Information

Three common comment styles:

### 34.1 HTML comment

```html
<!-- This is sent to browser -->
```

Do not put sensitive notes here.

### 34.2 Facelets remove

```xhtml
<ui:remove>
    Internal note not rendered.
</ui:remove>
```

### 34.3 XML comment handling

Depending on configuration/context, XML comments may be treated differently. Safer: use `ui:remove` for comments you never want sent.

Rule:

> Assume HTML comments are public.

---

## 35. Facelets File Organization for Large Systems

Recommended structure:

```text
src/main/webapp/
  WEB-INF/
    templates/
      main.xhtml
      public.xhtml
      error.xhtml
      print.xhtml
    includes/
      header.xhtml
      footer.xhtml
      menu.xhtml
      breadcrumb.xhtml
      global-alerts.xhtml
  cases/
    list.xhtml
    detail.xhtml
    edit.xhtml
    assign.xhtml
  appeals/
    list.xhtml
    detail.xhtml
  admin/
    users.xhtml
    roles.xhtml
  resources/
    css/
    js/
    images/
```

Naming rules:

1. Page files: business meaning, e.g. `detail.xhtml`, `assign.xhtml`.
2. Templates: layout role, e.g. `main.xhtml`, `public.xhtml`.
3. Includes: fragment role, e.g. `menu.xhtml`, `footer.xhtml`.
4. Composite components: under `/resources/{library}`.
5. Avoid `common1.xhtml`, `newTemplate2.xhtml`, `finalLayout.xhtml`.

---

## 36. Layout Versioning and Migration Strategy

In enterprise systems, layout changes are risky.

Do not edit a single global template recklessly if many modules depend on it.

Possible strategy:

```text
/WEB-INF/templates/main-v1.xhtml
/WEB-INF/templates/main-v2.xhtml
```

Migrate module by module:

```xhtml
template="/WEB-INF/templates/main-v2.xhtml"
```

Useful when:

1. Reworking navigation.
2. Adding CSP nonce handling.
3. Redesigning header/menu.
4. Introducing accessibility improvements.
5. Migrating from legacy JS/CSS.

Eventually remove old template after migration complete.

---

## 37. Accessibility Considerations in Facelets

Facelets does not automatically guarantee accessibility.

Checklist:

1. Use semantic HTML where possible.
2. Use `h:outputLabel for="..."` for inputs.
3. Render field-level messages near fields.
4. Provide ARIA attributes when needed.
5. Avoid div-only clickable UI.
6. Ensure keyboard navigation.
7. Ensure focus handling after Ajax validation failure.
8. Use meaningful link text.
9. Do not rely only on color.
10. Use table markup only for tabular data.

Example:

```xhtml
<h:outputLabel for="remarks" value="Remarks" />
<h:inputTextarea id="remarks"
                 value="#{caseBean.remarks}"
                 required="true"
                 pt:aria-describedby="remarksHelp remarksMessage" />
<span id="remarksHelp">Explain the decision clearly.</span>
<h:message id="remarksMessage" for="remarks" />
```

---

## 38. Security Considerations in Facelets Authoring

### 38.1 Output Escaping

Prefer:

```xhtml
<h:outputText value="#{caseBean.description}" />
```

Avoid:

```xhtml
<h:outputText value="#{caseBean.description}" escape="false" />
```

`escape="false"` should be treated as security-sensitive.

If rich text is required:

1. Sanitize server-side with allowlist.
2. Store sanitized version or sanitize at output boundary consistently.
3. Audit all usage.
4. Consider CSP.

### 38.2 Raw EL in JavaScript

Dangerous:

```xhtml
<script>
    const name = "#{userBean.name}";
</script>
```

If name contains quotes/newlines/script payload, this can break JS context.

Safer:

1. Encode for JavaScript context using a dedicated encoder.
2. Use JSON script block generated safely.
3. Put data in `data-*` attributes with proper HTML attribute escaping.
4. Fetch data via endpoint returning JSON.

### 38.3 Authorization

Again:

```xhtml
rendered="#{permission.canApprove}"
```

is visibility, not enforcement.

---

## 39. Performance Considerations in Facelets Authoring

Facelets performance issues often come from design, not framework overhead.

### 39.1 Expensive Getters

Bad:

```xhtml
<ui:repeat value="#{caseBean.rows}" var="row">
    ...
</ui:repeat>
```

If `getRows()` queries DB repeatedly, render becomes expensive.

### 39.2 Heavy Menu Permission Evaluation

Menu appears on every page. If each menu item calls permission service:

```xhtml
<ui:fragment rendered="#{permission.canViewModule('A')}">...</ui:fragment>
<ui:fragment rendered="#{permission.canViewModule('B')}">...</ui:fragment>
<ui:fragment rendered="#{permission.canViewModule('C')}">...</ui:fragment>
```

Could be expensive.

Better:

```java
List<MenuItemView> visibleMenuItems = navigationService.buildVisibleMenu(user);
```

Then render simple list.

### 39.3 Large Component Tree

Too many components increase:

1. Build time.
2. Restore time.
3. State size.
4. Render time.
5. Ajax partial processing cost.

Avoid rendering thousands of rows/components. Use pagination/lazy loading.

---

## 40. Common Failure Modes

### 40.1 “My Action Is Not Called”

Possible causes:

1. Button outside `h:form`.
2. Validation failed before invoke application.
3. Component not in tree due to `c:if`.
4. Form nested/invalid HTML.
5. Ajax `execute` excludes required input/action source.
6. View expired.
7. `rendered=false` during postback.

Debug path:

```text
Is command inside h:form?
Are validation messages present?
Is component rendered during postback?
Is c:if hiding it at build time?
Is ajax execute correct?
Is bean scope correct?
```

### 40.2 “Ajax Render Target Not Found”

Possible causes:

1. Target is raw HTML, not Faces component.
2. Target not rendered, absent from tree/DOM.
3. Wrong naming container.
4. ID inside repeat/table.
5. Conditional block removed by `c:if`.

Pattern:

```xhtml
<h:panelGroup id="stableContainer" layout="block">
    <h:panelGroup rendered="#{bean.showDetails}" layout="block">
        ...
    </h:panelGroup>
</h:panelGroup>
```

Ajax render stable container.

### 40.3 “Value Not Updated”

Possible causes:

1. Raw HTML input used instead of `h:inputText`.
2. Missing setter.
3. Validation/conversion failed.
4. Input not included in Ajax execute.
5. Component not rendered during apply request values.
6. Wrong bean scope.

### 40.4 “Duplicate Component ID”

Possible causes:

1. Manual repeated component with same ID.
2. `c:forEach` producing duplicate IDs.
3. Include fragment with fixed IDs included multiple times.
4. Composite component misuse.

Mitigation:

1. Use naming containers.
2. Avoid fixed IDs in fragments included multiple times.
3. Use `ui:repeat`/data components correctly.
4. Keep IDs stable but unique per naming container.

### 40.5 “Template Change Broke Many Pages”

Possible causes:

1. Template had implicit assumptions.
2. Slot renamed/removed.
3. Required `ui:define` not documented.
4. Header/menu calls page-specific beans.
5. Script order changed.

Mitigation:

1. Treat template as public contract.
2. Version major layout changes.
3. Keep slots backward-compatible if possible.
4. Use visual regression or HTML contract tests.

---

## 41. Anti-Patterns

### 41.1 Business Logic in Facelets

Bad:

```xhtml
<h:outputText value="#{case.status eq 'A' ? 'Approved' : case.status eq 'R' ? 'Rejected' : 'Pending'}" />
```

Better:

```xhtml
<h:outputText value="#{caseView.statusLabel}" />
```

### 41.2 Complex Permission Logic in View

Bad:

```xhtml
rendered="#{user.admin or (case.ownerId eq user.id and case.status ne 'CLOSED') or permissionBean.has('CASE_APPROVE')}"
```

Better:

```xhtml
rendered="#{caseDetailBean.canApprove}"
```

### 41.3 Query in Getter

Bad:

```java
public List<CaseRow> getRows() {
    return repository.findAll();
}
```

Better: explicit load/search.

### 41.4 Raw Inputs for Faces Forms

Bad:

```xhtml
<input name="remarks" />
```

Better:

```xhtml
<h:inputTextarea value="#{caseBean.remarks}" />
```

### 41.5 JSTL for Dynamic Editable Components

Bad:

```xhtml
<c:forEach items="#{bean.items}" var="item">
    <h:inputText value="#{item.value}" />
</c:forEach>
```

Prefer Faces-aware iteration/table components.

### 41.6 Over-fragmentation

Too many includes:

```text
page -> include A -> include B -> include C -> include D
```

Symptoms:

1. Hard to trace final view.
2. ID conflicts.
3. Hidden parameters.
4. Debugging slow.
5. Template contract unclear.

---

## 42. Enterprise Design Heuristics

### 42.1 View File Should Be Boring

A good Facelets file should mostly declare:

1. Layout slot usage.
2. Components.
3. Simple bindings.
4. Simple rendered conditions.
5. Messages.
6. Actions.

If the `.xhtml` feels like business logic, move logic out.

### 42.2 Use View Models

Instead of exposing entity:

```xhtml
#{caseEntity.officer.department.parent.name}
```

Prefer:

```xhtml
#{caseView.departmentName}
```

Benefits:

1. Avoid lazy loading during render.
2. Reduce N+1 risk.
3. Stable UI contract.
4. Easier testing.
5. Better security filtering.

### 42.3 Keep Template Stable

Template is infrastructure. Changing it is like changing a base class used by every page.

Use:

1. Clear slot names.
2. Minimal hidden behavior.
3. Versioning for large changes.
4. Documentation.
5. Contract tests for critical layout.

### 42.4 Prefer Explicit IDs for Interactive Components

Good:

```xhtml
<h:form id="searchForm">
    <h:inputText id="keyword" ... />
    <h:panelGroup id="results" ... />
</h:form>
```

Bad:

```xhtml
<h:form>
    <h:inputText ... />
</h:form>
```

Explicit IDs improve:

1. Ajax targeting.
2. Testing.
3. Debugging.
4. HTML inspection.
5. Accessibility labels.

### 42.5 Treat Include Parameters as API

If an include accepts parameters:

```xhtml
<ui:param name="title" value="..." />
```

Document:

1. Required parameters.
2. Optional parameters.
3. Expected type.
4. Escaping responsibility.
5. Whether parameter can be method expression.

---

## 43. Mini Case Study: Regulatory Case Detail Page

Requirements:

1. URL `/cases/detail.xhtml?id=123`.
2. Load case by ID.
3. Show header and breadcrumb.
4. Show summary card.
5. Show action buttons depending on role and state.
6. Show validation/action messages.
7. Support Ajax refresh of assignment panel.
8. Prevent direct access to template fragments.

Template:

```xhtml
<!-- /WEB-INF/templates/main.xhtml -->
<f:view xmlns="http://www.w3.org/1999/xhtml"
        xmlns:f="jakarta.faces.core"
        xmlns:h="jakarta.faces.html"
        xmlns:ui="jakarta.faces.facelets">
    <ui:insert name="metadata" />
    <html>
    <h:head>
        <title><ui:insert name="title">Regulatory System</ui:insert></title>
        <h:outputStylesheet library="css" name="app.css" />
    </h:head>
    <h:body>
        <ui:include src="/WEB-INF/includes/header.xhtml" />
        <main>
            <ui:insert name="breadcrumb" />
            <h:messages id="messages" globalOnly="true" />
            <ui:insert name="content" />
        </main>
        <h:outputScript library="js" name="app.js" target="body" />
    </h:body>
    </html>
</f:view>
```

Page:

```xhtml
<!-- /cases/detail.xhtml -->
<ui:composition xmlns="http://www.w3.org/1999/xhtml"
                xmlns:f="jakarta.faces.core"
                xmlns:h="jakarta.faces.html"
                xmlns:ui="jakarta.faces.facelets"
                template="/WEB-INF/templates/main.xhtml">

    <ui:define name="metadata">
        <f:metadata>
            <f:viewParam name="id" value="#{caseDetailBean.caseId}" required="true" />
            <f:viewAction action="#{caseDetailBean.load}" />
        </f:metadata>
    </ui:define>

    <ui:define name="title">
        Case #{caseDetailBean.caseView.referenceNo}
    </ui:define>

    <ui:define name="breadcrumb">
        <nav aria-label="Breadcrumb">
            <h:link outcome="/cases/list" value="Cases" />
            <span>/</span>
            <span>#{caseDetailBean.caseView.referenceNo}</span>
        </nav>
    </ui:define>

    <ui:define name="content">
        <h1>Case #{caseDetailBean.caseView.referenceNo}</h1>

        <h:panelGroup id="summary" layout="block" styleClass="card">
            <h2>Summary</h2>
            <dl>
                <dt>Status</dt>
                <dd><h:outputText value="#{caseDetailBean.caseView.statusLabel}" /></dd>
                <dt>Officer</dt>
                <dd><h:outputText value="#{caseDetailBean.caseView.officerName}" /></dd>
            </dl>
        </h:panelGroup>

        <h:form id="actionForm">
            <h:commandButton value="Approve"
                             action="#{caseDetailBean.approve}"
                             rendered="#{caseDetailBean.canApprove}">
                <f:ajax execute="@form" render="summary assignmentPanel messages" />
            </h:commandButton>
        </h:form>

        <h:panelGroup id="assignmentPanel" layout="block">
            <ui:include src="/WEB-INF/includes/case-assignment.xhtml">
                <ui:param name="assignment" value="#{caseDetailBean.caseView.assignment}" />
            </ui:include>
        </h:panelGroup>
    </ui:define>
</ui:composition>
```

Good aspects:

1. Template protected under `/WEB-INF`.
2. Metadata slot handles `id` loading.
3. Page uses view model.
4. Ajax targets stable `h:panelGroup` components.
5. Actions are visible conditionally but still must enforce server-side permission.
6. Include gets a small parameter, not the whole persistence context.

---

## 44. Review Checklist for Facelets View Authoring

### Correctness

- [ ] Does every input/action component belong to an `h:form`?
- [ ] Are forms not nested?
- [ ] Are Ajax `execute` and `render` targets correct?
- [ ] Are dynamic targets wrapped in stable components?
- [ ] Are component IDs stable and unique?
- [ ] Are raw HTML inputs avoided for Faces-bound forms?

### Lifecycle

- [ ] Is `c:if` avoided around editable/action components?
- [ ] Is `rendered` used appropriately?
- [ ] Are getters cheap and side-effect-free?
- [ ] Is view loading done via explicit load/viewAction rather than random getter?
- [ ] Is bean scope appropriate?

### Template

- [ ] Are templates under `/WEB-INF`?
- [ ] Are slot names clear?
- [ ] Does template avoid page-specific business logic?
- [ ] Are includes not over-parameterized?
- [ ] Is metadata slot supported where needed?

### Security

- [ ] Is output escaped by default?
- [ ] Is `escape="false"` avoided or justified?
- [ ] Are JavaScript/URL/CSS contexts encoded correctly?
- [ ] Is `rendered` not treated as authorization enforcement?
- [ ] Are hidden fields not trusted?
- [ ] Are sensitive comments not sent to browser?

### Performance

- [ ] Are large tables paginated?
- [ ] Are menu permissions precomputed/cached appropriately?
- [ ] Are repeated components not excessive?
- [ ] Are resource links handled by Faces where appropriate?
- [ ] Are includes not causing hidden expensive operations?

### Maintainability

- [ ] Does page bind to view model instead of deep entity graph?
- [ ] Are complex expressions moved to bean methods/properties?
- [ ] Are reusable fragments documented?
- [ ] Are page-specific scripts isolated?
- [ ] Are JS selectors based on stable hooks rather than accidental client IDs?

---

## 45. Mental Model Akhir

Facelets harus dipahami sebagai **view source code untuk component tree**, bukan HTML final.

Ringkasnya:

```text
.xhtml file
  declares components, templates, fragments, metadata

Facelets engine
  parses and builds/configures component tree

Faces lifecycle
  restores/processes/validates/updates/invokes/renders tree

Renderers
  encode components into HTML/CSS/JS response
```

Konsekuensi arsitektural:

1. Template adalah contract.
2. Component ID bukan selalu HTML final ID.
3. JSTL dan Faces component punya timing berbeda.
4. Raw HTML tidak ikut lifecycle.
5. `rendered` adalah visibility, bukan authorization.
6. Getter di view adalah bagian dari render path.
7. Ajax butuh target component yang stabil.
8. Template harus mengatur struktur, bukan business logic.
9. View model membuat Facelets lebih aman, cepat, dan mudah dites.
10. Facelets yang baik terlihat sederhana karena kompleksitas ditempatkan di boundary yang benar.

---

## 46. Hubungan dengan Part Berikutnya

Bagian ini fokus pada **menulis view Facelets**.

Part berikutnya akan masuk ke:

```text
16-faces-managed-beans-cdi-scopes-dependency-boundaries.md
```

Di sana kita akan membahas backing bean/CDI/scopes secara jauh lebih dalam:

1. `@Named` bean.
2. Request scope.
3. View scope.
4. Session scope.
5. Conversation scope.
6. Serialization/passivation.
7. DTO/view model.
8. Boundary antara view bean dan service.
9. Lazy loading dan persistence boundary.
10. Failure modes seperti bean recreated, stale state, dan memory leak.

---

## 47. Status Seri

Seri belum selesai.

Progress saat ini:

```text
[x] 00 Orientation
[x] 01 History and Compatibility
[x] 02 Jakarta Pages/JSP Internal Architecture
[x] 03 JSP Syntax
[x] 04 Request/Session/Application Scope
[x] 05 EL Fundamentals
[x] 06 Advanced EL
[x] 07 JSTL Core Tags
[x] 08 Formatting/I18N/XML/SQL Tags
[x] 09 Custom Tags and Tag Files
[x] 10 JSP Layouting
[x] 11 JSP Security
[x] 12 JSP Performance and Operations
[x] 13 Testing JSP and Tag Libraries
[x] 14 Jakarta Faces Big Picture
[x] 15 Facelets and XHTML View Authoring
[ ] 16 Faces Managed Beans, CDI, Scopes, and Dependency Boundaries
[ ] 17 Faces Lifecycle Deep Dive
[ ] 18 Faces Components
[ ] 19 Conversion and Validation
[ ] 20 Navigation, Actions, Events, and Flow
[ ] 21 State Management
[ ] 22 Ajax and Partial Rendering
[ ] 23 Composite Components
[ ] 24 Custom Faces Components and Extensions
[ ] 25 Faces Security
[ ] 26 Faces Performance and Scalability
[ ] 27 Library Ecosystem
[ ] 28 Migration Playbook
[ ] 29 Architecture Patterns
[ ] 30 Capstone
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./14-jakarta-faces-big-picture-component-based-mvc.md">⬅️ Part 14 — Jakarta Faces Big Picture: Component-Based MVC, Not Just Templates</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./16-faces-managed-beans-cdi-scopes-dependency-boundaries.md">Part 16 — Faces Managed Beans, CDI, Scopes, and Dependency Boundaries ➡️</a>
</div>
