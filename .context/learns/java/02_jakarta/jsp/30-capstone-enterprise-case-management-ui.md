# Part 30 — Capstone: Build and Review an Enterprise Case Management UI

> Seri: `learn-java-jakarta-pages-el-tags-faces-server-side-ui`  
> File: `30-capstone-enterprise-case-management-ui.md`  
> Fokus: menggabungkan Jakarta Pages/JSP, EL, Tags, Jakarta Faces, state management, security, validation, navigation, testing, migration, dan production readiness dalam satu studi kasus enterprise  
> Target Java: Java 8 sampai Java 25  
> Target stack historis-modern: Java EE `javax.*` sampai Jakarta EE `jakarta.*`

---

## 1. Tujuan Bagian Ini

Bagian ini adalah capstone. Tujuannya bukan menambah satu API baru, tetapi melatih cara berpikir engineer senior/top-tier ketika harus membangun atau mereview UI enterprise berbasis server-side Java.

Kita akan memakai studi kasus:

> **Regulatory Case Management UI** — aplikasi internal/eksternal untuk memproses case enforcement, assignment, status workflow, document upload, action decision, minutes/comment, dan audit trail.

Kasus ini sengaja dipilih karena memiliki karakteristik enterprise yang realistis:

- data sensitif;
- role-based action;
- workflow state;
- multi-user concurrency;
- auditability;
- validation kompleks;
- file upload/download;
- status lifecycle;
- SLA/escalation indicator;
- screen listing/detail;
- kemungkinan legacy JSP dan modern Faces hidup bersama.

Setelah bagian ini, kamu diharapkan bisa:

1. Mendesain UI server-side yang tidak sekadar “halaman HTML”.
2. Memisahkan view, form model, command, workflow service, authorization, dan audit.
3. Membandingkan implementasi JSP/JSTL/custom tag dengan Jakarta Faces/Facelets/CDI.
4. Mengidentifikasi failure mode sebelum production.
5. Membuat review checklist yang bisa dipakai untuk sistem enterprise nyata.
6. Mengambil keputusan kapan mempertahankan JSP, kapan memakai Faces, kapan pindah ke SPA/API, dan kapan hybrid.

---

## 2. Baseline Mental Model

Jakarta Pages/JSP dan Jakarta Faces sama-sama bisa menghasilkan HTML dari server, tetapi model internalnya berbeda.

Jakarta Pages/JSP adalah template engine. Halaman `.jsp` dicampur dengan textual content, EL, custom tags, dan embedded Java code, lalu dikompilasi menjadi Jakarta Servlet. Dalam konteks modern, scriptlet harus dianggap legacy escape hatch, bukan gaya utama. Fokus desain JSP yang sehat adalah:

```text
HTTP request
  -> controller servlet / MVC controller
  -> service/domain call
  -> view model prepared
  -> forward to JSP
  -> JSP renders view model using EL + JSTL/custom tags
  -> HTML response
```

Jakarta Faces adalah component-based MVC framework. View Facelets membentuk component tree, postback mengirim state, lifecycle memproses request values, conversion, validation, model update, action, lalu render response.

```text
HTTP request/postback
  -> FacesServlet
  -> restore/build component tree
  -> apply request values
  -> convert + validate
  -> update model
  -> invoke action/navigation
  -> render component tree
  -> HTML + view state response
```

Perbedaan ini menentukan seluruh desain.

JSP lebih natural untuk request/response page rendering yang sederhana, listing, read-only pages, server-side MVC klasik, dan legacy modernization.

Faces lebih natural untuk form-heavy, validation-heavy, stateful interaction, composite component library, Ajax partial rendering, dan UI internal enterprise dengan lifecycle yang konsisten.

---

## 3. Studi Kasus: Regulatory Case Management UI

Kita akan mendesain UI untuk modul case management dengan kebutuhan berikut.

### 3.1 Functional Requirements

Halaman utama:

1. **Case Listing**
   - filter by case number, status, officer, entity, date range, priority;
   - pagination;
   - sorting;
   - status badge;
   - SLA indicator;
   - action visibility based on role and state.

2. **Case Detail**
   - case summary;
   - entity/profile information;
   - current workflow state;
   - assignment info;
   - timeline;
   - documents;
   - comments/minutes;
   - audit summary;
   - available actions.

3. **Workflow Action Form**
   - assign;
   - recommend escalation;
   - approve;
   - reject;
   - request information;
   - close case;
   - return for clarification.

4. **Document Upload/Download**
   - upload supporting document;
   - file type/size validation;
   - virus scan status;
   - download permission check;
   - audit download.

5. **Minutes/Comments**
   - add internal note;
   - add external-facing comment;
   - mark sensitivity;
   - timestamp and author;
   - immutable after submit, or versioned edit depending policy.

6. **Audit View**
   - who did what;
   - when;
   - old/new values;
   - source channel;
   - correlation id;
   - reason/remarks.

### 3.2 Non-Functional Requirements

1. **Security**
   - authenticated access;
   - role/state-based authorization;
   - XSS protection;
   - CSRF protection;
   - no sensitive data leakage;
   - secure file handling;
   - secure error page.

2. **Auditability**
   - every state-changing action must be auditable;
   - audit must record intent, actor, state transition, and important data changes;
   - UI must not be the source of truth for authorization/audit.

3. **Consistency**
   - workflow action must not run if case state changed;
   - concurrent user action must be detected;
   - stale page submission must be handled.

4. **Performance**
   - listing must be paginated;
   - detail page must not load every document binary;
   - comments/timeline may be lazy-loaded or paginated;
   - no N+1 calls during rendering;
   - session state must be bounded.

5. **Maintainability**
   - view should not contain business rules;
   - reusable tags/components for badge, action button, error summary, date formatting;
   - predictable naming/layout conventions;
   - testable contracts.

6. **Accessibility and Localization**
   - labels and errors are localizable;
   - forms have accessible labels;
   - status not represented by color only;
   - keyboard navigation works.

---

## 4. Domain Model vs UI Model

A top-tier engineer avoids passing raw domain object directly to the view unless the app is very small. Enterprise UI needs a **view model** that is optimized for rendering, security, and stability.

### 4.1 Domain Concepts

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    UNDER_REVIEW,
    PENDING_INFORMATION,
    ESCALATED,
    APPROVED,
    REJECTED,
    CLOSED
}

public enum CaseActionType {
    ASSIGN,
    REQUEST_INFORMATION,
    RECOMMEND_ESCALATION,
    APPROVE,
    REJECT,
    CLOSE,
    RETURN_FOR_CLARIFICATION
}
```

Domain entity may contain persistence concerns:

```java
public class RegulatoryCase {
    private Long id;
    private String caseNumber;
    private CaseStatus status;
    private Long assignedOfficerId;
    private Integer version;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
    // entity relationships, lazy collections, etc.
}
```

This object is not ideal as direct view data because:

- it may have lazy-loaded associations;
- it may expose sensitive fields;
- it may have persistence semantics;
- it may change shape as domain evolves;
- it may invite calling getters that perform unexpected work;
- it does not encode UI-specific labels, CSS classes, permission decisions, or warning state.

### 4.2 View Model

A view model is a read-optimized structure prepared by controller/backing bean.

```java
public record CaseDetailView(
    Long caseId,
    String caseNumber,
    String statusCode,
    String statusLabel,
    String statusSeverity,
    String entityName,
    String assignedOfficerName,
    String createdAtDisplay,
    String updatedAtDisplay,
    int version,
    boolean staleWarning,
    List<ActionView> availableActions,
    List<DocumentView> documents,
    List<TimelineItemView> timeline,
    List<CommentView> comments
) {}

public record ActionView(
    String code,
    String label,
    boolean primary,
    boolean dangerous,
    boolean confirmationRequired,
    String confirmationMessage
) {}
```

For Java 8 legacy, use immutable POJO instead of record:

```java
public final class CaseDetailView {
    private final Long caseId;
    private final String caseNumber;
    private final String statusCode;
    private final String statusLabel;
    // constructor + getters
}
```

### 4.3 Form Model / Command Model

Separate display view from submitted command.

```java
public class WorkflowActionForm {
    private Long caseId;
    private int version;
    private String actionType;
    private String remarks;
    private Long assigneeId;
    private String returnReason;

    // getters/setters
}
```

Why not reuse `RegulatoryCase` as form backing object?

Because submitted data is a **command**, not an entity patch. A workflow action is not “update row fields”; it is “attempt transition under policy”. The command must be validated, authorized, audited, and applied atomically.

Better service boundary:

```java
public interface CaseWorkflowService {
    WorkflowResult performAction(WorkflowCommand command);
}

public record WorkflowCommand(
    Long caseId,
    int expectedVersion,
    CaseActionType actionType,
    String remarks,
    Long assigneeId,
    UserContext actor,
    String correlationId
) {}
```

---

## 5. State Machine as UI Constraint

For case management, UI must reflect workflow state. But the UI must never become the authority for workflow transitions.

Bad mental model:

```text
Button visible => user is allowed => action can execute
```

Correct mental model:

```text
Server policy decides available actions for rendering.
Server policy re-checks permission and state at submission.
UI visibility is convenience, not enforcement.
```

### 5.1 Workflow Policy

```java
public interface CaseActionPolicy {
    List<ActionView> availableActions(CaseSnapshot snapshot, UserContext user);
    void assertAllowed(CaseSnapshot snapshot, UserContext user, CaseActionType action);
}
```

The same policy concept should feed:

- listing action buttons;
- detail page action panel;
- command validation;
- audit reason;
- API/backing service enforcement.

### 5.2 State Transition Table

| Current Status | Action | Next Status | Actor | Required Input |
|---|---:|---|---|---|
| SUBMITTED | ASSIGN | UNDER_REVIEW | supervisor | assignee |
| UNDER_REVIEW | REQUEST_INFORMATION | PENDING_INFORMATION | officer | remarks |
| UNDER_REVIEW | RECOMMEND_ESCALATION | ESCALATED | officer | remarks |
| ESCALATED | APPROVE | APPROVED | approver | remarks |
| ESCALATED | REJECT | REJECTED | approver | remarks |
| APPROVED | CLOSE | CLOSED | officer/supervisor | closing note |

A UI action button is derived from this table, not hardcoded in view.

### 5.3 Stale State Handling

A user opens case detail at version 7. Another officer updates it to version 8. The first user submits `APPROVE` with version 7.

Correct behavior:

1. reject the action as stale;
2. show a clear message;
3. reload latest case state;
4. do not silently overwrite;
5. record failed attempt only if policy requires audit/security monitoring.

Service pseudocode:

```java
@Transactional
public WorkflowResult performAction(WorkflowCommand command) {
    RegulatoryCase c = repository.findForUpdate(command.caseId());

    if (c.getVersion() != command.expectedVersion()) {
        return WorkflowResult.stale(c.getVersion());
    }

    policy.assertAllowed(CaseSnapshot.from(c), command.actor(), command.actionType());
    validator.validate(command, c);

    CaseStatus oldStatus = c.getStatus();
    transition.apply(c, command);

    audit.recordWorkflowAction(c, oldStatus, c.getStatus(), command);
    return WorkflowResult.success(c.getId(), c.getVersion());
}
```

---

## 6. JSP Implementation Variant

JSP implementation is appropriate when the application follows classic MVC:

```text
Servlet/controller
  -> service/application layer
  -> view model/form model
  -> request attributes
  -> JSP + JSTL + custom tags
```

### 6.1 Controller

```java
public class CaseDetailController extends HttpServlet {

    private CaseQueryService caseQueryService;
    private CaseWorkflowService workflowService;

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {

        UserContext user = UserContext.from(request);
        Long caseId = Long.valueOf(request.getParameter("id"));

        CaseDetailView view = caseQueryService.getCaseDetail(caseId, user);

        request.setAttribute("caseView", view);
        request.setAttribute("actionForm", new WorkflowActionForm());

        request.getRequestDispatcher("/WEB-INF/views/case/detail.jsp")
               .forward(request, response);
    }

    @Override
    protected void doPost(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {

        UserContext user = UserContext.from(request);
        WorkflowActionForm form = WorkflowActionFormBinder.bind(request);

        WorkflowCommand command = WorkflowCommandFactory.from(form, user, correlationId(request));
        WorkflowResult result = workflowService.performAction(command);

        if (result.isSuccess()) {
            Flash.success(request, "Action completed successfully.");
            response.sendRedirect(request.getContextPath() + "/cases/detail?id=" + form.getCaseId());
            return;
        }

        if (result.isStale()) {
            Flash.warning(request, "This case has changed. Please review the latest information.");
            response.sendRedirect(request.getContextPath() + "/cases/detail?id=" + form.getCaseId());
            return;
        }

        CaseDetailView view = caseQueryService.getCaseDetail(form.getCaseId(), user);
        request.setAttribute("caseView", view);
        request.setAttribute("actionForm", form);
        request.setAttribute("errors", result.errors());

        request.getRequestDispatcher("/WEB-INF/views/case/detail.jsp")
               .forward(request, response);
    }
}
```

### 6.2 JSP Detail Page

```jsp
<%@ page contentType="text/html; charset=UTF-8" pageEncoding="UTF-8" %>
<%@ taglib prefix="c" uri="jakarta.tags.core" %>
<%@ taglib prefix="fmt" uri="jakarta.tags.fmt" %>
<%@ taglib prefix="app" uri="/WEB-INF/tlds/app.tld" %>

<app:layout title="Case Detail">

  <app:flashMessages />
  <app:errorSummary errors="${errors}" />

  <section class="case-header">
    <h1>Case <c:out value="${caseView.caseNumber}" /></h1>
    <app:statusBadge label="${caseView.statusLabel}"
                     severity="${caseView.statusSeverity}" />
  </section>

  <section class="case-summary">
    <dl>
      <dt>Entity</dt>
      <dd><c:out value="${caseView.entityName}" /></dd>

      <dt>Assigned Officer</dt>
      <dd><c:out value="${caseView.assignedOfficerName}" /></dd>

      <dt>Created</dt>
      <dd><c:out value="${caseView.createdAtDisplay}" /></dd>
    </dl>
  </section>

  <section class="case-actions">
    <h2>Available Actions</h2>

    <c:choose>
      <c:when test="${empty caseView.availableActions}">
        <p>No available action for your role and current case status.</p>
      </c:when>
      <c:otherwise>
        <c:forEach var="action" items="${caseView.availableActions}">
          <app:workflowActionButton action="${action}" caseId="${caseView.caseId}" />
        </c:forEach>
      </c:otherwise>
    </c:choose>
  </section>

  <section class="case-documents">
    <h2>Documents</h2>
    <app:documentTable documents="${caseView.documents}" />
  </section>

  <section class="case-timeline">
    <h2>Timeline</h2>
    <app:timeline items="${caseView.timeline}" />
  </section>

</app:layout>
```

Notice what the JSP does **not** do:

- it does not query database;
- it does not decide workflow transition;
- it does not check real authorization;
- it does not call service methods;
- it does not format raw sensitive data ad hoc;
- it does not compute SLA rules.

It renders a prepared view model.

### 6.3 JSP Custom Tag: Status Badge

A tag file can enforce consistent rendering and escaping.

`/WEB-INF/tags/statusBadge.tag`

```jsp
<%@ tag body-content="empty" pageEncoding="UTF-8" %>
<%@ attribute name="label" required="true" type="java.lang.String" %>
<%@ attribute name="severity" required="true" type="java.lang.String" %>
<%@ taglib prefix="c" uri="jakarta.tags.core" %>

<span class="status-badge status-badge--${fn:escapeXml(severity)}">
  <c:out value="${label}" />
</span>
```

In practice, avoid putting raw `severity` into class name unless it is normalized server-side to an enum-like whitelist:

```java
public enum StatusSeverity {
    INFO("info"), WARNING("warning"), DANGER("danger"), SUCCESS("success");

    private final String cssClass;
}
```

Then expose only the safe CSS token.

### 6.4 JSP Strengths in This Capstone

JSP is strong for:

- server-rendered listing/detail;
- simple request-response interaction;
- legacy MVC modernization;
- low framework state;
- predictable browser HTML;
- easier integration with existing servlet filters;
- gradual refactoring from scriptlet-heavy pages to view model + JSTL/custom tags.

### 6.5 JSP Weaknesses in This Capstone

JSP becomes painful when:

- forms have many dynamic validation rules;
- Ajax partial update becomes complex;
- component reuse requires deep behavior, not just markup;
- stateful multi-step wizard is implemented manually;
- developers push logic into JSTL/scriptlet;
- view model preparation is inconsistent;
- each page invents its own error/action/security rendering.

---

## 7. Jakarta Faces Implementation Variant

Faces implementation is appropriate when the UI is form-heavy, interaction-heavy, and benefits from component lifecycle.

```text
Facelets view
  -> component tree
  -> CDI backing bean
  -> view/form model
  -> conversion/validation
  -> action method
  -> service boundary
  -> navigation/render
```

### 7.1 Backing Bean

```java
@Named
@ViewScoped
public class CaseDetailBean implements Serializable {

    private Long caseId;
    private CaseDetailView caseView;
    private WorkflowActionForm actionForm = new WorkflowActionForm();

    @Inject
    private CaseQueryService caseQueryService;

    @Inject
    private CaseWorkflowService workflowService;

    @Inject
    private CurrentUser currentUser;

    public void load() {
        if (caseId == null) {
            throw new BadRequestException("Missing case id");
        }
        this.caseView = caseQueryService.getCaseDetail(caseId, currentUser.get());
        this.actionForm.setCaseId(caseId);
        this.actionForm.setVersion(caseView.version());
    }

    public String performAction() {
        WorkflowCommand command = WorkflowCommandFactory.from(
            actionForm,
            currentUser.get(),
            Correlation.current()
        );

        WorkflowResult result = workflowService.performAction(command);

        if (result.isSuccess()) {
            FacesMessages.info("Action completed successfully.");
            return "/cases/detail.xhtml?faces-redirect=true&id=" + caseId;
        }

        if (result.isStale()) {
            FacesMessages.warn("This case has changed. Please review the latest information.");
            return "/cases/detail.xhtml?faces-redirect=true&id=" + caseId;
        }

        result.errors().forEach(FacesMessages::error);
        return null;
    }

    // getters/setters
}
```

### 7.2 Facelets Page

```xhtml
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:h="jakarta.faces.html"
      xmlns:f="jakarta.faces.core"
      xmlns:ui="jakarta.faces.facelets"
      xmlns:app="jakarta.faces.composite/app">

<ui:composition template="/WEB-INF/templates/main.xhtml">

  <f:metadata>
    <f:viewParam name="id" value="#{caseDetailBean.caseId}" required="true" />
    <f:viewAction action="#{caseDetailBean.load}" />
  </f:metadata>

  <ui:define name="title">Case Detail</ui:define>

  <ui:define name="content">

    <h:messages globalOnly="true" layout="list" />

    <section class="case-header">
      <h1>Case #{caseDetailBean.caseView.caseNumber}</h1>
      <app:statusBadge label="#{caseDetailBean.caseView.statusLabel}"
                       severity="#{caseDetailBean.caseView.statusSeverity}" />
    </section>

    <h:panelGroup id="actionPanel" layout="block" styleClass="case-actions">
      <h2>Available Actions</h2>

      <ui:fragment rendered="#{empty caseDetailBean.caseView.availableActions}">
        <p>No available action for your role and current case status.</p>
      </ui:fragment>

      <ui:repeat value="#{caseDetailBean.caseView.availableActions}" var="action">
        <app:workflowActionButton action="#{action}"
                                  form="#{caseDetailBean.actionForm}" />
      </ui:repeat>
    </h:panelGroup>

    <app:documentTable documents="#{caseDetailBean.caseView.documents}" />
    <app:timeline items="#{caseDetailBean.caseView.timeline}" />

  </ui:define>
</ui:composition>
</html>
```

### 7.3 Action Dialog Example

```xhtml
<h:form id="workflowForm">

  <h:inputHidden value="#{caseDetailBean.actionForm.caseId}" />
  <h:inputHidden value="#{caseDetailBean.actionForm.version}" />
  <h:inputHidden value="#{caseDetailBean.actionForm.actionType}" />

  <h:outputLabel for="remarks" value="Remarks" />
  <h:inputTextarea id="remarks"
                   value="#{caseDetailBean.actionForm.remarks}"
                   required="true"
                   maxlength="2000" />
  <h:message for="remarks" />

  <h:commandButton value="Submit Action"
                   action="#{caseDetailBean.performAction}">
    <f:ajax execute="@form" render="@form :globalMessages" />
  </h:commandButton>

</h:form>
```

### 7.4 Faces Strengths in This Capstone

Faces is strong for:

- lifecycle-managed forms;
- converter/validator integration;
- component reuse;
- composite component library;
- partial rendering;
- page-level stateful interaction;
- server-side action/navigation model;
- internal enterprise screens.

### 7.5 Faces Weaknesses in This Capstone

Faces becomes risky when:

- view state becomes large;
- developers do expensive service calls in getters;
- `@SessionScoped` is abused;
- component tree becomes deeply dynamic;
- multiple tabs share mutable state incorrectly;
- Ajax target IDs are unstable;
- authorization is only represented by `rendered`;
- component library upgrades are unmanaged.

---

## 8. View Model Design for Both JSP and Faces

Whether using JSP or Faces, design the view model intentionally.

### 8.1 Good View Model Properties

A good view model is:

1. **render-ready** — labels, severity, display dates are already prepared;
2. **safe** — sensitive fields are excluded or masked;
3. **bounded** — lists are paginated or limited;
4. **stable** — changes less often than domain internals;
5. **permission-aware** — available actions are calculated, but not enforced only in UI;
6. **localized or localization-ready** — uses message keys or display strings consistently;
7. **testable** — can be asserted without rendering the whole page;
8. **free of lazy persistence traps** — no accidental DB access during rendering.

### 8.2 Bad View Model Smells

Smells:

- JSP/Faces view receives `RegulatoryCase` JPA entity directly;
- getters trigger repository calls;
- `availableActions` is computed in EL;
- date formatting varies per page;
- status label hardcoded in view;
- sensitive raw NRIC/email/address displayed without masking policy;
- view performs `if user.role == X && case.status == Y` everywhere;
- huge document binary or full audit CLOB is attached to page model;
- session stores entire search result.

### 8.3 Case Detail View Builder

```java
public class CaseDetailViewBuilder {

    private final CaseActionPolicy policy;
    private final DisplayFormatter formatter;
    private final DocumentSecurityPresenter documentPresenter;

    public CaseDetailView build(CaseAggregate aggregate, UserContext user) {
        CaseSnapshot snapshot = CaseSnapshot.from(aggregate.caseEntity());

        return new CaseDetailView(
            aggregate.caseEntity().getId(),
            aggregate.caseEntity().getCaseNumber(),
            aggregate.caseEntity().getStatus().name(),
            formatter.statusLabel(aggregate.caseEntity().getStatus()),
            formatter.statusSeverity(aggregate.caseEntity().getStatus()),
            formatter.entityName(aggregate.entity()),
            formatter.officerName(aggregate.assignedOfficer()),
            formatter.dateTime(aggregate.caseEntity().getCreatedAt(), user.locale(), user.zoneId()),
            formatter.dateTime(aggregate.caseEntity().getUpdatedAt(), user.locale(), user.zoneId()),
            aggregate.caseEntity().getVersion(),
            false,
            policy.availableActions(snapshot, user),
            documentPresenter.present(aggregate.documents(), user),
            formatter.timeline(aggregate.timeline(), user),
            formatter.comments(aggregate.comments(), user)
        );
    }
}
```

The view builder is not a place for authorization enforcement. It is a presentation adapter that consumes policy output.

---

## 9. Security Review of the Capstone

Security must be evaluated by data flow and action flow.

### 9.1 Data Flow Review

```text
DB/domain data
  -> query service
  -> view model builder
  -> JSP/Faces rendering
  -> HTML context / attribute context / JS context / URL context
  -> browser
```

Questions:

1. Which fields are sensitive?
2. Which fields are user-generated?
3. Which fields are displayed in HTML body?
4. Which fields are displayed inside HTML attributes?
5. Which fields are embedded into JavaScript?
6. Which fields are used in URLs?
7. Which fields are used in CSS class names?
8. Is encoding context-aware?
9. Are localized messages trusted?
10. Is raw HTML ever allowed? If yes, is it sanitized by policy?

### 9.2 Action Flow Review

```text
button rendered
  -> user clicks
  -> browser submits form
  -> CSRF protection
  -> authentication
  -> authorization policy
  -> stale version check
  -> validation
  -> workflow transition
  -> audit
  -> redirect/render result
```

Questions:

1. Is CSRF token required?
2. Is the action re-authorized server-side?
3. Is current status checked server-side?
4. Is optimistic version checked?
5. Are hidden fields trusted? They must not be.
6. Is audit recorded in the same transaction as transition?
7. Are error messages safe and not over-disclosing?
8. Does refresh/back button duplicate action?
9. Is POST-Redirect-GET used after successful mutation?
10. Are unauthorized attempts logged at the right level?

### 9.3 View State Security for Faces

If using Faces:

- server-side state saving reduces client tampering risk but increases session memory pressure;
- client-side state saving requires integrity/confidentiality considerations;
- view state must not be treated as business authority;
- `rendered=false` is not authorization;
- hidden component values can be manipulated;
- converter/validator does not replace service-side policy.

### 9.4 File Security

For upload:

- validate extension and content type, but trust neither blindly;
- enforce max size;
- store outside web root;
- generate server-side document id;
- scan asynchronously if required;
- quarantine before available download;
- do not render uploaded filename unescaped;
- normalize filename;
- prevent path traversal;
- audit upload.

For download:

- use document id, not filesystem path;
- authorize every download;
- set safe headers;
- avoid inline for risky types unless policy allows;
- audit access;
- throttle if needed.

---

## 10. Performance Review of the Capstone

### 10.1 Listing Page

Bad:

```text
Load all cases -> store in session -> paginate in JSP/Faces table
```

Good:

```text
Search criteria -> server-side query with pagination -> view model page -> render only current page
```

Search model:

```java
public record CaseSearchCriteria(
    String caseNumber,
    String status,
    Long officerId,
    String entityName,
    LocalDate fromDate,
    LocalDate toDate,
    int page,
    int size,
    String sort
) {}
```

View model:

```java
public record CaseListingView(
    CaseSearchCriteria criteria,
    List<CaseRowView> rows,
    int page,
    int size,
    long totalElements,
    int totalPages
) {}
```

### 10.2 Detail Page

Avoid loading everything.

Better detail page structure:

- summary: loaded immediately;
- documents: metadata only, not binary;
- timeline: latest N items, link to full timeline;
- audit: separate tab/page with pagination;
- comments: latest N or paginated;
- expensive derived indicators: precomputed or cached with invalidation.

### 10.3 Faces-Specific Performance

Watch:

- component count;
- view state size;
- `@ViewScoped` object graph;
- repeated EL calls;
- getters with DB/service access;
- data table row state;
- Ajax `render="@form"` too broad;
- client payload size;
- session replication overhead.

Rule:

```text
Do not hide backend inefficiency behind Ajax.
A partial render still runs server lifecycle.
```

### 10.4 JSP-Specific Performance

Watch:

- complex JSTL loops;
- nested custom tags;
- dynamic includes in loops;
- repeated formatting logic;
- session-sized view models;
- large generated HTML;
- scriptlets doing work;
- controller not precomputing display data.

### 10.5 Production Metrics

Capture:

- request duration by endpoint/view;
- render duration if possible;
- DB query count per request;
- response size;
- session size estimate;
- Faces view state size;
- validation failure rate;
- stale action rate;
- authorization denial rate;
- upload/download latency;
- error by page/action;
- top slow pages;
- top heavy component trees.

---

## 11. Failure Modeling

Top-tier design asks: “How does this fail?” before implementation.

### 11.1 Double Submit

Scenario:

- user clicks Approve twice;
- browser sends two POSTs;
- first succeeds;
- second arrives after state changed.

Controls:

- optimistic version;
- idempotency token for sensitive commands;
- disable button client-side as UX only;
- server-side state transition guard;
- PRG after success.

### 11.2 Stale State

Scenario:

- user opens page at 10:00;
- another officer updates case at 10:05;
- user submits at 10:10.

Controls:

- version hidden field;
- database optimistic locking;
- clear stale error;
- reload latest view;
- no silent merge for workflow action.

### 11.3 Unauthorized Action

Scenario:

- button hidden in UI;
- user crafts POST manually.

Controls:

- enforce policy in service layer;
- log attempt;
- avoid leaking whether case exists if policy requires;
- return generic denial.

### 11.4 Validation Race

Scenario:

- assignee valid during render;
- assignee inactive before submit.

Controls:

- validate again at command execution;
- service-side reference checks;
- stale/invalid reference error.

### 11.5 Session Expired

Scenario:

- user fills long form;
- session expires;
- submit fails.

Controls:

- graceful session timeout page;
- warn before timeout if appropriate;
- avoid losing draft for long forms if business requires;
- do not auto-resubmit mutation after re-login unless explicitly designed.

### 11.6 ViewExpiredException in Faces

Scenario:

- Faces server-side view state evicted;
- user submits old page.

Controls:

- friendly handler;
- redirect to reload page;
- preserve non-sensitive query context;
- tune state/session if too frequent;
- avoid huge view state.

### 11.7 Concurrent Update

Scenario:

- two supervisors assign same case to different officers.

Controls:

- row lock or optimistic version;
- deterministic error message;
- audit only successful transition as business action;
- monitor frequent conflicts as process signal.

### 11.8 Partial Ajax Failure

Scenario:

- Ajax request returns login page due timeout;
- client expects partial response XML;
- UI breaks.

Controls:

- Ajax-aware exception/session handler;
- proper partial response error;
- client `onerror` handling;
- global timeout detection.

---

## 12. Testing Strategy

### 12.1 Unit Tests

Test pure logic:

- action policy;
- transition table;
- view model builder;
- formatter;
- command factory;
- validation rules;
- security presenter.

Example:

```java
@Test
void officerCanRecommendEscalationWhenUnderReview() {
    CaseSnapshot c = snapshot(CaseStatus.UNDER_REVIEW);
    UserContext officer = userWithRole("OFFICER");

    List<ActionView> actions = policy.availableActions(c, officer);

    assertThat(actions)
        .extracting(ActionView::code)
        .contains("RECOMMEND_ESCALATION");
}
```

### 12.2 JSP Rendering Tests

Test rendered HTML with a parser:

- status badge exists;
- dangerous action has confirmation;
- unauthorized action not rendered;
- user-generated text escaped;
- CSRF field exists;
- error summary links to fields.

### 12.3 Faces Component Tests

Test:

- backing bean load;
- action method result;
- validation failure does not call service;
- stale result creates warning;
- composite component renders expected id/label/message;
- Ajax targets exist.

### 12.4 Integration Tests

Run with real-ish container:

- GET listing;
- GET detail;
- POST action success;
- POST stale action;
- POST unauthorized action;
- POST validation failure;
- upload invalid file;
- download unauthorized document;
- session timeout behavior.

### 12.5 Security Tests

Include regression payloads:

```text
<script>alert(1)</script>
" onmouseover="alert(1)
javascript:alert(1)
</textarea><script>alert(1)</script>
../../etc/passwd
```

Assert they do not execute, do not become unsafe URLs, and do not leak into raw context.

### 12.6 Performance Tests

Test:

- listing with 10, 50, 100 page size;
- detail with many documents/comments;
- view state size under threshold;
- repeated Ajax action;
- session memory growth;
- DB query count per render;
- cold-start JSP compilation if applicable;
- rolling deployment view compatibility if Faces state is involved.

---

## 13. Audit Design

Audit must not be an afterthought in regulatory UI.

### 13.1 Audit Event

```java
public record AuditEvent(
    String eventType,
    Long caseId,
    String caseNumber,
    String actorId,
    String actorRole,
    String sourceChannel,
    String ipAddress,
    String userAgent,
    String correlationId,
    String oldStatus,
    String newStatus,
    String actionType,
    String remarksSummary,
    Instant occurredAt
) {}
```

### 13.2 Audit Placement

Bad:

```text
JSP button click -> write audit log
```

Good:

```text
Workflow service applies transition and records audit in same business transaction boundary
```

UI may display audit, but service owns audit creation.

### 13.3 Audit and Error Cases

Successful business action:

- record as business audit.

Unauthorized attempt:

- record as security event if policy requires.

Validation failure:

- usually not business audit, but may be metric/log.

Stale action:

- metric/log; business audit only if organization needs failed attempt trace.

File download:

- often should be audit event because sensitive data access occurred.

---

## 14. Accessibility and Localization

### 14.1 Accessibility Rules

- Every input has label.
- Error summary is announced/accessibly linked.
- Status badge includes text, not color-only meaning.
- Buttons have clear labels.
- Confirmation dialog is keyboard accessible.
- Table headers use proper semantics.
- Pagination is navigable.
- Focus moves predictably after validation error or Ajax update.

### 14.2 Localization Rules

- Do not hardcode business labels in JSP/XHTML.
- Use message keys for status/action/error.
- Dates and numbers use user locale/timezone policy.
- Audit timestamps should have clear timezone.
- Avoid concatenating localized messages manually.
- Error messages should be specific enough for user, not leaking internals.

Example message keys:

```properties
case.status.UNDER_REVIEW=Under Review
case.action.RECOMMEND_ESCALATION=Recommend Escalation
case.error.stale=This case has changed. Please review the latest information before submitting again.
case.error.unauthorized=You are not allowed to perform this action.
```

---

## 15. Migration Strategy for a Legacy Capstone App

Assume you inherit:

- Java 8;
- Java EE 7/8;
- JSP with scriptlets;
- JSF 2.x pages;
- mixed JSTL versions;
- large session objects;
- direct entity rendering;
- hardcoded role checks in views.

### 15.1 Stabilize First

Do not immediately convert every `javax.*` to `jakarta.*` if you cannot test behavior.

First:

1. inventory pages and flows;
2. identify high-risk state-changing actions;
3. add regression tests around critical flows;
4. extract view model builders;
5. centralize policy;
6. remove DB calls from views/getters;
7. add XSS tests around user-generated content;
8. add optimistic version to workflow forms;
9. measure session/view state size.

### 15.2 Modernize Structure

For JSP:

- scriptlet → controller/service/view model;
- repeated HTML → tag file/custom tag;
- role checks in JSP → available action model;
- SQL tag → service/query layer;
- raw formatting → formatter/tag;
- direct entity → view DTO.

For Faces:

- legacy managed beans → CDI `@Named` beans;
- session scope abuse → view/request scope;
- getter service calls → explicit load/action methods;
- dynamic IDs → stable component structure;
- huge component tree → pagination/lazy loading;
- old component libraries → version compatibility plan.

### 15.3 Namespace Migration

Then perform:

- dependency alignment;
- `javax.*` → `jakarta.*`;
- TLD/taglib URI update;
- Facelets namespace update if needed;
- web.xml/faces-config update;
- container upgrade;
- third-party library upgrade;
- integration test;
- performance baseline comparison;
- security regression.

### 15.4 Java 8 to Java 17/21/25

Important distinction:

- Java 8 legacy stack may run old Java EE/Jakarta EE 8 libraries.
- Jakarta EE 11 requires Java SE 17+ minimum.
- Java 21/25 may be runtime choices if container supports them.
- Do not assume Java language upgrade automatically modernizes Jakarta APIs.

Migration should be treated as three separate axes:

```text
JDK axis: Java 8 -> 17/21/25
Jakarta axis: javax.* -> jakarta.*
Container axis: old app server -> EE 10/11-compatible server
```

---

## 16. Production Readiness Checklist

### 16.1 Functional

- [ ] Listing supports pagination and sorting.
- [ ] Detail page loads bounded data.
- [ ] Workflow actions reflect current state.
- [ ] State transitions are server-enforced.
- [ ] Form validation is clear.
- [ ] File upload/download works under policy.
- [ ] Audit display is paginated.
- [ ] PRG is used after successful mutations.

### 16.2 Security

- [ ] Every state-changing POST has CSRF protection.
- [ ] Every action is authorized server-side.
- [ ] Hidden fields are not trusted.
- [ ] Output is context-encoded.
- [ ] Raw HTML is prohibited or sanitized.
- [ ] Sensitive data is masked or excluded.
- [ ] Download is authorized and audited.
- [ ] Cache-control is set for protected pages.
- [ ] Error pages do not leak stack traces.
- [ ] Security headers are configured.

### 16.3 Consistency

- [ ] Optimistic version exists on workflow forms.
- [ ] Concurrent update produces clear stale message.
- [ ] Double submit is handled.
- [ ] Multi-tab behavior is understood.
- [ ] Faces view expiration has friendly recovery.
- [ ] Wizard flows handle back/cancel safely.

### 16.4 Performance

- [ ] No unbounded list in session.
- [ ] No binary document loaded into detail page.
- [ ] No service/DB calls from JSP/tag/getters.
- [ ] Faces view state size is measured.
- [ ] Component count is reasonable.
- [ ] DB query count per page is measured.
- [ ] Large tables are paginated/lazy.
- [ ] Ajax execute/render scope is minimal.

### 16.5 Maintainability

- [ ] View model is separate from entity.
- [ ] Form model is separate from display model.
- [ ] Policy is centralized.
- [ ] Reusable tags/components exist for repeated UI.
- [ ] Layout is centralized.
- [ ] Message keys are centralized.
- [ ] Tests cover critical render/action flows.
- [ ] Migration assumptions are documented.

### 16.6 Operations

- [ ] Correlation id is visible in logs.
- [ ] Action failures are observable.
- [ ] Stale/validation/authorization rates are measured.
- [ ] Upload/download errors are monitored.
- [ ] Session size/view state trends are monitored.
- [ ] Slow page report exists.
- [ ] Audit write failure policy is defined.

---

## 17. Decision Matrix: JSP vs Faces for This Capstone

| Need | JSP + JSTL/custom tags | Jakarta Faces |
|---|---|---|
| Simple listing/detail | Strong | Good |
| Complex forms | Manual effort | Strong |
| Component lifecycle | Limited | Strong |
| Low server state | Strong | Requires discipline |
| Legacy servlet MVC | Strong | Possible but larger shift |
| Ajax partial update | Manual/JS-heavy | Built-in |
| Composite UI library | Tag files/custom tags | Composite/custom components |
| Fine-grained validation lifecycle | Manual | Strong |
| Performance transparency | Easier | Needs state/component monitoring |
| Migration from old JSP | Natural | Rewrite-ish |
| Internal admin workflow UI | Good | Strong |
| Public high-scale stateless pages | Often better | Must be careful |

Practical recommendation:

- Use **JSP** for server-rendered pages where interaction is mostly request/response and you want low framework state.
- Use **Faces** where the UI is form-heavy, component-heavy, validation-heavy, and team understands lifecycle/state management.
- Use **SPA + REST/BFF** where UI interaction is highly client-side, offline-ish, very dynamic, or needs strong frontend ecosystem.
- Use **hybrid** only if boundaries are explicit: do not mix frameworks randomly page by page without ownership rules.

---

## 18. Reference Architecture

```text
Browser
  |
  | HTML form / Faces postback / file upload / download request
  v
Web Layer
  - Servlet Controller / FacesServlet
  - Filters: auth, CSRF, correlation id, headers
  - JSP/Facelets rendering
  |
  v
Presentation Application Layer
  - View model builder
  - Form binder / converter / validator adapter
  - Message/localization adapter
  - Navigation/result mapper
  |
  v
Use Case Layer
  - CaseQueryService
  - CaseWorkflowService
  - DocumentService
  - AuditService
  - PolicyService
  |
  v
Domain Layer
  - Case aggregate
  - Workflow state machine
  - Business rules
  - Domain events
  |
  v
Infrastructure
  - Database
  - File/object storage
  - Virus scanning
  - Email/notification
  - Audit store
  - Identity provider
```

Key rule:

```text
The view may reflect policy.
The service must enforce policy.
The domain should protect invariants.
The audit must capture meaningful business events.
```

---

## 19. Top 1% Review Questions

When reviewing a JSP/Faces case management implementation, ask:

1. What is the source of truth for allowed actions?
2. Is the same rule used for rendering and enforcement?
3. What happens if the case changes between render and submit?
4. Can a user craft a POST for hidden actions?
5. What data is stored in session/view state?
6. Is the view model safe and bounded?
7. Are entities exposed to the view?
8. Can rendering trigger DB calls?
9. Does every mutation have audit?
10. Is audit written atomically with mutation?
11. Are user-generated fields encoded in the right context?
12. Are localized messages safe?
13. Are file names and downloads safe?
14. Is PRG used after successful POST?
15. What happens on double-click?
16. What happens on session timeout?
17. What happens on Faces view expiration?
18. Can Ajax response leak protected content?
19. Is the table paginated at DB level?
20. Is the component tree/view state measured?
21. Can this page survive clustering/failover?
22. Are action errors user-friendly but not over-disclosing?
23. Are tests checking rendered security properties?
24. Is there a migration path if `javax.*` dependencies remain?
25. Is the code understandable by the next maintainer?

These questions are more valuable than memorizing tags.

---

## 20. Common Anti-Patterns and Better Alternatives

### Anti-Pattern 1: Role Checks Everywhere in View

Bad:

```jsp
<c:if test="${user.role == 'SUPERVISOR' && case.status == 'SUBMITTED'}">
  <button>Assign</button>
</c:if>
```

Better:

```jsp
<c:forEach var="action" items="${caseView.availableActions}">
  <app:workflowActionButton action="${action}" />
</c:forEach>
```

Enforcement remains in service.

### Anti-Pattern 2: Entity as Backing Bean

Bad:

```xhtml
<h:inputText value="#{caseBean.case.assignedOfficer.name}" />
```

Better:

```xhtml
<h:selectOneMenu value="#{caseBean.actionForm.assigneeId}">
  <f:selectItems value="#{caseBean.assigneeOptions}" />
</h:selectOneMenu>
```

Service validates assignee.

### Anti-Pattern 3: Getter Calls Service

Bad:

```java
public List<DocumentView> getDocuments() {
    return documentService.findByCase(caseId);
}
```

Better:

```java
public void load() {
    this.documents = documentService.findMetadataByCase(caseId, currentUser);
}

public List<DocumentView> getDocuments() {
    return documents;
}
```

### Anti-Pattern 4: View Controls Workflow

Bad:

```java
if (request.getParameter("action").equals("APPROVE")) {
    case.setStatus(APPROVED);
}
```

Better:

```java
workflowService.performAction(command);
```

### Anti-Pattern 5: Session as Workbench Dump

Bad:

```java
session.setAttribute("allSearchResults", results);
session.setAttribute("currentCase", entityWithAllRelations);
```

Better:

```java
request.setAttribute("listingView", pageResult);
// or @ViewScoped small form state for Faces
```

---

## 21. Final Mental Model

A robust enterprise server-side UI is not a collection of pages. It is a carefully bounded interaction system.

For JSP:

```text
Controller owns request handling.
Service owns use case.
Policy owns authorization/allowed action.
View model owns render-ready data.
JSP owns markup rendering only.
Custom tags own repeated safe UI patterns.
```

For Faces:

```text
FacesServlet owns lifecycle.
Facelets owns view declaration.
Component tree owns UI state.
Backing bean coordinates view interaction.
Converters/validators protect UI-level integrity.
Service owns business transition.
Policy owns authorization.
Domain owns invariants.
```

For both:

```text
Never trust the view.
Never put business truth in hidden fields.
Never confuse button visibility with permission.
Never let rendering perform business work.
Never let session become an unbounded cache.
Never ship without stale-state and double-submit handling.
```

The real mark of seniority is not knowing every tag. It is knowing where each responsibility must live so that the system remains secure, observable, auditable, testable, and evolvable under real production pressure.

---

## 22. What Has Been Covered in the Whole Series

This series covered:

1. server-side UI mental model;
2. Java EE/Jakarta EE compatibility;
3. JSP internal architecture;
4. JSP syntax;
5. scope and state boundaries;
6. Expression Language fundamentals;
7. advanced EL;
8. JSTL core tags;
9. formatting/i18n/XML/SQL tags;
10. custom tags and tag files;
11. JSP layouting;
12. JSP security;
13. JSP performance and operations;
14. JSP/tag testing;
15. Jakarta Faces big picture;
16. Facelets;
17. CDI/backing bean scopes;
18. Faces lifecycle;
19. standard Faces components;
20. conversion/validation;
21. navigation/actions/events;
22. state management;
23. Ajax/partial rendering;
24. composite components;
25. custom Faces extensions;
26. Faces security;
27. Faces performance;
28. ecosystem libraries;
29. migration playbook;
30. architecture patterns;
31. capstone enterprise case management UI.

---

## 23. Final Checklist for Mastery

You can consider yourself strong in this topic when you can do the following without guessing:

- explain why JSP is compiled into servlet;
- read generated JSP servlet when debugging;
- remove scriptlet from a legacy JSP;
- design a safe custom tag;
- choose correct scope for view state;
- debug EL resolver failure;
- prevent context-specific XSS;
- design a reusable JSP layout;
- test rendered HTML;
- explain Faces lifecycle phase by phase;
- debug why a Faces action is not called;
- debug why a model value is not updated;
- design a `@ViewScoped` bean safely;
- build composite components;
- reason about Faces view state size;
- handle `ViewExpiredException` gracefully;
- secure hidden fields and file download;
- migrate `javax.*` to `jakarta.*` with risk control;
- choose JSP vs Faces vs SPA rationally;
- review an enterprise server-side UI for security, performance, auditability, and maintainability.

---

## 24. Closing Principle

Server-side Java UI may look old from the outside, but in many enterprise systems it still sits at the boundary between humans and high-stakes workflows.

That boundary deserves serious engineering.

A top-tier engineer does not ask only:

> “How do I render this field?”

They ask:

> “What invariant does this screen expose, what action does it allow, what state does it carry, what data can leak, what can race, what can be forged, what must be audited, and how will the next engineer safely change it?”

That is the mindset this entire series is designed to build.

---

## 25. Status Seri

Seri `learn-java-jakarta-pages-el-tags-faces-server-side-ui` **selesai di bagian ini**.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./29-architecture-patterns-jsp-faces-modern-enterprise-systems.md">⬅️ Part 29 — Architecture Patterns: JSP/Faces in Modern Enterprise Systems</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<span></span>
</div>
