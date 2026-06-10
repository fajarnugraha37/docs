# Strict Coding Standards — Java JSP / Jakarta Server Pages

## 0. Purpose

This standard defines mandatory rules for using **JSP / Jakarta Server Pages** in Java web applications.

It is written for LLM code agents and reviewers. It is not a beginner tutorial and must be treated as an implementation contract.

JSP is a legacy-compatible server-side view technology. New projects should prefer a clearer server-side template engine or frontend architecture unless JSP is required by the platform, existing application, or deployment container.

## 1. Core Principle

JSP must be used only as a **view rendering layer**.

JSP must not contain:

- business logic,
- persistence logic,
- service calls,
- transaction logic,
- authorization decisions,
- SQL/JPQL/HQL,
- network calls,
- file I/O,
- cryptography,
- thread creation,
- mutable global state.

If a JSP page needs logic beyond simple presentation branching, that logic belongs in controller/service/view-model code.

## 2. Baseline References

This standard is grounded in these primary references:

- Jakarta Pages specification index: https://jakarta.ee/specifications/pages/
- Jakarta Server Pages 4.0 specification: https://jakarta.ee/specifications/pages/4.0/jakarta-server-pages-spec-4.0
- Jakarta Expression Language specification: https://jakarta.ee/specifications/expression-language/
- Jakarta Standard Tag Library specification: https://jakarta.ee/specifications/tags/
- Jakarta Servlet specification: https://jakarta.ee/specifications/servlet/
- OWASP Cross-Site Scripting Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
- OWASP Input Validation Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
- OWASP Logging Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html

## 3. Version and Namespace Rules

### 3.1 Version alignment

JSP/Jakarta Pages version must follow the application platform:

| Platform | JSP/Jakarta Pages family | Namespace |
|---|---:|---|
| Java EE / old servlet containers | JSP 2.x | `javax.servlet.jsp.*`, `javax.servlet.*`, `javax.el.*` |
| Jakarta EE 9 | Jakarta Server Pages 3.0 | `jakarta.servlet.jsp.*`, `jakarta.servlet.*`, `jakarta.el.*` |
| Jakarta EE 10 | Jakarta Server Pages 3.1 | `jakarta.*` |
| Jakarta EE 11 | Jakarta Pages 4.0 | `jakarta.*` |
| Jakarta EE 12 under development | Jakarta Pages 4.1 | `jakarta.*`; forbidden as baseline unless explicitly approved |

### 3.2 Namespace mixing

Do not mix `javax.*` and `jakarta.*` JSP/Servlet/EL APIs in one module.

Forbidden:

```java
import javax.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
```

A migration must move the whole web module coherently.

## 4. Scope

This file governs:

- `.jsp` and `.jspx` files,
- JSP include behavior,
- JSP tag libraries,
- JSP Expression Language usage,
- JSTL / Jakarta Tags usage,
- servlet-controller-to-JSP model passing,
- JSP error pages,
- JSP rendering security,
- JSP caching and headers,
- JSP testing and review.

This file does not replace:

- `strict-coding-standards__jaxrs.md`
- `strict-coding-standards__java_http.md`
- `strict-coding-standards__java_security.md`
- `strict-coding-standards__java_string.md`
- `strict-coding-standards__java_validation.md`
- `strict-coding-standards__java_logging.md`

## 5. LLM Agent Non-Negotiable Rules

An LLM code agent MUST:

1. keep JSP pages as dumb views;
2. use JSTL/Jakarta Tags and EL instead of Java scriptlets;
3. escape output by context;
4. never print raw user input;
5. never put database/service logic in JSP;
6. never create sessions casually;
7. never use hidden fields as trusted state;
8. never leak stack traces or internal error messages;
9. document any legacy JSP compromise;
10. add or update tests for controller model and rendered output when behavior changes.

If the agent cannot identify whether data is trusted, it must treat the data as untrusted.

## 6. Allowed, Restricted, and Forbidden Constructs

| Construct | Status | Rule |
|---|---:|---|
| JSP as final server-rendered view | Allowed | Controller prepares model; JSP renders only. |
| JSP Expression Language | Allowed | Use for simple property access and condition checks. |
| JSTL/Jakarta Tags | Allowed | Use for loops, conditionals, formatting, URL generation. |
| Custom tags | Restricted | Must be reusable presentation logic only. |
| JSP fragments/includes | Restricted | Must not create hidden dependency chains. |
| `scriptlet <% ... %>` | Forbidden by default | Legacy-only; requires explicit migration note. |
| JSP declaration `<%! ... %>` | Forbidden | Creates page-level members and hidden mutable state risk. |
| JSP expression `<%= ... %>` | Forbidden by default | Use EL and context-aware escaping instead. |
| Java imports in JSP | Forbidden by default | Indicates logic moved into view. |
| SQL/JDBC/JPA/Hibernate in JSP | Forbidden | Violates layering and transaction boundary. |
| Direct service locator lookup in JSP | Forbidden | Controller/service layer owns dependencies. |
| Raw HTML injection from request/model | Forbidden | Requires sanitized, policy-approved rich content object. |
| Debug stack trace in response | Forbidden | Log server-side; render safe error page. |

## 7. Directory and Naming Rules

### 7.1 Location

JSP files must not be directly reachable unless intentionally public.

Preferred layout:

```text
src/main/webapp/WEB-INF/views/
  layout/
  fragments/
  pages/
```

Files under `WEB-INF` cannot be requested directly by the browser and should be reached through a controller/dispatcher.

### 7.2 Naming

Use clear names:

```text
pages/case-detail.jsp
pages/case-search.jsp
fragments/pagination.jspf
layout/main.jsp
```

Avoid:

```text
test.jsp
new.jsp
common.jsp
page1.jsp
```

## 8. Controller-to-View Contract

### 8.1 Explicit model

A controller must prepare a minimal view model.

Allowed:

```java
request.setAttribute("caseView", caseView);
request.getRequestDispatcher("/WEB-INF/views/pages/case-detail.jsp")
       .forward(request, response);
```

Forbidden:

```jsp
<%
CaseService service = ServiceLocator.get(CaseService.class);
Case c = service.find(request.getParameter("id"));
%>
```

### 8.2 Model object rules

Objects passed to JSP should be:

- DTO/view model objects;
- immutable or effectively immutable;
- already authorized and filtered;
- preformatted only when formatting is domain-specific;
- free of lazy-loading entities.

Do not pass JPA entities directly to JSP if rendering could trigger lazy loading or leak internal fields.

### 8.3 Request parameters

JSP must not read raw request parameters for business decisions.

Restricted use:

```jsp
${param.q}
```

Allowed only for display echo after validation and context-aware escaping.

## 9. Escaping and XSS Rules

### 9.1 Default stance

All dynamic values are untrusted unless explicitly proven otherwise.

Every dynamic value must be escaped for its output context:

| Context | Required protection |
|---|---|
| HTML body text | HTML text escaping |
| HTML attribute | HTML attribute escaping and safe quoting |
| URL parameter | URL encoding plus URL allow-listing |
| JavaScript string | JavaScript string encoding; avoid dynamic JS where possible |
| CSS | Avoid dynamic CSS; strict allow-list if unavoidable |
| Raw HTML | Forbidden unless sanitized by approved policy |

### 9.2 Use tag escaping

Prefer:

```jsp
<c:out value="${caseView.title}" />
```

Avoid:

```jsp
${caseView.title}
```

because reviewers must verify how the container/framework handles escaping. `c:out` makes the intent visible.

### 9.3 Raw HTML policy

Rendering raw HTML is forbidden by default.

If required for CMS-like content, the value must be:

1. sanitized server-side using an approved HTML sanitizer policy;
2. stored or wrapped as `TrustedHtml` / `SanitizedHtml` type;
3. rendered only in a clearly marked location;
4. covered by XSS tests.

Forbidden:

```jsp
${article.bodyHtml}
```

Restricted:

```jsp
${article.sanitizedBodyHtml}
```

Only allowed when the variable type and pipeline prove sanitization.

## 10. URL and Link Rules

Use URL-generation tags or controller-generated URLs.

Allowed:

```jsp
<c:url var="detailUrl" value="/cases/detail">
  <c:param name="id" value="${caseView.id}" />
</c:url>
<a href="${detailUrl}">View</a>
```

Do not concatenate URLs manually with untrusted parameters:

```jsp
<a href="/cases/detail?id=${param.id}">View</a>
```

External links must validate scheme and host at model construction time.

## 11. Form Rules

### 11.1 CSRF

Every state-changing form must include CSRF protection from the application framework.

Forbidden:

```jsp
<form method="post" action="/approve">
```

Allowed only with CSRF token:

```jsp
<form method="post" action="${approveUrl}">
  <input type="hidden" name="csrfToken" value="${csrfToken}">
</form>
```

The token must be framework-backed, not invented in JSP.

### 11.2 Hidden fields

Hidden fields are user-controlled input.

Do not trust:

```jsp
<input type="hidden" name="role" value="admin">
```

Server-side authorization and state lookup must decide.

### 11.3 Validation errors

Validation errors must be displayed from a structured error model:

```text
fieldErrors: Map<String, List<String>>
globalErrors: List<String>
```

Do not display raw exception messages.

## 12. Session and State Rules

### 12.1 Session creation

JSP must not create sessions unintentionally.

For pages that do not need session:

```jsp
<%@ page session="false" %>
```

### 12.2 Session usage

Session reads are restricted to view-only concerns such as locale or authenticated user display name.

Forbidden in JSP:

- changing user role;
- modifying cart/order/case state;
- storing search results;
- caching large objects;
- storing security decisions.

## 13. Internationalization and Formatting

### 13.1 Locale

Locale must be resolved at the controller/framework boundary.

Do not guess locale in JSP from arbitrary request parameter.

### 13.2 Formatting

Use formatting tags or preformatted view values.

Rules:

- money formatting must follow `java_number` standard;
- time/date formatting must follow `java_time_date` standard;
- never format money with floating point;
- never manually concatenate date strings.

## 14. Error Page Rules

JSP error pages must be safe and minimal.

Allowed:

```jsp
<%@ page isErrorPage="true" %>
<h1>Something went wrong</h1>
<p>Please contact support with reference ID: <c:out value="${errorRef}" /></p>
```

Forbidden:

```jsp
<pre>${exception.stackTrace}</pre>
```

Error reference IDs must correlate with server-side logs.

## 15. Include and Layout Rules

### 15.1 Static include

Use static includes only for stable fragments:

```jsp
<%@ include file="/WEB-INF/views/fragments/header.jspf" %>
```

### 15.2 Dynamic include

Dynamic includes are restricted.

They must not be based on raw request parameters:

```jsp
<jsp:include page="${param.page}" />
```

This is forbidden because it can become path traversal or unauthorized view access.

### 15.3 Layout ownership

A layout must define regions. Pages must not mutate layout-level behavior via hidden globals.

## 16. Custom Tag Rules

Custom tags are allowed for presentation reuse only.

Allowed:

- pagination renderer;
- breadcrumb renderer;
- field error renderer;
- safe status badge renderer.

Forbidden:

- custom tag that calls repositories/services;
- custom tag that starts transactions;
- custom tag that performs network calls;
- custom tag that bypasses escaping.

## 17. Caching and Headers

JSP must not set critical HTTP caching/security headers ad hoc.

Headers must be controlled by filters/framework middleware:

- `Cache-Control`,
- `Content-Security-Policy`,
- `X-Content-Type-Options`,
- `Referrer-Policy`,
- `Permissions-Policy`,
- session cookie flags.

JSP can participate only through view-specific metadata passed from controller.

## 18. Performance Rules

JSP rendering must not perform expensive work.

Forbidden:

- sorting large lists in JSP;
- filtering large lists in JSP;
- running regex-heavy transformations in JSP;
- calling service/DB per row;
- creating large temporary strings in scriptlets.

Controller/service layer must prepare render-ready data.

## 19. Observability Rules

JSP must not log directly unless there is a very narrow, legacy reason.

Rendering failures must be logged at controller/filter/error handler layer with:

- request ID,
- user/session safe identifier,
- route/view name,
- exception type,
- template name,
- no sensitive payload.

## 20. Testing Requirements

Changes to JSP-rendered behavior require tests for:

1. controller returns correct view;
2. model contains required attributes;
3. missing optional values render safely;
4. user-controlled values are escaped;
5. validation errors render correctly;
6. unauthorized fields are not present;
7. CSRF token exists for state-changing forms;
8. no stack traces are rendered on error.

Use integration tests or HTML parsing tests where possible.

## 21. Anti-Patterns

Forbidden anti-patterns:

- JSP as controller;
- JSP as service layer;
- JSP as SQL layer;
- JSP scriptlet business logic;
- direct entity rendering;
- raw `${param.*}` in HTML;
- raw rich text rendering;
- user-controlled include path;
- relying on client-side hidden fields for authorization;
- stack trace in response;
- inline JavaScript with untrusted values.

## 22. Reviewer Checklist

A reviewer must reject JSP changes if:

- scriptlets are added without explicit legacy exemption;
- output escaping is unclear;
- raw HTML is rendered without sanitizer proof;
- JSP reads request parameters for business logic;
- JSP calls service/repository/database/network;
- forms lack CSRF;
- hidden fields are trusted;
- lazy entities are passed into the view;
- errors leak internal information;
- tests do not cover escaping and model contract.

## 23. LLM Prompt Contract

When implementing JSP code, the LLM agent must follow this contract:

```text
Use JSP only as a presentation layer.
Do not add scriptlets, declarations, SQL, service calls, or business logic to JSP.
Use controller-prepared view models.
Escape every dynamic value based on output context.
Prefer JSTL/Jakarta Tags and EL for simple rendering.
Treat request parameters, hidden fields, and model text as untrusted unless proven otherwise.
Do not render raw HTML unless it is sanitized and represented as a trusted type.
Add/update tests for model contract and XSS escaping behavior.
```

## 24. Final Rule

A JSP page is acceptable only when it is boring.

If it contains clever logic, hidden state, security decisions, or data access, it is not a view anymore and must be refactored.
