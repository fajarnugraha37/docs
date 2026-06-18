# Part 3 — JSP Syntax Deep Dive: Directives, Declarations, Scriptlets, Expressions, Actions

> Seri: `learn-java-jakarta-pages-el-tags-faces-server-side-ui`  
> File: `03-jsp-syntax-directives-scriptlets-actions.md`  
> Fokus: memahami seluruh kategori sintaks Jakarta Pages/JSP, terutama perbedaan antara template text, directives, scripting elements, EL, standard actions, custom actions, dan XML syntax, lalu memakai pemahaman itu untuk membaca, memperbaiki, dan memigrasi legacy JSP secara aman.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya, kita membedah bahwa JSP/Jakarta Pages bukan runtime ajaib yang “langsung mengeksekusi HTML bercampur Java”, melainkan file template yang diterjemahkan menjadi servlet, dikompilasi, lalu dieksekusi dalam container.

Part ini turun satu level lebih konkret: **apa saja bentuk sintaks yang bisa muncul di dalam file JSP**, bagaimana container memaknainya, dan apa konsekuensinya terhadap desain, keamanan, testability, maintainability, dan migrasi.

Part ini penting karena banyak sistem enterprise lama masih memiliki JSP dengan campuran:

```jsp
<%@ page import="java.util.*" %>
<jsp:useBean id="user" class="com.example.User" scope="session" />
<%
    if (user.isAdmin()) {
%>
        <a href="/admin">Admin</a>
<%
    }
%>
```

Kode seperti ini mungkin “jalan”, tetapi sulit diuji, sulit diamankan, sulit diubah, dan sering menjadi sumber bug lifecycle. Engineer yang kuat tidak hanya berkata “scriptlet buruk”; ia bisa menjelaskan **mengapa buruk, di mana risikonya, bagaimana membaca generated servlet-nya, dan bagaimana memigrasinya bertahap tanpa merusak sistem produksi**.

---

## 1. Mental Model Utama: JSP Adalah Campuran Template Data dan Dynamic Elements

Secara konseptual, sebuah JSP terdiri dari dua kelompok besar:

1. **Template data**  
   Konten statis yang akan ditulis ke response, seperti HTML, XML, teks, whitespace, komentar HTML, CSS inline, JavaScript inline.

2. **Dynamic elements**  
   Bagian yang diproses oleh JSP engine untuk menghasilkan output dinamis atau mengubah perilaku translation/request. Termasuk:
   - directives,
   - scripting elements,
   - EL expressions,
   - standard actions,
   - custom actions.

Contoh:

```jsp
<!doctype html>
<html>
<head>
    <title>${pageTitle}</title>
</head>
<body>
    <h1>Hello, ${user.displayName}</h1>
</body>
</html>
```

Di sini:

- `<!doctype html>`, `<html>`, `<h1>` adalah template data.
- `${pageTitle}` dan `${user.displayName}` adalah dynamic elements berupa EL expressions.

JSP engine pada akhirnya menghasilkan servlet kira-kira seperti:

```java
out.write("<!doctype html>\n");
out.write("<html>\n");
out.write("<head>\n");
out.write("    <title>");
out.write(evaluate(pageTitle));
out.write("</title>\n");
// ...
```

Yang perlu ditanam kuat: **semua sintaks JSP harus bisa dijelaskan dalam kaitannya dengan generated servlet atau request-time evaluation**.

---

## 2. Kategori Sintaks JSP Secara Lengkap

Secara praktis, sintaks JSP dapat dikelompokkan seperti ini:

| Kategori | Contoh | Diproses Kapan | Fungsi Utama |
|---|---|---:|---|
| Template text | `<h1>Hello</h1>` | Request time | Ditulis ke response |
| Page directive | `<%@ page ... %>` | Translation time | Mengatur properti halaman JSP |
| Include directive | `<%@ include file="..." %>` | Translation time | Menyisipkan file secara statis |
| Taglib directive | `<%@ taglib prefix="c" uri="..." %>` | Translation time | Mendeklarasikan tag library |
| Declaration | `<%! private int x; %>` | Translation time menjadi member servlet | Menambah field/method/class member |
| Scriptlet | `<% ... %>` | Request time | Menjalankan statement Java dalam `_jspService()` |
| Expression | `<%= ... %>` | Request time | Mengevaluasi Java expression dan menulis hasilnya |
| EL expression | `${...}` / `#{...}` | Request/render time tergantung konteks | Binding/evaluasi expression |
| Standard action | `<jsp:include .../>` | Request time | Action bawaan JSP |
| Custom action/tag | `<c:forEach ...>` | Request time/tag lifecycle | Abstraksi logic view reusable |
| JSP comment | `<%-- ... --%>` | Translation time dihapus | Komentar tidak dikirim ke client |
| HTML comment | `<!-- ... -->` | Request output | Komentar dikirim ke client |
| JSP document/XML syntax | `<jsp:root ...>` | Translation/request sesuai elemen | Representasi JSP berbasis XML |

Kekuatan pemahaman JSP dimulai dari kemampuan membedakan **translation-time construct** dan **request-time construct**.

---

## 3. Translation Time vs Request Time

### 3.1 Translation Time

Translation time terjadi ketika JSP engine mengubah JSP menjadi servlet source/class. Elemen yang berpengaruh di sini mengubah bentuk servlet yang dihasilkan.

Contoh translation-time:

```jsp
<%@ page import="java.time.LocalDate" %>
<%@ include file="/WEB-INF/jsp/common/header.jspf" %>
<%! private static final String VERSION = "1.0"; %>
```

Dampak:

- directive `page` mengubah metadata generated servlet,
- directive `include` menyisipkan konten sebelum kompilasi,
- declaration menjadi field/method/member di servlet.

### 3.2 Request Time

Request time terjadi setiap ada HTTP request yang memanggil JSP servlet.

Contoh request-time:

```jsp
<%= request.getAttribute("message") %>
<jsp:include page="/WEB-INF/jsp/menu.jsp" />
<c:forEach var="item" items="${items}">
    ${item.name}
</c:forEach>
```

Dampak:

- expression menulis output,
- `jsp:include` menjalankan include dinamis,
- JSTL menjalankan tag handler,
- EL dievaluasi terhadap request/session/application/context.

### 3.3 Kenapa Perbedaan Ini Penting?

Karena banyak bug JSP berasal dari salah paham kapan sesuatu terjadi.

Contoh:

```jsp
<%@ include file="${dynamicHeader}" %>
```

Ini salah secara konsep. Include directive adalah translation-time. Ia butuh file statis yang diketahui saat JSP diterjemahkan. Untuk include dinamis, gunakan:

```jsp
<jsp:include page="${dynamicHeader}" />
```

Walaupun demikian, include dinamis yang path-nya berasal dari input user juga berbahaya bila tidak dibatasi.

---

## 4. Template Text: Bagian yang Terlihat Paling Sederhana Tapi Sering Berbahaya

Template text adalah konten statis yang ditulis ke response.

Contoh:

```jsp
<div class="page-title">User Profile</div>
```

Ini tampak sederhana, tetapi beberapa hal penting:

1. Whitespace di JSP biasanya ikut menjadi output.
2. HTML comment ikut dikirim ke client.
3. JavaScript inline yang berisi data server raw bisa menjadi XSS.
4. CSS inline yang menerima nilai dinamis butuh encoding sesuai context.
5. Template text bercampur scriptlet bisa menghasilkan struktur HTML yang sulit diverifikasi.

Contoh buruk:

```jsp
<script>
    const displayName = '${user.displayName}';
</script>
```

Walaupun `${user.displayName}` tampak aman, konteksnya adalah JavaScript string, bukan HTML text. Jika user memasukkan nilai seperti:

```text
'; alert(1); //
```

maka output JavaScript bisa pecah. Ini akan dibahas lebih dalam pada part security, tetapi sejak awal perlu dipahami: **escaping harus sesuai output context**.

---

## 5. Directives: Instruksi ke JSP Engine

Directive tidak menghasilkan output langsung. Directive memberi instruksi ke JSP translator.

Ada tiga directive utama:

1. `page`
2. `include`
3. `taglib`

Bentuk umum:

```jsp
<%@ directiveName attribute="value" %>
```

---

## 6. Page Directive

Page directive mengatur properti halaman JSP.

Contoh:

```jsp
<%@ page contentType="text/html; charset=UTF-8" pageEncoding="UTF-8" %>
<%@ page session="false" %>
<%@ page errorPage="/WEB-INF/jsp/error.jsp" %>
```

### 6.1 Attribute Penting Page Directive

#### `contentType`

Mengatur MIME type response dan charset response.

```jsp
<%@ page contentType="text/html; charset=UTF-8" %>
```

Gunakan ini untuk memastikan browser menafsirkan response dengan benar.

#### `pageEncoding`

Mengatur encoding file JSP itu sendiri.

```jsp
<%@ page pageEncoding="UTF-8" %>
```

`contentType` dan `pageEncoding` sering disamakan, padahal berbeda:

| Attribute | Mengatur | Dampak |
|---|---|---|
| `pageEncoding` | Cara container membaca file JSP | Source/template decoding |
| `contentType` charset | Cara client membaca response | Browser response decoding |

Rekomendasi modern:

```jsp
<%@ page pageEncoding="UTF-8" contentType="text/html; charset=UTF-8" %>
```

#### `import`

Menambahkan import Java ke generated servlet.

```jsp
<%@ page import="java.time.LocalDate" %>
<%@ page import="java.util.List, java.util.Map" %>
```

Masalahnya: semakin banyak import, semakin besar indikasi bahwa JSP mengandung logic yang seharusnya ada di controller/service/view model.

#### `session`

Menentukan apakah JSP otomatis memakai session.

```jsp
<%@ page session="false" %>
```

Default lama sering `true`. Ini berbahaya untuk halaman publik atau static-like, karena dapat membuat session tanpa sengaja.

Prinsip:

- Jika halaman tidak perlu session, set `session="false"`.
- Jangan biarkan JSP menciptakan session hanya karena implicit object `session` tersedia.

#### `buffer` dan `autoFlush`

Mengatur buffering output.

```jsp
<%@ page buffer="16kb" autoFlush="true" %>
```

Jika buffer penuh dan auto flush terjadi, response bisa committed. Setelah committed, operasi seperti redirect atau set header mungkin gagal.

Contoh masalah:

```jsp
<%
    out.write("large content...");
    response.sendRedirect("/login");
%>
```

Jika output sudah committed, redirect tidak bisa dilakukan dengan benar.

#### `errorPage` dan `isErrorPage`

Halaman biasa:

```jsp
<%@ page errorPage="/WEB-INF/jsp/error.jsp" %>
```

Halaman error:

```jsp
<%@ page isErrorPage="true" %>
```

Dengan `isErrorPage="true"`, implicit object `exception` tersedia.

Hati-hati: menampilkan exception detail ke user adalah information leakage.

#### `isELIgnored`

Mengatur apakah EL diabaikan.

```jsp
<%@ page isELIgnored="false" %>
```

Pada aplikasi modern, EL hampir selalu digunakan. Jika EL tiba-tiba tidak bekerja, cek attribute ini dan deployment descriptor.

#### `isThreadSafe`

Legacy attribute yang terkait model threading JSP.

```jsp
<%@ page isThreadSafe="true" %>
```

Jangan mengandalkan attribute ini untuk desain concurrency. JSP servlet secara normal melayani banyak request secara concurrent. Desain yang benar adalah tidak menyimpan request-specific mutable state di field servlet/JSP declaration.

### 6.2 Page Directive Sebagai Smell Detector

Page directive dapat dipakai sebagai indikator kualitas JSP.

Contoh smell:

```jsp
<%@ page import="java.sql.*" %>
<%@ page import="com.example.repository.UserRepository" %>
<%@ page import="com.example.security.PermissionService" %>
```

Ini memberi sinyal bahwa JSP terlalu banyak memegang application logic.

JSP yang sehat cenderung memiliki directive minimal:

```jsp
<%@ page pageEncoding="UTF-8" contentType="text/html; charset=UTF-8" session="false" %>
<%@ taglib prefix="c" uri="jakarta.tags.core" %>
<%@ taglib prefix="fmt" uri="jakarta.tags.fmt" %>
```

---

## 7. Include Directive: Static Inclusion

Include directive menyisipkan file lain saat translation.

```jsp
<%@ include file="/WEB-INF/jsp/common/header.jspf" %>
```

Secara mental model, ini seperti copy-paste source sebelum JSP dikompilasi.

### 7.1 Karakteristik Include Directive

| Karakteristik | Include Directive |
|---|---|
| Waktu proses | Translation time |
| File target | Harus relatif/statis |
| Output | Menjadi bagian dari JSP utama |
| Cocok untuk | Fragment statis, directive bersama, deklarasi taglib umum |
| Risiko | Duplicate variable, coupling, sulit dilacak |

### 7.2 `.jspf` Fragment

Konvensi umum: file fragment diberi ekstensi `.jspf`.

Contoh:

```text
/WEB-INF/jsp/common/taglibs.jspf
/WEB-INF/jsp/common/header.jspf
/WEB-INF/jsp/common/footer.jspf
```

`taglibs.jspf`:

```jsp
<%@ taglib prefix="c" uri="jakarta.tags.core" %>
<%@ taglib prefix="fmt" uri="jakarta.tags.fmt" %>
```

Digunakan:

```jsp
<%@ include file="/WEB-INF/jsp/common/taglibs.jspf" %>
```

### 7.3 Risiko Include Directive

Karena include directive bekerja seperti source-level inclusion, ia dapat menyebabkan:

1. Duplicate variable declaration.
2. Hidden dependency.
3. Directive conflict.
4. Import tersembunyi.
5. Sulit memahami generated servlet.

Contoh buruk:

```jsp
<%@ include file="/WEB-INF/jsp/common/init.jspf" %>
```

`init.jspf`:

```jsp
<%
    User currentUser = (User) session.getAttribute("currentUser");
    boolean isAdmin = currentUser.hasRole("ADMIN");
%>
```

File utama tiba-tiba bergantung pada variable `currentUser` dan `isAdmin` yang tidak terlihat secara eksplisit. Ini meningkatkan coupling.

---

## 8. Taglib Directive

Taglib directive mendeklarasikan tag library agar bisa dipakai di JSP.

Contoh modern Jakarta Tags:

```jsp
<%@ taglib prefix="c" uri="jakarta.tags.core" %>
<%@ taglib prefix="fmt" uri="jakarta.tags.fmt" %>
```

Contoh legacy JSTL:

```jsp
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>
```

Pada migrasi dari Java EE ke Jakarta EE, taglib URI dan dependency perlu diperiksa. Banyak aplikasi lama gagal bukan karena class import saja, tetapi karena TLD/taglib mapping tidak cocok dengan container/library yang dipakai.

### 8.1 Prefix Bukan Namespace Semantik

Prefix seperti `c`, `fmt`, `fn`, `sec`, `ui` hanyalah alias lokal di file JSP.

Contoh:

```jsp
<%@ taglib prefix="core" uri="jakarta.tags.core" %>

<core:if test="${user.active}">
    Active
</core:if>
```

Secara teknis bisa. Secara konvensi, tetap gunakan prefix umum:

```jsp
<c:if test="${user.active}">Active</c:if>
```

Karena readability dalam tim lebih penting daripada kreativitas prefix.

---

## 9. Scripting Elements: Java Di Dalam JSP

Scripting elements adalah fitur JSP legacy yang memungkinkan Java langsung ditulis di JSP.

Ada tiga bentuk utama:

1. Declaration: `<%! ... %>`
2. Scriptlet: `<% ... %>`
3. Expression: `<%= ... %>`

Walaupun masih perlu dipahami untuk maintenance, prinsip modern adalah: **hindari scripting elements untuk kode baru**.

---

## 10. Declaration `<%! ... %>`

Declaration menambahkan field, method, atau inner class ke generated servlet.

Contoh:

```jsp
<%!
    private int counter = 0;

    private String formatName(String name) {
        return name == null ? "-" : name.trim().toUpperCase();
    }
%>
```

Secara mental model, ini menjadi member class servlet:

```java
public final class profile_jsp extends HttpJspBase {
    private int counter = 0;

    private String formatName(String name) {
        return name == null ? "-" : name.trim().toUpperCase();
    }

    public void _jspService(...) {
        // request handling
    }
}
```

### 10.1 Bahaya Field Mutable Dalam Declaration

Contoh sangat buruk:

```jsp
<%!
    private int counter = 0;
%>

<%
    counter++;
%>

Total visits: <%= counter %>
```

Masalah:

1. JSP servlet instance melayani banyak request.
2. Field `counter` dishare antar request/thread.
3. `counter++` bukan operasi atomic.
4. Nilai bisa race condition.
5. Data bisa bocor antar user bila field menyimpan user-specific state.

Contoh fatal:

```jsp
<%!
    private User currentUser;
%>

<%
    currentUser = (User) session.getAttribute("currentUser");
%>

Hello <%= currentUser.getName() %>
```

Ini dapat menyebabkan request user A dan user B saling overwrite field yang sama.

Rule keras: **jangan pernah menaruh request-specific data di declaration field**.

### 10.2 Declaration Method: Apakah Selalu Buruk?

Method stateless lebih aman daripada field mutable:

```jsp
<%!
    private String safeDash(String value) {
        return value == null || value.isBlank() ? "-" : value;
    }
%>
```

Tetapi tetap tidak ideal, karena:

- sulit diuji,
- tersembunyi di view,
- sering berkembang menjadi business logic,
- tidak reusable antar layer dengan baik.

Lebih baik pindahkan ke:

- helper class,
- formatter service,
- custom tag,
- EL function,
- view model method sederhana.

---

## 11. Scriptlet `<% ... %>`

Scriptlet menaruh statement Java di dalam method `_jspService()`.

Contoh:

```jsp
<%
    String message = (String) request.getAttribute("message");
    if (message != null) {
%>
        <div class="alert"><%= message %></div>
<%
    }
%>
```

Secara generated servlet kira-kira:

```java
String message = (String) request.getAttribute("message");
if (message != null) {
    out.write("<div class=\"alert\">");
    out.print(message);
    out.write("</div>");
}
```

### 11.1 Scriptlet Membuat Struktur Kontrol Tersebar

Contoh:

```jsp
<% if (user.isAdmin()) { %>
    <a href="/admin">Admin</a>
<% } else { %>
    <span>No admin access</span>
<% } %>
```

Masalah:

- HTML structure bergantung pada Java block yang terpecah.
- Editor/formatter sulit memahami nesting.
- Missing brace bisa menghasilkan error generated servlet yang tidak intuitif.
- Security dan escaping sering lupa.

### 11.2 Refactor Scriptlet ke JSTL/EL

Scriptlet:

```jsp
<% if (user.isAdmin()) { %>
    <a href="/admin">Admin</a>
<% } %>
```

JSTL:

```jsp
<c:if test="${user.admin}">
    <a href="/admin">Admin</a>
</c:if>
```

Lebih baik lagi, controller menyiapkan view model:

```java
request.setAttribute("showAdminMenu", permissionService.canAccessAdmin(currentUser));
```

JSP:

```jsp
<c:if test="${showAdminMenu}">
    <a href="/admin">Admin</a>
</c:if>
```

Ini lebih baik karena JSP tidak perlu tahu struktur role/permission internal.

### 11.3 Scriptlet Untuk Loop

Legacy:

```jsp
<%
    List<User> users = (List<User>) request.getAttribute("users");
    for (User user : users) {
%>
    <tr>
        <td><%= user.getName() %></td>
        <td><%= user.getEmail() %></td>
    </tr>
<%
    }
%>
```

JSTL:

```jsp
<c:forEach var="user" items="${users}">
    <tr>
        <td><c:out value="${user.name}" /></td>
        <td><c:out value="${user.email}" /></td>
    </tr>
</c:forEach>
```

Namun jangan berhenti di JSTL. View model tetap harus dipersiapkan di controller/service.

Buruk:

```jsp
<c:forEach var="order" items="${customer.orders}">
    <c:forEach var="line" items="${order.lines}">
        ...
    </c:forEach>
</c:forEach>
```

Jika `customer.orders` lazy-loaded dari JPA, JSP bisa memicu N+1 query atau `LazyInitializationException`. Controller harus menyiapkan DTO/projection yang sudah siap render.

---

## 12. Expression `<%= ... %>`

Expression mengevaluasi Java expression dan menulis hasilnya ke output.

Contoh:

```jsp
Hello, <%= user.getName() %>
```

Kira-kira menjadi:

```java
out.print(user.getName());
```

### 12.1 Expression Tidak Otomatis Aman Dari XSS

Jika `user.getName()` berisi:

```html
<script>alert(1)</script>
```

maka expression raw dapat menulis script ke HTML.

Buruk:

```jsp
<td><%= user.getName() %></td>
```

Lebih baik:

```jsp
<td><c:out value="${user.name}" /></td>
```

Namun sekali lagi, `c:out` terutama aman untuk HTML text context. Untuk JavaScript, URL, CSS, dan HTML attribute tertentu, butuh encoding sesuai context.

### 12.2 Expression vs EL

Java expression:

```jsp
<%= user.getDisplayName() %>
```

EL:

```jsp
${user.displayName}
```

Perbedaan utama:

| Aspek | JSP Expression | EL |
|---|---|---|
| Bahasa | Java | Expression language |
| Null handling | Bisa NPE | Lebih toleran tergantung resolver |
| Output escaping | Tidak otomatis | Tergantung tag/component/context |
| Coupling | Kuat ke Java API | Lebih deklaratif |
| Testability | Rendah | Lebih mudah dipisah dengan view model |
| Modern usage | Legacy | Preferred untuk JSP modern |

---

## 13. JSP Comments vs HTML Comments

### 13.1 JSP Comment

```jsp
<%-- This comment is removed before response --%>
```

Tidak dikirim ke browser.

Gunakan untuk komentar internal yang tidak boleh terlihat client.

### 13.2 HTML Comment

```html
<!-- This comment is sent to browser -->
```

Dikirim ke client.

Jangan menaruh informasi internal:

```html
<!-- TODO: disable admin button until ACEAS-123 fixed -->
<!-- API key: ... -->
<!-- hidden endpoint: /internal/reprocess -->
```

HTML comment adalah bagian dari response dan bisa dibaca user.

---

## 14. EL Expression Dalam JSP

EL akan dibahas sangat detail di part 5 dan 6. Di sini kita cukup memahami posisinya dalam sintaks JSP.

Contoh:

```jsp
${user.displayName}
${empty items}
${order.total > 1000000}
${requestScope.message}
```

EL membuat JSP lebih deklaratif, tetapi bukan berarti semua logic boleh dipindah ke EL.

Buruk:

```jsp
${user.role == 'ADMIN' || user.role == 'SUPERVISOR' || user.department.code == 'ENF'}
```

Lebih baik:

```jsp
${canApproveCase}
```

Dengan controller/backing service:

```java
boolean canApproveCase = authorizationService.canApproveCase(currentUser, caseId);
request.setAttribute("canApproveCase", canApproveCase);
```

EL yang baik biasanya membaca **view-ready property**, bukan menghitung business decision kompleks.

---

## 15. Standard Actions: Action Bawaan JSP

Standard actions memakai XML-like syntax dengan prefix `jsp`.

Contoh:

```jsp
<jsp:include page="/WEB-INF/jsp/common/menu.jsp" />
```

Standard actions diproses pada request time dan memberi abstraksi tertentu tanpa scriptlet.

Standard actions penting:

1. `jsp:include`
2. `jsp:forward`
3. `jsp:param`
4. `jsp:useBean`
5. `jsp:setProperty`
6. `jsp:getProperty`
7. `jsp:plugin` legacy
8. `jsp:element`, `jsp:attribute`, `jsp:body`, `jsp:text` untuk XML/dynamic element use case tertentu

---

## 16. `jsp:include`: Dynamic Include

`jsp:include` menyertakan output dari resource lain saat request time.

```jsp
<jsp:include page="/WEB-INF/jsp/common/menu.jsp" />
```

Dengan parameter:

```jsp
<jsp:include page="/WEB-INF/jsp/common/card.jsp">
    <jsp:param name="title" value="Recent Cases" />
</jsp:include>
```

Resource yang di-include menerima request yang sama dengan additional parameter.

### 16.1 Include Directive vs `jsp:include`

| Aspek | Include Directive | `jsp:include` |
|---|---|---|
| Syntax | `<%@ include file="..." %>` | `<jsp:include page="..." />` |
| Waktu | Translation time | Request time |
| Model | Source inclusion | Runtime dispatch/include |
| Cocok untuk | Fragment statis | Fragment dinamis |
| Bisa pakai parameter runtime | Tidak | Ya |
| Dampak compile | File digabung ke servlet utama | Resource bisa punya lifecycle sendiri |

### 16.2 Kapan Memakai `jsp:include`?

Gunakan untuk:

- menu yang datanya dinamis,
- widget berdasarkan request,
- fragment yang bisa dipakai ulang dengan parameter,
- output yang perlu dievaluasi sendiri.

Jangan gunakan untuk:

- include path dari input user tanpa whitelist,
- flow control kompleks,
- menggantikan layout engine yang jelas.

---

## 17. `jsp:forward`: Server-Side Forward

`jsp:forward` meneruskan request ke resource lain.

```jsp
<jsp:forward page="/WEB-INF/jsp/login.jsp" />
```

Dengan parameter:

```jsp
<jsp:forward page="/WEB-INF/jsp/search.jsp">
    <jsp:param name="source" value="dashboard" />
</jsp:forward>
```

### 17.1 Risiko `jsp:forward` Dalam View

Secara arsitektur, forward biasanya tanggung jawab controller/servlet/filter, bukan JSP.

Buruk:

```jsp
<c:if test="${not authenticated}">
    <jsp:forward page="/login" />
</c:if>
```

Masalah:

- authorization flow tersembunyi di view,
- sulit diuji,
- response mungkin sudah partially written,
- behaviour tergantung buffer/commit.

Lebih baik:

- filter/security layer menangani authentication,
- controller menentukan forward/redirect,
- JSP hanya render view yang sudah dipilih.

---

## 18. `jsp:param`

`jsp:param` dipakai sebagai child dari action seperti `jsp:include`, `jsp:forward`, atau `jsp:plugin`.

Contoh:

```jsp
<jsp:include page="/WEB-INF/jsp/common/breadcrumb.jsp">
    <jsp:param name="current" value="Case Detail" />
</jsp:include>
```

Perhatikan bahwa parameter masuk sebagai request parameter, bukan typed object. Untuk data kompleks, lebih baik gunakan request attribute/view model.

Buruk:

```jsp
<jsp:param name="caseJson" value="${caseViewModelAsJson}" />
```

Lebih baik:

```java
request.setAttribute("caseView", caseView);
```

---

## 19. `jsp:useBean`: Legacy JavaBean Instantiation/Lookup

`jsp:useBean` mencari object di scope tertentu, dan jika tidak ada, bisa membuat instance baru.

Contoh:

```jsp
<jsp:useBean id="user" class="com.example.User" scope="request" />
```

Makna kasar:

1. Cek attribute bernama `user` di request scope.
2. Jika ada, pakai object itu.
3. Jika tidak ada, buat `new com.example.User()`.
4. Simpan ke request scope.

### 19.1 Scope `jsp:useBean`

```jsp
<jsp:useBean id="cart" class="com.example.Cart" scope="session" />
```

Scope bisa:

- `page`,
- `request`,
- `session`,
- `application`.

### 19.2 Kenapa `jsp:useBean` Banyak Ditinggalkan?

Karena ia mencampur view dengan object lifecycle.

Masalah:

1. JSP bisa membuat domain object sendiri.
2. Dependency injection tidak natural.
3. Constructor harus no-arg.
4. Business initialization tersebar di view.
5. Testing dan debugging sulit.
6. Bisa menciptakan session/application state tanpa kontrol.

Contoh buruk:

```jsp
<jsp:useBean id="caseService" class="com.example.CaseService" scope="application" />
```

Ini membuat service secara manual dari JSP, tanpa DI, tanpa transaction boundary, tanpa lifecycle container yang benar.

### 19.3 Kapan Masih Perlu Memahami `jsp:useBean`?

Untuk membaca sistem lama, terutama pola MVC lama:

```jsp
<jsp:useBean id="user" class="com.example.UserBean" scope="request" />
<jsp:setProperty name="user" property="*" />
```

Pola ini sering dipakai untuk binding form request ke JavaBean. Modern approach lebih baik memakai controller/framework binding, validation, DTO, dan explicit mapping.

---

## 20. `jsp:setProperty` dan `jsp:getProperty`

### 20.1 `jsp:setProperty`

Mengatur property JavaBean.

```jsp
<jsp:setProperty name="user" property="name" value="Fajar" />
```

Dari request parameter:

```jsp
<jsp:setProperty name="user" property="name" param="name" />
```

Mass assignment:

```jsp
<jsp:setProperty name="user" property="*" />
```

### 20.2 Bahaya `property="*"`

`property="*"` mencoba mencocokkan request parameter dengan property bean.

Contoh form:

```html
<input name="name" />
<input name="email" />
```

Bean:

```java
public class UserBean {
    private String name;
    private String email;
    private boolean admin;
}
```

Jika attacker mengirim:

```text
name=Bob&email=bob@example.com&admin=true
```

maka property yang tidak ada di form pun bisa saja ikut terisi bila setter tersedia.

Ini mirip mass assignment vulnerability.

Prinsip modern:

- Jangan bind request parameter langsung ke domain object.
- Gunakan form DTO eksplisit.
- Allowlist field.
- Validasi input.
- Jangan expose setter sensitif.

### 20.3 `jsp:getProperty`

Menulis property bean ke output.

```jsp
<jsp:getProperty name="user" property="name" />
```

Ini legacy. Lebih umum pakai EL/JSTL:

```jsp
<c:out value="${user.name}" />
```

---

## 21. XML Syntax / JSP Document

JSP juga dapat ditulis dalam XML syntax, sering disebut JSP document.

Contoh:

```xml
<jsp:root xmlns:jsp="http://java.sun.com/JSP/Page" version="2.0">
    <jsp:directive.page contentType="text/html; charset=UTF-8" />
    <html>
        <body>
            <jsp:text>Hello</jsp:text>
        </body>
    </html>
</jsp:root>
```

Dalam versi Jakarta modern, namespace dan versi mengikuti spesifikasi/container yang relevan. Namun secara konsep, JSP document adalah representasi XML dari JSP.

### 21.1 Keunggulan XML Syntax

1. Well-formed XML.
2. Lebih cocok untuk tool XML.
3. Struktur lebih ketat.
4. Bisa menghindari beberapa ambiguity sintaks klasik.

### 21.2 Kekurangan XML Syntax

1. Verbose.
2. Kurang umum di banyak enterprise legacy.
3. Developer terbiasa dengan JSP syntax klasik.
4. HTML tidak selalu nyaman ditulis sebagai XML strict.

### 21.3 Jangan Samakan Dengan Facelets

Facelets di Jakarta Faces juga memakai XHTML-like syntax, tetapi bukan JSP document. Facelets adalah view declaration language untuk Faces component tree. JSP document tetap bagian dari JSP/Jakarta Pages.

---

## 22. Contoh Evolusi Kode: Dari Scriptlet ke View Model + JSTL

### 22.1 Legacy JSP

```jsp
<%@ page import="java.util.*, com.example.Case" %>
<%
    List<Case> cases = (List<Case>) request.getAttribute("cases");
    String role = (String) session.getAttribute("role");
%>

<table>
<%
    for (Case c : cases) {
        if ("ENFORCEMENT".equals(c.getType()) || "ADMIN".equals(role)) {
%>
    <tr>
        <td><%= c.getReferenceNo() %></td>
        <td><%= c.getStatus() %></td>
        <td>
            <% if ("ADMIN".equals(role)) { %>
                <a href="/case/delete?id=<%= c.getId() %>">Delete</a>
            <% } %>
        </td>
    </tr>
<%
        }
    }
%>
</table>
```

Masalah:

1. JSP tahu role rule.
2. JSP tahu filtering rule.
3. JSP tahu domain object.
4. URL dibuat manual.
5. Output tidak escaped dengan benar.
6. Delete action via link raw GET berbahaya.
7. Session diakses langsung.

### 22.2 Refactor Langkah 1: Controller Menyiapkan View Model

```java
List<CaseRowView> rows = caseQueryService.findVisibleCaseRows(currentUser);
request.setAttribute("caseRows", rows);
```

`CaseRowView`:

```java
public record CaseRowView(
        String referenceNo,
        String statusLabel,
        String detailUrl,
        boolean canDelete
) {}
```

### 22.3 JSP Setelah Refactor

```jsp
<%@ page pageEncoding="UTF-8" contentType="text/html; charset=UTF-8" session="false" %>
<%@ taglib prefix="c" uri="jakarta.tags.core" %>

<table>
    <c:forEach var="row" items="${caseRows}">
        <tr>
            <td><c:out value="${row.referenceNo}" /></td>
            <td><c:out value="${row.statusLabel}" /></td>
            <td>
                <a href="${row.detailUrl}">View</a>
                <c:if test="${row.canDelete}">
                    <form method="post" action="${row.deleteUrl}">
                        <input type="hidden" name="csrf" value="${csrfToken}" />
                        <button type="submit">Delete</button>
                    </form>
                </c:if>
            </td>
        </tr>
    </c:forEach>
</table>
```

Masih ada hal yang perlu diperbaiki, misalnya URL encoding dan context-aware escaping, tetapi struktur tanggung jawab jauh lebih sehat.

---

## 23. Anti-Pattern Sintaks JSP yang Harus Dikenali Cepat

### 23.1 Business Logic Dalam Scriptlet

```jsp
<%
    BigDecimal fine = violation.getBaseFine().multiply(new BigDecimal("1.25"));
    if (caseAge > 30 && offender.hasPriorViolation()) {
        fine = fine.multiply(new BigDecimal("1.5"));
    }
%>
```

Seharusnya di domain/service layer.

### 23.2 Query Database Dari JSP

```jsp
<%@ page import="java.sql.*" %>
<%
    Connection conn = DriverManager.getConnection(...);
    ResultSet rs = conn.createStatement().executeQuery("select * from users");
%>
```

Ini melanggar layering, transaction handling, pooling, security, dan testability.

### 23.3 Session Sebagai Global Scratchpad

```jsp
<%
    session.setAttribute("selectedCase", caseObj);
%>
```

Bisa menyebabkan stale state, memory bloat, dan tab concurrency bug.

### 23.4 Flow Control di JSP

```jsp
<%
    if (!loggedIn) {
        response.sendRedirect("/login");
        return;
    }
%>
```

Authentication/authorization harus di filter/security/controller.

### 23.5 Manual HTML Construction Dalam Java

```jsp
<%
    out.println("<td>" + userInput + "</td>");
%>
```

Raw output dan XSS risk.

### 23.6 Complex EL

```jsp
${case.status == 'OPEN' and user.role == 'SUPERVISOR' and case.owner.department.id == user.department.id and not empty case.actions}
```

Seharusnya menjadi:

```jsp
${caseRow.canShowSupervisorActions}
```

---

## 24. Syntax-Level Security Review Checklist

Saat review JSP, lihat cepat hal-hal ini:

1. Ada `<%` atau `<%=`?  
   Prioritas refactor atau audit escaping.

2. Ada `<%!`?  
   Cek field mutable dan shared state.

3. Ada `page import="java.sql`?  
   Hampir pasti layering violation.

4. Ada `property="*"`?  
   Cek mass assignment.

5. Ada output user input via `<%=`?  
   Cek XSS.

6. Ada `${...}` di dalam `<script>`?  
   Cek JavaScript encoding.

7. Ada `${...}` di URL?  
   Cek URL encoding dan open redirect.

8. Ada hidden input berisi object-sensitive data?  
   Cek tampering dan exposure.

9. Ada `jsp:forward` atau `response.sendRedirect` di JSP?  
   Cek flow ownership.

10. Ada include path dinamis?  
    Cek path traversal dan whitelist.

11. Ada direct session access?  
    Cek state boundary.

12. Ada HTML comment berisi internal notes?  
    Cek information leakage.

---

## 25. Syntax-Level Maintainability Review Checklist

1. Apakah JSP bisa dibaca sebagai template, bukan program Java?
2. Apakah semua branching view sederhana?
3. Apakah nested `c:if`/`c:choose` masih masuk akal?
4. Apakah controller sudah menyiapkan view model?
5. Apakah JSP bebas dari service/repository/domain computation?
6. Apakah taglib directive konsisten?
7. Apakah include digunakan dengan jelas?
8. Apakah JSP fragment punya kontrak input eksplisit?
9. Apakah ada variable tersembunyi dari included `.jspf`?
10. Apakah form binding eksplisit dan aman?
11. Apakah URL dibentuk dengan mekanisme yang benar?
12. Apakah output encoding sesuai context?

---

## 26. Decision Matrix: Pilih Sintaks Apa?

| Kebutuhan | Pilihan Lebih Baik | Hindari |
|---|---|---|
| Tampilkan property sederhana | EL + `c:out` | `<%=` raw |
| Conditional rendering sederhana | `c:if` / `c:choose` | scriptlet `if` |
| Loop list untuk table | `c:forEach` | scriptlet `for` |
| Format tanggal/angka | `fmt:*` atau preformatted view model | scriptlet formatter |
| Reusable UI fragment statis | include directive/tag file | copy-paste |
| Reusable UI fragment dinamis | `jsp:include`, custom tag, tag file | scriptlet include logic |
| Business decision | service/controller/view model | EL kompleks/scriptlet |
| Object construction | controller/DI | `jsp:useBean` untuk service/domain |
| Request parameter binding | controller/form DTO | `jsp:setProperty property="*"` |
| Redirect/forward flow | controller/filter | `jsp:forward` dalam view |

---

## 27. Reading Legacy JSP: Prosedur Bedah Aman

Saat mendapatkan JSP legacy besar, jangan langsung refactor. Baca dengan urutan ini:

### Langkah 1 — Identifikasi Directive

Cari:

```jsp
<%@ page ... %>
<%@ include ... %>
<%@ taglib ... %>
```

Catat:

- import apa saja,
- apakah session digunakan,
- encoding,
- error page,
- tag library,
- include statis.

### Langkah 2 — Identifikasi Scripting Elements

Cari semua:

```text
<%!
<%
<%=
```

Klasifikasi:

- declaration field/method,
- request data preparation,
- branching,
- loop,
- DB/service access,
- output raw.

### Langkah 3 — Identifikasi Input dan Output

Input ke JSP berasal dari:

- request attribute,
- request parameter,
- session attribute,
- application attribute,
- bean created via `jsp:useBean`,
- included fragment variable.

Output dari JSP:

- HTML text,
- HTML attribute,
- URL,
- JavaScript,
- CSS,
- hidden input,
- comments.

### Langkah 4 — Gambar Boundary

Tentukan siapa yang seharusnya bertanggung jawab:

| Logic | Seharusnya di |
|---|---|
| Authentication | filter/security layer |
| Authorization decision | security/service/controller |
| Data retrieval | service/repository |
| Data shaping | controller/query service/view model mapper |
| Rendering loop sederhana | JSP/tag |
| Formatting UI | tag/fmt/view model |
| Escaping | view/tag/component sesuai context |

### Langkah 5 — Refactor Bertahap

Urutan aman:

1. Tambahkan test/golden output untuk path utama.
2. Pindahkan DB/service call ke controller.
3. Pindahkan business decision ke view model boolean.
4. Ganti `<%=` raw dengan `c:out` atau encoder sesuai context.
5. Ganti loop/if scriptlet dengan JSTL.
6. Hapus declaration mutable.
7. Pecah repeated fragment menjadi tag file/custom tag.
8. Rapikan session usage.
9. Tambahkan security regression test.

---

## 28. JSP Syntax dan Java 8–25: Apa yang Berubah Secara Praktis?

Sintaks inti JSP relatif stabil. Yang berubah besar bukan bentuk `<% ... %>`, tetapi ekosistem sekelilingnya:

1. Namespace API:
   - Java EE/Jakarta EE 8: `javax.servlet.jsp.*`
   - Jakarta EE 9+: `jakarta.servlet.jsp.*`

2. Container compatibility:
   - Tomcat 9 untuk Java EE/Jakarta EE 8 style `javax.*`.
   - Tomcat 10+ untuk Jakarta namespace.
   - Jakarta EE 11 compatible runtime perlu baseline modern.

3. Java language features:
   - Java 8 lambda/streams sebaiknya tidak ditulis di JSP.
   - Java 16+ records cocok sebagai immutable view model.
   - Java 17+ baseline Jakarta EE 11.
   - Java 21/25 modern runtime tidak berarti JSP boleh berisi logic kompleks.

4. Security expectations lebih tinggi:
   - CSP,
   - SameSite cookies,
   - stricter encoding,
   - supply chain hygiene,
   - no SecurityManager assumption.

5. Migration pressure:
   - `javax.*` ke `jakarta.*`,
   - taglib URI,
   - dependency coordinates,
   - container version,
   - third-party tag libraries.

### 28.1 Java Records Sebagai View Model

Java modern memungkinkan view model ringkas:

```java
public record UserRowView(
        String displayName,
        String email,
        boolean locked,
        String detailUrl
) {}
```

JSP:

```jsp
<c:forEach var="user" items="${users}">
    <tr>
        <td><c:out value="${user.displayName}" /></td>
        <td><c:out value="${user.email}" /></td>
        <td><c:out value="${user.locked ? 'Locked' : 'Active'}" /></td>
        <td><a href="${user.detailUrl}">View</a></td>
    </tr>
</c:forEach>
```

Records membantu membuat data render immutable dan eksplisit. Tetapi jangan isi record dengan entity lazy-loaded atau service reference.

---

## 29. Prinsip Desain JSP Modern

Prinsip ringkas:

```text
Controller prepares.
Service decides.
View model carries.
JSP renders.
Tags abstract repetition.
EL reads.
Encoding protects.
Session is deliberate.
```

### 29.1 Controller Prepares

Controller menyiapkan semua data yang dibutuhkan view.

Buruk:

```jsp
<%
    List<Case> cases = caseService.findCases();
%>
```

Baik:

```java
request.setAttribute("caseRows", casePageService.getCaseRows(currentUser, filter));
```

### 29.2 Service Decides

Business rule jangan dihitung di JSP.

Buruk:

```jsp
<c:if test="${case.status == 'DRAFT' and user.role == 'OFFICER'}">
```

Baik:

```jsp
<c:if test="${caseRow.canSubmit}">
```

### 29.3 View Model Carries

View model harus membawa bentuk data yang siap render.

```java
public record CaseRowView(
        String referenceNo,
        String applicantName,
        String statusLabel,
        boolean canSubmit,
        boolean canWithdraw
) {}
```

### 29.4 JSP Renders

JSP fokus pada struktur output.

```jsp
<c:forEach var="row" items="${caseRows}">
    <tr>
        <td><c:out value="${row.referenceNo}" /></td>
        <td><c:out value="${row.applicantName}" /></td>
        <td><c:out value="${row.statusLabel}" /></td>
    </tr>
</c:forEach>
```

### 29.5 Tags Abstract Repetition

Jika pola markup berulang, buat tag file/custom tag.

```jsp
<app:statusBadge value="${row.status}" />
<app:pagination page="${page}" />
<app:formErrors errors="${errors}" />
```

### 29.6 EL Reads

EL sebaiknya membaca property sederhana.

Baik:

```jsp
${row.statusLabel}
${row.canApprove}
${page.totalPages}
```

Buruk:

```jsp
${row.case.status.code == 'OPEN' and row.assignment.assignee.id == currentUser.id}
```

### 29.7 Encoding Protects

Jangan mengandalkan “data sudah aman”. Output tetap perlu encoding sesuai context.

### 29.8 Session Is Deliberate

Session harus explicit design decision, bukan efek samping JSP.

---

## 30. Mini Case Study: Regulatory Case Detail JSP

Misal kita punya halaman detail case enforcement.

### 30.1 Data yang Dibutuhkan View

- Case reference number.
- Status label.
- Applicant/respondent summary.
- Assigned officer.
- Available actions.
- Timeline events.
- Documents.
- Audit summary.
- CSRF token.

### 30.2 View Model

```java
public record CaseDetailView(
        String referenceNo,
        String statusLabel,
        String respondentName,
        String assignedOfficerName,
        List<ActionView> actions,
        List<TimelineEventView> timeline,
        List<DocumentView> documents,
        String csrfToken
) {}

public record ActionView(
        String code,
        String label,
        String postUrl,
        boolean dangerous
) {}
```

### 30.3 JSP Rendering

```jsp
<%@ page pageEncoding="UTF-8" contentType="text/html; charset=UTF-8" session="false" %>
<%@ taglib prefix="c" uri="jakarta.tags.core" %>

<section class="case-header">
    <h1>Case <c:out value="${caseDetail.referenceNo}" /></h1>
    <span class="status"><c:out value="${caseDetail.statusLabel}" /></span>
</section>

<section class="case-summary">
    <dl>
        <dt>Respondent</dt>
        <dd><c:out value="${caseDetail.respondentName}" /></dd>

        <dt>Assigned Officer</dt>
        <dd><c:out value="${caseDetail.assignedOfficerName}" /></dd>
    </dl>
</section>

<section class="case-actions">
    <c:forEach var="action" items="${caseDetail.actions}">
        <form method="post" action="${action.postUrl}">
            <input type="hidden" name="csrf" value="${caseDetail.csrfToken}" />
            <button type="submit">
                <c:out value="${action.label}" />
            </button>
        </form>
    </c:forEach>
</section>
```

### 30.4 Apa yang Tidak Dilakukan JSP Ini?

Ia tidak:

- query database,
- cek role mentah,
- menghitung status transition,
- membuat service,
- membaca entity lazy-loaded,
- menyimpan state ke session,
- redirect manual,
- output raw user input.

Itulah bentuk JSP yang lebih defensible.

---

## 31. Generated Servlet Mental Mapping Untuk Sintaks

Agar kuat saat debugging, hafalkan mapping kasar ini:

| JSP Syntax | Generated Servlet Effect |
|---|---|
| HTML text | `out.write("...")` |
| `<%@ page import="x" %>` | `import x;` di generated source |
| `<%@ include file="x.jspf" %>` | Source `x.jspf` disisipkan sebelum compile |
| `<%! field/method %>` | Member field/method generated servlet |
| `<% statement %>` | Statement di `_jspService()` |
| `<%= expr %>` | `out.print(expr)` |
| `${expr}` | EL evaluation lalu output/attribute tergantung konteks |
| `<jsp:include>` | Runtime include via request dispatcher/container |
| `<jsp:forward>` | Runtime forward |
| `<c:forEach>` | Tag handler lifecycle |
| `<app:custom>` | Custom tag handler/tag file lifecycle |

Saat error JSP muncul di generated servlet line number, mapping ini membantu mencari sumber aslinya.

---

## 32. Refactoring Recipe: Menghapus Scriptlet Dengan Aman

### 32.1 Pattern: Output Raw

Sebelum:

```jsp
<%= user.getName() %>
```

Sesudah:

```jsp
<c:out value="${user.name}" />
```

Tambahkan test XSS untuk nama user.

### 32.2 Pattern: Conditional

Sebelum:

```jsp
<% if (showWarning) { %>
    <div>Warning</div>
<% } %>
```

Sesudah:

```jsp
<c:if test="${showWarning}">
    <div>Warning</div>
</c:if>
```

### 32.3 Pattern: Loop

Sebelum:

```jsp
<% for (Item item : items) { %>
    <li><%= item.getName() %></li>
<% } %>
```

Sesudah:

```jsp
<c:forEach var="item" items="${items}">
    <li><c:out value="${item.name}" /></li>
</c:forEach>
```

### 32.4 Pattern: Business Rule

Sebelum:

```jsp
<c:if test="${case.status == 'PENDING_REVIEW' and user.role == 'REVIEWER'}">
```

Sesudah:

```jsp
<c:if test="${caseView.canReview}">
```

Rule dipindahkan ke service/view model assembler.

### 32.5 Pattern: Form Binding Legacy

Sebelum:

```jsp
<jsp:useBean id="form" class="com.example.UserForm" scope="request" />
<jsp:setProperty name="form" property="*" />
```

Sesudah:

```java
UserForm form = UserForm.from(request);
ValidationResult result = userFormValidator.validate(form);
request.setAttribute("form", form);
request.setAttribute("errors", result.errors());
```

JSP hanya render:

```jsp
<input name="email" value="${form.email}" />
```

Dengan encoding sesuai attribute context.

---

## 33. Practical Debugging Tips

### 33.1 Jika JSP Compilation Error

Cek:

1. Apakah scriptlet brace seimbang?
2. Apakah import hilang?
3. Apakah declaration method valid di class level?
4. Apakah included fragment membuat duplicate variable?
5. Apakah taglib URI benar?
6. Apakah dependency tag library tersedia?
7. Apakah Java version compile sesuai container?

### 33.2 Jika EL Tidak Keluar

Cek:

1. `isELIgnored`.
2. Deployment descriptor setting.
3. Apakah file dianggap template biasa, bukan JSP?
4. Apakah syntax `${...}` berada di tempat yang dievaluasi?
5. Apakah attribute tersedia di scope yang benar?

### 33.3 Jika Redirect/Forward Gagal

Cek:

1. Apakah response sudah committed?
2. Apakah buffer sudah flush?
3. Apakah JSP sudah menulis output sebelum redirect?
4. Apakah ada include yang menulis response?

### 33.4 Jika Data User A Muncul di User B

Cek:

1. Declaration field mutable.
2. Static field di helper/tag handler.
3. Application scope mutable object.
4. Session reuse bug.
5. Cache key salah.

### 33.5 Jika View Lambat

Cek:

1. Loop besar di JSP.
2. EL memicu lazy loading.
3. Custom tag berat.
4. Include dinamis terlalu banyak.
5. Formatter dibuat berulang.
6. Large response payload.

---

## 34. Exercise: Audit JSP Berikut

Kode:

```jsp
<%@ page import="java.sql.*, java.util.*" %>
<%@ page session="true" %>
<jsp:useBean id="user" class="com.example.User" scope="session" />
<jsp:setProperty name="user" property="*" />

<%
    Connection c = DriverManager.getConnection("jdbc:oracle:thin:@...", "app", "secret");
    ResultSet rs = c.createStatement().executeQuery("select * from CASES where owner='" + request.getParameter("owner") + "'");
%>

<h1>Welcome <%= user.getName() %></h1>

<table>
<% while (rs.next()) { %>
    <tr>
        <td><%= rs.getString("REF_NO") %></td>
        <td><a href="/delete?id=<%= rs.getLong("ID") %>">Delete</a></td>
    </tr>
<% } %>
</table>
```

Temuan minimal:

1. DB access di JSP.
2. Hardcoded credential.
3. SQL injection.
4. Resource leak: connection/resultset tidak ditutup.
5. Session dipakai tanpa alasan jelas.
6. `jsp:useBean` membuat user di session.
7. `jsp:setProperty property="*"` mass assignment.
8. Raw output `user.getName()` XSS.
9. Raw output DB data XSS.
10. Delete via GET.
11. Tidak ada CSRF.
12. Tidak ada authorization check yang benar.
13. JSP menjadi controller + repository + view.
14. Tidak testable.

Refactor arah besar:

- Controller menerima request.
- Service/repository memakai prepared statement/JPA/query service.
- Authorization service menentukan visible rows dan allowed actions.
- View model disiapkan.
- JSP render dengan JSTL/EL.
- Delete memakai POST + CSRF + authorization server-side.

---

## 35. Ringkasan Mental Model

JSP syntax tidak boleh dilihat sebagai “template bebas”. Setiap bentuk sintaks punya konsekuensi runtime:

- Directive mengubah cara JSP diterjemahkan.
- Declaration menjadi member servlet dan berbahaya jika mutable.
- Scriptlet menjadi Java statement di `_jspService()` dan mencampur view dengan logic.
- Expression menulis output raw dan sering menjadi XSS source.
- EL membuat binding lebih deklaratif tetapi tetap perlu batas logic.
- Standard actions membantu include/forward/bean legacy, tetapi tidak menggantikan controller yang benar.
- Custom tags dan JSTL adalah jembatan menuju view yang lebih maintainable.
- JSP modern harus menjadi rendering layer yang tipis, eksplisit, dan aman.

Kalimat kunci:

```text
JSP yang sehat bukan JSP yang pintar.
JSP yang sehat adalah JSP yang hanya tahu cara merender data yang sudah benar-benar siap dirender.
```

---

## 36. Checklist Penguasaan Part Ini

Setelah memahami part ini, kamu harus bisa:

1. Menjelaskan perbedaan template text dan dynamic elements.
2. Membedakan translation time dan request time.
3. Menjelaskan fungsi `page`, `include`, dan `taglib` directive.
4. Menjelaskan kenapa declaration field mutable berbahaya.
5. Membaca scriptlet sebagai kode di `_jspService()`.
6. Menjelaskan kenapa `<%=` raw berisiko XSS.
7. Mengganti scriptlet conditional/loop dengan JSTL.
8. Menjelaskan perbedaan include directive dan `jsp:include`.
9. Menjelaskan risiko `jsp:useBean` dan `jsp:setProperty property="*"`.
10. Membedakan JSP comment dan HTML comment.
11. Mengidentifikasi flow control yang tidak seharusnya ada di JSP.
12. Membuat view model agar JSP tidak memegang business logic.
13. Melakukan audit cepat JSP legacy dari sisi security dan maintainability.
14. Menentukan kapan memakai EL, JSTL, tag file, custom tag, atau controller.

---

## 37. Apa yang Akan Dibahas Berikutnya

Part berikutnya:

```text
04-request-session-application-scope-view-data-flow.md
```

Fokus berikutnya adalah scope dan state boundary:

- page scope,
- request scope,
- session scope,
- application scope,
- attribute lookup,
- data handoff controller ke JSP,
- session memory,
- state leak,
- concurrency,
- clustering,
- flash message,
- scope decision matrix.

Ini penting karena setelah memahami sintaks, langkah berikutnya adalah memahami **di mana data hidup**, **berapa lama data hidup**, **siapa yang boleh mengubah data**, dan **apa risiko produksi jika scope dipilih salah**.

---

## Status Seri

Seri **belum selesai**.

Part yang sudah dibuat:

1. `00-orientation-server-side-ui-mental-model.md`
2. `01-history-compatibility-java8-to-java25.md`
3. `02-jakarta-pages-jsp-internal-architecture.md`
4. `03-jsp-syntax-directives-scriptlets-actions.md`

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: 02 — Jakarta Pages / JSP Internal Architecture: From `.jsp` to Servlet](./02-jakarta-pages-jsp-internal-architecture.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 4 — Request, Session, Application Scope: View Data Flow and State Boundaries](./04-request-session-application-scope-view-data-flow.md)

</div>