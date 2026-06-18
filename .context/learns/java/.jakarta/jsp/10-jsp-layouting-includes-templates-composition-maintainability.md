# Part 10 — JSP Layouting: Includes, Templates, Composition, and Maintainability

> Seri: `learn-java-jakarta-pages-el-tags-faces-server-side-ui`  
> Part: `10-jsp-layouting-includes-templates-composition-maintainability.md`  
> Fokus: membangun layout JSP/Jakarta Pages yang reusable, aman, predictable, dan tidak berubah menjadi spaghetti include.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami layouting JSP sebagai masalah **composition architecture**, bukan sekadar memecah HTML menjadi `header.jsp` dan `footer.jsp`.
2. Membedakan dengan tajam:
   - static include directive,
   - dynamic include action,
   - include via JSTL,
   - tag file template,
   - custom layout tag,
   - servlet forward/include.
3. Mendesain struktur JSP enterprise yang:
   - reusable,
   - aman,
   - mudah diuji,
   - migration-friendly,
   - tidak membuat coupling tersembunyi antar-fragment.
4. Menghindari anti-pattern umum:
   - nested include tanpa kontrak,
   - fragment yang bergantung pada global request attributes,
   - authorization hanya di menu,
   - layout yang membuat session tidak sengaja,
   - path relatif yang rapuh,
   - partial page yang sulit di-debug.
5. Membuat mental model bagaimana satu halaman server-side dirakit dari:
   - controller,
   - request/view model,
   - template/layout,
   - fragments,
   - tags,
   - static resources,
   - cross-cutting UI concerns.

---

## 1. Core Mental Model: Layouting Itu Masalah Komposisi

Dalam JSP sederhana, halaman terlihat seperti ini:

```jsp
<html>
<head>
    <title>User Detail</title>
</head>
<body>
    <h1>User Detail</h1>
    ...
</body>
</html>
```

Di aplikasi enterprise, halaman jarang sesederhana itu. Biasanya ada:

- shell aplikasi,
- header,
- sidebar,
- menu,
- breadcrumbs,
- content area,
- alert banner,
- authorization-aware actions,
- form error summary,
- footer,
- static asset references,
- global JavaScript variables,
- CSRF token,
- correlation/request id,
- environment banner,
- localization switcher,
- session timeout warning,
- role-based navigation.

Masalahnya bukan hanya “bagaimana reuse HTML”, tetapi:

> Bagaimana membagi UI menjadi unit kecil tanpa membuat dependency tersembunyi yang sulit dikontrol?

Layouting JSP yang buruk biasanya bukan gagal karena tidak bisa render halaman, tetapi karena:

1. Satu fragment membutuhkan attribute tertentu tetapi tidak terdokumentasi.
2. Include chain terlalu dalam.
3. Header diam-diam membaca session dan role.
4. Menu hanya menyembunyikan link, tetapi endpoint tetap tidak dilindungi.
5. Breadcrumb dihitung di JSP dengan logic domain.
6. Error layout memanggil component yang justru error.
7. Static resource path rusak saat context path berubah.
8. Layout terlalu global sehingga setiap page sulit berbeda.

Jadi prinsip dasarnya:

> Layout adalah orchestration view-level. Business decision tetap harus selesai sebelum view dirender.

---

## 2. Peta Mekanisme Composition di JSP

Ada beberapa cara merakit halaman JSP:

| Mekanisme | Waktu kerja | Karakter | Cocok untuk |
|---|---:|---|---|
| Include directive `<%@ include file="..." %>` | Translation time | file digabung sebelum compile | fragment statis, common declaration, boilerplate kecil |
| `jsp:include` | Request time | target dieksekusi saat request | fragment dinamis, header user-aware, menu, widget |
| JSTL `c:import` | Request time | import content dari URL/resource | integrasi content, jarang untuk layout internal |
| Tag file | Translation/request hybrid | reusable tag-like component | layout template, card, panel, form row |
| Custom tag handler | Runtime | Java-backed reusable tag | complex reusable rendering |
| Servlet include | Runtime | include resource via request dispatcher | composition dari controller/filter |
| Facelets template | Runtime component/view build | khusus Faces, bukan JSP murni | nanti dibahas di Faces |

Untuk JSP enterprise, pilihan yang paling sehat biasanya kombinasi:

```text
Controller prepares view model
        |
        v
Page JSP chooses layout
        |
        v
Layout tag file / template includes shell
        |
        v
Fragments render header/sidebar/content/footer
        |
        v
Tags render small reusable UI primitives
```

---

## 3. Static Include Directive

Syntax:

```jsp
<%@ include file="/WEB-INF/jsp/common/header.jspf" %>
```

Static include terjadi pada **translation phase**. Secara mental model:

```text
page.jsp + header.jspf + footer.jspf
        |
        v
one generated servlet
```

Artinya isi file include disalin ke JSP utama sebelum JSP dikompilasi menjadi servlet.

### 3.1 Kapan Cocok

Static include cocok untuk:

- fragment yang benar-benar statis,
- common directive,
- common taglib declaration,
- reusable markup kecil,
- compile-time composition,
- `.jspf` fragment yang tidak berdiri sendiri.

Contoh common taglibs:

```jsp
<%-- /WEB-INF/jsp/common/taglibs.jspf --%>
<%@ taglib prefix="c" uri="jakarta.tags.core" %>
<%@ taglib prefix="fmt" uri="jakarta.tags.fmt" %>
```

Lalu di page:

```jsp
<%@ include file="/WEB-INF/jsp/common/taglibs.jspf" %>
```

### 3.2 Risiko Static Include

Karena semua digabung sebelum compile, ada beberapa risiko:

1. Variable collision.
2. Duplicate declarations.
3. Duplicate taglib directive.
4. Sulit membaca generated servlet.
5. Perubahan fragment bisa memicu recompilation banyak page.
6. Fragment tidak punya boundary runtime.
7. Path resolution berbeda dari dynamic include.

Contoh buruk:

```jsp
<%-- header.jspf --%>
<%
    String title = (String) request.getAttribute("title");
%>
```

Lalu page utama juga punya:

```jsp
<%
    String title = "Something";
%>
```

Karena static include menggabungkan source, collision mudah terjadi.

### 3.3 Heuristik Static Include

Gunakan static include untuk fragment yang:

- tidak punya state,
- tidak punya branching kompleks,
- tidak melakukan IO,
- tidak bergantung pada request secara berat,
- tidak dipakai sebagai “component dinamis”.

Jangan gunakan static include untuk:

- menu role-based,
- user profile widget,
- alert dynamic,
- page-specific metadata kompleks,
- form fragment dengan banyak attribute implicit.

---

## 4. Dynamic Include dengan `jsp:include`

Syntax:

```jsp
<jsp:include page="/WEB-INF/jsp/common/header.jsp" />
```

Dynamic include terjadi pada **request processing time**. Secara mental model:

```text
page.jsp generated servlet
        |
        |-- RequestDispatcher.include(header.jsp)
        |-- render content
        |-- RequestDispatcher.include(footer.jsp)
```

Fragment yang di-include memiliki lifecycle JSP sendiri dan dieksekusi sebagai resource terpisah.

### 4.1 Mengirim Parameter ke Included Page

```jsp
<jsp:include page="/WEB-INF/jsp/common/panel.jsp">
    <jsp:param name="title" value="Case Summary" />
</jsp:include>
```

Di included JSP:

```jsp
<h2>${param.title}</h2>
```

Namun hati-hati: `jsp:param` masuk sebagai request parameter, bukan typed object. Untuk data kompleks, lebih baik gunakan request attribute atau tag file attributes.

### 4.2 Kapan Cocok

`jsp:include` cocok untuk:

- header dinamis,
- sidebar dinamis,
- user menu,
- notification widget,
- reusable chunk yang diproses runtime,
- fragment yang boleh punya own JSP translation unit.

### 4.3 Risiko Dynamic Include

1. Included JSP bisa membaca/mengubah request attributes.
2. Included JSP bisa membuat session.
3. Error di included JSP bisa membuat parent page gagal.
4. Response buffering menjadi penting.
5. Terlalu banyak include bisa menambah overhead.
6. Dependency fragment tidak eksplisit.

Contoh risiko:

```jsp
<jsp:include page="/WEB-INF/jsp/common/menu.jsp" />
```

`menu.jsp` diam-diam membutuhkan:

```text
request attribute: currentUser
request attribute: permissions
request attribute: activeMenu
session attribute: locale
```

Tetapi page yang membaca tidak tahu kontraknya.

### 4.4 Membuat Kontrak Include Eksplisit

Minimal, dokumentasikan di fragment:

```jsp
<%--
Fragment: /WEB-INF/jsp/common/menu.jsp

Requires:
- requestScope.layout.currentMenu: String
- requestScope.layout.menuItems: List<MenuItemView>
- requestScope.securityContext: SecurityView

Does not:
- create session
- query database
- mutate request attributes
--%>
```

Lebih baik lagi: kumpulkan state layout ke satu object:

```java
public final class LayoutView {
    private final String pageTitle;
    private final String activeMenu;
    private final List<MenuItemView> menuItems;
    private final List<BreadcrumbItem> breadcrumbs;
    private final List<AlertView> alerts;
    private final SecurityView security;
}
```

Lalu JSP hanya membaca:

```jsp
${layout.pageTitle}
${layout.activeMenu}
${layout.menuItems}
```

---

## 5. Include Directive vs `jsp:include`: Perbedaan Penting

| Aspek | Static include | Dynamic include |
|---|---|---|
| Syntax | `<%@ include file="..." %>` | `<jsp:include page="..." />` |
| Waktu | Translation time | Request time |
| Generated servlet | Digabung dengan parent | Resource terpisah |
| Runtime parameter | Tidak | Ya, via `jsp:param` |
| Cocok untuk | Fragment statis | Fragment dinamis |
| Boundary | Lemah | Lebih jelas, tapi masih shared request |
| Recompilation | Parent terpengaruh | Terpisah |
| Risiko | variable collision | hidden runtime dependency |

Rule of thumb:

> Static include untuk source composition. Dynamic include untuk runtime composition.

---

## 6. `.jsp` vs `.jspf`

Konvensi umum:

- `.jsp` = page atau fragment yang bisa dieksekusi container sebagai JSP resource.
- `.jspf` = JSP fragment, biasanya dipakai via static include, bukan direct request.

Contoh struktur:

```text
/WEB-INF/jsp/
  common/
    taglibs.jspf
    head.jspf
    scripts.jspf
  case/
    detail.jsp
```

`*.jspf` sebaiknya tidak diakses langsung.

Namun jangan mengandalkan ekstensi saja. Simpan di `/WEB-INF` agar tidak bisa diakses langsung lewat browser:

```text
/WEB-INF/jsp/common/head.jspf
```

---

## 7. Layout dengan Include Sederhana

Contoh pendekatan tradisional:

```jsp
<%@ include file="/WEB-INF/jsp/common/taglibs.jspf" %>
<%@ include file="/WEB-INF/jsp/common/top.jspf" %>

<h1>${caseDetail.title}</h1>
<p>${caseDetail.description}</p>

<%@ include file="/WEB-INF/jsp/common/bottom.jspf" %>
```

Ini mudah, tetapi cepat menjadi rapuh karena setiap page harus mengingat urutan:

```text
taglibs -> top -> content -> bottom
```

Masalah akan muncul saat ada:

- page tanpa sidebar,
- page login tanpa full layout,
- page print view,
- modal view,
- error view,
- admin layout,
- different static assets,
- different body class,
- page-level script.

Karena itu, untuk enterprise, lebih baik gunakan template berbasis tag file atau custom layout tag.

---

## 8. Layout dengan Tag File

Tag file adalah cara JSP-native untuk membuat reusable tag tanpa menulis Java class.

Struktur:

```text
/WEB-INF/tags/layout/
  main.tag
```

Contoh `main.tag`:

```jsp
<%@ tag body-content="scriptless" %>
<%@ attribute name="title" required="true" type="java.lang.String" %>
<%@ attribute name="activeMenu" required="false" type="java.lang.String" %>

<!doctype html>
<html lang="${not empty pageContext.request.locale ? pageContext.request.locale.language : 'en'}">
<head>
    <meta charset="UTF-8">
    <title>${title}</title>
    <link rel="stylesheet" href="${pageContext.request.contextPath}/assets/app.css">
</head>
<body>
    <header>
        <jsp:include page="/WEB-INF/jsp/common/header.jsp" />
    </header>

    <aside>
        <jsp:include page="/WEB-INF/jsp/common/sidebar.jsp">
            <jsp:param name="activeMenu" value="${activeMenu}" />
        </jsp:include>
    </aside>

    <main>
        <jsp:doBody />
    </main>

    <footer>
        <jsp:include page="/WEB-INF/jsp/common/footer.jsp" />
    </footer>

    <script src="${pageContext.request.contextPath}/assets/app.js"></script>
</body>
</html>
```

Pemakaian di page:

```jsp
<%@ taglib prefix="layout" tagdir="/WEB-INF/tags/layout" %>
<%@ taglib prefix="c" uri="jakarta.tags.core" %>

<layout:main title="Case Detail" activeMenu="cases">
    <h1>${caseDetail.referenceNo}</h1>

    <section>
        <h2>Case Summary</h2>
        <p><c:out value="${caseDetail.summary}" /></p>
    </section>
</layout:main>
```

### 8.1 Kenapa Ini Lebih Baik

Karena layout menjadi:

```text
explicit tag
explicit attributes
explicit body slot
single shell owner
```

Page tidak perlu tahu urutan internal header/sidebar/footer. Page hanya berkata:

```text
Render my body inside main layout with title and active menu.
```

### 8.2 Batasan Tag File Layout

Tag file bagus, tetapi jangan membuatnya menjadi framework tersembunyi.

Hindari:

```jsp
<layout:main
    title="..."
    activeMenu="..."
    loadCasePermissions="true"
    queryNotifications="true"
    calculateEscalation="true"
    enableWorkflowMagic="true">
```

Layout tag tidak boleh menjadi service orchestrator.

---

## 9. Fragment Passing dengan `jsp:doBody`

Tag file bisa menerima body. Ini memberikan slot sederhana:

```jsp
<layout:main title="Dashboard">
    <h1>Dashboard</h1>
    <p>Welcome.</p>
</layout:main>
```

Di tag file:

```jsp
<main>
    <jsp:doBody />
</main>
```

Untuk layout yang butuh banyak slot, JSP tag file punya keterbatasan. Ada cara memakai fragment attributes, tetapi lebih kompleks.

Contoh tag file dengan fragment:

```jsp
<%@ tag body-content="empty" %>
<%@ attribute name="title" required="true" type="java.lang.String" %>
<%@ attribute name="content" fragment="true" required="true" %>
<%@ attribute name="actions" fragment="true" required="false" %>

<!doctype html>
<html>
<head>
    <title>${title}</title>
</head>
<body>
    <header>
        <jsp:invoke fragment="actions" />
    </header>

    <main>
        <jsp:invoke fragment="content" />
    </main>
</body>
</html>
```

Pemakaian fragment attributes di JSP bisa terasa verbose dan tidak semua tim familiar. Untuk banyak slot kompleks, Faces Facelets atau template engine lain sering lebih nyaman.

### 9.1 Heuristik Slot

Gunakan body slot untuk:

- main content,
- simple layout,
- card/panel reusable.

Gunakan fragment attributes hanya jika:

- benar-benar butuh named slot,
- team memahami tag file,
- dokumentasi jelas,
- tidak membuat page sulit dibaca.

---

## 10. Header, Footer, Sidebar: Jangan Biarkan Fragment Mengambil Keputusan Domain

Contoh buruk pada `sidebar.jsp`:

```jsp
<c:if test="${user.role == 'CASE_MANAGER' && case.status == 'PENDING_REVIEW'}">
    <a href="/case/approve?id=${case.id}">Approve</a>
</c:if>
```

Masalah:

1. Role check hardcoded di view.
2. Status workflow hardcoded di view.
3. URL mungkin tidak context-safe.
4. Authorization belum tentu enforced di backend.
5. Jika rule berubah, banyak JSP harus diubah.
6. Testing rule jadi sulit.

Lebih baik controller/service menyiapkan:

```java
public final class ActionView {
    private final String label;
    private final String url;
    private final boolean visible;
    private final String method;
    private final String confirmationMessage;
}
```

JSP:

```jsp
<c:forEach items="${caseDetail.availableActions}" var="action">
    <c:if test="${action.visible}">
        <a href="${action.url}">
            <c:out value="${action.label}" />
        </a>
    </c:if>
</c:forEach>
```

Bahkan lebih baik: visibility sudah difilter di server.

```jsp
<c:forEach items="${caseDetail.availableActions}" var="action">
    <a href="${action.url}">
        <c:out value="${action.label}" />
    </a>
</c:forEach>
```

Tetapi ingat:

> Menu/action visibility adalah UX. Authorization tetap harus enforced di endpoint/service.

---

## 11. Breadcrumb Pattern

Breadcrumb sering menjadi sumber logic bocor ke JSP.

Contoh buruk:

```jsp
<a href="/home">Home</a>
<c:if test="${case.type == 'APPEAL'}">
    <a href="/appeals">Appeals</a>
</c:if>
<c:if test="${case.type == 'COMPLIANCE'}">
    <a href="/compliance">Compliance</a>
</c:if>
<span>${case.referenceNo}</span>
```

Lebih baik siapkan view model:

```java
public final class BreadcrumbItem {
    private final String label;
    private final String url;
    private final boolean current;
}
```

JSP fragment:

```jsp
<nav aria-label="Breadcrumb">
    <ol class="breadcrumb">
        <c:forEach items="${layout.breadcrumbs}" var="item">
            <li>
                <c:choose>
                    <c:when test="${item.current}">
                        <span aria-current="page"><c:out value="${item.label}" /></span>
                    </c:when>
                    <c:otherwise>
                        <a href="${item.url}"><c:out value="${item.label}" /></a>
                    </c:otherwise>
                </c:choose>
            </li>
        </c:forEach>
    </ol>
</nav>
```

Keuntungan:

- accessible,
- reusable,
- testable,
- tidak tergantung domain object langsung,
- mudah dilokalisasi.

---

## 12. Alert Banner dan Flash Message

Alert biasanya berasal dari:

- success after POST,
- validation warning,
- system announcement,
- permission warning,
- environment banner,
- maintenance notice.

Untuk post-redirect-get, alert harus bertahan satu redirect. Di Servlet/JSP sederhana, flash message bisa disimpan di session lalu dihapus setelah dibaca.

Controller:

```java
request.getSession().setAttribute("flash.success", "Case updated successfully");
response.sendRedirect(request.getContextPath() + "/cases/" + caseId);
```

Filter atau helper sebelum render:

```java
HttpSession session = request.getSession(false);
if (session != null) {
    Object success = session.getAttribute("flash.success");
    if (success != null) {
        request.setAttribute("flashSuccess", success);
        session.removeAttribute("flash.success");
    }
}
```

Fragment:

```jsp
<c:if test="${not empty flashSuccess}">
    <div class="alert alert-success" role="status">
        <c:out value="${flashSuccess}" />
    </div>
</c:if>
```

### 12.1 Risiko Flash Message

Jangan menyimpan object besar di flash.

Hindari:

```java
session.setAttribute("flash.caseDetail", hugeCaseObject);
```

Gunakan pesan kecil atau identifier.

---

## 13. Form Error Summary Layout

Di aplikasi enterprise, error tidak cukup ditampilkan dekat field. Sering perlu summary di atas form.

View model:

```java
public final class FormErrorView {
    private final String field;
    private final String message;
}
```

Fragment:

```jsp
<c:if test="${not empty formErrors}">
    <section class="error-summary" role="alert" aria-labelledby="error-summary-title">
        <h2 id="error-summary-title">Please fix the following errors</h2>
        <ul>
            <c:forEach items="${formErrors}" var="error">
                <li>
                    <a href="#field-${error.field}">
                        <c:out value="${error.message}" />
                    </a>
                </li>
            </c:forEach>
        </ul>
    </section>
</c:if>
```

Prinsip:

- validation dilakukan di server,
- view hanya render error,
- field id harus predictable,
- output harus escaped,
- summary harus accessible.

---

## 14. Resource Path dan Context Path

Salah satu bug klasik JSP layout:

```html
<link rel="stylesheet" href="/assets/app.css">
```

Ini hanya aman jika aplikasi deploy di root context `/`.

Jika deploy di:

```text
https://example.com/aceas
```

Maka `/assets/app.css` akan mengarah ke:

```text
https://example.com/assets/app.css
```

bukan:

```text
https://example.com/aceas/assets/app.css
```

Gunakan context path:

```jsp
<link rel="stylesheet" href="${pageContext.request.contextPath}/assets/app.css">
```

Atau JSTL `c:url`:

```jsp
<c:url value="/assets/app.css" var="appCss" />
<link rel="stylesheet" href="${appCss}">
```

### 14.1 Resource Versioning

Untuk cache busting:

```jsp
<c:url value="/assets/app.css" var="appCss">
    <c:param name="v" value="${buildInfo.assetVersion}" />
</c:url>

<link rel="stylesheet" href="${appCss}">
```

Lebih baik dalam sistem modern: asset fingerprint dari build pipeline:

```text
app.4f3a91c.css
```

JSP hanya menerima manifest/view model:

```jsp
<link rel="stylesheet" href="${assets.appCss}">
```

---

## 15. JavaScript Data Injection: Jangan Sembarangan

Layout sering perlu mengirim config ke JS:

```jsp
<script>
    window.APP = {
        contextPath: '${pageContext.request.contextPath}',
        userName: '${currentUser.name}'
    };
</script>
```

Ini rawan XSS karena HTML escaping tidak sama dengan JavaScript string escaping.

Lebih aman:

1. Taruh data sederhana di `data-*` attribute dengan encoding sesuai HTML attribute.
2. Gunakan JSON encoder yang benar.
3. Hindari memasukkan user input langsung ke script block.

Contoh lebih aman:

```jsp
<body data-context-path="${pageContext.request.contextPath}">
```

Lalu JS:

```javascript
const contextPath = document.body.dataset.contextPath;
```

Untuk data kompleks, render JSON dengan serializer yang melakukan escaping aman, bukan string concatenation manual.

---

## 16. Page-Specific CSS/JS

Masalah umum layout global:

```jsp
<script src="/assets/case-detail.js"></script>
```

Tidak semua page butuh JS yang sama. Ada beberapa strategi.

### 16.1 Attribute List dari View Model

Controller:

```java
layout.setScripts(List.of("/assets/case-detail.js"));
layout.setStyles(List.of("/assets/case-detail.css"));
```

Layout JSP:

```jsp
<c:forEach items="${layout.styles}" var="style">
    <link rel="stylesheet" href="${pageContext.request.contextPath}${style}">
</c:forEach>

<c:forEach items="${layout.scripts}" var="script">
    <script src="${pageContext.request.contextPath}${script}"></script>
</c:forEach>
```

### 16.2 Tag File Attribute

```jsp
<layout:main title="Case Detail" activeMenu="cases" pageScript="/assets/case-detail.js">
    ...
</layout:main>
```

Cocok untuk satu script sederhana, tetapi kurang fleksibel untuk banyak assets.

### 16.3 Named Slot

Dengan fragment attribute, page bisa mengirim custom head/scripts. Namun ini membuat JSP lebih kompleks.

Heuristik:

- Untuk aplikasi kecil: attribute sederhana cukup.
- Untuk enterprise: layout view model `styles/scripts/meta`.
- Untuk kompleks sekali: pertimbangkan framework/template yang lebih kaya.

---

## 17. Menu Authorization: Visibility vs Enforcement

Menu biasanya dirender berdasarkan permission:

```jsp
<c:forEach items="${layout.menuItems}" var="menu">
    <c:if test="${menu.visible}">
        <a href="${menu.url}">
            <c:out value="${menu.label}" />
        </a>
    </c:if>
</c:forEach>
```

Tetapi jangan salah mental model:

```text
Hiding link != preventing access
```

Endpoint tetap harus melakukan check:

```java
if (!permissionService.canViewCase(user, caseId)) {
    response.sendError(HttpServletResponse.SC_FORBIDDEN);
    return;
}
```

Dalam sistem regulatori/case management, ini sangat penting karena user bisa:

- mengetik URL manual,
- replay request,
- inspect HTML,
- call endpoint via script,
- membuka stale link,
- memakai bookmarked URL.

Menu harus dianggap sebagai **navigation aid**, bukan security boundary.

---

## 18. Error Page Layout

JSP error page sering butuh layout khusus.

`web.xml`:

```xml
<error-page>
    <error-code>404</error-code>
    <location>/WEB-INF/jsp/error/404.jsp</location>
</error-page>

<error-page>
    <error-code>500</error-code>
    <location>/WEB-INF/jsp/error/500.jsp</location>
</error-page>
```

Error JSP:

```jsp
<%@ page isErrorPage="true" %>
<%@ taglib prefix="layout" tagdir="/WEB-INF/tags/layout" %>

<layout:error title="Something went wrong">
    <h1>Something went wrong</h1>
    <p>Please contact support with reference ID: ${requestId}</p>
</layout:error>
```

### 18.1 Error Layout Harus Minimal

Jangan memakai full layout jika full layout bergantung pada banyak object:

- current user,
- menu items,
- permissions,
- notification,
- database,
- remote service.

Kalau error terjadi karena service down, full layout bisa ikut gagal.

Buat layout error minimal:

```text
logo
simple message
request/correlation id
support instruction
no dynamic sidebar
no expensive widget
```

---

## 19. Print Layout dan Alternate Layout

Sering ada kebutuhan:

- print case detail,
- export preview,
- public page,
- login page,
- embedded iframe page,
- maintenance page.

Jangan paksakan semua ke `mainLayout`.

Struktur:

```text
/WEB-INF/tags/layout/
  main.tag
  public.tag
  auth.tag
  print.tag
  error.tag
```

Contoh:

```jsp
<layout:print title="Case Detail Print View">
    ...
</layout:print>
```

Ini lebih baik daripada:

```jsp
<layout:main title="..." hideSidebar="true" hideHeader="true" printMode="true" noScripts="true">
```

Jika terlalu banyak boolean layout flags, berarti kamu butuh layout terpisah.

---

## 20. Composition Granularity: Seberapa Kecil Fragment?

Terlalu besar:

```text
case-detail.jsp
```

berisi semua tab, actions, comments, documents, audit.

Sulit maintain.

Terlalu kecil:

```text
case-title.jsp
case-status.jsp
case-owner.jsp
case-created-date.jsp
case-one-button.jsp
```

Terlalu banyak include, sulit trace.

Granularity sehat:

```text
case-detail.jsp
  includes:
    case-summary-panel.jsp
    case-actions-panel.jsp
    case-documents-panel.jsp
    case-comments-panel.jsp
    case-audit-panel.jsp
```

Atau custom tag/tag file:

```jsp
<case:summary value="${caseDetail.summary}" />
<case:actions actions="${caseDetail.availableActions}" />
<case:documents documents="${caseDetail.documents}" />
```

Heuristik:

> Pecah fragment berdasarkan cohesive UI section, bukan berdasarkan setiap HTML element.

---

## 21. Hidden Coupling: Masalah Terbesar JSP Layout

Fragment buruk:

```jsp
<%-- case-actions.jsp --%>
<c:if test="${canApprove}">
    <form action="${approveUrl}" method="post">
        ...
    </form>
</c:if>
```

Kontraknya tersembunyi:

- `canApprove`
- `approveUrl`
- `csrfToken`
- mungkin `caseId`
- mungkin `currentUser`

Lebih baik:

```jsp
<c:forEach items="${caseDetail.availableActions}" var="action">
    ...
</c:forEach>
```

Atau sebagai tag:

```jsp
<case:actions actions="${caseDetail.availableActions}" csrfToken="${csrfToken}" />
```

Semakin explicit dependency, semakin mudah:

- test,
- refactor,
- migrate,
- review security,
- diagnose bug.

---

## 22. Path Resolution Rules

Path di JSP bisa membingungkan.

### 22.1 Static Include Path

```jsp
<%@ include file="header.jspf" %>
```

Relative terhadap file JSP saat translation.

```jsp
<%@ include file="/WEB-INF/jsp/common/header.jspf" %>
```

Absolute terhadap web application root.

### 22.2 Dynamic Include Path

```jsp
<jsp:include page="header.jsp" />
```

Relative terhadap current JSP request path/resource.

```jsp
<jsp:include page="/WEB-INF/jsp/common/header.jsp" />
```

Absolute terhadap web application root.

Rule:

> Untuk enterprise, lebih aman gunakan absolute web-app-relative path untuk include internal.

Contoh:

```jsp
<jsp:include page="/WEB-INF/jsp/common/header.jsp" />
```

bukan:

```jsp
<jsp:include page="../common/header.jsp" />
```

---

## 23. Avoid Direct Browser Access to JSP

Jangan taruh JSP di public web root seperti:

```text
/webapp/case/detail.jsp
```

Karena user bisa akses langsung dan bypass controller preparation.

Lebih aman:

```text
/webapp/WEB-INF/jsp/case/detail.jsp
```

Controller forward:

```java
request.getRequestDispatcher("/WEB-INF/jsp/case/detail.jsp")
       .forward(request, response);
```

Keuntungan:

1. JSP hanya bisa diakses melalui controller.
2. View model pasti disiapkan.
3. Authorization bisa enforced sebelum render.
4. Error handling lebih konsisten.
5. URL publik tidak terikat pada lokasi file JSP.

---

## 24. Layout dan Controller Contract

Controller harus menyiapkan minimal:

```java
public final class PageView {
    private final LayoutView layout;
    private final Object content;
}
```

Atau request attributes:

```java
request.setAttribute("layout", layoutView);
request.setAttribute("caseDetail", caseDetailView);
```

JSP harus membaca, bukan menghitung.

Controller responsibility:

- load data,
- check authorization,
- call service/domain,
- map domain to view model,
- prepare layout state,
- forward to JSP.

JSP responsibility:

- render,
- branch ringan untuk display,
- escape output,
- loop data siap render,
- include/tag composition.

JSP harus menghindari:

- query database,
- call remote service,
- calculate permission,
- mutate domain state,
- parse complex business rules,
- store long-lived state.

---

## 25. Example: Enterprise Case Detail Layout

### 25.1 Controller

```java
protected void doGet(HttpServletRequest request, HttpServletResponse response)
        throws ServletException, IOException {

    UserPrincipal user = requireUser(request);

    String caseId = request.getParameter("id");

    CaseDetailView caseDetail = caseQueryService.getCaseDetail(user, caseId);

    if (caseDetail == null) {
        response.sendError(HttpServletResponse.SC_NOT_FOUND);
        return;
    }

    LayoutView layout = layoutFactory.forUser(user)
            .title("Case " + caseDetail.getReferenceNo())
            .activeMenu("cases")
            .breadcrumb("Home", request.getContextPath() + "/")
            .breadcrumb("Cases", request.getContextPath() + "/cases")
            .breadcrumb(caseDetail.getReferenceNo(), null)
            .build();

    request.setAttribute("layout", layout);
    request.setAttribute("caseDetail", caseDetail);

    request.getRequestDispatcher("/WEB-INF/jsp/case/detail.jsp")
            .forward(request, response);
}
```

### 25.2 Page JSP

```jsp
<%@ taglib prefix="layout" tagdir="/WEB-INF/tags/layout" %>
<%@ taglib prefix="caseui" tagdir="/WEB-INF/tags/case" %>
<%@ taglib prefix="c" uri="jakarta.tags.core" %>

<layout:main title="${layout.pageTitle}" activeMenu="${layout.activeMenu}">
    <caseui:summary value="${caseDetail.summary}" />

    <caseui:actions actions="${caseDetail.availableActions}"
                    csrfToken="${csrfToken}" />

    <caseui:documents documents="${caseDetail.documents}" />

    <caseui:comments comments="${caseDetail.comments}" />

    <caseui:audit items="${caseDetail.auditEntries}" />
</layout:main>
```

### 25.3 Layout Tag

```jsp
<%@ tag body-content="scriptless" %>
<%@ attribute name="title" required="true" type="java.lang.String" %>
<%@ attribute name="activeMenu" required="false" type="java.lang.String" %>
<%@ taglib prefix="c" uri="jakarta.tags.core" %>

<!doctype html>
<html lang="${layout.locale.language}">
<head>
    <meta charset="UTF-8">
    <title><c:out value="${title}" /></title>
    <link rel="stylesheet" href="${pageContext.request.contextPath}/assets/app.css">
</head>
<body>
    <jsp:include page="/WEB-INF/jsp/common/header.jsp" />
    <jsp:include page="/WEB-INF/jsp/common/sidebar.jsp" />

    <main id="main-content">
        <jsp:include page="/WEB-INF/jsp/common/breadcrumb.jsp" />
        <jsp:include page="/WEB-INF/jsp/common/alerts.jsp" />
        <jsp:doBody />
    </main>

    <jsp:include page="/WEB-INF/jsp/common/footer.jsp" />
</body>
</html>
```

---

## 26. Reusable Panel Tag

Tag file:

```text
/WEB-INF/tags/ui/panel.tag
```

```jsp
<%@ tag body-content="scriptless" %>
<%@ attribute name="title" required="true" type="java.lang.String" %>
<%@ attribute name="variant" required="false" type="java.lang.String" %>
<%@ taglib prefix="c" uri="jakarta.tags.core" %>

<section class="panel ${empty variant ? 'panel-default' : variant}">
    <header class="panel-header">
        <h2><c:out value="${title}" /></h2>
    </header>

    <div class="panel-body">
        <jsp:doBody />
    </div>
</section>
```

Usage:

```jsp
<ui:panel title="Case Summary">
    <dl>
        <dt>Reference No</dt>
        <dd><c:out value="${caseDetail.referenceNo}" /></dd>

        <dt>Status</dt>
        <dd><c:out value="${caseDetail.statusLabel}" /></dd>
    </dl>
</ui:panel>
```

This gives reusable structure without hiding domain behavior.

---

## 27. Avoiding Spaghetti Include

Spaghetti include usually looks like this:

```text
detail.jsp
  include header.jsp
    include user-menu.jsp
      include permission.jsp
  include left.jsp
    include module-menu.jsp
      include menu-item.jsp
  include case-tabs.jsp
    include case-summary.jsp
      include case-status.jsp
    include case-documents.jsp
      include document-row.jsp
  include footer.jsp
```

Symptoms:

1. Hard to trace rendered HTML.
2. Error stack points to generated JSP line numbers.
3. Data dependency unclear.
4. Fragment order matters.
5. Same attribute name reused differently.
6. Debugging requires opening many files.
7. Small change causes layout regression.

Better structure:

```text
Controller
  prepares LayoutView
  prepares CaseDetailView

detail.jsp
  <layout:main>
    <caseui:summary>
    <caseui:actions>
    <caseui:documents>
    <caseui:comments>
  </layout:main>
```

The include depth still exists internally, but public composition is simple.

---

## 28. Naming Conventions

Good naming matters in JSP because composition is file-based.

Recommended:

```text
/WEB-INF/jsp/
  common/
    header.jsp
    footer.jsp
    sidebar.jsp
    breadcrumb.jsp
    alerts.jsp
  error/
    404.jsp
    500.jsp
  case/
    list.jsp
    detail.jsp
    edit.jsp
  user/
    profile.jsp

/WEB-INF/tags/
  layout/
    main.tag
    auth.tag
    public.tag
    print.tag
    error.tag
  ui/
    panel.tag
    field.tag
    badge.tag
    actionButton.tag
  case/
    summary.tag
    actions.tag
    documents.tag
```

Use:

- `layout:*` for page shell.
- `ui:*` for generic components.
- `case:*` or `caseui:*` for module-specific components.
- `common/*.jsp` for runtime fragments.

Avoid names like:

```text
newHeader2.jsp
commonFinal.jsp
tempLayout.jsp
left_old.jsp
casePageInclude.jsp
```

---

## 29. Accessibility as Layout Concern

Layout owns many accessibility responsibilities:

1. `lang` attribute.
2. document title.
3. skip link.
4. landmark regions:
   - `header`,
   - `nav`,
   - `main`,
   - `footer`.
5. breadcrumb `aria-label`.
6. alert roles.
7. focus management after validation.
8. error summary.
9. heading hierarchy.
10. keyboard navigable menu.

Example:

```jsp
<a class="skip-link" href="#main-content">Skip to main content</a>

<header role="banner">
    ...
</header>

<nav aria-label="Main navigation">
    ...
</nav>

<main id="main-content" tabindex="-1">
    <jsp:doBody />
</main>
```

Accessibility should not be left to individual pages. Put the baseline in layout.

---

## 30. Localization as Layout Concern

Layout often renders:

- page title,
- menu,
- footer,
- common buttons,
- alert labels,
- language switcher.

Avoid hardcoding:

```jsp
<title>Case Detail</title>
```

Better:

```jsp
<title><fmt:message key="${layout.titleKey}" /></title>
```

But do not overdo dynamic message keys if they become hard to trace.

Alternative:

Controller prepares display label:

```java
layout.setPageTitle(messageSource.get("case.detail.title", locale));
```

JSP:

```jsp
<title><c:out value="${layout.pageTitle}" /></title>
```

Trade-off:

| Approach | Pro | Con |
|---|---|---|
| JSP `fmt:message` | view owns display text | key scattered in JSP |
| Controller-prepared labels | testable, centralized | controller/view model bigger |
| Hybrid | balanced | needs discipline |

For regulatory systems, controller-prepared or layout-factory-prepared labels are often easier to test and audit.

---

## 31. Security Headers and Layout

Some security belongs to filter/server config, not JSP:

- CSP,
- HSTS,
- X-Frame-Options / frame-ancestors,
- Referrer-Policy,
- Permissions-Policy,
- Cache-Control.

But layout affects CSP because inline scripts/styles make strict CSP harder.

Avoid:

```jsp
<script>
    function submitCase() { ... }
</script>
```

Prefer external JS:

```jsp
<script src="${pageContext.request.contextPath}/assets/case-detail.js"></script>
```

If inline script is unavoidable, use nonce generated by server and applied consistently:

```jsp
<script nonce="${cspNonce}">
    ...
</script>
```

But nonce generation and header must be owned by security/filter layer, not ad hoc per JSP.

---

## 32. CSRF Token Placement

Layout can expose CSRF token for forms, but should not invent it.

Form example:

```jsp
<form method="post" action="${action.url}">
    <input type="hidden" name="${csrf.parameterName}" value="${csrf.token}">
    ...
</form>
```

If many forms need token, create tag:

```jsp
<security:csrfInput token="${csrf}" />
```

Do not place one global CSRF token in layout and assume all AJAX/forms use it correctly. Make form/action components explicitly include it.

---

## 33. Performance Considerations

Layout performance issues usually come from:

1. Repeated dynamic includes.
2. Menu computed in JSP.
3. Large object graph traversed in EL.
4. Fragment doing remote/service call.
5. Heavy localized message resolution in loops.
6. Huge hidden fields.
7. Too many CSS/JS files.
8. No resource caching.
9. View renders unused data.
10. Layout calls expensive widgets on every page.

Rules:

- Layout should be mostly O(number of visible layout items).
- Page content should receive pre-shaped view model.
- Do not traverse deep object graph in loops.
- Do not call getters with side effects.
- Avoid remote call from tag/custom tag.
- Measure render time separately from service time where possible.

Bad:

```jsp
<c:forEach items="${cases}" var="case">
    ${case.owner.department.organization.name}
</c:forEach>
```

Better:

```jsp
${case.ownerDepartmentName}
```

The view model should flatten display data.

---

## 34. Observability and Debuggability

Add harmless, useful diagnostics:

1. Request/correlation id in layout.
2. Build version in footer or HTML comment.
3. Environment banner outside production.
4. Error page shows support reference id.
5. Server-side logs include JSP path and view model key summary.
6. Optional debug mode in lower env.

Footer example:

```jsp
<footer>
    <span>Version: <c:out value="${buildInfo.version}" /></span>
    <span>Request ID: <c:out value="${requestId}" /></span>
</footer>
```

Do not expose sensitive internal data:

- stack trace,
- database host,
- user permissions raw,
- token values,
- session id,
- internal IPs.

---

## 35. Testing Layout

JSP layout testing can be done at several levels.

### 35.1 Unit Test View Model Factory

Test:

- menu item based on role,
- breadcrumb based on page,
- localized title,
- script/style list,
- alert mapping.

This is usually the highest ROI.

### 35.2 Integration Test Rendered HTML

Use embedded container or web integration test.

Assert:

- page contains expected title,
- menu item visible/invisible,
- CSRF input exists,
- escaped user input,
- breadcrumb order,
- no stack trace,
- no broken context path.

### 35.3 HTML Parser Assertion

Avoid brittle string-only tests. Parse HTML and assert structure:

```text
title == "Case Detail"
main#main-content exists
nav[aria-label='Breadcrumb'] exists
form input[name='_csrf'] exists
```

### 35.4 Golden Master for Legacy

For large legacy JSP, snapshot/golden master can help before refactor.

But snapshot tests should not freeze bad design forever. Use them as safety net during migration.

---

## 36. Migration-Friendly Layout Design

If you may later migrate from JSP to:

- Thymeleaf,
- Faces,
- SPA,
- server-side React-like rendering,
- REST + Vue/React,

then avoid tying page logic to JSP-specific hidden behavior.

Good migration-friendly design:

1. Controller prepares view model.
2. Layout state explicit.
3. UI components receive simple DTOs.
4. No business logic in JSP.
5. No SQL/XML processing in JSP.
6. Authorization enforced outside view.
7. Asset manifest separated.
8. Fragment contract documented.
9. Session usage minimal.
10. Paths generated centrally.

Then migrating view technology becomes a rendering rewrite, not business logic archaeology.

---

## 37. Practical Refactoring: From Include Soup to Layout Tag

### 37.1 Before

```jsp
<%@ include file="../common/taglibs.jspf" %>
<%@ include file="../common/header.jspf" %>
<%@ include file="../common/left.jspf" %>

<h1>${case.referenceNo}</h1>

<%@ include file="caseActions.jspf" %>
<%@ include file="caseDocuments.jspf" %>
<%@ include file="caseComments.jspf" %>

<%@ include file="../common/footer.jspf" %>
```

### 37.2 Problems

- relative include paths,
- static include everywhere,
- hidden dependency on `case`,
- layout order duplicated,
- no explicit page title contract,
- no reusable page shell.

### 37.3 After

```jsp
<%@ taglib prefix="layout" tagdir="/WEB-INF/tags/layout" %>
<%@ taglib prefix="caseui" tagdir="/WEB-INF/tags/case" %>

<layout:main title="${layout.pageTitle}" activeMenu="${layout.activeMenu}">
    <caseui:summary value="${caseDetail.summary}" />
    <caseui:actions actions="${caseDetail.availableActions}" csrfToken="${csrf}" />
    <caseui:documents documents="${caseDetail.documents}" />
    <caseui:comments comments="${caseDetail.comments}" />
</layout:main>
```

### 37.4 Refactoring Steps

1. Move JSP under `/WEB-INF/jsp`.
2. Extract `LayoutView`.
3. Make controller prepare `layout`.
4. Create `layout:main`.
5. Replace header/footer include with layout tag.
6. Extract repeated sections into tag files.
7. Replace raw domain object access with view model.
8. Add integration tests around critical pages.
9. Remove obsolete `.jspf` fragments.
10. Document contracts for remaining fragments.

---

## 38. Decision Matrix

| Problem | Preferred Solution |
|---|---|
| common taglib declarations | static include `.jspf` |
| full page shell | layout tag file |
| dynamic user header | `jsp:include` with explicit request model |
| reusable card/panel | tag file |
| reusable complex rendering with Java logic | custom tag handler |
| module-specific UI section | tag file or JSP fragment |
| multi-slot template | tag file with fragments or reconsider view tech |
| print/public/error shell | separate layout tag |
| role-based menu | precomputed menu view model |
| page-specific assets | layout view model |
| flash alerts | request attribute from flash/session bridge |
| secure forms | explicit CSRF tag/input |
| error page | minimal error layout |

---

## 39. Anti-Pattern Catalog

### 39.1 Business Logic in Layout

```jsp
<c:if test="${case.status == 'PENDING' && user.role == 'APPROVER'}">
```

Fix: precompute action/menu view.

### 39.2 Fragment Reads Random Global Attribute

```jsp
${someFlag}
```

Fix: namespace attributes under `layout`, `caseDetail`, `form`.

### 39.3 Direct JSP Access

```text
/public/case/detail.jsp
```

Fix: `/WEB-INF/jsp/case/detail.jsp` + controller forward.

### 39.4 Layout With Too Many Boolean Flags

```jsp
<layout:main hideHeader="true" hideFooter="true" noSidebar="true" print="true">
```

Fix: separate layouts.

### 39.5 Relative Path Fragility

```jsp
<%@ include file="../../common/header.jspf" %>
```

Fix: web-app absolute path.

### 39.6 Inline JavaScript With User Data

```jsp
<script>var name = '${user.name}';</script>
```

Fix: safe JSON encoding or data attributes.

### 39.7 Menu as Authorization

```jsp
<c:if test="${canDelete}">
    <a href="/delete">Delete</a>
</c:if>
```

Fix: backend authorization enforcement.

### 39.8 Layout Queries Database

Custom tag or JSP calls DAO.

Fix: controller/service prepares layout view model.

---

## 40. Enterprise Layout Checklist

Before approving a JSP layout design, ask:

1. Are all JSP files under `/WEB-INF`?
2. Does controller prepare required view model?
3. Are layout dependencies explicit?
4. Are common sections reusable without hidden state?
5. Is context path handled correctly?
6. Are user values escaped in correct context?
7. Is JavaScript injection safe?
8. Are authorization checks enforced outside menu rendering?
9. Is CSRF included in forms?
10. Are error pages minimal and robust?
11. Are page-specific assets managed cleanly?
12. Is session usage intentional and small?
13. Are breadcrumbs/menu/actions precomputed?
14. Is accessibility handled in layout?
15. Are fragments cohesive, not microscopic?
16. Are include paths absolute and stable?
17. Is there a migration path away from JSP if needed?
18. Are integration tests covering layout-critical pages?
19. Are build version and request id visible where useful?
20. Are internal diagnostics not exposed to users?

---

## 41. Top 1% Engineering Perspective

A weak engineer sees JSP layouting as:

> “Put header and footer in include files.”

A stronger engineer sees it as:

> “Create reusable page shell.”

A top-tier engineer sees it as:

> “Design a rendering composition system with explicit state boundaries, safe output contexts, predictable dependency contracts, accessible structure, security-aware action rendering, and migration-friendly separation between view model and view technology.”

That distinction matters because enterprise UI does not fail only because someone forgot a closing tag. It fails because UI composition becomes an ungoverned dependency graph.

The real target is not “DRY HTML”. The real target is:

```text
predictable rendering
explicit state
safe output
testable view contracts
low coupling
migration readiness
operational debuggability
```

---

## 42. Summary

Dalam bagian ini, kita mempelajari:

1. Layouting JSP adalah masalah composition architecture.
2. Static include cocok untuk source-level fragment statis.
3. Dynamic include cocok untuk runtime fragment dinamis.
4. Tag file adalah mekanisme kuat untuk layout shell dan reusable UI primitives.
5. Include chain yang tidak dikontrol akan berubah menjadi spaghetti include.
6. Layout harus menerima view model yang sudah disiapkan controller.
7. Authorization visibility bukan security enforcement.
8. Context path dan asset versioning harus dirancang sejak awal.
9. Error layout harus minimal dan robust.
10. Accessibility, localization, CSRF, alert, breadcrumb, dan resource loading adalah layout-level concerns.
11. Desain layout yang baik membuat JSP lebih mudah diuji dan lebih mudah dimigrasikan.

---

## 43. Latihan Praktis

### Latihan 1 — Refactor Layout Tradisional

Ambil JSP legacy dengan pola:

```jsp
include header
include sidebar
content
include footer
```

Refactor menjadi:

```jsp
<layout:main>
    content
</layout:main>
```

Lalu dokumentasikan dependency yang sebelumnya tersembunyi.

### Latihan 2 — Buat `LayoutView`

Buat class `LayoutView` yang memuat:

- page title,
- active menu,
- breadcrumbs,
- alerts,
- styles,
- scripts,
- locale,
- build info.

Pastikan JSP tidak lagi menghitung menu/breadcrumb sendiri.

### Latihan 3 — Buat Error Layout

Buat `layout:error` yang tidak bergantung pada:

- user,
- menu,
- database,
- notification service.

Pastikan halaman 500 tetap bisa render saat service utama gagal.

### Latihan 4 — Audit XSS Layout

Cari semua:

```jsp
<script>
```

dan semua penggunaan `${...}` di dalam JavaScript context. Buat daftar mana yang harus diganti dengan safe JSON encoding atau `data-*`.

### Latihan 5 — Menu Security Review

Pilih menu role-based. Pastikan setiap menu action juga memiliki backend authorization enforcement.

---

## 44. Preview Part Berikutnya

Bagian berikutnya:

```text
11-jsp-security-xss-csrf-output-encoding-session-headers.md
```

Kita akan masuk lebih dalam ke security JSP:

- XSS per output context,
- HTML escaping vs JavaScript escaping vs URL escaping,
- CSRF rendering,
- session fixation,
- hidden field tampering,
- cache-control,
- clickjacking,
- CSP,
- secure error pages,
- authorization-aware rendering,
- dan checklist security review untuk JSP enterprise.

---

## 45. Status Seri

Seri belum selesai.

Kita sudah menyelesaikan:

```text
00-orientation-server-side-ui-mental-model.md
01-history-compatibility-java8-to-java25.md
02-jakarta-pages-jsp-internal-architecture.md
03-jsp-syntax-directives-scriptlets-actions.md
04-request-session-application-scope-view-data-flow.md
05-expression-language-fundamentals-value-method-resolver-chain.md
06-advanced-el-custom-functions-resolvers-security-performance.md
07-jakarta-standard-tag-library-core-tags-view-control-abstraction.md
08-formatting-i18n-xml-sql-tags-what-to-use-and-avoid.md
09-custom-tags-and-tag-files-reusable-view-components.md
10-jsp-layouting-includes-templates-composition-maintainability.md
```

Bagian berikutnya:

```text
11-jsp-security-xss-csrf-output-encoding-session-headers.md
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 9 — Custom Tags and Tag Files: Reusable View Components Before Component Frameworks](./09-custom-tags-and-tag-files-reusable-view-components.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 11 — JSP Security: XSS, CSRF, Output Encoding, Session, and Headers](./11-jsp-security-xss-csrf-output-encoding-session-headers.md)

</div>