# learn-java-servlet-websocket-web-container-runtime — Part 027
# JSP, Jakarta Pages, Expression Language, JSTL: Legacy but Still Important

> Seri: `learn-java-servlet-websocket-web-container-runtime`  
> Part: `027`  
> Topik: JSP / Jakarta Pages, Expression Language, JSTL, custom tag, legacy view maintenance, migration strategy  
> Rentang Java: Java 8 sampai Java 25  
> Rentang API: Java EE `javax.servlet.jsp.*` sampai Jakarta EE `jakarta.servlet.jsp.*`

---

## 1. Tujuan Part Ini

Part ini membahas teknologi view klasik di ekosistem Java web:

- JSP / Jakarta Pages.
- Expression Language / EL.
- JSTL / Jakarta Standard Tag Library.
- Tag files dan custom tag.
- JSP lifecycle sebagai servlet hasil kompilasi.
- Scopes dalam JSP.
- Pola MVC Model 1 vs Model 2.
- Risiko security, maintainability, dan migration.

Fokus part ini bukan mendorong penggunaan JSP untuk sistem baru secara membabi buta. Fokusnya adalah memahami dengan benar karena banyak sistem enterprise, government, banking, telco, insurance, dan legacy internal platform masih memakai JSP atau turunannya.

Seorang engineer yang kuat tidak hanya paham teknologi modern. Ia juga paham runtime lama yang masih hidup, tahu batasnya, tahu cara memperbaiki tanpa merusak, dan tahu kapan perlu migrasi bertahap.

---

## 2. Posisi JSP dalam Arsitektur Java Web

Secara mental model, JSP bukan framework terpisah dari Servlet. JSP adalah template yang diterjemahkan menjadi servlet.

```text
Browser
  ↓ HTTP request
Servlet container
  ↓ mapping ke JSP resource atau servlet/controller
JSP file
  ↓ translated/compiled by container
Generated servlet class
  ↓ service request
HTML response
```

Artinya:

```text
JSP bukan menggantikan Servlet.
JSP berjalan di atas Servlet.
JSP akhirnya menjadi Servlet.
```

Ini penting karena banyak perilaku JSP sebenarnya adalah perilaku Servlet:

- request object tetap `HttpServletRequest`.
- response object tetap `HttpServletResponse`.
- session tetap `HttpSession`.
- application scope tetap `ServletContext`.
- error handling tetap masuk ke error dispatch/container behavior.
- classloading tetap mengikuti web application classloader.
- redeploy leak tetap mungkin terjadi.
- response commit tetap berlaku.
- include/forward tetap memakai dispatch semantics.

---

## 3. Nama Teknologi: JSP vs Jakarta Pages

Secara historis:

```text
JavaServer Pages / JSP
  ↓
Jakarta Server Pages
  ↓
Jakarta Pages
```

Dalam konteks legacy Java EE, package API berada di namespace:

```java
javax.servlet.jsp.*
javax.servlet.jsp.tagext.*
```

Dalam konteks Jakarta EE modern, namespace berubah menjadi:

```java
jakarta.servlet.jsp.*
jakarta.servlet.jsp.tagext.*
```

Perubahan namespace ini sama seperti perubahan dari:

```java
javax.servlet.*
```

menjadi:

```java
jakarta.servlet.*
```

Konsekuensinya:

- library JSP lama berbasis `javax.*` tidak otomatis compatible dengan container `jakarta.*`.
- tag library lama mungkin perlu versi Jakarta-compatible.
- TLD lama mungkin perlu dicek URI dan class handler-nya.
- custom tag handler perlu dimigrasi import package-nya.
- aplikasi Spring Boot 2 berbasis Java EE berbeda dunia dengan Spring Boot 3 berbasis Jakarta EE.

---

## 4. Kapan JSP Masih Relevan?

JSP masih relevan ketika:

1. Aplikasi legacy masih memakai server-side rendering.
2. Ada banyak halaman internal admin yang stabil dan tidak butuh SPA kompleks.
3. Tim perlu maintenance aplikasi Java EE lama.
4. Migration besar terlalu mahal dan harus bertahap.
5. Ada vendor product lama yang masih expose extension point via JSP/taglib.
6. Ada report/dashboard sederhana yang sudah berjalan lama.
7. Ada aplikasi intranet dengan requirement UI sederhana.

JSP kurang ideal untuk sistem baru ketika:

- UI butuh interaksi frontend kompleks.
- state client-side sangat besar.
- development team sudah memakai Vue/React/Angular/Svelte.
- API perlu dipakai multi-channel: web, mobile, partner integration.
- deployment FE/BE perlu dipisah.
- security header/CSP/frontend build pipeline perlu dikontrol detail.
- componentization modern lebih penting daripada server-side template sederhana.

Namun kesimpulan yang lebih matang bukan “JSP buruk”. Kesimpulan yang lebih tepat:

```text
JSP adalah server-side template technology.
Ia cocok untuk bentuk masalah tertentu.
Ia menjadi masalah ketika dipakai sebagai tempat business logic, SQL, authorization, dan workflow state.
```

---

## 5. Mental Model: JSP sebagai Generated Servlet

Misal ada JSP sederhana:

```jsp
<%@ page contentType="text/html; charset=UTF-8" %>
<html>
<body>
  <h1>Hello ${user.name}</h1>
</body>
</html>
```

Container akan menerjemahkannya menjadi semacam servlet Java internal:

```java
public final class hello_jsp extends HttpJspBase {
    public void _jspService(HttpServletRequest request,
                            HttpServletResponse response)
            throws IOException, ServletException {
        response.setContentType("text/html; charset=UTF-8");
        JspWriter out = pageContext.getOut();
        out.write("<html>...");
        // evaluate EL ${user.name}
        out.write(escapedOrResolvedValue);
    }
}
```

Bentuk generated code setiap container bisa berbeda, tetapi mental modelnya sama:

```text
JSP source
  -> translation phase
  -> Java servlet source/class
  -> compiled class
  -> executed per request
```

Implikasi penting:

- Kesalahan syntax JSP bisa menjadi compilation error runtime.
- First request bisa lebih lambat karena translation/compilation.
- Precompile JSP bisa mengurangi runtime surprise.
- Generated servlet mengikuti lifecycle servlet.
- `out.write(...)` bisa commit response jika buffer penuh.
- Scriptlet Java dalam JSP benar-benar masuk ke generated servlet code.

---

## 6. JSP Lifecycle

Lifecycle JSP secara konseptual:

```text
1. JSP file ditemukan container
2. Container translate JSP menjadi servlet source
3. Source dikompilasi menjadi class
4. Class dimuat oleh webapp classloader
5. Instance servlet JSP dibuat
6. jspInit() dipanggil
7. _jspService() dipanggil untuk setiap request
8. jspDestroy() dipanggil saat unload/redeploy/shutdown
```

Mirip Servlet:

```text
Servlet init()       ≈ JSP jspInit()
Servlet service()    ≈ JSP _jspService()
Servlet destroy()    ≈ JSP jspDestroy()
```

Tetapi `_jspService()` tidak boleh dideklarasikan sendiri secara normal karena container yang generate.

### 6.1 First Request Compilation

Dalam banyak container, JSP bisa dikompilasi saat pertama kali diakses.

Risiko:

- halaman pertama lambat.
- error JSP baru muncul di runtime.
- permission/temp directory issue baru muncul saat traffic datang.
- container butuh compiler/JSP engine yang sesuai.

Untuk production besar, pertimbangkan:

- precompile JSP saat build/deploy.
- warm-up endpoint internal.
- smoke test semua critical JSP setelah deployment.
- fail-fast saat startup bila memungkinkan.

---

## 7. JSP Elements

JSP punya beberapa jenis elemen utama.

### 7.1 Directive

Directive mengatur translation behavior.

Contoh page directive:

```jsp
<%@ page contentType="text/html; charset=UTF-8" %>
<%@ page pageEncoding="UTF-8" %>
<%@ page import="java.time.LocalDate" %>
```

Directive umum:

```jsp
<%@ page ... %>
<%@ include file="header.jspf" %>
<%@ taglib prefix="c" uri="jakarta.tags.core" %>
```

Mental model:

```text
Directive memengaruhi cara JSP diterjemahkan, bukan sekadar runtime output.
```

### 7.2 Declaration

Declaration membuat field atau method pada generated servlet.

```jsp
<%!
    private int counter = 0;
%>
```

Ini sangat berbahaya bila dipakai untuk mutable state, karena JSP servlet instance bisa melayani banyak request concurrent.

Contoh buruk:

```jsp
<%!
    private int total = 0;
%>
<%
    total++;
%>
```

Masalah:

- race condition.
- hasil tidak deterministik.
- state global per servlet instance.
- sulit dipahami.

Rule praktis:

```text
Jangan taruh mutable instance field di JSP.
```

### 7.3 Scriptlet

Scriptlet memasukkan Java code ke `_jspService()`.

```jsp
<%
    String name = request.getParameter("name");
    out.println(name);
%>
```

Scriptlet adalah salah satu penyebab utama JSP legacy sulit dirawat.

Masalah:

- mencampur HTML dan Java imperative code.
- raw output rawan XSS.
- logic tersebar di view.
- sulit test.
- sulit refactor.
- sering memanggil DAO/service langsung.

Rule modern:

```text
Hindari scriptlet.
Gunakan controller + model + EL + JSTL/tag files.
```

### 7.4 Expression

JSP expression menulis hasil ke output.

```jsp
<%= user.getName() %>
```

Masalahnya mirip scriptlet:

- raw output.
- escaping tidak eksplisit.
- Java logic bocor ke view.

Lebih baik gunakan EL dengan escaping/tag yang benar:

```jsp
${user.name}
```

atau:

```jsp
<c:out value="${user.name}" />
```

### 7.5 Standard Action

Contoh standard action:

```jsp
<jsp:include page="header.jsp" />
<jsp:forward page="login.jsp" />
<jsp:param name="x" value="y" />
<jsp:useBean id="user" class="com.example.User" scope="request" />
```

Beberapa masih ditemukan di legacy app, tetapi banyak modern app lebih memilih controller yang eksplisit.

---

## 8. Static Include vs Dynamic Include

Ada dua bentuk include yang sering membingungkan.

### 8.1 Static Include

```jsp
<%@ include file="header.jspf" %>
```

Mental model:

```text
Copy-paste source saat translation phase.
```

Karakteristik:

- terjadi sebelum JSP dikompilasi.
- cocok untuk fragment statis.
- included file menjadi bagian dari generated servlet yang sama.
- perubahan fragment bisa memicu retranslation.

### 8.2 Dynamic Include

```jsp
<jsp:include page="header.jsp" />
```

Mental model:

```text
Runtime include via request dispatch.
```

Karakteristik:

- terjadi saat request berjalan.
- resource target bisa JSP/Servlet lain.
- output target dimasukkan ke response saat itu.
- target punya lifecycle/translation sendiri.
- mirip `RequestDispatcher.include()`.

### 8.3 Perbandingan

| Aspek | Static include | Dynamic include |
|---|---|---|
| Waktu | Translation time | Runtime |
| Mekanisme | Source inclusion | Request dispatch include |
| Cocok untuk | Fragment markup statis | Fragment dinamis |
| Coupling | Tinggi | Lebih rendah |
| Lifecycle target | Menyatu dengan JSP utama | Target resource sendiri |
| Risiko | Variable collision | Response include constraints |

---

## 9. Implicit Objects dalam JSP

JSP menyediakan implicit objects.

| Object | Tipe konseptual | Scope/Fungsi |
|---|---|---|
| `request` | `HttpServletRequest` | request data |
| `response` | `HttpServletResponse` | response control |
| `session` | `HttpSession` | user session |
| `application` | `ServletContext` | app scope |
| `out` | `JspWriter` | output writer |
| `pageContext` | `PageContext` | bridge scope/context |
| `config` | `ServletConfig` | JSP servlet config |
| `page` | generated servlet instance | page object |
| `exception` | `Throwable` | hanya error page |

Mental model penting:

```text
Implicit object membuat JSP terasa mudah,
tetapi juga membuat boundary tersembunyi.
```

Contoh buruk:

```jsp
<%
    application.setAttribute("globalFlag", true);
    session.setAttribute("currentStep", "APPROVAL");
%>
```

Masalah:

- view mengubah application/session state.
- lifecycle workflow tersembunyi di page rendering.
- debugging sulit.
- concurrency risk.

Prinsip:

```text
JSP sebaiknya membaca model untuk render,
bukan mengubah workflow state.
```

---

## 10. JSP Scopes

JSP/EL mengenal beberapa scope:

```text
page
request
session
application
```

### 10.1 Page Scope

Page scope hanya berlaku di halaman JSP saat ini.

```jsp
<c:set var="x" value="123" scope="page" />
```

Cocok untuk variable rendering lokal.

### 10.2 Request Scope

Request scope hidup sepanjang satu request dispatch.

Controller biasanya mengisi request attribute:

```java
request.setAttribute("user", userDto);
request.getRequestDispatcher("/WEB-INF/views/user.jsp")
       .forward(request, response);
```

JSP membaca:

```jsp
${user.name}
```

Ini adalah pola sehat untuk server-side MVC.

### 10.3 Session Scope

Session scope hidup lintas request untuk user/session yang sama.

```jsp
${sessionScope.currentUser.name}
```

Risiko:

- session bloat.
- stale data.
- concurrency antar tab.
- serialization issue pada cluster.
- data authorization lama masih tersimpan setelah role berubah.

Gunakan session untuk identity/session state minimal, bukan cache domain besar.

### 10.4 Application Scope

Application scope sama dengan `ServletContext` attribute.

```jsp
${applicationScope.appVersion}
```

Risiko:

- global mutable state.
- race condition.
- redeploy leak jika menyimpan object buruk.
- data antar tenant/user tercampur bila salah desain.

### 10.5 Scope Resolution Order

EL biasanya mencari attribute dari scope sempit ke luas:

```text
page → request → session → application
```

Masalah:

```jsp
${user}
```

bisa ambigu jika `user` ada di request dan session.

Lebih eksplisit:

```jsp
${requestScope.user}
${sessionScope.currentUser}
```

Prinsip:

```text
Gunakan nama model yang jelas.
Untuk data sensitif, eksplisitkan scope.
```

---

## 11. Expression Language / EL

EL memungkinkan akses property, collection, operator, function, dan object scoped tanpa scriptlet.

Contoh:

```jsp
${user.name}
${order.total > 1000}
${empty items}
${items[0].name}
${param.q}
${header['User-Agent']}
${cookie.JSESSIONID.value}
```

EL membuat JSP lebih declarative.

Namun EL bukan tempat business logic kompleks.

Contoh terlalu kompleks:

```jsp
${order.status == 'PENDING' and user.role == 'APPROVER' and order.amount < user.limit and not empty order.documents}
```

Lebih baik controller/service menyiapkan view model:

```java
viewModel.setCanApprove(decision.canApprove());
```

JSP:

```jsp
<c:if test="${model.canApprove}">
  <button>Approve</button>
</c:if>
```

Mental model:

```text
EL bagus untuk binding view.
EL buruk untuk policy engine.
```

---

## 12. EL Property Resolution

EL expression:

```jsp
${user.name}
```

secara konseptual mencari:

```java
user.getName()
```

atau property equivalent.

Untuk map:

```jsp
${map.key}
${map['key-with-dash']}
```

Untuk list/array:

```jsp
${items[0]}
```

Potential issue:

- property tidak ada.
- null chain.
- method side effect jika getter buruk.
- lazy-loaded entity access di view.
- exception tersembunyi menjadi empty output tergantung config/container.

Rule penting:

```text
Jangan expose entity persistence langsung ke JSP.
Expose DTO/view model yang sudah lengkap.
```

Mengapa?

- JSP render tidak boleh trigger lazy DB query tak terkontrol.
- JSP tidak boleh membuka transaction semantics.
- JSP tidak boleh tahu domain internal terlalu dalam.
- DTO mengurangi accidental data exposure.

---

## 13. EL Implicit Objects

EL punya implicit objects seperti:

```jsp
${pageScope.x}
${requestScope.x}
${sessionScope.x}
${applicationScope.x}
${param.name}
${paramValues.role}
${header['User-Agent']}
${headerValues['Accept']}
${cookie.theme.value}
${initParam.appName}
```

Contoh membaca query parameter:

```jsp
Search: ${param.q}
```

Tetapi jangan percaya user input hanya karena dibaca via EL.

Jika output ke HTML, gunakan escaping yang benar.

---

## 14. Escaping dan XSS

Ini salah satu area paling penting.

Contoh raw output berbahaya:

```jsp
<%= request.getParameter("name") %>
```

Jika user mengirim:

```html
<script>alert(1)</script>
```

maka script bisa masuk output HTML.

Dengan JSTL:

```jsp
<c:out value="${param.name}" />
```

`c:out` melakukan XML/HTML escaping untuk karakter seperti `<`, `>`, `&`, dan quote.

Namun escaping harus sesuai context.

### 14.1 HTML Body Context

```jsp
<p><c:out value="${user.name}" /></p>
```

### 14.2 HTML Attribute Context

```jsp
<input value="<c:out value='${user.name}' />" />
```

Perlu hati-hati quote dan encoding.

### 14.3 JavaScript Context

```jsp
<script>
  const name = "${user.name}";
</script>
```

Ini rawan. HTML escaping saja tidak cukup untuk JavaScript string context.

Lebih aman:

- serialize data sebagai JSON dengan library yang benar.
- taruh data di endpoint API.
- gunakan data attributes dengan escaping yang benar.

### 14.4 URL Context

```jsp
<a href="/search?q=${param.q}">Search</a>
```

Perlu URL encoding, bukan HTML escaping saja.

### 14.5 Prinsip Escaping

```text
Escaping bukan satu jenis.
Escaping bergantung pada output context:
HTML body, HTML attribute, JavaScript, CSS, URL, JSON.
```

Top-tier engineer tidak hanya bilang “escape output”. Ia bertanya:

```text
Output ini masuk context apa?
```

---

## 15. JSTL / Jakarta Standard Tag Library

JSTL menyediakan tag umum untuk:

- conditional rendering.
- iteration.
- output escaping.
- URL construction.
- formatting.
- internationalization.
- XML processing.
- SQL tags legacy.

Taglib modern Jakarta biasanya memakai URI seperti:

```jsp
<%@ taglib prefix="c" uri="jakarta.tags.core" %>
<%@ taglib prefix="fmt" uri="jakarta.tags.fmt" %>
<%@ taglib prefix="fn" uri="jakarta.tags.functions" %>
```

Legacy Java EE sering memakai URI lama seperti:

```jsp
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>
```

Saat migrasi `javax` ke `jakarta`, cek versi taglib dan URI yang didukung container/library.

---

## 16. JSTL Core Tags

### 16.1 Output

```jsp
<c:out value="${user.name}" />
```

Gunakan untuk output user/domain data ke HTML body.

### 16.2 Conditional

```jsp
<c:if test="${model.canApprove}">
  <button>Approve</button>
</c:if>
```

### 16.3 Choose/When/Otherwise

```jsp
<c:choose>
  <c:when test="${order.status == 'PENDING'}">
    Pending
  </c:when>
  <c:when test="${order.status == 'APPROVED'}">
    Approved
  </c:when>
  <c:otherwise>
    Unknown
  </c:otherwise>
</c:choose>
```

### 16.4 Iteration

```jsp
<c:forEach var="item" items="${items}" varStatus="st">
  <tr>
    <td>${st.index + 1}</td>
    <td><c:out value="${item.name}" /></td>
  </tr>
</c:forEach>
```

### 16.5 URL Construction

```jsp
<c:url var="detailUrl" value="/orders/detail">
  <c:param name="id" value="${order.id}" />
</c:url>
<a href="${detailUrl}">Detail</a>
```

Keuntungan:

- context path handling.
- parameter encoding.
- lebih aman daripada string concat manual.

---

## 17. Formatting dan Internationalization

JSTL fmt tags sering dipakai untuk:

- date/time formatting.
- number formatting.
- currency formatting.
- message bundle/i18n.

Contoh:

```jsp
<fmt:setBundle basename="messages" />
<fmt:message key="order.title" />
```

Contoh formatting:

```jsp
<fmt:formatNumber value="${order.amount}" type="currency" />
<fmt:formatDate value="${order.createdAt}" pattern="yyyy-MM-dd HH:mm" />
```

Caveat modern:

- `java.time` support tergantung tag/library/container behavior.
- Format sebaiknya konsisten dengan locale user.
- Jangan formatting uang/regulatory value sembarangan.
- Untuk domain serius, format di view model bila aturan kompleks.

---

## 18. JSTL SQL Tags: Kenapa Hampir Selalu Harus Dihindari

JSTL historis punya SQL tags.

Contoh style buruk:

```jsp
<sql:query var="orders" dataSource="jdbc/myDs">
  SELECT * FROM orders
</sql:query>
```

Ini harus dihindari untuk aplikasi serius.

Masalah:

- query di view.
- transaction boundary kacau.
- authorization/data filtering rawan bocor.
- sulit test.
- sulit optimize.
- rawan N+1 atau query berat saat render.
- melanggar separation of concerns.

Rule:

```text
Jangan akses database dari JSP.
JSP menerima view model siap render.
```

---

## 19. MVC Model 1 vs Model 2

### 19.1 Model 1

Model 1 berarti JSP menangani request langsung:

```text
Browser
  ↓
JSP
  ↓ reads parameter, calls service/DAO, renders output
Response
```

Contoh buruk:

```jsp
<%
String id = request.getParameter("id");
Order order = orderDao.findById(id);
request.setAttribute("order", order);
%>
<html>...</html>
```

Masalah:

- view menjadi controller.
- view tahu DAO/service.
- security mudah terlewat.
- validation tersebar.
- error handling tidak konsisten.
- testability rendah.

### 19.2 Model 2

Model 2 memakai controller/servlet di depan JSP:

```text
Browser
  ↓
Controller Servlet / Framework Controller
  ↓ validate/auth/business orchestration
View model
  ↓ forward
JSP render only
  ↓
Response
```

Contoh controller:

```java
@WebServlet("/orders/detail")
public class OrderDetailServlet extends HttpServlet {
    private OrderQueryService orderQueryService;

    @Override
    protected void doGet(HttpServletRequest request,
                         HttpServletResponse response)
            throws ServletException, IOException {

        String id = request.getParameter("id");
        OrderDetailViewModel model = orderQueryService.getDetailForCurrentUser(id);

        request.setAttribute("model", model);
        request.getRequestDispatcher("/WEB-INF/views/order-detail.jsp")
               .forward(request, response);
    }
}
```

JSP:

```jsp
<h1>Order <c:out value="${model.orderNo}" /></h1>
<p>Status: <c:out value="${model.statusLabel}" /></p>
```

Prinsip:

```text
Controller decides.
JSP displays.
```

---

## 20. Kenapa JSP Biasanya Ditaruh di `WEB-INF`

Jika JSP berada di public web root:

```text
/src/main/webapp/order-detail.jsp
```

client bisa mengakses langsung:

```text
GET /order-detail.jsp
```

Ini berisiko karena controller bisa dilewati.

Pola lebih aman:

```text
/src/main/webapp/WEB-INF/views/order-detail.jsp
```

Resource di `WEB-INF` tidak bisa diakses langsung oleh client, tetapi bisa di-forward oleh server.

Flow:

```text
GET /orders/detail?id=123
  ↓
OrderDetailServlet
  ↓ validate/auth/load model
forward /WEB-INF/views/order-detail.jsp
  ↓
render
```

Ini memastikan JSP hanya menjadi view, bukan entry point publik.

---

## 21. Tag Files

Tag file adalah cara membuat reusable view component menggunakan syntax JSP-like.

Lokasi umum:

```text
/WEB-INF/tags/panel.tag
```

Contoh `panel.tag`:

```jsp
<%@ tag body-content="scriptless" %>
<%@ attribute name="title" required="true" %>

<div class="panel">
  <h2><c:out value="${title}" /></h2>
  <div class="panel-body">
    <jsp:doBody />
  </div>
</div>
```

Pemakaian:

```jsp
<%@ taglib prefix="ui" tagdir="/WEB-INF/tags" %>

<ui:panel title="Order Detail">
  <p>Order number: <c:out value="${model.orderNo}" /></p>
</ui:panel>
```

Kegunaan:

- mengurangi duplikasi markup.
- membuat komponen kecil.
- lebih mudah dari custom Java tag handler untuk kebutuhan sederhana.
- menjaga JSP tetap declarative.

Caveat:

- jangan masukkan business logic ke tag file.
- jangan membuat tag file terlalu besar.
- jangan menyembunyikan authorization policy di tag file.

---

## 22. Custom Tag Handler

Custom tag handler adalah class Java yang mengimplementasikan tag behavior.

Secara konseptual:

```text
JSP tag usage
  ↓
TLD descriptor
  ↓
Tag handler class
  ↓
Runtime rendering/control
```

Contoh use case valid:

- reusable form component.
- permission-aware rendering wrapper, jika policy tetap di service.
- formatting domain-specific.
- layout component.
- pagination component.
- legacy design system integration.

Risiko:

- tag handler punya state instance yang tidak thread-safe.
- tag handler memanggil database.
- tag handler terlalu pintar.
- tag handler menyembunyikan side effect.
- TLD/class mismatch saat migrasi.

Prinsip:

```text
Custom tag boleh membantu rendering.
Custom tag tidak boleh menjadi mini service layer.
```

---

## 23. Page Directive Penting

Beberapa directive penting:

```jsp
<%@ page contentType="text/html; charset=UTF-8" %>
<%@ page pageEncoding="UTF-8" %>
<%@ page isErrorPage="true" %>
<%@ page errorPage="/WEB-INF/views/error.jsp" %>
<%@ page session="false" %>
<%@ page trimDirectiveWhitespaces="true" %>
```

### 23.1 `session="false"`

Default JSP bisa membuat/menggunakan session. Untuk halaman publik atau stateless, lebih aman:

```jsp
<%@ page session="false" %>
```

Keuntungan:

- mencegah session dibuat tidak sengaja.
- mengurangi memory footprint.
- membantu cacheability.

### 23.2 `isErrorPage="true"`

Agar implicit object `exception` tersedia:

```jsp
<%@ page isErrorPage="true" %>
```

Namun error page harus hati-hati:

- jangan bocorkan stack trace ke user.
- jangan melakukan logic berat.
- jangan memicu error kedua.
- log correlation id, bukan detail sensitif ke response.

---

## 24. Buffering dan Response Commit di JSP

JSP menulis output melalui `JspWriter`.

Directive buffer:

```jsp
<%@ page buffer="8kb" autoFlush="true" %>
```

Jika buffer penuh dan autoFlush true, response bisa committed.

Setelah committed:

- status code tidak bisa diubah aman.
- header tidak bisa ditambah aman.
- redirect gagal.
- forward gagal.

Contoh bug:

```jsp
<html>
<body>
Lots of output...
<%
    if (!authorized) {
        response.sendRedirect("/login");
        return;
    }
%>
</body>
</html>
```

Jika output sudah committed, redirect bisa gagal.

Prinsip:

```text
Authorization dan redirect decision harus terjadi sebelum view render.
```

---

## 25. JSP dan Error Handling

JSP bisa memakai page-level error:

```jsp
<%@ page errorPage="/WEB-INF/views/error.jsp" %>
```

Tetapi untuk aplikasi besar, lebih baik gunakan centralized error mapping:

```xml
<error-page>
  <error-code>500</error-code>
  <location>/WEB-INF/views/errors/500.jsp</location>
</error-page>

<error-page>
  <exception-type>java.lang.Throwable</exception-type>
  <location>/WEB-INF/views/errors/error.jsp</location>
</error-page>
```

Atau framework-level error handling.

JSP error page harus:

- aman jika model tidak tersedia.
- tidak assume session valid.
- tidak query DB.
- tidak throw exception baru.
- tidak expose stack trace.
- menampilkan correlation id.

---

## 26. JSP dan Security Boundary

JSP sering menjadi sumber bug security karena terlalu dekat dengan output.

### 26.1 XSS

Sumber:

- raw scriptlet output.
- `${param.x}` tanpa escape dalam context berbahaya.
- HTML fragment dari database.
- JavaScript inline injection.

Mitigasi:

- default escaping discipline.
- gunakan `<c:out>` untuk HTML body.
- hindari inline JS data raw.
- gunakan JSON serializer aman.
- Content Security Policy bila memungkinkan.

### 26.2 Authorization Bypass

Contoh buruk:

```jsp
<c:if test="${sessionScope.user.role == 'ADMIN'}">
  <a href="/admin/delete?id=${item.id}">Delete</a>
</c:if>
```

Ini hanya menyembunyikan tombol. Bukan authorization.

Server endpoint `/admin/delete` tetap harus enforce authorization.

Prinsip:

```text
JSP boleh menyembunyikan UI.
Servlet/controller/service harus enforce policy.
```

### 26.3 CSRF

JSP form perlu token bila memakai cookie/session auth.

```jsp
<form method="post" action="/orders/approve">
  <input type="hidden" name="csrf" value="${csrfToken}" />
  ...
</form>
```

Token generation/validation jangan dilakukan di JSP. JSP hanya render token dari model/request.

### 26.4 Sensitive Data Exposure

Jangan taruh data sensitif di:

- hidden input tanpa alasan.
- HTML comments.
- JavaScript global variable.
- data attributes.
- client-side rendered JSON blob.

---

## 27. JSP dan Caching

Server-side rendered page bisa dicache oleh browser/proxy jika header salah.

Untuk page private:

```java
response.setHeader("Cache-Control", "no-store");
response.setHeader("Pragma", "no-cache");
response.setDateHeader("Expires", 0);
```

Jangan taruh cache header decision di JSP jika bisa dilakukan di filter/controller.

Pola baik:

```text
Filter decides cache headers based on URL/security context.
Controller decides model.
JSP renders.
```

Risiko umum:

- user logout tapi browser back menampilkan data private dari cache.
- proxy cache page personalized.
- static assets tidak dicache optimal karena dicampur dengan dynamic JSP.

---

## 28. JSP dan Static Assets

JSP sering mencampur asset path dengan context path.

Buruk:

```jsp
<link rel="stylesheet" href="/css/app.css">
```

Jika aplikasi deploy di context path `/aceas`, path menjadi salah.

Lebih baik:

```jsp
<c:url var="cssUrl" value="/css/app.css" />
<link rel="stylesheet" href="${cssUrl}">
```

Atau ekspresikan context path secara konsisten.

Untuk production modern:

- static assets sebaiknya versioned/cache-busted.
- gunakan CDN/proxy static route jika perlu.
- jangan serve file besar melalui JSP.
- jangan generate CSS/JS besar dari JSP kecuali sangat perlu.

---

## 29. JSP dan Internationalization

Pola umum:

```jsp
<fmt:setBundle basename="messages" />
<h1><fmt:message key="order.detail.title" /></h1>
```

Tetapi top-tier engineering memperhatikan:

- locale resolution dari user preference/session/request header.
- fallback locale.
- missing key detection.
- date/time timezone.
- currency/number precision.
- regulatory wording consistency.
- jangan hardcode status label di JSP jika domain label controlled.

Lebih matang:

```text
Domain status code -> service maps to message key -> JSP renders localized message.
```

---

## 30. JSP dalam Spring MVC / Jakarta MVC / Servlet MVC

Banyak aplikasi memakai JSP sebagai view technology di belakang controller framework.

Flow:

```text
Controller method
  ↓ returns view name + model
View resolver
  ↓ resolves /WEB-INF/views/x.jsp
JSP renders model
```

Walaupun framework berbeda, prinsipnya sama:

```text
JSP is view.
Controller owns request decision.
Service owns business rule.
Repository owns data access.
```

Jangan karena memakai framework lalu JSP bebas berisi logic.

---

## 31. Dependency dan Packaging

### 31.1 Traditional Container

Dalam WAR external container, JSP API biasanya disediakan container.

Maven dependency biasanya `provided`:

```xml
<dependency>
  <groupId>jakarta.servlet.jsp</groupId>
  <artifactId>jakarta.servlet.jsp-api</artifactId>
  <version>4.0.0</version>
  <scope>provided</scope>
</dependency>
```

JSTL implementation/library mungkin perlu dikemas sesuai container.

### 31.2 Embedded Server

Dalam embedded server, pastikan JSP engine tersedia.

Contoh isu umum:

- embedded Tomcat tanpa Jasper dependency.
- executable JAR sulit support JSP karena JSP butuh resource layout tertentu.
- JSP lebih cocok dengan WAR layout dibanding pure executable JAR tertentu.
- container image perlu temp directory writable untuk JSP compilation jika runtime compile.

### 31.3 Migration `javax` ke `jakarta`

Checklist:

```text
[ ] Replace imports javax.servlet.jsp.* -> jakarta.servlet.jsp.*
[ ] Replace tag handler imports
[ ] Upgrade JSP/Jakarta Pages API
[ ] Upgrade JSTL/Jakarta Tags dependency
[ ] Check taglib URI compatibility
[ ] Check TLD class references
[ ] Check web.xml schema namespace
[ ] Check container version
[ ] Check framework view resolver
[ ] Compile JSP/precompile if possible
[ ] Regression test all pages
```

---

## 32. JSP Precompilation

Precompilation berarti JSP diterjemahkan/dikompilasi sebelum runtime traffic.

Manfaat:

- compile error ditemukan lebih cepat.
- first request latency turun.
- production tidak surprise karena syntax error.
- bisa fail build jika JSP rusak.

Trade-off:

- build lebih kompleks.
- container-specific tooling bisa berbeda.
- generated servlet mapping perlu benar.
- dynamic JSP update saat runtime tidak relevan untuk immutable deployment.

Untuk sistem enterprise modern, precompile atau setidaknya smoke-test JSP critical path sangat disarankan.

---

## 33. Anti-Pattern JSP yang Harus Diwaspadai

### 33.1 Business Logic di JSP

```jsp
<% if (order.getAmount().compareTo(user.getApprovalLimit()) <= 0) { %>
```

Masalah:

- policy tersebar.
- audit sulit.
- test sulit.
- logic bisa beda antar halaman.

Solusi:

```java
model.setCanApprove(approvalPolicy.canApprove(user, order));
```

JSP:

```jsp
<c:if test="${model.canApprove}">
```

### 33.2 DAO di JSP

```jsp
<%= orderDao.findById(request.getParameter("id")) %>
```

Hindari total.

### 33.3 Session sebagai Dumping Ground

```jsp
<% session.setAttribute("order", order); %>
```

Risiko:

- stale data.
- concurrency antar tab.
- memory bloat.
- distributed session serialization.

### 33.4 Raw HTML dari Database

```jsp
${article.bodyHtml}
```

Jika tidak disanitasi, rawan XSS.

### 33.5 Logic Berdasarkan Tombol yang Ditampilkan

Menyembunyikan tombol bukan authorization.

### 33.6 JSP Direct Access

JSP public di root bisa melewati controller.

### 33.7 Error Page yang Error Lagi

Error JSP yang assume `model` selalu ada bisa meledak saat error path.

---

## 34. Designing View Model untuk JSP

View model adalah object khusus untuk rendering.

Contoh:

```java
public final class OrderDetailPageModel {
    private final String orderNo;
    private final String statusLabel;
    private final boolean canApprove;
    private final boolean canReject;
    private final List<DocumentRow> documents;
    private final String csrfToken;

    // constructor + getters
}
```

Keuntungan:

- JSP sederhana.
- business rule sudah dievaluasi.
- data exposed terkontrol.
- tidak lazy-load saat render.
- mudah test di service/controller.
- cocok untuk migration ke JSON/API nanti.

JSP:

```jsp
<h1>Order <c:out value="${model.orderNo}" /></h1>
<p>Status: <c:out value="${model.statusLabel}" /></p>

<c:if test="${model.canApprove}">
  <form method="post" action="${approveUrl}">
    <input type="hidden" name="csrf" value="${model.csrfToken}" />
    <button>Approve</button>
  </form>
</c:if>
```

Prinsip:

```text
JSP should render facts and decisions,
not compute domain decisions.
```

---

## 35. Refactoring Legacy JSP Step by Step

Jangan langsung rewrite semua.

### Step 1 — Inventory

Catat:

- jumlah JSP.
- direct-access JSP.
- JSP di `WEB-INF` vs public root.
- scriptlet-heavy pages.
- pages yang query DB.
- taglibs custom.
- security-sensitive pages.
- high-traffic pages.
- error-prone pages.

### Step 2 — Stop the Bleeding

Aturan untuk perubahan baru:

```text
No new scriptlet.
No DAO call in JSP.
No new public JSP entry point.
No raw user output.
No business decision in JSP.
```

### Step 3 — Move JSP Behind Controller

Dari:

```text
/order.jsp?id=123
```

ke:

```text
/orders/detail?id=123 -> controller -> /WEB-INF/views/order.jsp
```

### Step 4 — Extract View Model

Pindahkan logic dari JSP ke service/controller.

### Step 5 — Replace Scriptlet with JSTL/EL

Dari:

```jsp
<% for (Order o : orders) { %>
  <%= o.getNo() %>
<% } %>
```

ke:

```jsp
<c:forEach var="o" items="${orders}">
  <c:out value="${o.no}" />
</c:forEach>
```

### Step 6 — Introduce Tag Files for Repetition

Extract repeated markup.

### Step 7 — Harden Output and Forms

- escape output.
- CSRF token.
- URL encoding.
- cache headers.
- no sensitive hidden fields.

### Step 8 — Add Regression Safety

- snapshot HTML test for critical pages.
- integration test controller -> view.
- smoke test deployed JSP.
- access control test.
- XSS payload test.

### Step 9 — Decide Migration Destination

Options:

- keep JSP but clean architecture.
- migrate to Thymeleaf/Freemarker/Mustache.
- migrate to SPA + REST/JAX-RS/Spring controllers.
- migrate page-by-page behind same routes.

---

## 36. JSP to SPA Migration Strategy

Migrasi JSP ke SPA tidak boleh hanya “ubah UI”. Banyak boundary berubah.

### 36.1 Before

```text
Browser
  ↓
Servlet/controller
  ↓ load model
  ↓ forward JSP
HTML response
```

Auth/session/CSRF/rendering terjadi server-side.

### 36.2 After

```text
Browser SPA
  ↓ API call
Backend API
  ↓ JSON response
Browser renders UI
```

Perubahan:

- data exposure pindah ke JSON API.
- client-side routing muncul.
- CSRF/CORS/token/session strategy berubah.
- caching berubah.
- error rendering berubah.
- authorization UI vs backend enforcement makin penting.
- API backward compatibility perlu dijaga.

### 36.3 Safe Migration Pattern

```text
1. Put JSP behind controller
2. Extract view model
3. Convert view model to API DTO candidate
4. Add API endpoint parallel
5. Build SPA page consuming API
6. Route selected users/page to SPA
7. Keep legacy JSP fallback
8. Remove JSP after stability window
```

### 36.4 Jangan Langsung Expose Entity

Legacy JSP mungkin membaca entity internal. Saat membuat API, jangan langsung serialize entity.

Gunakan DTO:

```java
public record OrderDetailResponse(
    String orderNo,
    String status,
    List<DocumentResponse> documents,
    ActionsResponse actions
) {}
```

---

## 37. JSP dan Performance

JSP performance biasanya bukan masalah utama setelah compiled. Masalah sering berasal dari:

- logic berat di JSP.
- DB call saat render.
- lazy loading.
- terlalu banyak includes.
- tag handler mahal.
- session besar.
- output besar.
- tidak cache static assets.
- no gzip/compression.
- repeated message bundle lookup buruk.

Checklist:

```text
[ ] JSP precompiled or warmed up
[ ] No DB call in view
[ ] No lazy entity traversal
[ ] Bounded iteration size
[ ] Pagination for tables
[ ] Static assets versioned/cacheable
[ ] No huge session object
[ ] Response compression configured at container/proxy
[ ] Access log measures render latency
```

---

## 38. JSP dan Observability

JSP error sering terlihat sebagai:

- 500 compilation error.
- property not found.
- null pointer in scriptlet.
- tag handler exception.
- include target not found.
- response already committed.
- broken pipe during large output.

Observability yang membantu:

- request ID/correlation ID.
- URL + servlet path + JSP path.
- controller name.
- view name.
- render duration.
- exception root cause.
- user/session id hash, bukan data sensitif.
- response committed status.
- include/forward chain jika bisa.

Hindari log:

- full HTML response.
- password/token.
- sensitive request parameters.
- full session dump.

---

## 39. Failure Model JSP

### 39.1 JSP Compilation Failure

Gejala:

- first request 500.
- stack trace dari JSP compiler.
- only happens after deploy.

Penyebab:

- syntax JSP salah.
- taglib tidak ditemukan.
- class import salah.
- `javax`/`jakarta` mismatch.
- container JSP engine missing.

Mitigasi:

- precompile JSP.
- smoke test.
- dependency check.

### 39.2 Tag Library Not Found

Gejala:

```text
The absolute uri ... cannot be resolved
```

Penyebab:

- JSTL dependency tidak ada.
- URI lama tidak didukung versi baru.
- TLD tidak masuk classpath.
- migration `javax` ke `jakarta` belum lengkap.

### 39.3 Response Already Committed

Penyebab:

- output sudah ditulis sebelum redirect/error/forward.
- buffer terlalu kecil.
- authorization terlambat di JSP.

### 39.4 XSS Regression

Penyebab:

- scriptlet raw output.
- mengganti `<c:out>` dengan `${}` di context berbahaya.
- raw HTML field baru dari CMS/database.

### 39.5 Session Bloat

Penyebab:

- JSP memasukkan object besar ke session.
- per-tab state disimpan global per session.
- wizard state tidak dibersihkan.

### 39.6 Direct Access Bypass

Penyebab:

- JSP public bisa diakses tanpa controller.
- page assume request attribute sudah ada.
- auth hanya dilakukan oleh controller.

Mitigasi:

- pindahkan JSP ke `WEB-INF`.
- deny direct access via security/filter.

---

## 40. Practical Production Checklist

Untuk aplikasi JSP serius:

```text
Architecture
[ ] JSP berada di /WEB-INF/views jika perlu controller
[ ] Controller menyiapkan view model
[ ] JSP tidak memanggil DAO/service langsung
[ ] JSP tidak berisi business decision kompleks
[ ] Tidak ada scriptlet baru

Security
[ ] Output user/domain data diescape sesuai context
[ ] Form mutating action punya CSRF token
[ ] Authorization enforced di backend, bukan hanya hide button
[ ] Sensitive page pakai no-store cache header
[ ] Tidak ada sensitive data di hidden field/comment/JS global

Runtime
[ ] JSP compile/precompile strategy jelas
[ ] Taglib dependencies compatible dengan container
[ ] javax/jakarta namespace konsisten
[ ] Error page aman dan tidak bocor stack trace
[ ] Static assets pakai context-path safe URL

Performance
[ ] Tidak ada DB/lazy loading saat render
[ ] Large table dipaginate
[ ] Static assets cacheable
[ ] View render latency terukur

Migration
[ ] Legacy JSP inventory tersedia
[ ] High-risk scriptlet pages diprioritaskan
[ ] View model diekstrak sebelum migrasi SPA/API
```

---

## 41. Minimal Clean JSP Example

Controller:

```java
@WebServlet("/orders/detail")
public class OrderDetailServlet extends HttpServlet {

    private OrderPageService orderPageService;

    @Override
    protected void doGet(HttpServletRequest request,
                         HttpServletResponse response)
            throws ServletException, IOException {

        String orderId = request.getParameter("id");

        OrderDetailPageModel model = orderPageService.loadForCurrentUser(
                request.getUserPrincipal(),
                orderId
        );

        request.setAttribute("model", model);
        request.getRequestDispatcher("/WEB-INF/views/orders/detail.jsp")
               .forward(request, response);
    }
}
```

JSP:

```jsp
<%@ page contentType="text/html; charset=UTF-8" pageEncoding="UTF-8" %>
<%@ page session="false" %>
<%@ taglib prefix="c" uri="jakarta.tags.core" %>

<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Order Detail</title>
</head>
<body>
  <h1>Order <c:out value="${model.orderNo}" /></h1>

  <p>Status: <c:out value="${model.statusLabel}" /></p>

  <h2>Documents</h2>
  <c:choose>
    <c:when test="${empty model.documents}">
      <p>No documents.</p>
    </c:when>
    <c:otherwise>
      <ul>
        <c:forEach var="doc" items="${model.documents}">
          <c:url var="downloadUrl" value="/documents/download">
            <c:param name="id" value="${doc.id}" />
          </c:url>
          <li>
            <a href="${downloadUrl}"><c:out value="${doc.fileName}" /></a>
          </li>
        </c:forEach>
      </ul>
    </c:otherwise>
  </c:choose>

  <c:if test="${model.canApprove}">
    <c:url var="approveUrl" value="/orders/approve" />
    <form method="post" action="${approveUrl}">
      <input type="hidden" name="csrf" value="${model.csrfToken}">
      <input type="hidden" name="id" value="${model.orderId}">
      <button type="submit">Approve</button>
    </form>
  </c:if>
</body>
</html>
```

Yang baik dari contoh ini:

- JSP berada di `WEB-INF`.
- controller menyiapkan model.
- JSP tidak query DB.
- JSP tidak menghitung business policy.
- output diescape.
- URL dibuat dengan `c:url`.
- session tidak dibuat otomatis.
- CSRF token disediakan dari server side.

---

## 42. Mental Model Akhir

JSP/Jakarta Pages harus dipahami sebagai:

```text
server-side template
  yang diterjemahkan menjadi servlet
  yang membaca request/view model
  lalu menulis response HTML
```

Bukan:

```text
tempat menulis Java bebas
tempat query database
policy engine
workflow engine
security layer utama
session storage engine
```

Kalimat paling penting:

```text
JSP yang sehat adalah view yang bodoh tapi aman.
Controller/service yang sehat adalah tempat keputusan dibuat.
```

Top-tier engineer dalam konteks JSP bukan orang yang paling banyak tahu tag. Top-tier engineer adalah orang yang bisa:

- membaca JSP legacy tanpa panik.
- menemukan boundary yang rusak.
- memisahkan rendering dari business logic.
- menutup XSS dan authorization bypass.
- mencegah session bloat.
- memigrasi `javax` ke `jakarta` secara sistematis.
- memindahkan JSP ke `WEB-INF` tanpa breaking route.
- menyiapkan view model yang bisa menjadi stepping stone ke API/SPA.
- menjaga production tetap stabil selama refactoring.

---

## 43. Ringkasan

Dalam part ini kita membahas:

- JSP/Jakarta Pages sebagai generated servlet.
- lifecycle JSP dari translation sampai destroy.
- directive, declaration, scriptlet, expression, action.
- implicit objects dan scopes.
- EL dan property resolution.
- JSTL core/format/functions.
- XSS dan context-sensitive escaping.
- Model 1 vs Model 2.
- alasan JSP sebaiknya di `WEB-INF`.
- tag files dan custom tag handler.
- buffering dan response commit.
- error handling JSP.
- dependency, packaging, precompilation.
- anti-pattern JSP legacy.
- refactoring dan migration path.
- production checklist.

Part ini sengaja tidak mengulang detail Servlet request/response/filter/session/security yang sudah dibahas di part sebelumnya. Fokusnya adalah bagaimana teknologi view legacy ini duduk di atas Servlet runtime dan bagaimana mengelolanya secara aman, maintainable, dan migration-friendly.

---

## 44. Status Seri

Seri belum selesai.

Part yang sudah selesai sampai titik ini:

```text
Part 000 — Orientation: Mental Model Server-Side Java Web Runtime
Part 001 — Evolution: Java EE javax.* ke Jakarta EE jakarta.*
Part 002 — HTTP Fundamentals for Servlet Engineers
Part 003 — Servlet Container Architecture
Part 004 — Servlet Lifecycle Deep Dive
Part 005 — Request Object Internals: HttpServletRequest
Part 006 — Response Object Internals: HttpServletResponse
Part 007 — Servlet Mapping, URL Pattern, and Dispatch Resolution
Part 008 — Request Dispatching: Forward, Include, Async, Error
Part 009 — Filters: Cross-Cutting Boundary Before Frameworks
Part 010 — Listeners: Observing Web Application Lifecycle
Part 011 — ServletContext and Application Scope
Part 012 — Session Management: HttpSession Deep Dive
Part 013 — Cookies, Headers, SameSite, and Browser Boundary
Part 014 — Async Servlet: Non-Blocking Request Lifecycle
Part 015 — Servlet Non-Blocking I/O
Part 016 — Multipart Upload, File Download, and Large Payload Handling
Part 017 — Error Handling and Failure Semantics in Servlet Apps
Part 018 — Threading Model: Classic Servlet, Platform Threads, Virtual Threads
Part 019 — Web Application Classloading, Deployment, and Redeployment
Part 020 — Packaging Models: WAR, Embedded Container, Executable JAR, Native-ish Deployments
Part 021 — WebSocket Protocol Fundamentals
Part 022 — Jakarta WebSocket Server Endpoint Model
Part 023 — WebSocket Session, Concurrency, and State Management
Part 024 — WebSocket Reliability Patterns
Part 025 — WebSocket Security Boundary
Part 026 — Server-Sent Events, Long Polling, and Streaming Alternatives
Part 027 — JSP, Jakarta Pages, Expression Language, JSTL: Legacy but Still Important
```

Part berikutnya:

```text
Part 028 — Container Configuration: Connectors, Thread Pools, Limits, Timeouts
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-java-servlet-websocket-web-container-runtime — Part 026](./learn-java-servlet-websocket-web-container-runtime-part-026.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-servlet-websocket-web-container-runtime-part-028](./learn-java-servlet-websocket-web-container-runtime-part-028.md)

</div>