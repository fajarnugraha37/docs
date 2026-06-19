# learn-java-template-freemarker-thymeleaf-rendering-engineering-part-032

# Part 32 — Real-World Blueprint II: Server-Side Rendered Admin Portal with Thymeleaf

> Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`  
> Bagian: `032 / 034`  
> Topik: blueprint portal admin SSR menggunakan Thymeleaf  
> Target: Java 8–25, Spring MVC/Spring Boot, Thymeleaf 3.x, enterprise admin portal  
> Fokus: arsitektur halaman, layout, fragment/component library, form, validation, pagination, authorization-aware UI, accessibility, performance, testing, deployment, dan kapan berpindah ke SPA.

---

## 1. Tujuan Part Ini

Part sebelumnya membahas **enterprise notification and correspondence platform**. Part ini membahas blueprint berbeda: **server-side rendered admin portal**.

Admin portal sering tampak sederhana:

- login,
- list data,
- search/filter,
- form create/update,
- approval button,
- export,
- audit trail,
- role-based menu,
- dashboard.

Namun dalam sistem enterprise, admin portal justru sering menjadi permukaan risiko yang besar:

- banyak role dan permission,
- banyak state transition,
- banyak form kompleks,
- banyak tabel besar,
- banyak edge case validasi,
- sering dipakai internal officer/admin,
- sering memproses data sensitif,
- sering menjadi entry point perubahan data production.

Blueprint ini menjawab pertanyaan:

> Bagaimana mendesain admin portal berbasis Spring MVC + Thymeleaf yang bukan sekadar “controller return view”, tetapi benar-benar maintainable, secure, testable, performant, dan siap production?

---

## 2. Apa yang Dimaksud Server-Side Rendered Admin Portal?

Dalam konteks ini, SSR admin portal berarti:

1. Browser melakukan request HTTP ke server.
2. Server menjalankan controller.
3. Controller/service mengambil data.
4. Data dibentuk menjadi view model.
5. Thymeleaf merender HTML di server.
6. Browser menerima HTML siap tampil.
7. Interaksi berikutnya umumnya melalui form submit, link, atau progressive enhancement dengan JavaScript ringan.

Diagram sederhana:

```text
Browser
  |
  | GET /admin/cases?status=PENDING&page=0
  v
Spring MVC Controller
  |
  | query/filter command
  v
Application Service
  |
  | retrieve page data + permissions + counters
  v
ViewModel Assembler
  |
  | AdminCaseListPageModel
  v
Thymeleaf Template
  |
  | HTML output
  v
Browser renders page
```

SSR bukan berarti anti-JavaScript. SSR berarti **HTML awal dan state utama halaman berasal dari server**. JavaScript tetap bisa dipakai untuk:

- date picker,
- confirmation dialog,
- progressive enhancement,
- collapsible panel,
- small autocomplete,
- async validation ringan,
- clipboard helper,
- table row highlight,
- UI convenience.

Namun rule-nya:

> JavaScript boleh memperkaya interaksi, tetapi tidak boleh menjadi pemilik utama business state kecuali memang sengaja pindah ke SPA/hybrid architecture.

---

## 3. Kapan Thymeleaf Cocok untuk Admin Portal?

Thymeleaf sangat cocok ketika karakteristik sistem seperti ini:

1. **CRUD-heavy**
   - banyak page list/detail/create/update.

2. **Form-heavy**
   - validasi server-side menjadi pusat kebenaran.

3. **Internal/backoffice usage**
   - user lebih mementingkan correctness dan workflow daripada UI super interaktif.

4. **Role/state driven UI**
   - tombol dan menu berubah berdasarkan permission dan state.

5. **SEO tidak penting**
   - admin portal biasanya protected.

6. **Team backend-heavy**
   - tim bisa deliver fitur cepat tanpa split API + frontend SPA.

7. **Deployment simplicity penting**
   - satu artifact aplikasi sudah cukup.

8. **Page-level interaction cukup**
   - tidak perlu real-time canvas-like UI.

9. **Audit dan security lebih penting daripada fluid UX**
   - setiap action harus jelas, submitted, validated, logged.

Contoh cocok:

- user management,
- case management,
- approval portal,
- internal reporting,
- configuration management,
- workflow operation console,
- batch job administration,
- correspondence template admin,
- audit search portal,
- enforcement lifecycle backoffice,
- regulatory case review interface.

---

## 4. Kapan Thymeleaf Tidak Cocok?

Thymeleaf bukan hammer untuk semua UI.

Pertimbangkan SPA/hybrid bila:

1. **Interaksi sangat rich**
   - drag-and-drop complex board,
   - graph editor,
   - spreadsheet-like editing,
   - live collaborative UI,
   - multi-panel dynamic workspace.

2. **State client sangat kompleks**
   - local draft besar,
   - offline mode,
   - optimistic update kompleks,
   - real-time synchronization.

3. **UX membutuhkan partial update sangat sering**
   - setiap klik mengubah banyak bagian tanpa full reload.

4. **Tim FE punya design system SPA mature**
   - React/Vue/Angular already standardized.

5. **API dipakai banyak channel**
   - web SPA, mobile, partner API, internal tools.

6. **Portal sebenarnya product UI publik**
   - bukan admin/backoffice.

Top 1% engineer tidak fanatik SSR atau SPA. Ia bertanya:

> Di mana state paling tepat hidup? Di server? Di client? Di keduanya? Apa konsekuensi security, latency, complexity, testability, dan team ownership-nya?

---

## 5. Architectural Principle: Page as a Use Case

Kesalahan umum dalam MVC adalah memperlakukan template sebagai “HTML file”, controller sebagai “route handler”, dan model sebagai `Map<String, Object>` random.

Untuk admin portal production, gunakan prinsip:

> Satu halaman penting adalah satu use case presentasi.

Contoh halaman:

- Case list page,
- Case detail page,
- Case assignment page,
- Case approval page,
- User management page,
- Role editor page,
- Audit trail search page,
- Template preview page.

Setiap page punya:

1. **Route**
   - URL stabil.

2. **Input command/query**
   - filter, pagination, form body.

3. **Application service call**
   - use-case oriented.

4. **View model**
   - contract ke template.

5. **Template**
   - presentation transformation.

6. **Permission policy**
   - what user can see/do.

7. **Error model**
   - validation, business error, system error.

8. **Test scenario**
   - success, empty state, permission denied, validation fail, state mismatch.

---

## 6. High-Level Architecture

```text
src/main/java/com/example/admin
  config/
    ThymeleafConfig.java
    WebMvcConfig.java
    SecurityConfig.java

  common/
    web/
      PageRequestParser.java
      FlashMessage.java
      CurrentUserArgumentResolver.java
      GlobalModelAdvice.java
      ErrorPageController.java
    ui/
      Breadcrumb.java
      PageMeta.java
      MenuItem.java
      PermissionView.java
      PaginationView.java

  caseadmin/
    web/
      CaseListController.java
      CaseDetailController.java
      CaseActionController.java
      CaseFormController.java
    app/
      CaseQueryService.java
      CaseCommandService.java
    view/
      CaseListPage.java
      CaseListRow.java
      CaseDetailPage.java
      CaseActionPanel.java
      CaseForm.java
      CaseSearchCriteria.java
    policy/
      CaseUiPolicy.java
      CasePermissionService.java

src/main/resources/templates
  layouts/
    admin-layout.html
    auth-layout.html
    error-layout.html
  fragments/
    head.html
    header.html
    sidebar.html
    breadcrumbs.html
    flash.html
    pagination.html
    form-fields.html
    table.html
    modal.html
    security.html
  admin/
    cases/
      list.html
      detail.html
      form.html
      action-confirm.html
    users/
      list.html
      form.html
    audit/
      search.html
  error/
    403.html
    404.html
    500.html
```

Rule penting:

- Controller tidak membuat HTML string.
- Template tidak query database.
- Entity tidak langsung diberikan ke template.
- Permission tidak hanya dicek di template.
- Template hanya menerima view model yang sudah disiapkan.
- Fragment library punya kontrak jelas.
- Semua action mutation memakai POST/PUT/PATCH/DELETE semantics melalui form atau endpoint yang aman.

---

## 7. Request Lifecycle untuk Page GET

Contoh: case list page.

```text
GET /admin/cases?status=PENDING_REVIEW&page=2&size=25&sort=createdAt,desc
```

Pipeline ideal:

```text
HTTP request
  -> authentication filter
  -> authorization filter
  -> controller method
  -> parse query criteria
  -> validate query criteria
  -> call query service
  -> fetch page result
  -> calculate user actions/permissions
  -> assemble view model
  -> return template name + model
  -> Thymeleaf render
  -> HTML response
```

Controller skeleton:

```java
@Controller
@RequestMapping("/admin/cases")
public class CaseListController {

    private final CaseQueryService caseQueryService;
    private final CaseUiPolicy caseUiPolicy;
    private final CaseListPageAssembler assembler;

    public CaseListController(
            CaseQueryService caseQueryService,
            CaseUiPolicy caseUiPolicy,
            CaseListPageAssembler assembler
    ) {
        this.caseQueryService = caseQueryService;
        this.caseUiPolicy = caseUiPolicy;
        this.assembler = assembler;
    }

    @GetMapping
    public String list(
            @Valid CaseSearchCriteria criteria,
            BindingResult bindingResult,
            CurrentUser currentUser,
            Model model
    ) {
        if (bindingResult.hasErrors()) {
            model.addAttribute("page", assembler.emptyPage(criteria, bindingResult, currentUser));
            return "admin/cases/list";
        }

        CasePageResult result = caseQueryService.search(criteria.toQuery(), currentUser.toActor());
        CaseListPage page = assembler.toPage(criteria, result, currentUser);

        model.addAttribute("page", page);
        return "admin/cases/list";
    }
}
```

Hal penting:

- `CaseSearchCriteria` adalah query/input model dari request.
- `CasePageResult` adalah result dari application service.
- `CaseListPage` adalah view model template.
- Template tidak perlu tahu domain aggregate penuh.

---

## 8. Request Lifecycle untuk Mutation POST

Contoh: approve case.

```text
POST /admin/cases/{caseId}/approve
```

Pipeline ideal:

```text
HTTP POST
  -> authentication
  -> CSRF validation
  -> authorization check
  -> bind form
  -> validate form
  -> load current state
  -> execute command
  -> audit event
  -> redirect with flash message
```

Controller skeleton:

```java
@Controller
@RequestMapping("/admin/cases/{caseId}")
public class CaseActionController {

    private final CaseCommandService commandService;
    private final CasePermissionService permissionService;

    @PostMapping("/approve")
    public String approve(
            @PathVariable String caseId,
            @Valid ApproveCaseForm form,
            BindingResult bindingResult,
            CurrentUser currentUser,
            RedirectAttributes redirectAttributes
    ) {
        if (bindingResult.hasErrors()) {
            redirectAttributes.addFlashAttribute("error", "Approval form is invalid.");
            return "redirect:/admin/cases/" + caseId;
        }

        permissionService.requireCanApprove(caseId, currentUser);

        try {
            commandService.approve(caseId, form.toCommand(currentUser));
            redirectAttributes.addFlashAttribute("success", "Case approved successfully.");
        } catch (InvalidStateTransitionException ex) {
            redirectAttributes.addFlashAttribute("error", "Case can no longer be approved.");
        }

        return "redirect:/admin/cases/" + caseId;
    }
}
```

Rule:

- Mutation jangan return page langsung kecuali ada alasan kuat.
- Gunakan Post-Redirect-Get.
- Flash message untuk feedback.
- Permission dicek di backend service/controller, bukan hanya disembunyikan di UI.
- State transition harus divalidasi server-side.

---

## 9. Page Model Design

Contoh view model untuk case list:

```java
public final class CaseListPage {
    private final PageMeta meta;
    private final CurrentUserView currentUser;
    private final List<Breadcrumb> breadcrumbs;
    private final CaseSearchCriteria criteria;
    private final List<CaseListRow> rows;
    private final PaginationView pagination;
    private final CaseListActions actions;
    private final boolean empty;
    private final String emptyMessage;

    // constructor + getters
}
```

Row model:

```java
public final class CaseListRow {
    private final String caseId;
    private final String caseNumber;
    private final String applicantName;
    private final String statusLabel;
    private final String statusCssClass;
    private final String createdAtText;
    private final String assignedOfficerName;
    private final boolean canOpen;
    private final boolean canAssign;
    private final boolean canApprove;

    // constructor + getters
}
```

Kenapa status CSS class boleh ada di view model?

Karena class CSS bukan domain rule. Ia bagian dari presentation mapping. Domain mungkin punya `PENDING_REVIEW`, tetapi UI butuh badge `badge-warning`. Mapping bisa dilakukan di assembler/presenter.

Jangan berikan ini ke template:

```java
model.addAttribute("cases", caseRepository.findAll());
```

Itu membuat template tergantung pada entity, lazy loading, domain property, dan internal structure.

Lebih baik:

```java
model.addAttribute("page", caseListPage);
```

Template membaca kontrak stabil:

```html
<tr th:each="row : ${page.rows}">
  <td>
    <a th:href="@{/admin/cases/{id}(id=${row.caseId})}"
       th:text="${row.caseNumber}">CASE-001</a>
  </td>
  <td th:text="${row.applicantName}">Applicant</td>
  <td>
    <span th:class="${row.statusCssClass}"
          th:text="${row.statusLabel}">Pending</span>
  </td>
</tr>
```

---

## 10. Layout System

Admin portal hampir selalu punya layout yang sama:

- document `<head>`,
- top navbar,
- sidebar,
- breadcrumb,
- page title,
- flash message,
- main content,
- footer,
- scripts.

Template page tidak boleh meng-copy seluruh shell.

### 10.1 Native Thymeleaf Fragment Layout

`layouts/admin-layout.html`:

```html
<!DOCTYPE html>
<html lang="en" xmlns:th="http://www.thymeleaf.org">
<head th:replace="~{fragments/head :: head(${page.meta})}">
  <title>Admin</title>
</head>
<body>
<header th:replace="~{fragments/header :: header(${page.currentUser})}"></header>

<div class="admin-shell">
  <aside th:replace="~{fragments/sidebar :: sidebar(${page.currentUser}, ${page.meta.activeMenu})}"></aside>

  <main id="main-content" tabindex="-1">
    <nav th:replace="~{fragments/breadcrumbs :: breadcrumbs(${page.breadcrumbs})}"></nav>

    <section th:replace="${content}">
      Page content
    </section>
  </main>
</div>
</body>
</html>
```

Page:

```html
<!DOCTYPE html>
<html xmlns:th="http://www.thymeleaf.org">
<body>
<section th:replace="~{layouts/admin-layout :: layout(~{::content})}">
  <div th:fragment="content">
    <h1 th:text="${page.meta.title}">Cases</h1>
    <!-- page-specific body -->
  </div>
</section>
</body>
</html>
```

Namun native layout bisa cepat menjadi awkward bila tidak disiplin. Banyak tim memakai Thymeleaf Layout Dialect untuk decorator-style layout. Pilih salah satu dan standarkan.

### 10.2 Layout Design Rule

Layout harus menerima:

- page title,
- active menu,
- current user view,
- breadcrumbs,
- global flash messages,
- optional page actions,
- optional scripts/styles.

Layout tidak boleh:

- query permission sendiri,
- membaca entity domain,
- memuat business-specific data,
- mengandung conditional per module terlalu banyak.

---

## 11. Fragment Library sebagai Design System Server-Side

Fragment bukan hanya include. Fragment adalah **server-side component primitive**.

Contoh fragment:

- alert/flash,
- button,
- badge,
- form input,
- select,
- textarea,
- pagination,
- table empty state,
- confirmation modal,
- audit timeline,
- status badge,
- action dropdown.

### 11.1 Form Field Fragment

`fragments/form-fields.html`:

```html
<!DOCTYPE html>
<html xmlns:th="http://www.thymeleaf.org">
<body>

<div th:fragment="input(fieldName, label, placeholder, required)" class="form-group">
  <label th:for="${#ids.next(fieldName)}">
    <span th:text="${label}">Label</span>
    <span th:if="${required}" aria-hidden="true" class="required">*</span>
  </label>

  <input class="form-control"
         th:field="*{__${fieldName}__}"
         th:placeholder="${placeholder}"
         th:attr="aria-required=${required}" />

  <div class="field-error"
       th:if="${#fields.hasErrors(fieldName)}"
       th:errors="*{__${fieldName}__}">
    Error
  </div>
</div>

</body>
</html>
```

Catatan:

- Dynamic `th:field` harus hati-hati.
- Jangan membuat fragment terlalu magic.
- Kalau fragment sulit dipahami, lebih baik eksplisit.

### 11.2 Pagination Fragment

```html
<nav th:fragment="pagination(pagination)"
     th:if="${pagination.totalPages > 1}"
     aria-label="Pagination">
  <ul class="pagination">
    <li th:classappend="${pagination.first} ? 'disabled'">
      <a th:href="${pagination.previousUrl}" aria-label="Previous">Previous</a>
    </li>

    <li th:each="item : ${pagination.items}"
        th:classappend="${item.active} ? 'active'">
      <a th:if="${!item.ellipsis}"
         th:href="${item.url}"
         th:text="${item.label}">1</a>
      <span th:if="${item.ellipsis}">…</span>
    </li>

    <li th:classappend="${pagination.last} ? 'disabled'">
      <a th:href="${pagination.nextUrl}" aria-label="Next">Next</a>
    </li>
  </ul>
</nav>
```

Pagination URL sebaiknya disiapkan di backend presenter, bukan dibangun kompleks di template.

---

## 12. Menu dan Sidebar Authorization

UI menu harus sadar permission, tetapi jangan menjadi authorization enforcement utama.

Model:

```java
public final class MenuItem {
    private final String label;
    private final String url;
    private final String icon;
    private final boolean active;
    private final boolean visible;
    private final List<MenuItem> children;
}
```

Sidebar:

```html
<nav th:fragment="sidebar(currentUser, activeMenu)" aria-label="Main navigation">
  <ul class="sidebar-menu">
    <li th:each="item : ${currentUser.menuItems}"
        th:if="${item.visible}"
        th:classappend="${item.active} ? 'active'">
      <a th:href="@{${item.url}}">
        <span th:text="${item.label}">Menu</span>
      </a>
    </li>
  </ul>
</nav>
```

Backend tetap harus punya:

```java
@PreAuthorize("hasAuthority('CASE_READ')")
@GetMapping("/admin/cases")
public String list(...) { ... }
```

atau explicit permission service.

Rule:

- Hiding menu is UX.
- Denying endpoint is security.
- Denying command is business protection.

---

## 13. Case Detail Page Architecture

Case detail biasanya paling kompleks:

- header summary,
- status badge,
- applicant info,
- documents,
- actions,
- comments,
- audit history,
- related cases,
- correspondence,
- task assignment,
- risk flags.

Jangan buat satu template 2.000 baris.

Gunakan panel-based page model:

```java
public final class CaseDetailPage {
    private final PageMeta meta;
    private final CaseSummaryPanel summary;
    private final ApplicantPanel applicant;
    private final DocumentPanel documents;
    private final ActionPanel actions;
    private final CommentPanel comments;
    private final AuditTimelinePanel auditTimeline;
    private final List<AlertView> alerts;
}
```

Template:

```html
<section>
  <div th:replace="~{admin/cases/panels/summary :: summary(${page.summary})}"></div>
  <div th:replace="~{admin/cases/panels/applicant :: applicant(${page.applicant})}"></div>
  <div th:replace="~{admin/cases/panels/documents :: documents(${page.documents})}"></div>
  <div th:replace="~{admin/cases/panels/actions :: actions(${page.actions})}"></div>
  <div th:replace="~{admin/cases/panels/audit :: timeline(${page.auditTimeline})}"></div>
</section>
```

Panel fragment rule:

- menerima satu panel model,
- tidak membaca `page` global kecuali standard convention,
- tidak query service,
- tidak punya hidden dependency ke current user,
- semua action visibility sudah dihitung.

---

## 14. Search and Filter Pattern

Admin portal hampir selalu punya list page dengan filter.

Input model:

```java
public final class CaseSearchCriteria {
    private String keyword;
    private String status;
    private String assignedTo;
    private LocalDate submittedFrom;
    private LocalDate submittedTo;
    private Integer page = 0;
    private Integer size = 25;
    private String sort = "submittedAt,desc";

    // getters/setters for binding
}
```

Controller:

```java
@GetMapping
public String list(@Valid CaseSearchCriteria criteria,
                   BindingResult bindingResult,
                   CurrentUser currentUser,
                   Model model) {
    // validate criteria and render page
}
```

Template:

```html
<form method="get" th:object="${page.criteria}" th:action="@{/admin/cases}">
  <input type="text" th:field="*{keyword}" placeholder="Search case number or applicant" />

  <select th:field="*{status}">
    <option value="">All statuses</option>
    <option th:each="status : ${page.statusOptions}"
            th:value="${status.value}"
            th:text="${status.label}">Pending</option>
  </select>

  <button type="submit">Search</button>
  <a th:href="@{/admin/cases}">Reset</a>
</form>
```

Principles:

- Search/filter should be GET, not POST.
- Query parameters should be bookmarkable.
- Pagination links must preserve filter.
- Sorting must be allowlisted.
- Page size must be bounded.
- Date range must be validated.

---

## 15. Pagination Strategy

Bad pattern:

```java
List<Case> cases = caseRepository.findAll();
model.addAttribute("cases", cases);
```

This fails at scale.

Good pattern:

```java
Page<CaseSummary> page = caseQueryService.search(criteria);
```

Then assemble:

```java
PaginationView pagination = PaginationView.from(
    page.getNumber(),
    page.getSize(),
    page.getTotalElements(),
    urlBuilderFor(criteria)
);
```

Pagination model should include already computed URLs:

```java
public final class PaginationItem {
    private final String label;
    private final String url;
    private final boolean active;
    private final boolean ellipsis;
}
```

Template stays dumb:

```html
<a th:href="${item.url}" th:text="${item.label}">1</a>
```

This avoids complex URL construction inside template.

---

## 16. Sorting Pattern

Sorting is often an injection vector or performance trap.

Do not pass raw sort into repository query builder.

Use allowlist:

```java
public enum CaseSortKey {
    SUBMITTED_AT("submittedAt"),
    CASE_NUMBER("caseNumber"),
    STATUS("status"),
    ASSIGNED_TO("assignedOfficerName");

    private final String property;
}
```

Criteria:

```java
public final class SortSpec {
    private final CaseSortKey key;
    private final SortDirection direction;
}
```

Template:

```html
<a th:href="${page.sortLinks.caseNumber.url}">
  Case Number
  <span th:if="${page.sortLinks.caseNumber.active}"
        th:text="${page.sortLinks.caseNumber.directionSymbol}">↓</span>
</a>
```

Again: template receives prepared links.

---

## 17. Form Architecture

A form is not just HTML. It is an input contract.

For each mutation form, define:

1. form class,
2. validator,
3. template fragment/page,
4. command mapper,
5. permission check,
6. state check,
7. success redirect,
8. failure render strategy,
9. tests.

Example:

```java
public final class AssignCaseForm {
    @NotBlank
    private String officerId;

    @Size(max = 1000)
    private String note;

    public AssignCaseCommand toCommand(String caseId, CurrentUser currentUser) {
        return new AssignCaseCommand(caseId, officerId, note, currentUser.userId());
    }
}
```

Template:

```html
<form method="post"
      th:action="@{/admin/cases/{id}/assign(id=${page.summary.caseId})}"
      th:object="${page.assignForm}">

  <input type="hidden" th:name="${_csrf.parameterName}" th:value="${_csrf.token}" />

  <label for="officerId">Officer</label>
  <select th:field="*{officerId}">
    <option value="">Select officer</option>
    <option th:each="officer : ${page.assignableOfficers}"
            th:value="${officer.id}"
            th:text="${officer.name}">Officer</option>
  </select>
  <div th:if="${#fields.hasErrors('officerId')}" th:errors="*{officerId}"></div>

  <label for="note">Note</label>
  <textarea th:field="*{note}"></textarea>
  <div th:if="${#fields.hasErrors('note')}" th:errors="*{note}"></div>

  <button type="submit">Assign</button>
</form>
```

If Spring Security and Thymeleaf integration are configured, CSRF can often be integrated automatically in forms, but explicit rendering is clearer in security-sensitive templates.

---

## 18. Validation Error UX

Validation failures should be usable, not merely technically correct.

Good validation page should:

- preserve submitted values,
- show field-level errors,
- show global errors,
- focus first invalid field if possible,
- use accessible error markup,
- avoid losing user input,
- avoid duplicate messages,
- not expose stack traces.

Error fragment:

```html
<div th:fragment="fieldError(fieldName)"
     th:if="${#fields.hasErrors(fieldName)}"
     class="field-error"
     role="alert">
  <span th:errors="*{__${fieldName}__}">Invalid value</span>
</div>
```

Global errors:

```html
<div th:if="${#fields.hasGlobalErrors()}" class="alert alert-danger" role="alert">
  <ul>
    <li th:each="err : ${#fields.globalErrors()}" th:text="${err}">Error</li>
  </ul>
</div>
```

Service/business errors should not be disguised as field validation if they are not field validation.

Example:

- field error: “Officer is required.”
- business error: “Case is already closed and cannot be assigned.”

---

## 19. State-Based Action Panel

Admin portals often show action buttons based on workflow state.

Bad pattern:

```html
<button th:if="${case.status == 'PENDING' and user.role == 'APPROVER'}">Approve</button>
```

Better:

```java
public final class CaseActionPanel {
    private final boolean canApprove;
    private final boolean canReject;
    private final boolean canAssign;
    private final boolean canRequestInfo;
    private final List<ActionView> primaryActions;
    private final List<ActionView> secondaryActions;
}
```

Template:

```html
<div th:fragment="actions(actions)">
  <form th:each="action : ${actions.primaryActions}"
        method="post"
        th:action="${action.url}">
    <input type="hidden" th:name="${_csrf.parameterName}" th:value="${_csrf.token}" />
    <button type="submit"
            th:class="${action.cssClass}"
            th:text="${action.label}">Action</button>
  </form>
</div>
```

Backend action policy:

```java
public CaseActionPanel actionsFor(CaseSnapshot snapshot, CurrentUser user) {
    return new CaseActionPanel(
        canApprove(snapshot, user),
        canReject(snapshot, user),
        canAssign(snapshot, user),
        canRequestInfo(snapshot, user),
        buildActions(snapshot, user)
    );
}
```

Benefits:

- template stays simple,
- policy testable,
- state transition logic centralized,
- permissions reusable across UI/API,
- less chance of UI/backend mismatch.

---

## 20. Authorization Rendering vs Backend Enforcement

There are three layers:

```text
Layer 1: Navigation visibility
  -> should user see menu/link/button?

Layer 2: Endpoint authorization
  -> can user access URL/action?

Layer 3: Domain command authorization
  -> can user perform action on this entity in this state?
```

All three matter.

Example:

```text
User has CASE_APPROVE authority.
But case is assigned to another department.
UI might hide approve button.
Endpoint must still reject direct POST.
Domain command must still reject invalid transition.
```

Template-level authorization is UX, not final protection.

---

## 21. Accessibility Baseline

Admin portal users may be internal officers who use keyboard navigation, screen readers, browser zoom, or high-contrast mode. Accessibility is not optional polish.

Baseline requirements:

1. Proper headings.
2. Proper labels for input.
3. Visible focus indicator.
4. Keyboard navigability.
5. Skip-to-content link.
6. `aria-current` for active navigation.
7. `role="alert"` for validation summary/flash messages.
8. Table header `<th scope="col">`.
9. Error messages associated with fields.
10. Color not used as only status signal.
11. Sufficient contrast.
12. Semantic buttons vs links.
13. Avoid fake clickable divs.
14. Page title meaningful.
15. Language attribute correct.

Example layout skip link:

```html
<a class="skip-link" href="#main-content">Skip to main content</a>
<main id="main-content" tabindex="-1">
  ...
</main>
```

Table:

```html
<table>
  <caption class="sr-only">Case search results</caption>
  <thead>
    <tr>
      <th scope="col">Case Number</th>
      <th scope="col">Applicant</th>
      <th scope="col">Status</th>
      <th scope="col">Assigned Officer</th>
      <th scope="col">Actions</th>
    </tr>
  </thead>
</table>
```

---

## 22. Error Pages

Admin portal needs predictable error pages:

- 400 bad request,
- 401 unauthenticated,
- 403 forbidden,
- 404 not found,
- 409 conflict/state mismatch,
- 422 validation/business rule failure if used,
- 500 internal error.

Do not expose stack traces.

Error page model:

```java
public final class ErrorPage {
    private final String title;
    private final String message;
    private final String correlationId;
    private final String supportHint;
    private final String backUrl;
}
```

Template:

```html
<section class="error-page">
  <h1 th:text="${error.title}">Something went wrong</h1>
  <p th:text="${error.message}">Please try again later.</p>
  <p>
    Reference ID:
    <code th:text="${error.correlationId}">abc-123</code>
  </p>
  <a th:href="${error.backUrl}">Go back</a>
</section>
```

Top 1% principle:

> A good error page reduces support cost and increases incident diagnosability without leaking sensitive internals.

---

## 23. Flash Message Strategy

Flash messages are useful after PRG.

Model:

```java
public final class FlashMessage {
    private final FlashType type;
    private final String message;
}
```

Fragment:

```html
<div th:fragment="flash(messages)" th:if="${messages != null}">
  <div th:each="msg : ${messages}"
       th:class="'alert alert-' + ${msg.type.cssClass}"
       role="alert"
       th:text="${msg.message}">
    Message
  </div>
</div>
```

Do not put raw user input into flash message unless escaped by default.

Bad:

```java
redirectAttributes.addFlashAttribute("success", "User " + displayName + " created.");
```

Better:

```java
redirectAttributes.addFlashAttribute("success", "User account created successfully.");
```

If dynamic value is needed, ensure template uses escaped output.

---

## 24. Static Asset Strategy

SSR does not mean assets are random.

Recommended:

```text
src/main/resources/static
  css/
    admin.css
  js/
    admin.js
    confirm-dialog.js
    autocomplete.js
  images/
```

Rules:

- version/hash assets in production,
- set cache headers,
- keep page-specific JS small,
- avoid inline JavaScript with untrusted data,
- prefer `data-*` attributes for safe server-to-client hints,
- use CSP where possible,
- separate static assets from template logic.

Example:

```html
<button type="submit"
        data-confirm="Approve this case?"
        class="js-confirm">
  Approve
</button>
```

JS reads `data-confirm`. Avoid rendering complex JSON into inline script unless needed and safely encoded.

---

## 25. Avoiding Template-Driven N+1 Queries

Danger pattern:

```html
<span th:text="${case.assignedOfficer.name}">Officer</span>
```

If `case` is JPA entity with lazy association, rendering may trigger N+1 queries.

Prevent by:

1. Never expose entity directly.
2. Query projection exactly what page needs.
3. Assemble row DTO before rendering.
4. Track DB query count in tests for important pages.
5. Keep transaction boundary out of view rendering if possible.

Good:

```java
public record CaseListRow(
    String caseId,
    String caseNumber,
    String applicantName,
    String statusLabel,
    String assignedOfficerName
) {}
```

Template just reads strings.

---

## 26. Performance Budget for SSR Admin Portal

Define budget.

Example for internal portal:

```text
P50 server render response: <= 200 ms
P95 server render response: <= 800 ms
P99 server render response: <= 1500 ms
HTML size list page: <= 500 KB for normal page
Rows per page: 25–100 max
DB queries per list page: <= 5 predictable queries
Template render time: <= 50 ms for normal page
```

Breakdown:

```text
HTTP/security overhead       10–30 ms
Controller/model binding      5–20 ms
DB query                     50–500 ms
View model assembly           5–50 ms
Thymeleaf render              5–100 ms
Network/browser              variable
```

Most page latency is usually not Thymeleaf itself. It is often:

- database query,
- missing index,
- N+1,
- huge model,
- over-rendered table,
- expensive permission checks per row,
- remote service call,
- synchronous audit enrichment,
- large static assets.

Top 1% performance mindset:

> Optimize the full page path, not only the template engine.

---

## 27. Large Table Handling

Never render thousands of rows because “it is internal only”.

Use:

- pagination,
- bounded page size,
- server-side filter,
- server-side sort,
- export job for large output,
- async report generation for heavy result,
- search constraints for expensive queries.

Pattern:

```text
Interactive table: <= 100 rows/page
Export CSV/PDF: async job or streaming endpoint
Dashboard count: precomputed/read-optimized query
```

Template empty state:

```html
<tr th:if="${page.empty}">
  <td colspan="6">
    <div class="empty-state">
      <h2>No cases found</h2>
      <p>Adjust filters and try again.</p>
    </div>
  </td>
</tr>
```

---

## 28. Progressive Enhancement Pattern

A robust SSR admin portal should work without complex JS.

Baseline:

- form submit works,
- links work,
- server validation works,
- action confirmation can fall back to normal POST.

Enhancement:

- JS confirmation dialog,
- autocomplete,
- collapsible panels,
- client-side field convenience,
- live character count.

Example:

```html
<form method="post" th:action="@{/admin/cases/{id}/approve(id=${page.caseId})}">
  <input type="hidden" th:name="${_csrf.parameterName}" th:value="${_csrf.token}" />
  <button type="submit" class="js-confirm" data-confirm="Approve this case?">
    Approve
  </button>
</form>
```

Without JS, submit still works. With JS, user gets better confirmation.

---

## 29. Security Checklist for Thymeleaf Admin Portal

1. Use `th:text` by default.
2. Avoid `th:utext` unless content is sanitized and trusted.
3. Use CSRF protection for unsafe methods.
4. Do backend endpoint authorization.
5. Do command/domain authorization.
6. Do not rely on hidden fields for trusted values.
7. Do not expose entity graph directly.
8. Do not render secrets, tokens, internal IDs unnecessarily.
9. Do not put untrusted values into inline JS unsafely.
10. Use allowlisted redirects.
11. Use allowlisted sorting fields.
12. Bound page size.
13. Validate all form input server-side.
14. Prevent over-posting with form DTOs.
15. Use secure headers/CSP where possible.
16. Log correlation ID, not sensitive payload.
17. Do not expose stack trace in error pages.
18. Avoid leaking permission details in 403 messages.
19. Protect admin endpoints with MFA/SSO as needed.
20. Add audit logging for high-risk actions.

---

## 30. Testing Strategy

### 30.1 Controller Test

Test:

- route mapping,
- model attribute exists,
- view name,
- validation error,
- redirect after POST,
- forbidden case.

Example with Spring MVC test:

```java
mockMvc.perform(get("/admin/cases")
        .param("status", "PENDING_REVIEW"))
    .andExpect(status().isOk())
    .andExpect(view().name("admin/cases/list"))
    .andExpect(model().attributeExists("page"));
```

### 30.2 Template Smoke Test

Render template with representative page model:

```java
Context context = new Context(Locale.ENGLISH);
context.setVariable("page", CaseListPageFixtures.normal());
String html = templateEngine.process("admin/cases/list", context);
assertThat(html).contains("CASE-2026-0001");
```

### 30.3 Security Rendering Test

Input:

```text
<script>alert(1)</script>
```

Expected:

- visible as text,
- not executable script.

### 30.4 Permission Matrix Test

For action panel:

```text
Role: Viewer       -> no approve/reject buttons
Role: Approver     -> approve if state pending
Role: Supervisor   -> assign if department matches
Closed case        -> no mutation actions
```

This should be tested in Java policy/service, not only by checking HTML.

### 30.5 Accessibility Test

At minimum:

- semantic HTML review,
- axe/browser check in CI if possible,
- manual keyboard navigation for critical flows,
- validation error focus behavior.

### 30.6 Visual Regression

For high-value pages:

- list page normal/empty/error,
- form normal/validation error,
- detail page all panels,
- 403/500 error pages.

---

## 31. Deployment Considerations

### 31.1 Template Cache

Production:

```properties
spring.thymeleaf.cache=true
```

Development:

```properties
spring.thymeleaf.cache=false
```

But do not blindly use dev settings in production.

### 31.2 Static Asset Cache

Use long cache for versioned assets:

```text
/admin.css?v=2026.06.19
or
/admin.8f3a2c.css
```

### 31.3 Error Observability

Log:

- correlation ID,
- user ID or actor ID if allowed,
- route,
- template name,
- exception classification,
- not full sensitive model.

### 31.4 Health and Smoke Test

Post-deploy smoke:

- login page loads,
- dashboard loads,
- case list loads,
- form page loads,
- one safe validation scenario,
- static assets load,
- error page not leaking stack.

---

## 32. Folder and Naming Conventions

Recommended template naming:

```text
templates/admin/<module>/<page>.html
```

Examples:

```text
templates/admin/cases/list.html
templates/admin/cases/detail.html
templates/admin/cases/form.html
templates/admin/users/list.html
templates/admin/audit/search.html
```

Fragment naming:

```text
templates/fragments/<component>.html
```

Panel naming:

```text
templates/admin/cases/panels/summary.html
templates/admin/cases/panels/actions.html
templates/admin/cases/panels/audit.html
```

Model naming:

```text
CaseListPage
CaseListRow
CaseDetailPage
CaseSummaryPanel
CaseActionPanel
AssignCaseForm
CaseSearchCriteria
PaginationView
```

Controller naming:

```text
CaseListController
CaseDetailController
CaseActionController
CaseFormController
```

This improves codebase navigability.

---

## 33. Anti-Patterns

### 33.1 Entity Dumping

```java
model.addAttribute("case", caseEntity);
```

Risk:

- lazy loading,
- accidental sensitive data exposure,
- template coupled to persistence,
- hard to version.

### 33.2 Business Logic in Template

```html
<button th:if="${case.status == 'PENDING' and user.department == case.department and user.level > 3}">
```

Move to policy/view model.

### 33.3 Overusing `th:utext`

```html
<div th:utext="${comment.body}"></div>
```

Risk: XSS.

### 33.4 Huge Page Model

```java
model.addAttribute("everything", giantObjectGraph);
```

Risk:

- memory,
- security,
- debugging difficulty,
- hidden coupling.

### 33.5 Fragment Spaghetti

Fragments importing fragments importing fragments across modules with hidden global variables.

Avoid by:

- one fragment receives explicit parameter,
- shared fragments only for generic UI,
- module-specific panels stay inside module folder.

### 33.6 GET Mutation

```html
<a href="/admin/cases/123/approve">Approve</a>
```

Unsafe. Use POST with CSRF.

### 33.7 Client-Only Authorization

```html
<button hidden-by-js-if-no-role>Delete</button>
```

Never enough.

---

## 34. Blueprint Example: Case Admin Portal

### 34.1 Pages

```text
GET  /admin/cases
GET  /admin/cases/{id}
GET  /admin/cases/{id}/edit
POST /admin/cases/{id}/assign
POST /admin/cases/{id}/approve
POST /admin/cases/{id}/reject
POST /admin/cases/{id}/request-info
GET  /admin/cases/{id}/audit
GET  /admin/cases/{id}/documents
```

### 34.2 View Models

```text
CaseListPage
  - meta
  - breadcrumbs
  - criteria
  - statusOptions
  - rows
  - pagination
  - sortLinks
  - emptyState

CaseDetailPage
  - meta
  - breadcrumbs
  - summary
  - applicant
  - documents
  - actions
  - comments
  - auditTimeline
  - alerts

CaseActionPanel
  - primaryActions
  - secondaryActions
  - dangerActions
```

### 34.3 Services

```text
CaseQueryService
  - search(criteria, actor)
  - detail(caseId, actor)
  - audit(caseId, actor)

CaseCommandService
  - assign(command)
  - approve(command)
  - reject(command)
  - requestInfo(command)

CaseUiPolicy
  - actionsFor(snapshot, actor)
  - menuFor(actor)
```

### 34.4 Testing Matrix

```text
Case list:
  - normal result
  - empty result
  - invalid filter
  - unauthorized user
  - large page size rejected/bounded

Case detail:
  - pending case
  - approved case
  - rejected case
  - closed case
  - different department

Actions:
  - approve success
  - approve forbidden
  - approve invalid state
  - reject with missing reason
  - assign invalid officer
```

---

## 35. When to Switch from Thymeleaf SSR to SPA

Use SSR until the page model becomes unnatural.

Warning signs:

1. You are rendering huge JSON blobs into the page.
2. Most interactions are AJAX partial updates.
3. You maintain complex client-side state manually.
4. Thymeleaf fragments are only bootstrapping JS components.
5. Form state is mostly client-owned.
6. UX requires real-time updates across panels.
7. Client routing becomes necessary.
8. Multiple frontends need same API anyway.

At that point, choose:

```text
Option A: Keep SSR for admin CRUD, add small islands of JS.
Option B: Use HTMX/Turbo-like partial server rendering.
Option C: Move specific rich module to SPA.
Option D: Convert whole portal to SPA + API.
```

Do not migrate because SPA is fashionable. Migrate because state ownership and interaction complexity justify it.

---

## 36. Java 8–25 Considerations

### Java 8

- Compatible with many older Spring/Thymeleaf stacks.
- Use immutable classes manually.
- `java.time` available and should be preferred over `Date`.
- Avoid relying on records/sealed classes.

### Java 11/17

- Better baseline for modern Spring Boot versions.
- Records available from Java 16 onward, stable in Java 17.
- Better GC/runtime ergonomics.

### Java 21

- Virtual threads can help request concurrency in some stacks, but SSR page latency still dominated by DB/service/template path.
- Use virtual threads carefully; avoid assuming template rendering itself becomes faster.

### Java 25

- Treat as modern LTS-era runtime target depending on ecosystem readiness.
- Keep code compatible with framework support matrix.
- Template architecture remains the same: route -> model -> render -> response.

View model design can use records on Java 17+:

```java
public record CaseListRow(
    String caseId,
    String caseNumber,
    String applicantName,
    String statusLabel,
    String statusCssClass,
    String createdAtText,
    boolean canOpen
) {}
```

For Java 8, use final classes with getters.

---

## 37. Review Checklist

Use this checklist for a real Thymeleaf admin portal review.

### Architecture

- [ ] Each page has explicit view model.
- [ ] Controller does not expose entity graph.
- [ ] Template does not contain business rule logic.
- [ ] Layout and fragments are standardized.
- [ ] Module-specific fragments are not globally entangled.

### Security

- [ ] `th:text` used by default.
- [ ] `th:utext` usage reviewed and justified.
- [ ] CSRF enabled for unsafe methods.
- [ ] Backend authorization exists for all protected routes.
- [ ] Domain command authorization exists for stateful actions.
- [ ] Hidden fields are not trusted.
- [ ] Sorting/filtering allowlisted.
- [ ] Error pages do not leak internals.

### Performance

- [ ] Page size bounded.
- [ ] Pagination used.
- [ ] No large unbounded tables.
- [ ] No entity lazy loading in template.
- [ ] Query count known for critical pages.
- [ ] Template cache enabled in production.
- [ ] Static assets cached/versioned.

### UX

- [ ] PRG used after mutation.
- [ ] Flash messages consistent.
- [ ] Validation errors preserve input.
- [ ] Empty states defined.
- [ ] Conflict/state mismatch messages clear.

### Accessibility

- [ ] Labels exist for inputs.
- [ ] Table headers use `<th>` with scope.
- [ ] Focus state visible.
- [ ] Keyboard navigation works.
- [ ] Validation errors announced/accessibly rendered.
- [ ] Color is not the only status signal.

### Testing

- [ ] Controller tests for main routes.
- [ ] Template smoke tests for representative models.
- [ ] Security escaping tests.
- [ ] Permission/action matrix tests.
- [ ] Validation error rendering tests.
- [ ] Error page tests.

---

## 38. Mental Model Summary

A top-tier Thymeleaf admin portal is not defined by how many `th:*` attributes it uses.

It is defined by these invariants:

1. **Page is a use case.**
2. **View model is the template contract.**
3. **Template renders; it does not decide business truth.**
4. **Fragments are server-side components with explicit parameters.**
5. **Authorization visibility is UX; backend enforcement is security.**
6. **Mutation uses POST + CSRF + PRG.**
7. **Pagination and filtering are server-owned.**
8. **Accessibility is part of correctness.**
9. **Performance is full request-path performance.**
10. **SSR is excellent when server owns state and page-level interaction is enough.**

If you internalize this, Thymeleaf becomes more than a template engine. It becomes a disciplined way to build enterprise admin systems where correctness, traceability, security, and maintainability matter more than frontend fashion.

---

## 39. What Comes Next

Part 32 completed the second real-world blueprint: **Server-Side Rendered Admin Portal with Thymeleaf**.

Next part:

```text
Part 33 — Real-World Blueprint III: Rule/State-Based Document Rendering for Case Management
```

Part 33 will focus on a domain where template rendering intersects with workflow lifecycle, state machines, regulatory defensibility, immutable document snapshots, effective-date template selection, and audit-grade correspondence generation.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-031.md">⬅️ Part 31 — Real-World Blueprint I: Enterprise Notification and Correspondence Platform</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-template-freemarker-thymeleaf-rendering-engineering-part-033.md">Part 33 — World Blueprint III: Rule/State-Based Document Rendering for Case Management ➡️</a>
</div>
