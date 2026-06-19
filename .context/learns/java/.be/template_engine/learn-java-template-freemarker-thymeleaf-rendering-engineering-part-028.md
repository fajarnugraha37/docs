# learn-java-template-freemarker-thymeleaf-rendering-engineering-part-028

# Part 28 — Migration Engineering: JSP to Thymeleaf/FreeMarker, Legacy Templates, and Modernization

## 0. Posisi Part Ini dalam Series

Pada part sebelumnya kita sudah membahas integrasi rendering dengan MVC, REST, batch, messaging, BPMN, dan case management. Sekarang kita masuk ke problem yang sangat sering muncul di sistem enterprise Java: **migrasi dari template lama ke template engine modern tanpa merusak perilaku production**.

Scope part ini:

- migrasi dari JSP/Jakarta Pages ke Thymeleaf untuk server-side HTML.
- migrasi dari JSP/custom string template/Velocity-style legacy template ke FreeMarker untuk email, dokumen, konfigurasi, XML, text, dan artifact generation.
- modernisasi struktur controller, model, layout, fragment, taglib, JSTL, EL, dan scriptlet.
- strangler migration supaya perubahan bisa bertahap.
- parallel rendering comparison agar hasil lama dan baru bisa dibandingkan.
- visual regression, security regression, dan rollback plan.

Inti part ini:

> Migrasi template bukan pekerjaan “ubah syntax”. Migrasi template adalah pekerjaan **behavior preservation + boundary redesign + risk reduction**.

Kalau hanya mengganti `.jsp` menjadi `.html` atau `.ftlh`, kita sering hanya memindahkan masalah lama ke teknologi baru.

Kalau dilakukan benar, migrasi template adalah kesempatan untuk memperbaiki:

- coupling view ke domain entity.
- scriptlet dan business logic di view.
- layout duplication.
- XSS risk.
- hidden authorization logic.
- inconsistent i18n.
- fragile form binding.
- template yang tidak bisa dites.
- output dokumen/email yang tidak versioned.
- page rendering yang memicu N+1 query.

---

## 1. Mental Model: Migrasi Template sebagai Perubahan Boundary

Template lama biasanya tidak hanya berisi markup. Ia sering mengandung campuran:

```text
HTML
+ JSP tags
+ JSTL
+ Expression Language
+ Java scriptlet
+ include
+ session access
+ request attributes
+ security checks
+ formatting
+ data traversal
+ accidental business rules
+ hidden assumptions
```

Maka migrasi tidak cukup bertanya:

```text
Bagaimana cara menulis ulang <c:forEach> ke th:each?
```

Pertanyaan yang lebih benar:

```text
Perilaku apa yang sedang dikodekan di template lama?
Mana yang presentation logic?
Mana yang business logic?
Mana yang authorization logic?
Mana yang formatting logic?
Mana yang sebenarnya bug tapi sudah menjadi behavior yang user kenal?
Mana yang harus dipertahankan, mana yang harus diperbaiki?
```

### 1.1 Template Migration Invariant

Invariant utama migrasi:

```text
Untuk input state yang sama,
output baru harus sama secara perilaku,
atau berbeda secara sengaja, terdokumentasi, dan disetujui.
```

“Perilaku” tidak selalu berarti byte-by-byte sama. Untuk HTML page, perilaku bisa berarti:

- field yang sama terlihat.
- tombol yang sama muncul untuk permission yang sama.
- error message muncul di lokasi yang masuk akal.
- form submit mengirim parameter yang sama.
- link mengarah ke endpoint yang sama.
- CSRF tetap valid.
- page bisa dibaca screen reader.
- client-side script tetap bekerja.
- visual appearance tidak berubah di luar acceptable tolerance.

Untuk email/dokumen, perilaku sering lebih ketat:

- wording harus sama.
- numbering harus sama.
- salutation harus sama.
- locale/date/amount formatting harus sama.
- attachment reference harus sama.
- legal footer harus sama.
- template version harus tercatat.
- hasil rendering harus reproducible.

### 1.2 Migration Is Not Refactoring Only

Refactoring mengubah internal structure tanpa mengubah external behavior. Migrasi template sering mencampur tiga jenis perubahan:

1. **Translation** — syntax lama diterjemahkan ke syntax baru.
2. **Refactoring** — struktur diperbaiki tanpa mengubah behavior.
3. **Redesign** — behavior atau boundary sengaja diubah.

Masalah muncul ketika tiga hal ini dicampur tanpa label.

Contoh buruk:

```text
Migrate JSP to Thymeleaf and clean up everything.
```

Ini terlalu ambigu. “Clean up” bisa berarti:

- mengubah HTML.
- mengubah controller.
- mengubah DTO.
- mengubah validation.
- mengubah authorization check.
- mengubah form parameter.
- mengubah CSS class.
- mengubah JS hook.

Lebih aman:

```text
Phase 1: Behavior-preserving migration.
Phase 2: Remove scriptlet/business logic.
Phase 3: Layout/component consolidation.
Phase 4: Security/i18n/accessibility hardening.
Phase 5: Performance and test modernization.
```

---

## 2. JSP/Jakarta Pages Baseline: Apa yang Sebenarnya Dimigrasikan?

JSP/Jakarta Pages adalah template technology untuk web application Java. Pada runtime, page diproses sebagai template yang menghasilkan response, dan secara historis JSP sangat dekat dengan Servlet model.

Dalam legacy system, JSP sering memakai:

- JSP directives: `<%@ page ... %>`, `<%@ include ... %>`, `<%@ taglib ... %>`.
- JSP expressions: `<%= value %>`.
- JSP scriptlets: `<% ... Java code ... %>`.
- JSP declarations: `<%! ... %>`.
- JSP Standard Tag Library/JSTL: `<c:if>`, `<c:forEach>`, `<fmt:message>`, `<fmt:formatDate>`.
- Expression Language: `${user.name}`.
- custom tag libraries.
- Spring form tags: `<form:form>`, `<form:input>`, `<form:errors>`.
- Spring security tags: `<sec:authorize>`.
- include/layout frameworks seperti Tiles/Sitemesh/custom include.

### 2.1 JSP Strengths yang Harus Diakui

Migrasi yang matang tidak memulai dari “JSP jelek”. JSP punya kekuatan historis:

- integrasi kuat dengan Servlet container.
- familiar di banyak enterprise codebase.
- taglib ecosystem matang.
- Spring form tag support kuat.
- compatible dengan banyak application server.
- bisa sangat powerful karena dekat dengan Java.

Masalahnya bukan JSP sebagai teknologi saja. Masalah biasanya berasal dari **kebebasan berlebihan** yang dibiarkan terlalu lama:

- scriptlet Java di view.
- query atau service call di JSP.
- session/request object diakses langsung.
- entity graph ditelusuri langsung dari view.
- include chain tidak terkontrol.
- taglib custom tidak terdokumentasi.
- escaping inconsistent.
- layout duplication.
- tidak ada test untuk output.

### 2.2 Apa Target Migrasinya?

Tidak semua JSP harus pindah ke target yang sama.

Gunakan Thymeleaf ketika targetnya:

- server-side HTML page.
- form-heavy MVC page.
- page yang butuh natural template/prototype.
- Spring MVC page dengan validation/error binding.
- admin portal / internal portal / case workflow UI.
- UI yang perlu fragment/layout/component server-side.

Gunakan FreeMarker ketika targetnya:

- email HTML/text.
- letter/correspondence.
- HTML pre-render untuk PDF.
- XML/text/config/source generation.
- template yang tidak terikat Servlet/MVC.
- dynamic template catalog.
- batch rendering.
- platform correspondence/document generation.

Jangan pindahkan semua JSP ke Thymeleaf hanya karena “lebih modern”. Untuk output non-HTML atau email/dokumen, FreeMarker sering lebih natural karena ia adalah general-purpose text output engine.

---

## 3. Migration Anti-Patterns

Sebelum membahas strategi benar, pahami pola gagal yang sering terjadi.

### 3.1 Big Bang Rewrite

```text
Semua JSP diganti ke Thymeleaf dalam satu release besar.
```

Risiko:

- terlalu banyak regression surface.
- QA tidak mampu membandingkan semua page.
- rollback sulit.
- visual bug tersebar.
- form submit rusak diam-diam.
- permission rendering berubah.
- hidden JS hook hilang.
- deadline memaksa kompromi security/testing.

Big bang hanya masuk akal untuk aplikasi kecil, low-risk, dan page count sangat terbatas.

### 3.2 Syntax-Only Translation

```jsp
<c:forEach var="item" items="${items}">
  ${item.name}
</c:forEach>
```

Menjadi:

```html
<tr th:each="item : ${items}">
  <td th:text="${item.name}"></td>
</tr>
```

Ini belum tentu salah, tapi sering melewatkan pertanyaan besar:

- `items` berasal dari mana?
- apakah `item.name` lazy-loaded?
- apakah `name` sudah escaped?
- apakah null boleh muncul?
- apakah order deterministik?
- apakah authorization filtering sudah dilakukan?
- apakah old page punya hidden behavior?

### 3.3 Migrasi Sambil Mengubah Business Rule

Buruk:

```text
Di JSP lama status APPROVED dan AUTO_APPROVED tampil sebagai Approved.
Di template baru hanya APPROVED yang tampil sebagai Approved.
```

Bisa jadi ini bug fix, tapi kalau tidak dicatat, QA akan melihatnya sebagai regression.

### 3.4 Membawa Entity Langsung ke Template Baru

Legacy JSP sering mengakses entity langsung:

```jsp
${case.application.applicant.profile.address.postalCode}
```

Migrasi buruk:

```html
<span th:text="${case.application.applicant.profile.address.postalCode}"></span>
```

Ini memindahkan coupling lama ke Thymeleaf.

Target lebih baik:

```html
<span th:text="${caseSummary.applicantPostalCode}"></span>
```

Controller/presenter menyiapkan `CaseSummaryViewModel`.

### 3.5 Mengganti Include dengan Fragment Tanpa Arsitektur

Legacy:

```jsp
<jsp:include page="/WEB-INF/jsp/common/header.jsp" />
```

Migrasi buruk:

```html
<div th:replace="~{common/header :: header}"></div>
```

Kalau tidak ada design system, fragment baru akan menjadi include spaghetti baru.

### 3.6 Membiarkan Security Tag Menjadi UI-Only Authorization

Legacy:

```jsp
<sec:authorize access="hasRole('ADMIN')">
  <a href="/admin/delete">Delete</a>
</sec:authorize>
```

Migrasi ke Thymeleaf security dialect boleh dilakukan, tapi harus tetap diingat:

```text
Hiding button is not authorization.
Backend endpoint must enforce authorization.
```

### 3.7 Tidak Membuat Regression Harness

Migrasi template tanpa harness berarti hanya mengandalkan manual QA. Untuk aplikasi enterprise, ini tidak cukup.

Minimum harness:

- route/page inventory.
- sample data matrix.
- screenshot comparison.
- HTML semantic assertion.
- form parameter compatibility check.
- security/escaping regression.
- old vs new output comparison untuk email/dokumen.

---

## 4. Migration Strategy Overview

Strategi aman biasanya bertahap:

```text
1. Inventory
2. Classification
3. Risk scoring
4. Target mapping
5. Compatibility harness
6. Strangler setup
7. Page/template migration
8. Parallel comparison
9. Controlled rollout
10. Cleanup and hardening
```

### 4.1 Inventory

Kumpulkan semua template lama:

```text
/WEB-INF/jsp/**/*.jsp
/WEB-INF/tags/**/*.tag
/WEB-INF/**/*.tagx
*.jspf
Tiles definitions
Sitemesh decorators
custom taglib descriptors
message bundles
CSS/JS dependencies
controller mappings
```

Untuk setiap template, catat:

- path.
- route/controller yang menggunakan.
- layout/decorator.
- includes.
- taglibs.
- forms.
- security tags.
- scriptlets.
- custom tags.
- JS dependencies.
- model attributes required.
- output type.
- owner module.
- usage frequency.
- risk level.

Contoh inventory table:

| Field | Example |
|---|---|
| Template | `/WEB-INF/jsp/case/detail.jsp` |
| Route | `GET /cases/{id}` |
| Controller | `CaseController#detail` |
| Model Attributes | `case`, `permissions`, `comments`, `attachments` |
| Includes | `common/header.jsp`, `case/tabs.jspf` |
| Taglibs | JSTL core/fmt, Spring form, Security tag |
| Scriptlet | no |
| Forms | comment form, upload form |
| JS Hooks | `.js-comment-submit`, `#case-tabs` |
| Risk | high |
| Target | Thymeleaf |

### 4.2 Classification

Klasifikasikan template berdasarkan jenis:

| Type | Example | Target Likely |
|---|---|---|
| Simple read-only page | dashboard card, status page | Thymeleaf |
| Form page | create/edit workflow | Thymeleaf |
| Table/list page | search results | Thymeleaf |
| Email JSP | old HTML email | FreeMarker or Thymeleaf email |
| PDF pre-render JSP | HTML printed as PDF | FreeMarker/Thymeleaf + PDF pipeline |
| XML/text output | external integration output | FreeMarker |
| Layout/include | header/footer/sidebar | Thymeleaf fragments/layout |
| Custom taglib | reusable UI/control | Thymeleaf fragments/dialect or Java service |
| Scriptlet-heavy page | mixed business/view | refactor before/while migrate |

### 4.3 Risk Scoring

Risk score membantu urutan migrasi.

Faktor risiko:

- user-facing criticality.
- transaction write path.
- number of forms.
- number of roles/permissions.
- custom tags.
- scriptlets.
- client-side JS coupling.
- regulatory/legal output.
- historical bugs.
- lack of test data.
- high traffic.

Contoh scoring:

```text
risk = businessCriticality
     + formComplexity
     + authorizationComplexity
     + scriptletComplexity
     + jsCoupling
     + outputDefensibility
     + traffic
     - existingTestCoverage
```

Urutan migrasi tidak selalu dari paling mudah. Pola yang sehat:

1. satu page mudah sebagai pilot.
2. satu page medium untuk membuktikan form/layout.
3. satu page high-risk dengan harness kuat.
4. batch per module setelah pattern stabil.

---

## 5. JSP to Thymeleaf Mapping: Syntax Bukan Tujuan, Tapi Tetap Perlu Dikuasai

Bagian ini memberi mapping praktis, tetapi ingat: mapping syntax hanyalah permukaan.

### 5.1 JSP Expression / EL ke Thymeleaf `th:text`

JSP:

```jsp
${user.displayName}
```

Thymeleaf:

```html
<span th:text="${user.displayName}">Sample User</span>
```

Catatan:

- `th:text` escaped by default.
- static body `Sample User` berguna untuk prototype.
- jangan memakai `th:utext` kecuali data sudah disanitasi dan benar-benar HTML safe.

### 5.2 JSTL `c:if` ke `th:if`

JSP:

```jsp
<c:if test="${case.closed}">
  <span>Closed</span>
</c:if>
```

Thymeleaf:

```html
<span th:if="${case.closed}">Closed</span>
```

Lebih baik dengan view model:

```html
<span th:if="${caseSummary.closed}">Closed</span>
```

### 5.3 JSTL `c:choose` ke `th:switch`

JSP:

```jsp
<c:choose>
  <c:when test="${status == 'APPROVED'}">Approved</c:when>
  <c:when test="${status == 'REJECTED'}">Rejected</c:when>
  <c:otherwise>Pending</c:otherwise>
</c:choose>
```

Thymeleaf:

```html
<span th:switch="${status}">
  <span th:case="'APPROVED'">Approved</span>
  <span th:case="'REJECTED'">Rejected</span>
  <span th:case="*">Pending</span>
</span>
```

Namun untuk display label status, lebih baik precompute:

```java
record CaseStatusView(String code, String label, String cssClass) {}
```

Template:

```html
<span th:text="${caseStatus.label}" th:class="${caseStatus.cssClass}"></span>
```

### 5.4 JSTL `c:forEach` ke `th:each`

JSP:

```jsp
<c:forEach var="item" items="${items}" varStatus="st">
  <tr class="${st.index % 2 == 0 ? 'even' : 'odd'}">
    <td>${st.count}</td>
    <td>${item.name}</td>
  </tr>
</c:forEach>
```

Thymeleaf:

```html
<tr th:each="item, st : ${items}" th:class="${st.even} ? 'even' : 'odd'">
  <td th:text="${st.count}">1</td>
  <td th:text="${item.name}">Item Name</td>
</tr>
```

Catatan migration:

- cek old index base: `index` 0-based, `count` 1-based.
- cek empty-list behavior.
- cek sort order.
- cek pagination.
- cek apakah old JSP menampilkan row placeholder ketika list kosong.

### 5.5 JSTL `fmt:message` ke Thymeleaf `#{...}`

JSP:

```jsp
<fmt:message key="case.detail.title" />
```

Thymeleaf:

```html
<h1 th:text="#{case.detail.title}">Case Detail</h1>
```

Parameterized:

```jsp
<fmt:message key="case.assigned.to">
  <fmt:param value="${officerName}" />
</fmt:message>
```

Thymeleaf:

```html
<span th:text="#{case.assigned.to(${officerName})}">Assigned to John</span>
```

Migration concern:

- message bundle key compatibility.
- locale resolver behavior.
- fallback behavior.
- encoding of `.properties` files.
- parameter order.

### 5.6 JSTL `fmt:formatDate` ke Utility Object / Preformatted Field

JSP:

```jsp
<fmt:formatDate value="${case.createdAt}" pattern="dd/MM/yyyy" />
```

Thymeleaf option:

```html
<span th:text="${#temporals.format(case.createdAt, 'dd/MM/yyyy')}"></span>
```

Namun untuk regulated output, lebih defensible:

```java
record CaseView(String createdAtDisplay) {}
```

Template:

```html
<span th:text="${case.createdAtDisplay}"></span>
```

Kenapa?

- timezone policy eksplisit.
- locale policy eksplisit.
- lebih mudah dites.
- template tidak memutuskan formatting kritikal.

### 5.7 Spring Form Tags ke Thymeleaf Form Binding

JSP:

```jsp
<form:form modelAttribute="caseForm" method="post">
  <form:input path="title" />
  <form:errors path="title" cssClass="error" />
  <button type="submit">Save</button>
</form:form>
```

Thymeleaf:

```html
<form th:object="${caseForm}" method="post">
  <input th:field="*{title}" />
  <div th:if="${#fields.hasErrors('title')}" th:errors="*{title}" class="error"></div>
  <button type="submit">Save</button>
</form>
```

Migration checks:

- generated `name` attribute.
- generated `id` attribute.
- hidden fields.
- checkbox hidden marker behavior.
- date conversion.
- enum conversion.
- binding error display.
- CSRF hidden input.
- PRG behavior.

### 5.8 Spring Security Tag ke Thymeleaf Security Dialect

JSP:

```jsp
<sec:authorize access="hasAuthority('CASE_APPROVE')">
  <button>Approve</button>
</sec:authorize>
```

Thymeleaf:

```html
<button sec:authorize="hasAuthority('CASE_APPROVE')">Approve</button>
```

Better for complex permission:

```html
<button th:if="${permissions.canApprove}">Approve</button>
```

Backend still enforces:

```java
@PreAuthorize("hasAuthority('CASE_APPROVE')")
@PostMapping("/{id}/approve")
public String approve(...) { ... }
```

For workflow/case systems, prefer a `permissions` view model because permission is often not only role-based; it may depend on case state, assignment, ownership, delegation, tenant, lock, and SLA condition.

### 5.9 JSP Include ke Thymeleaf Fragment

JSP:

```jsp
<jsp:include page="/WEB-INF/jsp/common/header.jsp" />
```

Thymeleaf:

```html
<header th:replace="~{common/header :: header}"></header>
```

Parameterized fragment:

```html
<header th:replace="~{common/header :: header(${activeMenu}, ${currentUser})}"></header>
```

Fragment definition:

```html
<header th:fragment="header(activeMenu, currentUser)">
  <nav>
    <span th:text="${currentUser.displayName}">User</span>
  </nav>
</header>
```

Migration warning:

- old include may rely on request/session attributes.
- new fragment should receive explicit parameters or stable layout model.
- avoid fragment reading arbitrary global state.

---

## 6. JSP to FreeMarker Mapping for Non-Web Outputs

Jika JSP lama dipakai untuk email, PDF HTML, XML, CSV, atau text generation, target yang lebih tepat sering FreeMarker.

### 6.1 JSP Email ke FreeMarker Email

Legacy JSP email:

```jsp
<p>Dear ${recipientName},</p>
<p>Your application ${applicationNo} has been approved.</p>
```

FreeMarker HTML email:

```ftl
<p>Dear ${recipientName},</p>
<p>Your application ${applicationNo} has been approved.</p>
```

Tampak mirip, tetapi architecture-nya berbeda:

```text
JSP email often depends on servlet/request context.
FreeMarker email should be pure render(templateId, version, model, locale).
```

Better render contract:

```java
record ApprovalEmailModel(
    String recipientName,
    String applicationNo,
    String approvalDateDisplay,
    String portalUrl,
    String agencyName
) {}
```

### 6.2 JSP Include ke FreeMarker Macro/Import

JSP:

```jsp
<%@ include file="/WEB-INF/jsp/email/footer.jspf" %>
```

FreeMarker:

```ftl
<#import "email/layout.ftlh" as layout>
<@layout.footer agencyName=agencyName />
```

Macro library:

```ftl
<#macro footer agencyName>
  <p class="footer">This email was sent by ${agencyName}.</p>
</#macro>
```

### 6.3 JSTL Loop ke FreeMarker `#list`

JSP:

```jsp
<c:forEach var="attachment" items="${attachments}">
  <li>${attachment.name}</li>
</c:forEach>
```

FreeMarker:

```ftl
<#list attachments as attachment>
  <li>${attachment.name}</li>
<#else>
  <li>No attachments.</li>
</#list>
```

### 6.4 JSP Conditional ke FreeMarker `#if`

JSP:

```jsp
<c:if test="${showAppealSection}">
  ...
</c:if>
```

FreeMarker:

```ftl
<#if showAppealSection>
  ...
</#if>
```

### 6.5 JSP Formatting ke Preformatted Fields

For legally important letters, avoid formatting scattered in template:

Buruk:

```ftl
${decisionDate?string('dd/MM/yyyy')}
```

Lebih defensible:

```ftl
${decisionDateDisplay}
```

Java prepares:

```java
String decisionDateDisplay = formatter.format(decisionDate.atZone(policyZone));
```

Reason:

- timezone/locale controlled in Java.
- easier golden-output tests.
- template simpler.
- avoids drift between engines.

---

## 7. Scriptlet Removal: Bagian Paling Bernilai dari Migrasi

Scriptlet adalah tanda bahwa template lama mungkin menyimpan logic yang harus diklasifikasi.

Legacy:

```jsp
<%
  boolean canApprove = false;
  if (user.hasRole("MANAGER") && caseObj.isPending() && !caseObj.isLocked()) {
      canApprove = true;
  }
%>

<% if (canApprove) { %>
  <button>Approve</button>
<% } %>
```

Jangan translate menjadi expression panjang:

```html
<button th:if="${user.hasRole('MANAGER') and case.pending and !case.locked}">Approve</button>
```

Lebih baik:

```java
record CasePermissionsView(
    boolean canApprove,
    boolean canReject,
    boolean canReassign,
    boolean canUploadDocument
) {}
```

Template:

```html
<button th:if="${permissions.canApprove}">Approve</button>
```

### 7.1 Scriptlet Classification

Untuk setiap scriptlet, kategorikan:

| Scriptlet Type | Example | Migration Target |
|---|---|---|
| Presentation condition | show/hide optional section | view model boolean |
| Formatting | date/amount/string conversion | formatter/presenter |
| Authorization | role/state check | permission service + view model |
| Business decision | approval/rejection logic | domain/service layer |
| Data fetching | DAO/service call | controller/application service |
| Aggregation | totals/counts | query/service/presenter |
| HTML helper | repeated UI snippet | fragment/macro/component |
| Debug code | print request/session | remove |

### 7.2 Scriptlet Extraction Pattern

Step-by-step:

1. Copy scriptlet into temporary migration note.
2. Identify inputs read by scriptlet.
3. Identify outputs produced by scriptlet.
4. Classify logic type.
5. Move logic to correct layer.
6. Add test for extracted logic.
7. Add field to view model.
8. Replace template logic with simple field access.
9. Compare old/new output.

Example extraction:

Old:

```jsp
<%
int overdueDays = ChronoUnit.DAYS.between(caseObj.getDueDate(), LocalDate.now());
String css = overdueDays > 0 ? "overdue" : "normal";
%>
<span class="<%= css %>"><%= overdueDays %></span>
```

New Java:

```java
record SlaView(
    int overdueDays,
    String cssClass,
    String displayText
) {}
```

Template:

```html
<span th:class="${sla.cssClass}" th:text="${sla.displayText}">3 days overdue</span>
```

This is not just cleaner. It is testable, deterministic, and independent from the template engine.

---

## 8. Custom Taglib Migration

Custom JSP tags are often the hidden framework inside old applications.

Examples:

```jsp
<app:statusBadge status="${case.status}" />
<app:pagination page="${page}" />
<app:field label="Name" path="applicant.name" />
<app:permission code="CASE_APPROVE">...</app:permission>
```

### 8.1 Inventory Custom Tags

For every custom tag:

- tag name.
- attributes.
- body behavior.
- output HTML.
- dependencies.
- security behavior.
- escaping behavior.
- whether it calls services.
- whether it uses request/session.
- whether it mutates page context.

### 8.2 Migration Target Decision

| Custom Tag Behavior | Target |
|---|---|
| Simple repeated markup | Thymeleaf fragment |
| Reusable email/document block | FreeMarker macro |
| Complex UI with server-side data | presenter + Thymeleaf fragment |
| Permission wrapper | permission view model or security dialect |
| Formatting helper | Java formatter/presenter |
| Cross-cutting transformation | custom Thymeleaf dialect/directive only if justified |
| Dangerous service call | remove from view layer |

### 8.3 Avoid Overusing Custom Dialects

Thymeleaf custom dialects are powerful, but do not turn every JSP custom tag into a custom dialect.

Prefer:

```text
Fragment + ViewModel + Presenter
```

Before:

```text
Custom Dialect
```

Use custom dialect when:

- behavior is truly cross-cutting.
- syntax improves safety/consistency.
- implementation is stable.
- testing burden is acceptable.
- team understands Thymeleaf processor lifecycle.

Example that may justify dialect:

- standardized authorization attributes.
- design-system attributes.
- audit-safe redaction rendering.
- tenant branding processor.

Example that should not be dialect:

- one-off status badge.
- simple table component.
- normal form field layout.

---

## 9. Layout Migration: Tiles/Sitemesh/JSP Include to Thymeleaf Layouts

Legacy JSP apps often have layout systems like:

```text
header.jsp
footer.jsp
sidebar.jsp
menu.jsp
common.jspf
Tiles definitions
Sitemesh decorator
```

Migrating layout is risky because layout affects all pages.

### 9.1 Layout Inventory

Document:

- all layout files.
- nested include structure.
- per-page override regions.
- CSS/JS injection points.
- title/meta handling.
- active menu logic.
- breadcrumb logic.
- flash message handling.
- error banner handling.
- role-based menu items.

### 9.2 Layout Migration Options

Option A — Native Thymeleaf fragments:

```html
<html>
<head th:replace="~{layout/head :: head(${pageTitle})}"></head>
<body>
  <header th:replace="~{layout/header :: header(${layout})}"></header>
  <main>
    page content
  </main>
  <footer th:replace="~{layout/footer :: footer}"></footer>
</body>
</html>
```

Option B — Thymeleaf Layout Dialect:

```html
<html layout:decorate="~{layout/main}">
<section layout:fragment="content">
  page content
</section>
</html>
```

Option C — Hybrid during migration:

- keep old JSP layout for old pages.
- introduce Thymeleaf layout for new pages.
- share CSS/JS assets.
- route gradually.

### 9.3 Layout Model

Avoid fragments reading many global variables. Create a `LayoutModel`:

```java
record LayoutModel(
    String pageTitle,
    UserMenuView userMenu,
    List<MenuItemView> mainMenu,
    List<BreadcrumbView> breadcrumbs,
    List<FlashMessageView> flashMessages,
    String activeModule,
    TenantBrandingView branding
) {}
```

Template:

```html
<header th:replace="~{layout/header :: header(${layout})}"></header>
```

This makes layout dependencies explicit.

---

## 10. Controller Migration: Clean Model Boundary

Old controllers often prepare model in inconsistent ways:

```java
model.addAttribute("case", caseEntity);
model.addAttribute("user", session.getUser());
model.addAttribute("statusList", statusRepository.findAll());
model.addAttribute("canApprove", securityService.canApprove(user, caseEntity));
```

For migration, introduce page-specific view models:

```java
@GetMapping("/cases/{id}")
public String detail(@PathVariable Long id, Model model) {
    CaseDetailPage page = caseDetailPageAssembler.assemble(id, currentUser());
    model.addAttribute("page", page);
    return "case/detail";
}
```

Template:

```html
<h1 th:text="${page.title}">Case Detail</h1>
<span th:text="${page.caseNo}">CASE-001</span>
<button th:if="${page.permissions.canApprove}">Approve</button>
```

### 10.1 Page View Model Pattern

```java
record CaseDetailPage(
    LayoutModel layout,
    String caseNo,
    String statusLabel,
    String statusCssClass,
    ApplicantView applicant,
    List<AttachmentView> attachments,
    CasePermissionsView permissions,
    CommentForm commentForm
) {}
```

Benefits:

- template contract is obvious.
- controller becomes thin.
- model can be tested without rendering.
- avoids exposing entity graph.
- avoids lazy-loading surprises.
- improves permission consistency.

### 10.2 Avoid `Map<String, Object>` as Internal Contract

`Model` is already map-like. Do not make your assembler return untyped maps everywhere.

Less ideal:

```java
Map<String, Object> page = new HashMap<>();
page.put("caseNo", caseNo);
page.put("status", status);
```

Better:

```java
record CaseDetailPage(...) {}
```

Use maps only for dynamic template platforms where schema is stored externally and validated separately.

---

## 11. Form Migration: The Most Dangerous HTML Migration Surface

Read-only pages are relatively easy. Forms are risky because they affect input behavior.

### 11.1 Form Compatibility Checklist

For every migrated form, compare old/new:

- HTTP method.
- action URL.
- query parameters.
- field `name` attributes.
- hidden fields.
- checkbox behavior.
- radio behavior.
- selected option behavior.
- disabled/readonly fields.
- validation messages.
- global errors.
- field errors.
- CSRF token.
- multipart encoding.
- date/time formats.
- enum values.
- collection indexes.
- nested object paths.
- cancel/back button behavior.
- default values.
- duplicate submit protection.

### 11.2 Old Spring Form Tag to Thymeleaf

Old:

```jsp
<form:form modelAttribute="appealForm" action="${submitUrl}" method="post">
  <form:hidden path="caseId" />
  <form:textarea path="reason" />
  <form:errors path="reason" cssClass="error" />
</form:form>
```

New:

```html
<form th:object="${appealForm}" th:action="${submitUrl}" method="post">
  <input type="hidden" th:field="*{caseId}" />
  <textarea th:field="*{reason}"></textarea>
  <div th:if="${#fields.hasErrors('reason')}" th:errors="*{reason}" class="error"></div>
</form>
```

### 11.3 Over-Posting Review

Migration is a good time to prevent mass assignment.

Bad form object:

```java
class CaseEntity {
    private Long id;
    private String status;
    private String assignee;
    private boolean locked;
    private String applicantName;
}
```

Better command object:

```java
record SubmitAppealCommand(
    Long caseId,
    String reason
) {}
```

Backend decides whether caseId is valid and current user can submit appeal.

### 11.4 Collection Binding Migration

Old JSP might render dynamic rows with indexed names:

```html
<input name="items[0].name" />
<input name="items[1].name" />
```

Thymeleaf:

```html
<tr th:each="item, st : *{items}">
  <input th:field="*{items[__${st.index}__].name}" />
</tr>
```

Migration risks:

- index gaps.
- deleted row behavior.
- client-side dynamic add/remove.
- hidden id fields.
- optimistic locking version fields.
- validation errors mapped back to correct row.

---

## 12. URL and Routing Compatibility

JSP often constructs URLs in several ways:

```jsp
<c:url value="/cases/${case.id}" />
<a href="${contextPath}/cases/${case.id}">
```

Thymeleaf:

```html
<a th:href="@{/cases/{id}(id=${case.id})}">View</a>
```

Migration checklist:

- context path handling.
- path variable encoding.
- query parameter encoding.
- trailing slash behavior.
- absolute vs relative URL.
- reverse proxy path prefix.
- locale prefix.
- tenant prefix.
- old bookmarked URLs.
- SEO/canonical links if public.

### 12.1 Do Not Break JS Selectors Accidentally

Old JSP:

```html
<a id="approveBtn" class="btn approve-action" data-case-id="${case.id}">Approve</a>
```

New template must preserve JS hooks unless JS is also migrated:

```html
<a id="approveBtn"
   class="btn approve-action"
   th:attr="data-case-id=${page.caseId}">Approve</a>
```

If changing hooks, make it explicit and include JS regression testing.

---

## 13. Data and Lazy Loading Regression

Legacy JSP often triggers lazy loading during rendering:

```jsp
${case.application.applicant.address.line1}
```

If Open Session in View is enabled, page rendering may accidentally call DB during view rendering.

During migration, do not preserve this behavior blindly.

### 13.1 Detect N+1 from Template

Signs:

- page render triggers many SQL queries.
- list page slow only with many rows.
- template traverses nested entity graph.
- session open during view.
- entity getters perform computed lookup.

### 13.2 Fix Pattern

Move data loading before render:

```java
CaseDetailProjection projection = caseQueryRepository.fetchCaseDetail(id);
CaseDetailPage page = assembler.toPage(projection, permissions);
```

Template only reads flat/prepared fields.

### 13.3 Migration Gate

For high-risk pages, record:

```text
Old page SQL count: 87
New page SQL count target: <= 10
```

Migration success is not just visual equivalence; it can also be performance improvement if behavior is approved.

---

## 14. Security Regression During Migration

Template migration can create security bugs even when old page was safe.

### 14.1 XSS Escaping Drift

Old JSP using JSTL EL may escape or not depending on tag usage. Thymeleaf `th:text` escapes by default; `th:utext` does not.

Migration rule:

```text
Default to escaped output.
Raw HTML must be a named, reviewed, sanitized value.
```

Example:

```java
record RichTextView(
    String sanitizedHtml
) {}
```

Template:

```html
<div th:utext="${richText.sanitizedHtml}"></div>
```

But only after sanitizer and policy are documented.

### 14.2 Hidden Field Leakage

Legacy forms may include hidden fields:

```jsp
<form:hidden path="internalStatus" />
<form:hidden path="assignedOfficerId" />
```

During migration, ask:

- should client be allowed to see this?
- should client be allowed to submit this?
- is server trusting this value?
- can it be tampered?

Better:

```text
Only submit command fields that user can control.
Server reloads internal state from DB.
```

### 14.3 Authorization Rendering Drift

Old page hides button for role X. New page may accidentally show it.

Test matrix:

| Role/User State | Expected Buttons |
|---|---|
| applicant | withdraw, view |
| officer assigned | review, request info |
| officer not assigned | view only |
| manager | approve, reject, reassign |
| admin | admin actions |
| locked case | no mutation buttons |
| closed case | view only |

Do not rely only on visual manual check.

### 14.4 CSRF Regression

If old Spring form tags automatically emitted CSRF token under certain setup, ensure new Thymeleaf forms still include CSRF token.

Test unsafe methods:

- POST.
- PUT.
- PATCH.
- DELETE.

Verify rejected when token missing/invalid.

### 14.5 CSP and Inline Script

JSP pages often embed inline script with server values:

```jsp
<script>
  var caseId = '${case.id}';
</script>
```

Migration should not multiply inline scripts. Prefer:

```html
<div id="casePage" th:attr="data-case-id=${page.caseId}"></div>
```

Or JSON script block with safe serialization and CSP strategy.

---

## 15. Parallel Rendering Comparison

For high-risk pages/templates, run old and new renderers side by side in non-production, or shadow mode if safe.

### 15.1 HTML Page Comparison

Pipeline:

```text
same route input
same database fixture
same user/session/locale
render old JSP
render new Thymeleaf
normalize output
compare semantic structure
screenshot compare
record diff
```

Normalization:

- remove CSRF token value.
- remove dynamic nonce.
- normalize whitespace.
- ignore generated IDs if accepted.
- ignore timestamp if not part of behavior.

### 15.2 Email/Document Comparison

For email/document migration, comparison can be stricter:

```text
same template input
render old output
render new output
normalize dynamic values
compare text/HTML/PDF visual
approve intentional differences
```

Track diff status:

| Diff Type | Action |
|---|---|
| whitespace only | likely accept |
| CSS class changed | check visual/JS impact |
| wording changed | business approval needed |
| field missing | defect unless intentional |
| date/amount format changed | high-risk review |
| authorization section changed | security review |
| link changed | functional review |

### 15.3 Golden Master Tests

Create a golden output file for stable artifact:

```text
src/test/resources/golden/case-approval-letter/en-SG/approved-basic.html
```

Test renders new template and compares normalized output.

For HTML page, use semantic assertions rather than brittle byte comparison:

- title exists.
- button appears/disappears.
- form fields exist.
- error message appears.
- table row count.
- specific link URL.
- no raw `<script>` injection from user input.

---

## 16. Strangler Migration Architecture

A strangler approach allows old and new template systems to coexist.

### 16.1 Route-Based Strangler

```text
/cases/old/** -> JSP
/cases/new/** -> Thymeleaf
```

Good for pilot, but URLs change.

### 16.2 Feature Flag Based Strangler

```java
@GetMapping("/cases/{id}")
public String detail(...) {
    if (featureFlags.useThymeleafCaseDetail(user)) {
        model.addAttribute("page", newPageAssembler.assemble(id));
        return "case/detail";
    }
    model.addAttribute("case", oldModelAssembler.assemble(id));
    return "jsp/case/detail";
}
```

Better for controlled rollout.

### 16.3 Module-Based Strangler

Migrate one bounded area at a time:

```text
Survey module -> Thymeleaf
Correspondence emails -> FreeMarker
Case detail pages -> later
Admin lookup pages -> later
```

### 16.4 Output-Type Strangler

Move non-web outputs first:

```text
email templates -> FreeMarker
PDF pre-render -> FreeMarker/Thymeleaf
MVC pages -> Thymeleaf later
```

This can reduce risk because email/document rendering service can be isolated.

### 16.5 Dual View Resolver

Spring MVC can resolve different view technologies depending on configuration and view names. A migration can keep JSP and Thymeleaf together temporarily:

```text
return "case/detail"       -> Thymeleaf
return "legacy/caseDetail" -> JSP
```

Convention matters. Avoid ambiguous view names.

Suggested naming:

```text
templates/                 Thymeleaf
/WEB-INF/jsp/              JSP
freemarker/                FreeMarker non-web templates
```

---

## 17. Migration Work Breakdown Structure

A reliable migration has explicit tasks.

### 17.1 Discovery Tasks

- scan all JSP/tag/tagx/jspf files.
- scan all controller return view names.
- scan all taglib usages.
- scan all scriptlets.
- scan all include directives.
- scan all forms.
- scan all security tags.
- scan all message keys.
- scan all JS selector dependencies.
- scan all CSS class dependencies.

### 17.2 Foundation Tasks

- add Thymeleaf dependency/config.
- add FreeMarker dependency/config if needed.
- configure template resolver paths.
- configure encoding UTF-8.
- configure cache for dev/prod.
- configure message source.
- configure layout/fragments base.
- configure security dialect if using Spring Security integration.
- define page view model convention.
- define template naming convention.

### 17.3 Harness Tasks

- create fixture users/roles.
- create fixture data.
- create screenshot test harness.
- create HTML assertion helper.
- create golden-output helper.
- create link checker.
- create form field comparison.
- create XSS sample test.
- create locale/timezone matrix.

### 17.4 Migration Tasks per Page

For each page:

1. freeze old behavior with fixture.
2. document route/model/form/security behavior.
3. create view model.
4. migrate layout/fragments needed.
5. migrate page template.
6. migrate form binding if any.
7. migrate validation error rendering.
8. migrate security rendering.
9. run old/new comparison.
10. fix differences.
11. get review.
12. enable behind flag.
13. monitor.
14. remove old template after stabilization.

---

## 18. Code Organization During Migration

Avoid mixing legacy and modern templates randomly.

Suggested structure:

```text
src/main/resources/templates/
  layout/
    main.html
    head.html
    header.html
    sidebar.html
    footer.html
  case/
    detail.html
    list.html
    form.html
  fragments/
    form-field.html
    pagination.html
    status-badge.html

src/main/resources/freemarker/
  email/
    layout.ftlh
    case-approved.ftlh
    case-rejected.ftlh
  document/
    notice-of-decision.ftlh

src/main/webapp/WEB-INF/jsp/
  legacy/
    ...
```

For Spring Boot executable JARs, JSP support can be awkward depending on packaging/container approach. If the existing application uses WAR deployment on an external servlet container, coexistence may be easier. Treat packaging as part of migration planning, not an afterthought.

---

## 19. Migration Quality Gates

A page/template is not “done” just because it renders.

### 19.1 Minimum Done Criteria for Read-Only Page

- route works.
- title/header correct.
- all expected fields displayed.
- escaping correct.
- empty/null states handled.
- authorization-sensitive sections correct.
- links correct.
- layout correct.
- screenshot acceptable.
- no unexpected server error in logs.
- no lazy-load query explosion.

### 19.2 Minimum Done Criteria for Form Page

All read-only criteria plus:

- form action/method correct.
- field names correct.
- binding works.
- validation errors render correctly.
- global errors render correctly.
- CSRF works.
- rejected invalid token tested.
- successful submit behavior unchanged.
- PRG behavior correct.
- double-submit behavior reviewed.
- over-posting reviewed.

### 19.3 Minimum Done Criteria for Email/Document

- old/new sample output compared.
- text wording approved.
- HTML escaped correctly.
- plain text alternative if email.
- PDF visual output if PDF.
- locale/timezone correct.
- template version recorded.
- model contract tested.
- missing variable test.
- no PII leakage beyond intended recipients.
- audit metadata captured.

---

## 20. Rollback Strategy

Rollback is not optional.

### 20.1 Route-Level Rollback

Feature flag controls view technology:

```text
case.detail.view=legacy-jsp | thymeleaf
```

### 20.2 Template Version Rollback

For email/document platform:

```text
case-approved v3 active
rollback to v2 if v3 fails
```

Important: already-sent/generated outputs should not be mutated. Rollback affects future rendering.

### 20.3 Deployment Rollback

If template code is packaged in application artifact, rollback may require app deployment rollback.

If templates are stored externally, rollback may be template metadata change. This is faster but requires stricter governance.

### 20.4 Data Compatibility Rollback

If migration changes model/data schema, rollback may fail. Avoid coupling template migration with database migration unless necessary.

Prefer:

```text
Add new fields first.
Support old and new view models temporarily.
Switch template.
Remove old fields later.
```

---

## 21. Team Workflow for Migration

Template migration touches backend, frontend, QA, UX, security, business owner, and sometimes legal/compliance.

### 21.1 Roles

| Role | Responsibility |
|---|---|
| Backend engineer | controller/model/rendering integration |
| Frontend/UI engineer | HTML/CSS/JS parity, accessibility |
| QA | regression matrix, visual/form/security testing |
| Business owner | approve wording/behavior differences |
| Security reviewer | XSS/CSRF/auth/data leakage review |
| Architect/TL | migration pattern consistency, risk control |

### 21.2 Review Checklist

Pull request should include:

- old template path.
- new template path.
- route/controller affected.
- screenshot before/after.
- behavior differences.
- test fixture used.
- security-sensitive sections.
- form compatibility notes.
- rollback flag/config.
- template/model contract changes.

### 21.3 Avoid Parallel Pattern Drift

During migration, teams may invent different approaches per page. Prevent this with:

- common layout model.
- common form fragment.
- common pagination fragment.
- common status badge fragment.
- common permission view model.
- common golden test helper.
- common naming convention.

---

## 22. Migration Example: JSP Case Detail Page to Thymeleaf

### 22.1 Legacy JSP

```jsp
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>
<%@ taglib prefix="fmt" uri="http://java.sun.com/jsp/jstl/fmt" %>
<%@ taglib prefix="sec" uri="http://www.springframework.org/security/tags" %>

<h1>Case ${case.caseNo}</h1>

<span class="status ${case.status}">${case.status}</span>

<c:if test="${not empty case.applicant.name}">
  <p>Applicant: ${case.applicant.name}</p>
</c:if>

<p>Created: <fmt:formatDate value="${case.createdAt}" pattern="dd/MM/yyyy" /></p>

<sec:authorize access="hasAuthority('CASE_APPROVE')">
  <c:if test="${case.status == 'PENDING'}">
    <form action="${contextPath}/cases/${case.id}/approve" method="post">
      <input type="hidden" name="${_csrf.parameterName}" value="${_csrf.token}" />
      <button type="submit">Approve</button>
    </form>
  </c:if>
</sec:authorize>
```

Problems:

- status CSS uses raw domain status.
- entity exposed directly.
- authorization split between security tag and status condition.
- date formatting in template.
- URL built manually.
- applicant nested graph accessed directly.

### 22.2 New View Model

```java
record CaseDetailPage(
    LayoutModel layout,
    String caseId,
    String caseNo,
    String statusLabel,
    String statusCssClass,
    String applicantName,
    boolean showApplicantName,
    String createdAtDisplay,
    CaseDetailPermissions permissions
) {}

record CaseDetailPermissions(
    boolean canApprove
) {}
```

Assembler:

```java
public CaseDetailPage assemble(Long caseId, UserPrincipal user) {
    CaseDetailProjection c = caseQuery.fetchDetail(caseId);
    CasePermissions permissions = permissionService.evaluate(user, c);

    return new CaseDetailPage(
        layoutAssembler.forPage("Case " + c.caseNo(), "case"),
        c.id().toString(),
        c.caseNo(),
        statusPresenter.label(c.status()),
        statusPresenter.cssClass(c.status()),
        nullToEmpty(c.applicantName()),
        c.applicantName() != null && !c.applicantName().isBlank(),
        dateFormatter.format(c.createdAt()),
        new CaseDetailPermissions(permissions.canApprove())
    );
}
```

### 22.3 New Thymeleaf

```html
<h1 th:text="|Case ${page.caseNo}|">Case CASE-001</h1>

<span th:class="${page.statusCssClass}" th:text="${page.statusLabel}">Pending</span>

<p th:if="${page.showApplicantName}">
  Applicant: <span th:text="${page.applicantName}">Jane Doe</span>
</p>

<p>Created: <span th:text="${page.createdAtDisplay}">01/01/2026</span></p>

<form th:if="${page.permissions.canApprove}"
      th:action="@{/cases/{id}/approve(id=${page.caseId})}"
      method="post">
  <button type="submit">Approve</button>
</form>
```

Backend endpoint still enforces:

```java
@PreAuthorize("hasAuthority('CASE_APPROVE')")
@PostMapping("/cases/{id}/approve")
public String approve(@PathVariable Long id) {
    caseCommandService.approve(id, currentUser());
    return "redirect:/cases/" + id;
}
```

### 22.4 Regression Tests

Assertions:

- case number rendered.
- status label rendered.
- status CSS class matches mapping.
- applicant name escaped.
- created date fixed to expected timezone.
- approve form shown for authorized pending case.
- approve form hidden for unauthorized user.
- approve form hidden for closed case.
- POST without CSRF rejected.
- POST by unauthorized user rejected even if form manually submitted.

---

## 23. Migration Example: JSP Email to FreeMarker

### 23.1 Legacy JSP Email

```jsp
<p>Dear ${name},</p>
<p>Your case ${caseNo} has been closed on ${closedDate}.</p>
<jsp:include page="footer.jspf" />
```

### 23.2 FreeMarker Template

`case-closed.ftlh`:

```ftl
<#import "layout/email-layout.ftlh" as layout>
<@layout.email title=subject>
  <p>Dear ${recipientName},</p>
  <p>Your case ${caseNo} has been closed on ${closedDateDisplay}.</p>
</@layout.email>
```

`email-layout.ftlh`:

```ftl
<#macro email title>
<!doctype html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
</head>
<body>
  <#nested>
  <hr>
  <p class="footer">${agencyName}</p>
</body>
</html>
</#macro>
```

### 23.3 Render Model

```java
record CaseClosedEmailModel(
    String subject,
    String recipientName,
    String caseNo,
    String closedDateDisplay,
    String agencyName
) {}
```

### 23.4 Migration Improvement

Old JSP email may depend on web context. New FreeMarker email can be rendered from:

- command handler.
- outbox consumer.
- batch job.
- BPMN service task.
- admin preview endpoint.

This is a real architecture improvement, not just syntax migration.

---

## 24. Handling Intentional Differences

Not all differences are bad. But all differences must be classified.

### 24.1 Difference Log

Maintain per migrated page/template:

| Difference | Type | Approved By | Reason |
|---|---|---|---|
| Date now uses Asia/Singapore timezone | behavior change | Product/Compliance | Old output used server timezone accidentally |
| Button CSS class changed | visual change | UX | New design system |
| Raw HTML field now sanitized | security change | Security | XSS hardening |
| Empty attachment section now hidden | UX change | Product | Reduces clutter |

### 24.2 Do Not Hide Differences in Code Review

A reviewer should not need to infer behavior changes from diff. State them clearly.

---

## 25. Performance During and After Migration

Migrating to Thymeleaf or FreeMarker does not automatically make pages faster.

### 25.1 What Can Improve

- template caching configured better.
- model precomputed.
- N+1 removed.
- layout duplication reduced.
- less scriptlet logic.
- fragments standardized.
- output streaming for large documents.

### 25.2 What Can Get Worse

- expression-heavy templates.
- too many nested fragments.
- view model assembler fetches too much.
- large table rendered server-side without pagination.
- template cache disabled in production.
- dynamic template loader hits DB per render.
- screenshot-heavy test only run too late.

### 25.3 Migration Performance Gate

For critical pages:

```text
Old p95 render latency: 280ms
New p95 target: <= 280ms unless approved
Old SQL count: 45
New SQL count target: <= 15
Old response size: 320KB
New target: <= 320KB unless approved
```

Use evidence, not feeling.

---

## 26. Java 8 to 25 Considerations

Template migration across Java versions has practical concerns.

### 26.1 Java 8 Baseline

If the application still supports Java 8:

- avoid records in production code unless using newer branch.
- use normal DTO classes.
- be careful with `java.time` support in old libs.
- check library version compatibility.
- avoid APIs introduced after Java 8.

### 26.2 Java 11/17/21/25 Modernization

For newer Java:

- records are excellent for immutable view models.
- sealed types can model template variants.
- `java.time` should be standard for rendering dates.
- virtual threads can help concurrent blocking rendering workflows, but do not fix CPU-heavy rendering.
- modern GC improves allocation behavior but does not excuse huge string generation.

### 26.3 Multi-Version Library Compatibility

Before selecting template engine version, check:

- minimum Java version.
- Spring/Spring Boot compatibility.
- Jakarta namespace compatibility.
- Servlet/Jakarta Servlet version.
- application server support.
- packaging model.

Especially for migrations from old `javax.*` stacks to `jakarta.*`, view migration may be part of a larger framework migration.

---

## 27. Final Migration Playbook

Use this as operational checklist.

### 27.1 Before Migration

```text
[ ] Inventory all JSP/tag/include/layout files.
[ ] Map routes/controllers to templates.
[ ] Identify scriptlets.
[ ] Identify custom taglibs.
[ ] Identify forms.
[ ] Identify security-sensitive sections.
[ ] Identify message bundles and locale behavior.
[ ] Identify JS/CSS hooks.
[ ] Classify templates by type and risk.
[ ] Decide target: Thymeleaf or FreeMarker.
[ ] Define view model conventions.
[ ] Define layout/component strategy.
[ ] Build regression harness.
[ ] Define rollback mechanism.
```

### 27.2 During Migration

```text
[ ] Freeze old behavior with sample data.
[ ] Create page/render model.
[ ] Extract scriptlet logic.
[ ] Migrate layout dependencies.
[ ] Migrate template syntax.
[ ] Preserve form field compatibility.
[ ] Preserve URL behavior unless approved.
[ ] Preserve JS hooks unless approved.
[ ] Add security/escaping tests.
[ ] Add authorization rendering tests.
[ ] Add locale/timezone tests if relevant.
[ ] Compare old/new output.
[ ] Record intentional differences.
[ ] Enable behind flag.
```

### 27.3 After Migration

```text
[ ] Monitor render errors.
[ ] Monitor latency.
[ ] Monitor 4xx/5xx route behavior.
[ ] Monitor form submission failures.
[ ] Collect user/QA feedback.
[ ] Remove old template after stabilization.
[ ] Remove dead taglibs/includes.
[ ] Consolidate fragments/components.
[ ] Update documentation.
[ ] Update team patterns.
```

---

## 28. Top 1% Engineering Heuristics

### 28.1 Do Not Migrate Technology; Migrate Responsibility

Wrong mental model:

```text
JSP -> Thymeleaf
```

Better:

```text
View-layer responsibilities are reallocated:
- domain decision -> domain/service
- permission decision -> authorization/permission service
- formatting policy -> presenter/formatter
- reusable UI -> fragment/component
- output transformation -> template
- audit metadata -> rendering service
```

### 28.2 Every Template Has a Contract

If a template requires `page.permissions.canApprove`, the contract should be visible in a typed model or schema.

Avoid mystery variables.

### 28.3 Preserve Behavior First, Improve Second

The fastest way to fail migration is to combine too many “improvements” with the technology change.

Better:

```text
Phase A: behavior-preserving migration.
Phase B: cleanup and hardening.
```

When improvement is urgent, document it as intentional behavior change.

### 28.4 The Hardest Bugs Are Not Syntax Bugs

The hardest migration bugs are:

- missing authorization condition.
- wrong timezone.
- over-posted hidden field.
- wrong form name.
- escaped/unescaped drift.
- JS hook changed.
- lazy-loaded value missing.
- layout include order changed.
- message bundle fallback changed.
- PDF pagination changed.

### 28.5 Strangler Beats Big Bang

A good migration makes rollback boring.

### 28.6 Template Migration Is a Great Time to Build Rendering Discipline

After migration, the system should have:

- typed view models.
- reusable layout/components.
- tested templates.
- explicit escaping strategy.
- consistent i18n.
- observable rendering errors.
- controlled template versioning for emails/documents.

If after migration the new templates are just as coupled and untested as old JSPs, the migration did not achieve engineering value.

---

## 29. Ringkasan

Migrasi JSP/legacy template ke Thymeleaf/FreeMarker adalah pekerjaan engineering yang harus menjaga behavior sambil memperbaiki boundary.

Poin paling penting:

1. Jangan melihat migrasi sebagai syntax conversion.
2. Inventarisasi dulu semua template, include, taglib, forms, security tags, scriptlets, dan JS hooks.
3. Pilih target berdasarkan output: Thymeleaf untuk server-side HTML/form UI; FreeMarker untuk email/document/text/output generation.
4. Extract scriptlet logic ke layer yang benar.
5. Jangan expose entity graph ke template baru.
6. Gunakan typed view model/page model.
7. Migrate layout dengan strategi fragment/design system, bukan include spaghetti baru.
8. Form migration harus diuji sangat ketat.
9. Security regression wajib: XSS, CSRF, authorization rendering, hidden field leakage.
10. Gunakan strangler, feature flag, dan rollback plan.
11. Untuk high-risk output, lakukan old/new parallel comparison.
12. Catat intentional differences.
13. Setelah stabil, hapus legacy code dan konsolidasikan pattern.

Migration target akhir bukan “semua file sudah berubah extension”. Target akhirnya adalah:

```text
Rendering layer yang eksplisit, aman, testable, observable, versioned, dan bisa berkembang tanpa membawa legacy coupling lama.
```

---

## 30. Latihan Praktis

### Latihan 1 — Inventory JSP Legacy

Ambil satu module lama dan buat inventory:

```text
Template path
Controller route
Model attributes
Includes
Taglibs
Forms
Security tags
Scriptlets
JS hooks
Risk score
Target engine
```

### Latihan 2 — Scriptlet Extraction

Ambil satu JSP yang punya scriptlet. Klasifikasikan setiap scriptlet:

```text
presentation / formatting / authorization / business / data fetching / helper / debug
```

Pindahkan minimal satu scriptlet ke view model/presenter.

### Latihan 3 — Form Compatibility Test

Pilih satu form JSP dan tulis daftar field:

```text
name
id
type
required/default
validation error
hidden/visible
submitted value
```

Migrasikan ke Thymeleaf dan pastikan parameter submit tetap kompatibel.

### Latihan 4 — Old/New HTML Comparison

Render old JSP dan new Thymeleaf dengan fixture yang sama. Buat normalizer sederhana:

- trim whitespace.
- remove dynamic CSRF token.
- normalize generated timestamps.

Bandingkan semantic output.

### Latihan 5 — Email JSP to FreeMarker

Ambil satu email template lama dan migrasikan ke FreeMarker dengan:

- typed email model.
- `.ftlh`.
- escaped output.
- layout macro.
- golden-output test.

---

## 31. Referensi

- Jakarta Server Pages 4.0 Specification — Jakarta EE / Eclipse Foundation.
- Thymeleaf 3.1 Official Documentation — Using Thymeleaf, Thymeleaf + Spring, Page Layouts.
- Apache FreeMarker Manual — Template Loading, Output Formats, Auto-Escaping, Object Wrapping, Error Handling.
- Spring Framework Reference — Web MVC View Technologies, Thymeleaf Integration, FreeMarker Integration, Validation/Data Binding.
- Spring Security Reference — CSRF, Authorization.
- OWASP XSS Prevention Cheat Sheet.
- OWASP Server-Side Template Injection testing guidance.
