# Part 7 — Jakarta Standard Tag Library Core Tags: View Control Abstraction

> Seri: `learn-java-jakarta-pages-el-tags-faces-server-side-ui`  
> File: `07-jakarta-standard-tag-library-core-tags-view-control-abstraction.md`  
> Fokus: memahami core tags Jakarta Standard Tag Library/JSTL sebagai abstraksi view control yang menggantikan scriptlet, tanpa mengubah JSP menjadi business layer.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membangun fondasi Jakarta Expression Language:

- bagaimana `${...}` dan `#{...}` dievaluasi,
- bagaimana resolver chain mencari variable dan property,
- bagaimana custom resolver/function bekerja,
- mengapa EL harus dipahami sebagai binding/evaluation layer, bukan sekadar string interpolation.

Sekarang kita masuk ke layer di atas EL: **Jakarta Standard Tag Library**, historisnya dikenal sebagai **JSTL**.

JSTL adalah jawaban terhadap masalah besar JSP lama: banyak halaman JSP berubah menjadi campuran HTML, Java, query, branching, loop, formatting, dan side effect. Akibatnya view menjadi sulit dites, sulit diamankan, sulit dimigrasi, dan sulit dipahami.

Core tags memberikan cara deklaratif untuk melakukan tugas view yang umum:

- output text,
- set/remove attribute,
- conditional rendering,
- mutually exclusive branch,
- iteration,
- token iteration,
- exception capture,
- URL construction,
- import resource,
- redirect.

Tetapi ada batas penting:

> JSTL core tags adalah **view control abstraction**, bukan business workflow engine.

Artinya, core tags boleh membantu JSP memilih dan mengulang data yang sudah dipersiapkan controller, tetapi tidak seharusnya menjadi tempat mengambil keputusan bisnis kompleks.

---

## 1. Mental Model Utama: JSTL Core Tags Mengontrol Rendering, Bukan Domain

Bayangkan request lifecycle MVC sederhana:

```text
Browser
  |
  | HTTP request
  v
Controller / Servlet / Spring MVC Controller
  |
  | validate request, call service, authorize, build view model
  v
Request attributes
  |
  | forward
  v
JSP
  |
  | EL + JSTL tags render HTML
  v
HTTP response
```

Dalam model ini:

- controller menentukan **apa data yang tersedia**,
- service menentukan **aturan bisnis**,
- authorization layer menentukan **boleh/tidaknya aksi**,
- JSP menentukan **bagaimana data ditampilkan**,
- JSTL membantu JSP melakukan conditional/iteration sederhana,
- EL membaca value dari view model.

### 1.1 Batas Normal JSTL

Contoh yang wajar:

```jsp
<c:if test="${caseView.canApprove}">
  <button type="submit" name="action" value="approve">Approve</button>
</c:if>
```

Kenapa ini wajar?

Karena JSP hanya membaca keputusan yang sudah dihitung:

```text
caseView.canApprove = hasil dari authorization + workflow rule + status case
```

Contoh yang buruk:

```jsp
<c:if test="${case.status == 'PENDING_REVIEW' and user.role == 'MANAGER' and case.amount < 1000000 and not case.hasEscalation and case.region == user.region}">
  <button>Approve</button>
</c:if>
```

Ini buruk karena view mulai berisi aturan bisnis. Jika aturan berubah, developer harus mencari expression di banyak JSP. Lebih buruk lagi, server-side action tetap harus mengecek authorization ulang. Jika tidak, tombol mungkin tersembunyi tetapi endpoint tetap bisa dipanggil langsung.

Aturan praktis:

> JSP boleh bertanya “haruskah elemen ini ditampilkan?”, tetapi jawabannya sebaiknya sudah tersedia sebagai field view model.

---

## 2. Evolusi Nama dan Namespace: JSTL Lama ke Jakarta Tags

Secara historis, tag library ini dikenal sebagai:

```text
JSTL = JSP Standard Tag Library
```

Dalam era Jakarta, nama spesifikasinya menjadi:

```text
Jakarta Standard Tag Library
```

Sering juga disebut **Jakarta Tags** di URI dan dokumentasi modern.

### 2.1 Namespace Legacy vs Jakarta

Pada aplikasi Java EE lama, core tag biasanya dideklarasikan seperti ini:

```jsp
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>
```

atau pada versi lebih baru sebelum namespace Jakarta penuh:

```jsp
<%@ taglib prefix="c" uri="http://xmlns.jcp.org/jsp/jstl/core" %>
```

Pada Jakarta Standard Tag Library 3.0, URI baru adalah:

```jsp
<%@ taglib prefix="c" uri="jakarta.tags.core" %>
```

Untuk aplikasi migrasi, perubahan URI ini sering menjadi sumber error:

```text
The absolute uri: [jakarta.tags.core] cannot be resolved
Unable to find taglib [c] for URI [jakarta.tags.core]
```

Biasanya penyebabnya salah satu dari ini:

1. Dependency API/implementation belum ada.
2. Container tidak menyediakan JSTL implementation.
3. Versi container masih `javax.*`, tapi JSP sudah memakai URI `jakarta.tags.core`.
4. WAR membawa dependency JSTL yang salah generasi.
5. TLD tidak ditemukan karena packaging/classloader.

### 2.2 Dependency Mental Model

JSP container biasanya menyediakan JSP engine, tetapi JSTL/Jakarta Tags bisa perlu dependency tambahan tergantung container.

Untuk Jakarta 10/11-style aplikasi, dependency umumnya mengarah ke:

```xml
<dependency>
  <groupId>jakarta.servlet.jsp.jstl</groupId>
  <artifactId>jakarta.servlet.jsp.jstl-api</artifactId>
  <version>3.0.0</version>
</dependency>

<dependency>
  <groupId>org.glassfish.web</groupId>
  <artifactId>jakarta.servlet.jsp.jstl</artifactId>
  <version>3.0.1</version>
</dependency>
```

Namun pada application server full-profile, API bisa sudah disediakan oleh server. Pada embedded servlet container seperti Tomcat, dependency JSTL sering perlu dibawa aplikasi.

Prinsipnya:

```text
API tells compiler what classes exist.
Implementation tells runtime how tags execute.
TLD tells JSP engine what URI maps to what tag classes.
```

Jika salah satu hilang, taglib tidak jalan.

---

## 3. Core Tag Library: Peta Besar

Core tag biasanya dideklarasikan dengan prefix `c`:

```jsp
<%@ taglib prefix="c" uri="jakarta.tags.core" %>
```

Secara konseptual, core tags dapat dikelompokkan menjadi beberapa kategori:

| Kategori | Tag | Fungsi |
|---|---|---|
| Output | `c:out` | Menulis value dengan escaping opsional |
| Variable | `c:set`, `c:remove` | Mengelola scoped attribute |
| Conditional | `c:if`, `c:choose`, `c:when`, `c:otherwise` | Mengatur conditional rendering |
| Iteration | `c:forEach`, `c:forTokens` | Mengulang collection atau token string |
| Error boundary kecil | `c:catch` | Menangkap exception dalam body |
| URL/resource | `c:url`, `c:param`, `c:import` | Membuat URL, parameter, import resource |
| Flow | `c:redirect` | Redirect dari JSP |

Tetapi tidak semua tag sama sehatnya dalam desain enterprise.

Tag yang paling sering aman:

- `c:out`,
- `c:if`,
- `c:choose`,
- `c:forEach`,
- `c:url`,
- `c:param`.

Tag yang perlu hati-hati:

- `c:set`, karena bisa menyembunyikan transformasi data di view,
- `c:catch`, karena bisa menyembunyikan error,
- `c:import`, karena bisa mencampur rendering dengan network/resource access,
- `c:redirect`, karena navigation sebaiknya dikendalikan controller.

---

## 4. `c:out`: Output Text dan Escaping Dasar

`c:out` digunakan untuk menulis value ke response.

Contoh:

```jsp
<c:out value="${caseView.title}" />
```

Dengan default modern JSTL, XML/HTML-sensitive characters biasanya di-escape sehingga value seperti:

```text
<script>alert('xss')</script>
```

akan dirender sebagai teks, bukan dieksekusi sebagai script.

### 4.1 `c:out` vs `${...}` Langsung

Banyak JSP menulis:

```jsp
${caseView.title}
```

Masalahnya: escaping behavior bergantung konteks JSP/container dan konfigurasi. Untuk data user-generated, lebih eksplisit memakai:

```jsp
<c:out value="${caseView.title}" />
```

Dengan begitu niatnya jelas: output ini adalah teks, bukan markup.

### 4.2 `escapeXml`

```jsp
<c:out value="${caseView.description}" escapeXml="true" />
```

Jangan matikan escaping kecuali value benar-benar sudah disanitasi dan memang dimaksudkan sebagai HTML:

```jsp
<c:out value="${caseView.richHtml}" escapeXml="false" />
```

Ini berbahaya jika `richHtml` berasal dari user input tanpa sanitization ketat.

### 4.3 Escaping Bukan Satu Jenis

Kesalahan umum: mengira HTML escaping cukup untuk semua konteks.

Tidak cukup.

Konteks berbeda butuh escaping berbeda:

```jsp
<!-- HTML text context -->
<span><c:out value="${user.name}" /></span>

<!-- HTML attribute context -->
<input value="${user.name}" />

<!-- JavaScript string context -->
<script>
  const name = "${user.name}";
</script>

<!-- URL context -->
<a href="/search?q=${user.keyword}">Search</a>
```

`c:out` terutama membantu pada XML/HTML escaping. Untuk JavaScript string, URL, CSS, dan HTML attribute yang kompleks, butuh encoding sesuai konteks. Strategi paling aman:

1. Hindari memasukkan data dinamis langsung ke JavaScript inline.
2. Pakai `data-*` attribute dengan encoding benar.
3. Gunakan JSON encoder server-side jika harus mengirim JSON ke script.
4. Gunakan `c:url`/`c:param` untuk URL parameter.

---

## 5. `c:set`: Menyetel Variable di Scope

`c:set` digunakan untuk menyimpan value ke scope.

Contoh:

```jsp
<c:set var="pageTitle" value="Case Detail" />
```

Secara default, variable disimpan di page scope.

Dengan scope eksplisit:

```jsp
<c:set var="activeMenu" value="cases" scope="request" />
```

### 5.1 Kapan `c:set` Wajar?

Wajar untuk kebutuhan rendering ringan:

```jsp
<c:set var="pageTitle" value="Case Detail" />
<c:set var="activeMenu" value="case-management" />
```

Wajar juga untuk menghindari expression berulang yang sederhana:

```jsp
<c:set var="hasWarning" value="${not empty caseView.warningMessages}" />
```

### 5.2 Kapan `c:set` Berbahaya?

Berbahaya ketika dipakai untuk business calculation:

```jsp
<c:set var="approvalLimit" value="${user.grade == 'A' ? 1000000 : 500000}" />
```

Atau untuk membuat state yang nanti dipakai action:

```jsp
<c:set var="computedStatus" value="${case.status == 'NEW' ? 'PENDING' : case.status}" scope="session" />
```

Ini buruk karena:

- aturan tersembunyi di view,
- sulit dites,
- bisa berbeda dari service logic,
- bisa menyebabkan stale session data,
- rawan race pada multi-tab.

### 5.3 Scope untuk `c:set`

```jsp
<c:set var="x" value="1" scope="page" />
<c:set var="x" value="1" scope="request" />
<c:set var="x" value="1" scope="session" />
<c:set var="x" value="1" scope="application" />
```

Prinsip enterprise:

- default ke `page`,
- gunakan `request` untuk data request rendering,
- hindari `session` kecuali benar-benar state user lintas request,
- hampir tidak pernah set `application` dari JSP.

JSP yang menulis ke `session` atau `application` harus dianggap red flag.

---

## 6. `c:remove`: Menghapus Variable

`c:remove` menghapus variable dari scope.

```jsp
<c:remove var="temporaryValue" />
```

Dengan scope eksplisit:

```jsp
<c:remove var="flashMessage" scope="session" />
```

### 6.1 Use Case

Use case legacy yang sering ditemukan:

```jsp
<c:if test="${not empty sessionScope.flashMessage}">
  <div class="alert">
    <c:out value="${sessionScope.flashMessage}" />
  </div>
  <c:remove var="flashMessage" scope="session" />
</c:if>
```

Ini bekerja, tetapi dalam desain modern lebih baik flash lifecycle dikelola controller/filter, bukan JSP. Mengapa?

Karena rendering bisa gagal sebelum remove, user bisa refresh, include bisa dieksekusi lebih dari sekali, atau halaman bisa dipanggil oleh multiple tab.

---

## 7. `c:if`: Conditional Rendering Sederhana

`c:if` mengevaluasi expression boolean.

```jsp
<c:if test="${not empty caseView.warningMessages}">
  <section class="warning-panel">
    <h2>Warnings</h2>
    <ul>
      <c:forEach var="warning" items="${caseView.warningMessages}">
        <li><c:out value="${warning}" /></li>
      </c:forEach>
    </ul>
  </section>
</c:if>
```

### 7.1 Good Use

`c:if` cocok untuk:

- menampilkan block jika data ada,
- menampilkan button berdasarkan flag view model,
- menampilkan empty state,
- menampilkan warning/info panel,
- menampilkan optional field.

Contoh sehat:

```jsp
<c:if test="${caseView.showEscalationBanner}">
  <div class="banner banner-warning">
    This case is escalated.
  </div>
</c:if>
```

### 7.2 Bad Use

`c:if` buruk jika expression menjadi decision table besar:

```jsp
<c:if test="${case.status == 'A' and user.type == 'X' and org.mode == 'Y' and not empty case.items and case.items[0].riskScore > 80}">
```

Jika expression mulai terasa seperti policy rule, pindahkan ke service/view model:

```java
caseView.setShowHighRiskEscalationBanner(policy.shouldShowHighRiskEscalationBanner(caseData, userContext));
```

lalu JSP:

```jsp
<c:if test="${caseView.showHighRiskEscalationBanner}">
  ...
</c:if>
```

---

## 8. `c:choose`, `c:when`, `c:otherwise`: Mutually Exclusive Branch

`c:choose` seperti `switch/if-else-if` deklaratif.

```jsp
<c:choose>
  <c:when test="${caseView.status == 'DRAFT'}">
    <span class="badge">Draft</span>
  </c:when>
  <c:when test="${caseView.status == 'PENDING_REVIEW'}">
    <span class="badge">Pending Review</span>
  </c:when>
  <c:when test="${caseView.status == 'APPROVED'}">
    <span class="badge">Approved</span>
  </c:when>
  <c:otherwise>
    <span class="badge">Unknown</span>
  </c:otherwise>
</c:choose>
```

### 8.1 Kapan `c:choose` Tepat?

Tepat untuk variasi rendering kecil:

- badge status,
- empty/error/loading-like block,
- label berdasarkan enum,
- optional panel berdasarkan simple view state.

### 8.2 Kapan `c:choose` Salah?

Salah jika dipakai untuk memodelkan workflow:

```jsp
<c:choose>
  <c:when test="${case.status == 'DRAFT' and user.role == 'OFFICER'}">
    ...
  </c:when>
  <c:when test="${case.status == 'PENDING_REVIEW' and user.role == 'MANAGER'}">
    ...
  </c:when>
  <c:when test="${case.status == 'RETURNED' and user.role == 'OFFICER' and case.assigneeId == user.id}">
    ...
  </c:when>
</c:choose>
```

Itu bukan sekadar rendering. Itu workflow matrix. Tempatnya di workflow/policy layer, lalu JSP menerima action model:

```java
record CaseActionView(
    String code,
    String label,
    boolean enabled,
    String disabledReason
) {}
```

JSP:

```jsp
<c:forEach var="action" items="${caseView.actions}">
  <button name="action" value="${action.code}" ${action.enabled ? '' : 'disabled'}>
    <c:out value="${action.label}" />
  </button>
</c:forEach>
```

Lebih baik lagi, hindari string concatenation attribute seperti di atas dan gunakan tag/custom tag khusus agar escaping dan boolean attribute rapi.

---

## 9. `c:forEach`: Iteration Over Collections, Arrays, Maps, Ranges

`c:forEach` adalah core tag paling penting untuk rendering list/table.

Contoh list:

```jsp
<ul>
  <c:forEach var="item" items="${caseView.relatedCases}">
    <li>
      <a href="<c:url value='/cases/detail'><c:param name='id' value='${item.id}' /></c:url>">
        <c:out value="${item.referenceNo}" />
      </a>
    </li>
  </c:forEach>
</ul>
```

Contoh table:

```jsp
<table>
  <thead>
    <tr>
      <th>Reference</th>
      <th>Status</th>
      <th>Updated</th>
    </tr>
  </thead>
  <tbody>
    <c:forEach var="row" items="${caseList.rows}" varStatus="st">
      <tr>
        <td><c:out value="${row.referenceNo}" /></td>
        <td><c:out value="${row.statusLabel}" /></td>
        <td><c:out value="${row.updatedAtLabel}" /></td>
      </tr>
    </c:forEach>
  </tbody>
</table>
```

### 9.1 `varStatus`

`varStatus` memberikan metadata loop:

```jsp
<c:forEach var="row" items="${rows}" varStatus="st">
  ${st.index}   <!-- 0-based -->
  ${st.count}   <!-- 1-based -->
  ${st.first}
  ${st.last}
</c:forEach>
```

Use case:

```jsp
<tr class="${st.index % 2 == 0 ? 'even' : 'odd'}">
```

Namun untuk styling zebra row, CSS modern lebih baik:

```css
tbody tr:nth-child(even) { ... }
```

Jangan gunakan JSTL untuk hal yang bisa diselesaikan CSS.

### 9.2 Range Iteration

```jsp
<c:forEach var="page" begin="1" end="${caseList.totalPages}">
  <a href="<c:url value='/cases'><c:param name='page' value='${page}' /></c:url>">
    ${page}
  </a>
</c:forEach>
```

Hati-hati jika `totalPages` sangat besar. Pagination UI harus dibatasi:

```text
1 ... 8 9 [10] 11 12 ... 300
```

Jangan render 3000 link pagination.

### 9.3 Iterating Map

Jika `items` adalah map, item biasanya expose key/value:

```jsp
<c:forEach var="entry" items="${caseView.summaryMap}">
  <dt><c:out value="${entry.key}" /></dt>
  <dd><c:out value="${entry.value}" /></dd>
</c:forEach>
```

Tetapi untuk UI enterprise, map sering kurang eksplisit. Lebih baik list of field view:

```java
record SummaryFieldView(String label, String value, boolean visible) {}
```

Lalu JSP:

```jsp
<c:forEach var="field" items="${caseView.summaryFields}">
  <c:if test="${field.visible}">
    <dt><c:out value="${field.label}" /></dt>
    <dd><c:out value="${field.value}" /></dd>
  </c:if>
</c:forEach>
```

Ini lebih stabil untuk urutan, i18n, masking, dan visibility.

### 9.4 Performance Rule for `forEach`

`forEach` mengeksekusi body untuk setiap item. Jika body mengandung EL yang memanggil getter mahal, cost bisa besar.

Buruk:

```jsp
<c:forEach var="case" items="${cases}">
  ${case.assignee.name}
  ${case.latestDecision.label}
  ${case.riskProfile.score}
</c:forEach>
```

Jika getter memicu lazy loading, remote call, atau computation berat, halaman bisa menjadi lambat dan tidak stabil.

Lebih baik controller menyiapkan row DTO:

```java
record CaseRowView(
    String referenceNo,
    String assigneeName,
    String latestDecisionLabel,
    String riskScoreLabel
) {}
```

JSP hanya render:

```jsp
<c:forEach var="row" items="${caseList.rows}">
  <td><c:out value="${row.assigneeName}" /></td>
  <td><c:out value="${row.latestDecisionLabel}" /></td>
  <td><c:out value="${row.riskScoreLabel}" /></td>
</c:forEach>
```

Mental model:

> JSP iteration should be O(number of rows) rendering only, not O(rows × hidden business/database work).

---

## 10. Empty State Pattern

Tabel enterprise harus menangani list kosong.

Pola yang sehat:

```jsp
<c:choose>
  <c:when test="${empty caseList.rows}">
    <div class="empty-state">
      No cases found for the current filter.
    </div>
  </c:when>
  <c:otherwise>
    <table>
      <thead>...</thead>
      <tbody>
        <c:forEach var="row" items="${caseList.rows}">
          <tr>
            <td><c:out value="${row.referenceNo}" /></td>
            <td><c:out value="${row.statusLabel}" /></td>
          </tr>
        </c:forEach>
      </tbody>
    </table>
  </c:otherwise>
</c:choose>
```

Lebih baik lagi, controller menyediakan:

```java
caseList.hasRows()
caseList.emptyMessage()
```

JSP:

```jsp
<c:choose>
  <c:when test="${not caseList.hasRows}">
    <div class="empty-state">
      <c:out value="${caseList.emptyMessage}" />
    </div>
  </c:when>
  <c:otherwise>
    ...
  </c:otherwise>
</c:choose>
```

Kenapa ini lebih baik?

Karena empty message sering tergantung filter, authorization, atau data visibility:

- “No cases found.”
- “No cases assigned to you.”
- “You do not have access to any cases in this agency.”
- “Filter returned no result.”

Itu bukan keputusan JSP.

---

## 11. `c:forTokens`: Iterating Token String

`c:forTokens` memecah string berdasarkan delimiter.

```jsp
<c:forTokens var="tag" items="${caseView.tagsCsv}" delims=",">
  <span class="tag"><c:out value="${tag}" /></span>
</c:forTokens>
```

### 11.1 Kenapa Jarang Direkomendasikan?

Karena CSV/string token biasanya bentuk data yang buruk untuk UI model. Lebih baik controller mengirim list:

```java
List<String> tags
```

JSP:

```jsp
<c:forEach var="tag" items="${caseView.tags}">
  <span class="tag"><c:out value="${tag}" /></span>
</c:forEach>
```

`c:forTokens` berguna untuk legacy integration, tetapi untuk kode baru gunakan collection.

---

## 12. `c:url`: URL Construction, Context Path, dan Parameter Encoding

`c:url` membantu membuat URL yang benar terhadap context path dan parameter.

```jsp
<c:url var="detailUrl" value="/cases/detail">
  <c:param name="id" value="${row.id}" />
</c:url>

<a href="${detailUrl}">
  <c:out value="${row.referenceNo}" />
</a>
```

### 12.1 Kenapa Tidak String Concatenation?

Buruk:

```jsp
<a href="/app/cases/detail?id=${row.id}&tab=${caseView.selectedTab}">Open</a>
```

Masalah:

- context path hardcoded,
- parameter encoding rawan salah,
- value bisa mengandung karakter khusus,
- mudah rusak saat reverse proxy/path berubah,
- rawan XSS/attribute injection jika value tidak aman.

Lebih baik:

```jsp
<c:url var="detailUrl" value="/cases/detail">
  <c:param name="id" value="${row.id}" />
  <c:param name="tab" value="${caseView.selectedTab}" />
</c:url>
<a href="${detailUrl}">Open</a>
```

### 12.2 Session ID URL Rewriting

Pada environment tertentu, URL encoding bisa menambahkan session id ke URL jika cookie tidak tersedia:

```text
/app/cases;jsessionid=ABC123
```

Ini fitur servlet lama untuk session tracking tanpa cookie. Dari sudut security modern, session id di URL berisiko:

- bocor di log,
- bocor via referrer,
- mudah tercopy,
- session fixation.

Untuk aplikasi modern, lebih baik session tracking menggunakan cookie dan konfigurasi container/security yang sesuai.

### 12.3 URL as View Model

Untuk aplikasi besar, bisa lebih rapi jika controller menyiapkan URL intent, bukan JSP merakit semua URL.

```java
record CaseRowView(
    String referenceNo,
    String detailUrl,
    boolean canOpen
) {}
```

Namun ada trade-off:

- URL di view model memudahkan JSP,
- tetapi controller harus tahu path UI,
- jika routing berubah, view model builder ikut berubah.

Pilihan arsitekturalnya tergantung framework dan kompleksitas routing. Untuk JSP klasik, `c:url` di JSP masih wajar selama parameter sederhana.

---

## 13. `c:param`: Nested Parameter Builder

`c:param` dipakai di dalam `c:url`, `c:redirect`, atau `c:import`.

```jsp
<c:url var="searchUrl" value="/cases/search">
  <c:param name="q" value="${searchForm.keyword}" />
  <c:param name="status" value="${searchForm.status}" />
  <c:param name="page" value="1" />
</c:url>
```

### 13.1 Avoid Repeating Current Filter Manually

Untuk pagination, sorting, dan filtering, jangan hardcode parameter di banyak tempat.

Buruk:

```jsp
<c:url var="page2" value="/cases">
  <c:param name="status" value="${param.status}" />
  <c:param name="agency" value="${param.agency}" />
  <c:param name="risk" value="${param.risk}" />
  <c:param name="page" value="2" />
</c:url>
```

Lebih scalable: controller menyediakan filter state dan pagination link model.

```java
record PageLinkView(int page, String label, String url, boolean current) {}
```

JSP:

```jsp
<c:forEach var="link" items="${caseList.pageLinks}">
  <a href="${link.url}" class="${link.current ? 'current' : ''}">
    <c:out value="${link.label}" />
  </a>
</c:forEach>
```

Untuk UI kompleks, link generation sering lebih aman di route/link builder terpusat.

---

## 14. `c:redirect`: Redirect dari JSP

Contoh:

```jsp
<c:redirect url="/login" />
```

Secara teknis bisa. Secara desain sering buruk.

### 14.1 Kenapa Redirect Sebaiknya di Controller?

Redirect adalah keputusan flow, bukan rendering.

Jika JSP melakukan redirect, berarti controller sudah forward ke JSP, lalu JSP memutuskan tidak jadi render. Ini membingungkan:

```text
Controller says: render page A.
JSP says: actually redirect to page B.
```

Risiko:

- flow tersembunyi,
- test controller tidak cukup,
- response bisa sudah committed,
- authorization flow tersebar,
- debugging lebih sulit.

Gunakan `c:redirect` hanya untuk kasus legacy/sederhana. Untuk aplikasi enterprise, redirect harus terjadi sebelum view rendering.

---

## 15. `c:import`: Import Resource ke JSP

`c:import` bisa mengambil resource internal atau eksternal.

```jsp
<c:import url="/WEB-INF/fragments/help-panel.jsp" />
```

atau bahkan URL eksternal:

```jsp
<c:import url="https://example.com/banner" />
```

### 15.1 Bedakan Include vs Import

Untuk fragment internal JSP, biasanya lebih tepat:

```jsp
<jsp:include page="/WEB-INF/fragments/header.jsp" />
```

atau layout/tag file.

`c:import` lebih fleksibel, tetapi fleksibilitas itu juga berbahaya.

### 15.2 Risiko `c:import`

Jika import resource eksternal:

- rendering page tergantung network,
- latency tidak terkontrol,
- failure eksternal merusak page,
- SSRF risk jika URL dipengaruhi user,
- caching sulit,
- observability kabur.

Jangan lakukan ini:

```jsp
<c:import url="${param.widgetUrl}" />
```

Itu pola SSRF klasik: user mengontrol URL yang server fetch.

Prinsip:

> JSP tidak boleh menjadi HTTP client dinamis.

Jika butuh data eksternal, service/controller yang fetch, validate, cache, timeout, audit, lalu kirim view model ke JSP.

---

## 16. `c:catch`: Menangkap Exception di View

Contoh:

```jsp
<c:catch var="renderError">
  <c:out value="${caseView.optionalPanel.text}" />
</c:catch>

<c:if test="${not empty renderError}">
  <div>Optional panel unavailable.</div>
</c:if>
```

### 16.1 Kenapa Harus Hati-Hati?

Exception di JSP sering menandakan bug:

- view model tidak lengkap,
- getter melempar exception,
- lazy loading gagal,
- null handling buruk,
- encoding/formatting error.

Jika `c:catch` dipakai untuk menelan error, produksi akan terlihat “baik-baik saja” tetapi data salah atau hilang.

`c:catch` boleh dipakai untuk optional rendering legacy, tetapi jangan untuk menyembunyikan defect.

Lebih baik:

```java
caseView.setOptionalPanelAvailable(...);
caseView.setOptionalPanelMessage(...);
```

JSP:

```jsp
<c:if test="${caseView.optionalPanelAvailable}">
  ...
</c:if>
```

---

## 17. Core Tags dan View Model Pattern

Core tags paling kuat jika digabungkan dengan view model yang sudah matang.

### 17.1 Tanpa View Model

```jsp
<c:forEach var="case" items="${cases}">
  <tr>
    <td>${case.id}</td>
    <td>${case.status}</td>
    <td>${case.assignee.profile.displayName}</td>
    <td>
      <c:if test="${case.status == 'PENDING' and currentUser.role == 'MANAGER'}">
        <button>Approve</button>
      </c:if>
    </td>
  </tr>
</c:forEach>
```

Masalah:

- domain object bocor ke view,
- nested access rawan lazy loading,
- status raw string,
- role logic di JSP,
- XSS escaping tidak eksplisit,
- action visibility tidak authoritative.

### 17.2 Dengan View Model

Controller/service membuat:

```java
record CaseListPageView(
    List<CaseRowView> rows,
    boolean hasRows,
    String emptyMessage,
    List<PageLinkView> pageLinks
) {}

record CaseRowView(
    String id,
    String referenceNo,
    String statusLabel,
    String assigneeName,
    boolean showApproveButton,
    String detailUrl
) {}
```

JSP:

```jsp
<c:choose>
  <c:when test="${not caseList.hasRows}">
    <div class="empty-state"><c:out value="${caseList.emptyMessage}" /></div>
  </c:when>
  <c:otherwise>
    <table>
      <tbody>
        <c:forEach var="row" items="${caseList.rows}">
          <tr>
            <td><a href="${row.detailUrl}"><c:out value="${row.referenceNo}" /></a></td>
            <td><c:out value="${row.statusLabel}" /></td>
            <td><c:out value="${row.assigneeName}" /></td>
            <td>
              <c:if test="${row.showApproveButton}">
                <button type="submit" name="caseId" value="${row.id}">Approve</button>
              </c:if>
            </td>
          </tr>
        </c:forEach>
      </tbody>
    </table>
  </c:otherwise>
</c:choose>
```

Lebih baik karena JSP hanya rendering.

---

## 18. Authorization: Rendering Bukan Enforcement

JSTL sering dipakai untuk menyembunyikan menu/button:

```jsp
<c:if test="${permissions.canDeleteCase}">
  <button>Delete</button>
</c:if>
```

Ini baik untuk UX, tetapi bukan security enforcement.

User masih bisa mengirim HTTP request manual:

```http
POST /cases/delete?id=123
```

Karena itu, authorization harus dicek lagi di endpoint/service:

```java
caseAuthorization.assertCanDelete(user, caseId);
caseService.delete(caseId);
```

Rule:

```text
JSP/JSTL controls visibility.
Server-side action controls authority.
```

Jika dua rule ini tidak konsisten, itu bug. Biasanya solusinya adalah sumber keputusan yang sama:

```text
Authorization policy -> action model -> JSP visibility
Authorization policy -> command handler enforcement
```

---

## 19. Form Rendering dengan JSTL

JSTL sering dipakai untuk render form errors.

View model:

```java
record FieldErrorView(String field, String message) {}
record FormView(Map<String, String> values, Map<String, List<String>> errors) {}
```

JSP:

```jsp
<label for="title">Title</label>
<input id="title" name="title" value="<c:out value='${form.values.title}' />" />

<c:if test="${not empty form.errors.title}">
  <ul class="field-errors">
    <c:forEach var="err" items="${form.errors.title}">
      <li><c:out value="${err}" /></li>
    </c:forEach>
  </ul>
</c:if>
```

Namun perhatikan atribut `value`. Menaruh tag di dalam attribute seperti ini sering tidak valid/rapi di JSP tergantung syntax. Lebih umum:

```jsp
<input id="title" name="title" value="${fn:escapeXml(form.values.title)}" />
```

Tapi itu membutuhkan function library dan tetap harus hati-hati context escaping.

Alternatif lebih baik adalah custom tag untuk input:

```jsp
<app:inputText name="title" label="Title" form="${form}" />
```

Custom tag tersebut bertanggung jawab untuk:

- HTML escaping attribute,
- rendering label,
- rendering error,
- CSS error class,
- accessibility attributes seperti `aria-describedby`.

Ini salah satu alasan custom tag dibahas pada Part 9.

---

## 20. URL, CSRF, dan Form Action

Untuk form POST:

```jsp
<c:url var="submitUrl" value="/cases/submit" />

<form method="post" action="${submitUrl}">
  <input type="hidden" name="csrfToken" value="${csrfToken}" />
  ...
</form>
```

Catatan:

- token CSRF harus berasal dari framework/security layer,
- jangan buat token di JSP,
- jangan percaya hidden fields sebagai source of truth,
- semua value hidden dapat dimodifikasi user.

Buruk:

```jsp
<input type="hidden" name="approved" value="${caseView.canApprove}" />
```

Server tidak boleh percaya hidden `approved=true`. Server harus hitung ulang authorization/action validity.

---

## 21. Anti-Pattern: Query/Filtering di JSP

Contoh buruk:

```jsp
<c:forEach var="case" items="${cases}">
  <c:if test="${case.status == param.status or empty param.status}">
    ...
  </c:if>
</c:forEach>
```

Mengapa buruk?

- filter logic ada di view,
- pagination count jadi salah,
- data terlalu banyak dikirim dari service,
- authorization filtering rawan salah,
- performa memburuk.

Filter harus terjadi di query/service/controller. JSP menerima hasil final.

JSP boleh menampilkan filter yang aktif:

```jsp
<c:if test="${not empty caseList.activeFilterSummary}">
  <div class="filter-summary">
    <c:out value="${caseList.activeFilterSummary}" />
  </div>
</c:if>
```

---

## 22. Anti-Pattern: Sorting di JSP

Buruk:

```jsp
<!-- Tidak ada core tag sorting built-in, tetapi sering developer mencoba hack via scriptlet/custom EL -->
```

Sorting harus dilakukan sebelum rendering:

- database query `ORDER BY`,
- service layer sort untuk in-memory small collection,
- dedicated view model ordering.

JSP hanya render urutan yang diterima.

---

## 23. Anti-Pattern: Complex Nested Rendering

Contoh:

```jsp
<c:forEach var="case" items="${cases}">
  <c:forEach var="party" items="${case.parties}">
    <c:forEach var="document" items="${party.documents}">
      <c:forEach var="version" items="${document.versions}">
        ...
      </c:forEach>
    </c:forEach>
  </c:forEach>
</c:forEach>
```

Ini rawan:

- HTML besar,
- N+1 lazy loading,
- UI sulit dibaca,
- rendering lambat,
- memory meningkat,
- browser lambat.

Solusi:

1. flatten view model,
2. pagination/expand-on-demand,
3. summary first, detail page later,
4. server-side prepared sections,
5. custom tag/component untuk struktur berulang.

---

## 24. Pattern: Table Row Actions

Kasus enterprise umum: setiap row punya action berbeda.

Jangan lakukan ini:

```jsp
<c:if test="${row.status == 'NEW' and user.role == 'OFFICER'}">...</c:if>
<c:if test="${row.status == 'PENDING' and user.role == 'MANAGER'}">...</c:if>
<c:if test="${row.status == 'APPROVED' and user.role == 'ADMIN'}">...</c:if>
```

Lebih baik:

```java
record RowActionView(
    String code,
    String label,
    String url,
    String method,
    boolean visible,
    boolean enabled,
    String disabledReason
) {}

record CaseRowView(
    String referenceNo,
    List<RowActionView> actions
) {}
```

JSP:

```jsp
<c:forEach var="action" items="${row.actions}">
  <c:if test="${action.visible}">
    <c:choose>
      <c:when test="${action.enabled}">
        <a href="${action.url}"><c:out value="${action.label}" /></a>
      </c:when>
      <c:otherwise>
        <span class="disabled" title="${action.disabledReason}">
          <c:out value="${action.label}" />
        </span>
      </c:otherwise>
    </c:choose>
  </c:if>
</c:forEach>
```

Action model membuat UI lebih konsisten, dan policy bisa dites tanpa JSP.

---

## 25. Pattern: Menu Rendering

Menu sering tergantung permission.

Jangan sebar permission expression:

```jsp
<c:if test="${user.role == 'ADMIN'}">...</c:if>
<c:if test="${user.role == 'OFFICER' or user.role == 'MANAGER'}">...</c:if>
```

Lebih baik controller/layout model menyediakan:

```java
record MenuItemView(
    String label,
    String url,
    boolean visible,
    boolean active,
    List<MenuItemView> children
) {}
```

JSP:

```jsp
<nav>
  <ul>
    <c:forEach var="item" items="${layout.menuItems}">
      <c:if test="${item.visible}">
        <li class="${item.active ? 'active' : ''}">
          <a href="${item.url}"><c:out value="${item.label}" /></a>
        </li>
      </c:if>
    </c:forEach>
  </ul>
</nav>
```

Untuk nested menu, pertimbangkan custom tag agar JSP tidak penuh recursive-like markup.

---

## 26. Pattern: Alert and Notification Rendering

View model:

```java
record AlertView(String type, String message) {}
```

JSP:

```jsp
<c:forEach var="alert" items="${layout.alerts}">
  <div class="alert alert-${alert.type}">
    <c:out value="${alert.message}" />
  </div>
</c:forEach>
```

Catatan: `alert.type` masuk ke CSS class. Jangan biarkan value bebas dari user. Gunakan enum/whitelist di server.

Lebih aman:

```java
record AlertView(String cssClass, String message) {}
```

`cssClass` hanya berasal dari mapping internal:

```java
INFO -> "alert-info"
WARNING -> "alert-warning"
ERROR -> "alert-error"
```

---

## 27. Pattern: Status Badge

Buruk:

```jsp
<c:choose>
  <c:when test="${case.status == 'PENDING'}"><span class="yellow">Pending</span></c:when>
  <c:when test="${case.status == 'APPROVED'}"><span class="green">Approved</span></c:when>
  <c:otherwise><span>Unknown</span></c:otherwise>
</c:choose>
```

Lebih baik:

```java
record StatusBadgeView(String label, String cssClass) {}
```

JSP:

```jsp
<span class="badge ${row.statusBadge.cssClass}">
  <c:out value="${row.statusBadge.label}" />
</span>
```

Tetap pastikan `cssClass` bukan user input.

---

## 28. JSTL Core Tags dan Internationalization

Part 8 akan membahas `fmt:*`. Namun core tags tetap perlu memikirkan i18n.

Jangan hardcode label jika aplikasi multilingual:

```jsp
<button>Approve</button>
```

Lebih baik gunakan message bundle via `fmt:message` atau view model yang sudah membawa label lokal.

Untuk action model:

```java
record RowActionView(String code, String label, String url, boolean enabled) {}
```

`label` bisa berasal dari message service sesuai locale.

Trade-off:

- label di JSP via `fmt:message`: view lebih declarative,
- label di view model: UI logic lebih terkonsolidasi di server builder,
- hybrid: JSP static labels pakai bundle, dynamic labels dari view model.

---

## 29. Error Handling Philosophy

JSP harus gagal jelas pada bug developer, bukan diam-diam menyembunyikan masalah.

Misalnya, jika required view model tidak ada:

```jsp
${caseView.title}
```

mungkin hanya kosong, tergantung EL behavior. Ini bisa menyembunyikan bug controller.

Untuk halaman kritikal, controller harus menjamin contract:

```text
/cases/detail always sets request attribute `caseView`.
caseView.title is non-null.
caseView.actions is non-null, may be empty.
caseView.warningMessages is non-null, may be empty.
```

View model sebaiknya menghindari nullable collection:

```java
List<ActionView> actions = List.of();
```

bukan:

```java
List<ActionView> actions = null;
```

JSTL `empty` bisa membantu, tetapi jangan jadikan null sebagai desain default.

---

## 30. Security Checklist untuk Core Tags

Gunakan checklist ini saat review JSP:

1. Semua user-generated text dirender dengan escaping eksplisit.
2. Tidak ada `escapeXml="false"` kecuali value sudah disanitasi dan ada alasan kuat.
3. Tidak ada URL yang dibangun dari raw user input tanpa whitelist.
4. Tidak ada `c:import` terhadap URL user-controlled.
5. Tidak ada authorization rule kompleks di JSP sebagai satu-satunya enforcement.
6. Tidak ada hidden field yang dipercaya sebagai keputusan server.
7. Semua POST form punya CSRF token dari security layer.
8. CSS class/HTML attribute dinamis berasal dari enum/whitelist.
9. Tidak ada sensitive data disimpan di page sebagai hidden field tanpa kebutuhan jelas.
10. Error detail tidak dirender ke user.
11. `c:catch` tidak menelan exception kritikal.
12. Link/action visibility berasal dari policy/action model yang sama dengan backend enforcement.

---

## 31. Performance Checklist untuk Core Tags

1. `c:forEach` tidak merender collection besar tanpa pagination.
2. Getter yang dipanggil EL tidak melakukan DB query/remote call.
3. Tidak ada nested loop dalam yang meledak menjadi ribuan node HTML.
4. Tidak ada `c:import` network call di render path.
5. URL generation tidak mengulang logic kompleks di setiap row jika bisa disiapkan di model.
6. Formatting berat tidak dilakukan berulang di JSP jika bisa disiapkan di view model.
7. View model sudah flatten untuk table/list besar.
8. Empty state dan pagination dihitung server-side.
9. Tidak ada session mutation masif dari JSP.
10. HTML payload diperiksa untuk halaman data-heavy.

---

## 32. Maintainability Checklist

JSP dengan JSTL yang sehat biasanya punya ciri:

- mayoritas berisi HTML,
- EL sederhana,
- core tags untuk conditional/iteration ringan,
- tidak ada scriptlet,
- tidak ada business rule panjang,
- tidak ada query/data access,
- tidak ada complex transformation,
- view model eksplisit,
- escaping jelas,
- URL dibuat dengan helper/tag yang benar,
- layout tidak copy-paste.

JSP yang mulai sakit biasanya punya ciri:

- `c:choose` sangat panjang,
- nested `c:if` banyak,
- `c:set` dipakai untuk kalkulasi,
- banyak akses nested property,
- banyak dependency ke `param`, `sessionScope`, `applicationScope`,
- taglib campur dengan scriptlet,
- redirect/import dari JSP,
- exception ditangkap di view,
- authorization expression tersebar.

---

## 33. Refactoring Scriptlet ke JSTL + View Model

Misalnya JSP legacy:

```jsp
<%
List<Case> cases = (List<Case>) request.getAttribute("cases");
User user = (User) session.getAttribute("user");
for (Case c : cases) {
  if ("PENDING".equals(c.getStatus()) && user.hasRole("MANAGER")) {
%>
  <tr>
    <td><%= c.getReferenceNo() %></td>
    <td><a href="/cases/approve?id=<%= c.getId() %>">Approve</a></td>
  </tr>
<%
  }
}
%>
```

Tahap 1: hilangkan scriptlet mekanis:

```jsp
<c:forEach var="case" items="${cases}">
  <c:if test="${case.status == 'PENDING' and user.manager}">
    <tr>
      <td><c:out value="${case.referenceNo}" /></td>
      <td>
        <c:url var="approveUrl" value="/cases/approve">
          <c:param name="id" value="${case.id}" />
        </c:url>
        <a href="${approveUrl}">Approve</a>
      </td>
    </tr>
  </c:if>
</c:forEach>
```

Tahap 2: pindahkan rule ke view model:

```jsp
<c:forEach var="row" items="${caseList.rows}">
  <tr>
    <td><c:out value="${row.referenceNo}" /></td>
    <td>
      <c:if test="${row.showApproveAction}">
        <a href="${row.approveUrl}">Approve</a>
      </c:if>
    </td>
  </tr>
</c:forEach>
```

Tahap 3: action model reusable:

```jsp
<c:forEach var="row" items="${caseList.rows}">
  <tr>
    <td><c:out value="${row.referenceNo}" /></td>
    <td>
      <c:forEach var="action" items="${row.actions}">
        <c:if test="${action.visible}">
          <a href="${action.url}"><c:out value="${action.label}" /></a>
        </c:if>
      </c:forEach>
    </td>
  </tr>
</c:forEach>
```

Tahap 1 membuat JSP lebih aman. Tahap 2 membuat desain lebih benar. Tahap 3 membuat UI scalable.

---

## 34. Decision Table: Tag Mana Dipakai Kapan?

| Kebutuhan | Tag | Catatan |
|---|---|---|
| Render user text | `c:out` | Default aman untuk HTML text, tetap perhatikan konteks |
| Render block jika data ada | `c:if` | Expression sederhana saja |
| Render salah satu dari beberapa block | `c:choose` | Untuk variasi UI, bukan workflow matrix |
| Render rows/list | `c:forEach` | Data sudah siap, tidak lazy-load |
| Render CSV legacy | `c:forTokens` | Prefer list untuk kode baru |
| Buat URL dengan parameter | `c:url` + `c:param` | Hindari string concat |
| Simpan variable render lokal | `c:set` | Hindari session/application dari JSP |
| Hapus variable | `c:remove` | Jarang, hati-hati flash/session side effect |
| Tangkap error optional | `c:catch` | Jangan telan defect penting |
| Import resource | `c:import` | Hindari URL eksternal/user-controlled |
| Redirect | `c:redirect` | Prefer controller redirect |

---

## 35. Hubungan JSTL dengan Faces

Nanti saat masuk Jakarta Faces, kamu akan melihat bahwa Facelets juga bisa memakai tag JSTL tertentu. Tetapi ada jebakan besar:

> JSTL tags berjalan sebagai tag handler pada build/render view tertentu, sedangkan Faces components hidup dalam component tree dan lifecycle.

Akibatnya, memakai `c:if` atau `c:forEach` sembarangan di Facelets bisa menghasilkan bug lifecycle, state, Ajax partial rendering, dan component id.

Dalam JSP, JSTL adalah mekanisme utama view control. Dalam Faces, banyak kasus lebih tepat memakai component attributes seperti:

```xml
rendered="#{bean.visible}"
```

atau komponen iterasi Faces daripada JSTL.

Pembahasan detailnya nanti di Part 15 dan Part 17.

---

## 36. Top 1% Mental Model: Jangan Berhenti di “Bisa Render”

Engineer biasa bertanya:

```text
Bagaimana cara menampilkan list di JSP?
```

Engineer kuat bertanya:

```text
Siapa yang menentukan data list ini?
Apakah data sudah difilter dan diauthorize?
Apakah loop ini bisa memicu lazy loading?
Apakah output sudah di-escape sesuai konteks?
Apakah URL aman terhadap context path dan parameter encoding?
Apakah action yang disembunyikan tetap dienforce server-side?
Apakah JSP ini tetap mudah dites jika rule berubah?
Apakah state masuk request/session/application dengan benar?
Apakah halaman ini aman pada multi-tab, refresh, dan double submit?
```

JSTL core tags bukan sekadar syntax. Ia adalah titik temu antara:

- presentation logic,
- state boundary,
- security rendering,
- URL correctness,
- performance,
- maintainability,
- migration compatibility.

Kalau kamu memahami batas-batas itu, kamu tidak hanya bisa menulis JSP. Kamu bisa menilai apakah sebuah JSP enterprise akan tetap sehat setelah bertahun-tahun perubahan requirement.

---

## 37. Ringkasan

Pada part ini kita memahami bahwa:

1. JSTL/Jakarta Tags core library menggantikan scriptlet untuk common view control.
2. Core tags harus dipakai untuk rendering-level logic, bukan business logic.
3. `c:out` membantu escaping, tetapi escaping harus sesuai konteks.
4. `c:set` dan `c:remove` harus dipakai hemat, terutama jangan sembarang menulis session/application.
5. `c:if` dan `c:choose` cocok untuk conditional rendering sederhana.
6. `c:forEach` cocok untuk list/table, tetapi data harus sudah disiapkan dan aman dari lazy loading tersembunyi.
7. `c:url` dan `c:param` lebih aman daripada string concatenation URL.
8. `c:redirect`, `c:import`, dan `c:catch` ada gunanya, tetapi sering menjadi tanda desain yang kurang bersih.
9. Authorization visibility di JSP bukan enforcement.
10. View model pattern membuat JSTL jauh lebih aman, testable, dan scalable.
11. JSP yang sehat berisi HTML + EL sederhana + tag ringan, bukan workflow, query, atau policy.

---

## 38. Latihan Praktis

### Latihan 1 — Refactor Scriptlet

Ambil JSP legacy dengan loop scriptlet. Refactor menjadi:

1. JSTL mekanis,
2. JSTL + view model,
3. action model reusable.

Evaluasi perbedaan readability, testability, dan security.

### Latihan 2 — Review Security

Cari semua output `${...}` langsung di JSP. Klasifikasikan konteksnya:

- HTML text,
- HTML attribute,
- URL,
- JavaScript,
- CSS.

Tentukan encoding yang tepat untuk masing-masing.

### Latihan 3 — Detect Business Logic in JSP

Cari semua `c:if` dan `c:choose`. Tandai expression yang:

- hanya UI rendering,
- mengandung authorization,
- mengandung workflow,
- mengandung business calculation.

Pindahkan kategori 2–4 ke view model/policy layer.

### Latihan 4 — Diagnose Performance

Ambil tabel JSP yang memakai `c:forEach`. Periksa:

- jumlah row maksimum,
- jumlah nested EL per row,
- apakah getter bisa memicu lazy loading,
- ukuran HTML output,
- apakah pagination server-side sudah benar.

---

## 39. Preview Part Berikutnya

Part berikutnya akan membahas:

```text
08-formatting-i18n-xml-sql-tags-what-to-use-and-avoid.md
```

Fokusnya:

- `fmt:*` untuk formatting dan internationalization,
- locale/timezone/resource bundle,
- XML tags dan kapan masih relevan,
- SQL tags dan mengapa hampir selalu harus dihindari pada enterprise modern,
- layering violation analysis,
- strategi i18n yang tidak merusak domain dan view model.

---

## 40. Status Seri

Seri belum selesai.

Kita sudah menyelesaikan:

- Part 0 — Orientation: Mental Model Server-Side UI di Java
- Part 1 — Historical Evolution dan Compatibility Matrix
- Part 2 — Jakarta Pages/JSP Internal Architecture
- Part 3 — JSP Syntax Deep Dive
- Part 4 — Request, Session, Application Scope
- Part 5 — Expression Language Fundamentals
- Part 6 — Advanced EL
- Part 7 — Jakarta Standard Tag Library Core Tags

Berikutnya:

- Part 8 — Formatting, I18N, XML, and SQL Tags: What to Use and What to Avoid

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 6 — Advanced Expression Language: Custom Functions, Custom Resolvers, Security, and Performance](./06-advanced-el-custom-functions-resolvers-security-performance.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 8 — Formatting, I18N, XML, and SQL Tags: What to Use and What to Avoid](./08-formatting-i18n-xml-sql-tags-what-to-use-and-avoid.md)

</div>