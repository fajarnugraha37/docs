# learn-java-jakarta-part-028.md

# Bagian 28 — Jakarta Pages / JSP (`jakarta.servlet.jsp`): Translation to Servlet, Tag Libraries, EL, JSTL, dan Modern Relevance

> Target pembaca: Java engineer yang ingin memahami Jakarta Pages / JSP bukan sebagai “cara lama menulis HTML”, tetapi sebagai **server-side template engine** yang dikompilasi menjadi Servlet, terintegrasi dengan Expression Language, tag libraries, implicit objects, request/session/application scope, dan masih banyak ditemui di legacy Jakarta EE/Java EE systems.
>
> Fokus bagian ini: Jakarta Pages 4.0 di Jakarta EE 11, JSP lifecycle, translation/compilation menjadi Servlet, directives, declarations, scriptlets, expressions, EL, implicit objects, standard actions, tag libraries, Jakarta Tags/JSTL, custom tags, tag files, JSP fragments, error pages, security, performance, migration, and when JSP still makes sense today.

---

## Daftar Isi

1. [Orientasi: Jakarta Pages Itu Apa?](#1-orientasi-jakarta-pages-itu-apa)
2. [Mental Model: JSP adalah Template yang Dikompilasi Menjadi Servlet](#2-mental-model-jsp-adalah-template-yang-dikompilasi-menjadi-servlet)
3. [Jakarta Pages 4.0 dalam Jakarta EE 11](#3-jakarta-pages-40-dalam-jakarta-ee-11)
4. [JSP vs Servlet vs Faces vs REST vs Template Engine Modern](#4-jsp-vs-servlet-vs-faces-vs-rest-vs-template-engine-modern)
5. [Dependency, Runtime, dan Packaging](#5-dependency-runtime-dan-packaging)
6. [Peta API dan Package `jakarta.servlet.jsp`](#6-peta-api-dan-package-jakartaservletjsp)
7. [JSP Lifecycle: Translation, Compilation, Loading, Execution](#7-jsp-lifecycle-translation-compilation-loading-execution)
8. [JSP Generated Servlet: Apa yang Sebenarnya Terjadi?](#8-jsp-generated-servlet-apa-yang-sebenarnya-terjadi)
9. [Directive: `page`, `include`, `taglib`](#9-directive-page-include-taglib)
10. [Scripting Elements: Declaration, Scriptlet, Expression](#10-scripting-elements-declaration-scriptlet-expression)
11. [Kenapa Scriptlet Harus Dihindari](#11-kenapa-scriptlet-harus-dihindari)
12. [Expression Language dalam JSP](#12-expression-language-dalam-jsp)
13. [Implicit Objects](#13-implicit-objects)
14. [Scope: Page, Request, Session, Application](#14-scope-page-request-session-application)
15. [JSP Standard Actions](#15-jsp-standard-actions)
16. [Static Include vs Dynamic Include](#16-static-include-vs-dynamic-include)
17. [Forward dan Redirect](#17-forward-dan-redirect)
18. [Error Pages dan Exception Handling](#18-error-pages-dan-exception-handling)
19. [Tag Libraries: Mental Model](#19-tag-libraries-mental-model)
20. [Jakarta Standard Tag Library / Jakarta Tags / JSTL](#20-jakarta-standard-tag-library--jakarta-tags--jstl)
21. [Core Tags: Condition, Loop, URL, Output](#21-core-tags-condition-loop-url-output)
22. [Formatting dan Internationalization Tags](#22-formatting-dan-internationalization-tags)
23. [Functions Tags / EL Functions](#23-functions-tags--el-functions)
24. [SQL dan XML Tags: Kenapa Biasanya Jangan Dipakai di Production](#24-sql-dan-xml-tags-kenapa-biasanya-jangan-dipakai-di-production)
25. [Custom Tags: Classic Tag Handler dan Simple Tag Handler](#25-custom-tags-classic-tag-handler-dan-simple-tag-handler)
26. [Tag Files: Reusable View Fragment tanpa Java Class](#26-tag-files-reusable-view-fragment-tanpa-java-class)
27. [JSP Fragment dan Body Content](#27-jsp-fragment-dan-body-content)
28. [MVC dengan Servlet Controller + JSP View](#28-mvc-dengan-servlet-controller--jsp-view)
29. [DTO/View Model untuk JSP](#29-dtoview-model-untuk-jsp)
30. [Form Handling](#30-form-handling)
31. [Validation dan Error Display](#31-validation-dan-error-display)
32. [Session Management](#32-session-management)
33. [Security: XSS, CSRF, AuthZ, Session, Direct JSP Access](#33-security-xss-csrf-authz-session-direct-jsp-access)
34. [JSP dan Static Resources](#34-jsp-dan-static-resources)
35. [Performance Engineering](#35-performance-engineering)
36. [Modern Relevance: Kapan JSP Masih Masuk Akal?](#36-modern-relevance-kapan-jsp-masih-masuk-akal)
37. [Migration: `javax.servlet.jsp` ke `jakarta.servlet.jsp`](#37-migration-javaxservletjsp-ke-jakartaservletjsp)
38. [Migration dari Scriptlet JSP ke MVC + JSTL/EL](#38-migration-dari-scriptlet-jsp-ke-mvc--jstlel)
39. [Testing Strategy](#39-testing-strategy)
40. [Observability dan Debugging](#40-observability-dan-debugging)
41. [Production Failure Modes](#41-production-failure-modes)
42. [Best Practices dan Anti-Patterns](#42-best-practices-dan-anti-patterns)
43. [Checklist Review](#43-checklist-review)
44. [Case Study 1: Legacy Admin JSP yang Perlu Dimodernisasi](#44-case-study-1-legacy-admin-jsp-yang-perlu-dimodernisasi)
45. [Case Study 2: XSS karena `${userInput}` Tidak Di-escape dengan Benar](#45-case-study-2-xss-karena-userinput-tidak-di-escape-dengan-benar)
46. [Case Study 3: JSP Langsung Query Database](#46-case-study-3-jsp-langsung-query-database)
47. [Case Study 4: Include Salah Pilih dan Performance Turun](#47-case-study-4-include-salah-pilih-dan-performance-turun)
48. [Latihan Bertahap](#48-latihan-bertahap)
49. [Mini Project: Jakarta Pages MVC Lab](#49-mini-project-jakarta-pages-mvc-lab)
50. [Referensi Resmi](#50-referensi-resmi)

---

# 1. Orientasi: Jakarta Pages Itu Apa?

Jakarta Pages adalah teknologi Jakarta EE untuk membuat dynamic web content menggunakan template yang menggabungkan:

- text/HTML/XML;
- Expression Language;
- custom tags;
- tag libraries;
- optional embedded Java code;
- Servlet runtime.

Nama historisnya:

```text
JavaServer Pages / JSP
```

Nama modern dalam Jakarta EE:

```text
Jakarta Pages
```

Package API:

```java
jakarta.servlet.jsp
```

## 1.1 Kenapa JSP masih perlu dipelajari?

Karena banyak sistem enterprise lama masih memakai:

- `.jsp`;
- JSTL;
- JSP custom tag;
- Servlet controller + JSP view;
- Struts/Spring MVC legacy JSP;
- tag files;
- internal admin pages.

Kalau kamu bekerja di enterprise Java, kamu akan menemukan JSP walau project baru mungkin tidak memilihnya.

## 1.2 Jakarta Pages modern positioning

Jakarta EE Tutorial menyatakan Jakarta Pages sebelumnya dikenal sebagai JSP dan telah archived in favor of Facelets.

Artinya, untuk server-side component UI modern di Jakarta EE, Facelets/Jakarta Faces lebih direkomendasikan.

Namun Jakarta Pages tetap ada untuk compatibility dan legacy support.

## 1.3 JSP bukan Faces

JSP adalah template engine.

Faces adalah component-based UI framework dengan lifecycle dan component tree.

JSP lebih dekat ke:

```text
Servlet controller prepares data
JSP renders HTML
```

## 1.4 JSP bukan REST

JSP menghasilkan HTML atau textual output.

REST/Jakarta REST menghasilkan resource representation seperti JSON.

## 1.5 Prinsip utama

```text
JSP should be a view technology, not a place for business logic.
```

Jika JSP berisi SQL, transaction, authorization kompleks, atau Java scriptlet besar, desainnya perlu diperbaiki.

---

# 2. Mental Model: JSP adalah Template yang Dikompilasi Menjadi Servlet

JSP bukan dieksekusi sebagai “HTML dengan magic”.

JSP diterjemahkan menjadi Java Servlet.

## 2.1 Flow high-level

```text
request /users.jsp
  ↓
container checks JSP
  ↓
translate JSP to Java servlet source
  ↓
compile servlet
  ↓
load servlet class
  ↓
execute _jspService(...)
  ↓
write response HTML
```

## 2.2 First request cost

First request ke JSP bisa lambat karena translation/compilation.

Production server bisa precompile JSP.

## 2.3 Generated servlet

JSP:

```jsp
Hello ${user.name}
```

menjadi generated servlet yang menulis output ke response writer dan mengevaluasi EL/tag.

## 2.4 JSP lifecycle depends on Servlet lifecycle

Generated servlet mengikuti lifecycle servlet:

- init;
- service;
- destroy.

## 2.5 Why this mental model matters

Jika kamu menulis scriptlet:

```jsp
<%
int x = 1;
%>
```

kode itu masuk ke generated servlet method.

Jika kamu menulis declaration:

```jsp
<%! int counter = 0; %>
```

itu bisa menjadi field servlet, shared across requests, thread-safety risk.

## 2.6 JSP is multi-threaded

Generated servlet handles multiple requests concurrently.

Do not put mutable shared state in JSP declarations.

---

# 3. Jakarta Pages 4.0 dalam Jakarta EE 11

Jakarta Pages 4.0 adalah release untuk Jakarta EE 11.

Jakarta Pages mendefinisikan template engine untuk web applications yang mendukung mixing textual content seperti HTML/XML dengan custom tags, expression language, dan embedded Java code, lalu dikompilasi menjadi Jakarta Servlet.

## 3.1 Package modern

```java
jakarta.servlet.jsp
```

Tag extension package:

```java
jakarta.servlet.jsp.tagext
```

Old package:

```java
javax.servlet.jsp
javax.servlet.jsp.tagext
```

## 3.2 Jakarta Pages 4.0 scope

JSP 4.0 largely aligns with Jakarta EE 11 and Servlet/EL versions.

## 3.3 Jakarta Pages 4.1

Jakarta Pages 4.1 is under development for Jakarta EE 12.

Target kita di seri ini: Jakarta EE 11 / Jakarta Pages 4.0.

## 3.4 Pages in Web Profile

Jakarta EE 11 Web Profile includes Jakarta Pages 4.0.

## 3.5 Archived in favor of Facelets

Jakarta EE Tutorial indicates Jakarta Pages was archived in favor of Facelets.

Practical meaning:

- do not choose JSP blindly for new component-heavy UI;
- still understand it for maintenance/migration;
- prefer cleaner MVC if using JSP.

---

# 4. JSP vs Servlet vs Faces vs REST vs Template Engine Modern

## 4.1 Servlet

Pure Java HTTP handler.

Good for:

- low-level control;
- filters;
- controllers;
- binary output;
- custom protocol.

Bad for hand-writing lots of HTML.

## 4.2 JSP

HTML-centric template compiled to servlet.

Good for:

- server-rendered HTML;
- MVC view;
- simple dynamic pages;
- legacy compatibility.

Bad if abused with Java scriptlets/business logic.

## 4.3 Faces

Component-based server UI.

Good for:

- form-heavy internal apps;
- stateful component interactions;
- validation lifecycle;
- component libraries.

## 4.4 REST

API-oriented.

Good for:

- JSON clients;
- SPA/mobile;
- service-to-service.

## 4.5 Modern template engines

Examples:

- Thymeleaf;
- FreeMarker;
- Mustache;
- Pebble.

Often used outside full Jakarta EE or with Spring/MVC stacks.

## 4.6 Decision table

| Need | Prefer |
|---|---|
| Low-level HTTP | Servlet |
| Legacy server-rendered view | JSP/Jakarta Pages |
| Component-rich server-side forms | Jakarta Faces |
| JSON API | Jakarta REST |
| Modern server templates | Thymeleaf/FreeMarker/etc |
| SPA/mobile backend | REST/GraphQL |
| Existing JSP app maintenance | Jakarta Pages knowledge |

## 4.7 Top-tier decision

For new Jakarta EE UI, evaluate:

- Faces/Facelets;
- Jakarta MVC if available in runtime ecosystem;
- REST + frontend;
- simple Servlet + template;
- JSP only if it fits legacy/simplicity constraints.

---

# 5. Dependency, Runtime, dan Packaging

## 5.1 API dependency

Typical API coordinate:

```xml
<dependency>
  <groupId>jakarta.servlet.jsp</groupId>
  <artifactId>jakarta.servlet.jsp-api</artifactId>
  <version>4.0.0</version>
  <scope>provided</scope>
</dependency>
```

## 5.2 Runtime implementation

API jar is not enough.

Need a Servlet/JSP container implementation, for example:

- Apache Tomcat 11;
- Jetty with JSP support;
- GlassFish/Payara;
- WildFly/Undertow stack;
- Open Liberty;
- other Jakarta EE runtimes.

## 5.3 WAR packaging

Typical:

```text
app.war
  index.jsp
  WEB-INF/
    web.xml
    views/
      users.jsp
    tags/
      layout.tag
  WEB-INF/lib/
  static/
    app.css
```

## 5.4 Put JSP under `WEB-INF` for MVC

To prevent direct browser access:

```text
/WEB-INF/views/users/list.jsp
```

Servlet forwards to it.

Client cannot request it directly.

## 5.5 Direct JSP under web root

```text
/users.jsp
```

is directly accessible.

This can bypass controller authorization/data preparation.

## 5.6 JSTL/Jakarta Tags dependency

Jakarta Standard Tag Library may need API/implementation dependency depending runtime.

Example concepts:

```xml
<dependency>
  <groupId>jakarta.servlet.jsp.jstl</groupId>
  <artifactId>jakarta.servlet.jsp.jstl-api</artifactId>
  <version>3.0.2</version>
</dependency>
```

Implementation dependency depends runtime.

## 5.7 Avoid bundling conflicting APIs

If runtime provides JSP/JSTL APIs, duplicate/incompatible jars can cause classloading issues.

---

# 6. Peta API dan Package `jakarta.servlet.jsp`

Important packages:

```text
jakarta.servlet.jsp
jakarta.servlet.jsp.tagext
```

## 6.1 `jakarta.servlet.jsp`

Important types:

- `JspPage`;
- `HttpJspPage`;
- `JspContext`;
- `PageContext`;
- `JspWriter`;
- `JspException`;
- `JspFactory`;
- `SkipPageException`.

## 6.2 `jakarta.servlet.jsp.tagext`

Tag extension APIs:

- `Tag`;
- `IterationTag`;
- `BodyTag`;
- `SimpleTag`;
- `SimpleTagSupport`;
- `TagSupport`;
- `BodyTagSupport`;
- `JspFragment`;
- `TagExtraInfo`;
- `TagLibraryValidator`;
- `VariableInfo`.

## 6.3 `JspPage`

Base interface for generated JSP page.

## 6.4 `HttpJspPage`

HTTP-specific JSP page interface.

Generated JSP servlet implements it.

## 6.5 `PageContext`

Provides page-level context and access to request/response/session/application scopes.

## 6.6 `JspWriter`

Writer for JSP output.

## 6.7 Tag APIs

Used to implement reusable custom tags.

---

# 7. JSP Lifecycle: Translation, Compilation, Loading, Execution

## 7.1 Translation

Container translates `.jsp` into Java servlet source.

## 7.2 Compilation

Generated source compiled into class.

## 7.3 Loading

Servlet class loaded.

## 7.4 Initialization

`jspInit()` called.

## 7.5 Request processing

For each request:

```java
_jspService(request, response)
```

is called.

## 7.6 Destruction

`jspDestroy()` called.

## 7.7 Lifecycle diagram

```text
JSP file
  ↓ translation
Java servlet source
  ↓ compilation
Servlet class
  ↓ load/init
_jspService per request
  ↓ destroy on unload
```

## 7.8 First-hit latency

First request may include translation/compile cost.

## 7.9 Precompilation

Production deployments often precompile JSPs to:

- catch errors early;
- reduce first-hit latency;
- avoid runtime compiler dependency.

## 7.10 Redeploy/change

In development, container may detect JSP modification and recompile.

In production, disable frequent checks or use precompiled pages.

---

# 8. JSP Generated Servlet: Apa yang Sebenarnya Terjadi?

## 8.1 Simple JSP

```jsp
<html>
<body>
Hello ${user.name}
</body>
</html>
```

## 8.2 Conceptual generated servlet

```java
public final class hello_jsp extends HttpServlet implements HttpJspPage {
    public void _jspService(HttpServletRequest request, HttpServletResponse response)
            throws IOException, ServletException {
        JspWriter out = ...;
        out.write("<html><body>");
        out.write("Hello ");
        out.write(evaluateEL("${user.name}"));
        out.write("</body></html>");
    }
}
```

## 8.3 Scriptlet placement

```jsp
<% int x = 1; %>
```

becomes local code inside `_jspService`.

## 8.4 Declaration placement

```jsp
<%! int counter = 0; %>
```

becomes field/member in servlet class.

This is shared across requests.

## 8.5 Expression placement

```jsp
<%= user.getName() %>
```

becomes:

```java
out.print(user.getName());
```

## 8.6 Thread safety

Generated servlet is multi-threaded.

Fields are shared.

Do not store request/user data in declarations.

## 8.7 Debugging

If JSP error stack trace references generated Java line, inspect generated servlet output if container exposes it.

---

# 9. Directive: `page`, `include`, `taglib`

Directives affect translation-time behavior.

## 9.1 Page directive

```jsp
<%@ page contentType="text/html; charset=UTF-8" pageEncoding="UTF-8" %>
```

Common attributes:

- `contentType`;
- `pageEncoding`;
- `import`;
- `errorPage`;
- `isErrorPage`;
- `session`;
- `buffer`;
- `autoFlush`;
- `isELIgnored`.

## 9.2 Include directive

Static include at translation time:

```jsp
<%@ include file="/WEB-INF/jspf/header.jspf" %>
```

The included file content becomes part of JSP before compilation.

## 9.3 Taglib directive

Declares tag library:

```jsp
<%@ taglib prefix="c" uri="jakarta.tags.core" %>
```

or old JSTL URIs in legacy systems.

## 9.4 Directive runs at translation time

It configures generated servlet.

## 9.5 Avoid overusing page import

If JSP imports many Java classes, likely too much logic in view.

## 9.6 Encoding

Always set UTF-8.

---

# 10. Scripting Elements: Declaration, Scriptlet, Expression

JSP has scripting elements inherited from early Java web era.

## 10.1 Declaration

```jsp
<%! private int counter = 0; %>
```

Adds class-level member to generated servlet.

Dangerous for mutable state.

## 10.2 Scriptlet

```jsp
<%
String name = request.getParameter("name");
%>
```

Adds Java statements inside `_jspService`.

## 10.3 Expression

```jsp
<%= name %>
```

Prints evaluated Java expression.

## 10.4 Why they exist

Historical convenience before EL/JSTL/tag libraries matured.

## 10.5 Modern rule

Avoid scripting elements in JSP.

Use:

- Servlet/controller for logic;
- model attributes/DTO;
- EL for output;
- JSTL/tags for simple view conditions/loops.

## 10.6 Legacy reality

You will see scriptlets in old code.

Refactor gradually.

---

# 11. Kenapa Scriptlet Harus Dihindari

## 11.1 Mixing concerns

Bad JSP:

```jsp
<%
Connection c = dataSource.getConnection();
PreparedStatement ps = c.prepareStatement("select * from users");
ResultSet rs = ps.executeQuery();
while (rs.next()) {
%>
<tr><td><%= rs.getString("name") %></td></tr>
<%
}
%>
```

Problems:

- DB logic in view;
- resource leaks;
- hard to test;
- hard to secure;
- XSS risk;
- unreadable;
- no separation of concerns.

## 11.2 Thread-safety hazards

Declarations create shared fields.

## 11.3 Poor testability

Cannot easily unit test JSP scriptlet logic.

## 11.4 Security

Manual output often forgets escaping.

## 11.5 Refactor target

Controller:

```java
List<UserRow> users = userService.search(...);
request.setAttribute("users", users);
request.getRequestDispatcher("/WEB-INF/views/users.jsp").forward(request, response);
```

JSP:

```jsp
<c:forEach var="user" items="${users}">
  <tr><td><c:out value="${user.name}" /></td></tr>
</c:forEach>
```

## 11.6 Rule

```text
No Java business logic in JSP.
```

---

# 12. Expression Language dalam JSP

EL allows JSP to access scoped attributes and bean properties.

## 12.1 Basic output

```jsp
${user.name}
```

## 12.2 Scoped access

```jsp
${requestScope.user.name}
${sessionScope.profile.email}
${applicationScope.appName}
```

## 12.3 Param

```jsp
${param.q}
${paramValues.category[0]}
```

## 12.4 Header

```jsp
${header['User-Agent']}
```

## 12.5 Cookie

```jsp
${cookie.sessionId.value}
```

## 12.6 Operators

```jsp
${not empty users}
${user.age ge 18}
${user.active ? 'Active' : 'Inactive'}
```

## 12.7 EL is not automatically escaped

In JSP template text, `${user.name}` output behavior depends context/tag.

Safer:

```jsp
<c:out value="${user.name}" />
```

## 12.8 Avoid complex EL

Bad:

```jsp
${orderService.computeRisk(order) > 10 and user.admin}
```

Better: compute in controller/view model.

---

# 13. Implicit Objects

JSP provides implicit objects.

## 13.1 Classic JSP implicit objects

- `request`;
- `response`;
- `out`;
- `session`;
- `application`;
- `config`;
- `pageContext`;
- `page`;
- `exception` on error page.

## 13.2 EL implicit objects

- `pageContext`;
- `pageScope`;
- `requestScope`;
- `sessionScope`;
- `applicationScope`;
- `param`;
- `paramValues`;
- `header`;
- `headerValues`;
- `cookie`;
- `initParam`.

## 13.3 `pageContext`

Access to multiple contexts.

```jsp
${pageContext.request.contextPath}
```

## 13.4 `requestScope`

Attributes for one request.

## 13.5 `sessionScope`

Attributes for user session.

## 13.6 `applicationScope`

ServletContext attributes shared app-wide.

## 13.7 Scope ambiguity

If you write:

```jsp
${user}
```

resolver searches scopes.

Prefer explicit scope for clarity when ambiguous.

## 13.8 Avoid direct request parameter trust

`param` is untrusted input.

Validate in controller/service.

---

# 14. Scope: Page, Request, Session, Application

## 14.1 Page scope

Exists only during current JSP page execution.

## 14.2 Request scope

Exists during one HTTP request, including forward/include.

Common for MVC model.

## 14.3 Session scope

Exists during user session.

Use sparingly.

## 14.4 Application scope

Shared app-wide.

Must be thread-safe.

## 14.5 MVC recommendation

Controller puts view model in request scope:

```java
request.setAttribute("userList", users);
```

JSP reads:

```jsp
${userList}
```

## 14.6 Session scope caution

Do not store large lists/entities in session.

## 14.7 Application scope caution

Do not store mutable unsynchronized data.

## 14.8 Scope leak

Putting request-specific user data into application scope leaks across users.

---

# 15. JSP Standard Actions

Standard actions are XML-like tags provided by JSP.

## 15.1 `jsp:include`

Dynamic include:

```jsp
<jsp:include page="/WEB-INF/views/header.jsp" />
```

## 15.2 `jsp:forward`

Forward request:

```jsp
<jsp:forward page="/login.jsp" />
```

Rare in modern MVC; controller should decide.

## 15.3 `jsp:param`

Pass parameter to include/forward:

```jsp
<jsp:include page="fragment.jsp">
  <jsp:param name="title" value="Users" />
</jsp:include>
```

## 15.4 JavaBean actions

Historical:

```jsp
<jsp:useBean>
<jsp:setProperty>
<jsp:getProperty>
```

Less common in modern apps; prefer MVC/model attributes.

## 15.5 Modern preference

Use EL/JSTL/custom tags instead of old JavaBean actions.

## 15.6 Dynamic include vs static include

`jsp:include` happens at request time.

`%@ include` happens at translation time.

---

# 16. Static Include vs Dynamic Include

## 16.1 Static include

```jsp
<%@ include file="/WEB-INF/jspf/header.jspf" %>
```

Translation-time include.

The included content is copied into JSP before compilation.

## 16.2 Dynamic include

```jsp
<jsp:include page="/WEB-INF/views/header.jsp" />
```

Request-time include.

The included page executes separately and output inserted.

## 16.3 Static include good for

- common declarations;
- repeated static fragments;
- header/footer if no runtime variation;
- compile-time composition.

## 16.4 Dynamic include good for

- runtime-selected page;
- fragments with request-time logic;
- separate dynamic components.

## 16.5 Performance

Static include avoids runtime dispatch but increases generated servlet size.

Dynamic include adds request dispatch overhead.

## 16.6 Maintenance

Static include can cause duplicate variable conflicts.

Dynamic include has clearer boundary.

## 16.7 Use Facelets/templates for richer templating

If heavy page layout needed, JSP include may become messy.

---

# 17. Forward dan Redirect

## 17.1 Forward

Server-side transfer.

```java
request.getRequestDispatcher("/WEB-INF/views/users.jsp")
    .forward(request, response);
```

Browser URL unchanged.

Request attributes preserved.

## 17.2 Redirect

Client receives 302/303 and makes new request.

```java
response.sendRedirect(request.getContextPath() + "/users");
```

Browser URL changes.

Request attributes lost.

## 17.3 Use forward for view rendering

Controller forwards to JSP.

## 17.4 Use redirect after POST

Post-Redirect-Get:

```text
POST /users
  ↓ save
  ↓ redirect /users
```

Prevents duplicate form submit.

## 17.5 Flash messages

Need mechanism to carry message across redirect:

- session flash;
- query param;
- framework support.

## 17.6 Avoid forward after commit

Cannot forward after response committed.

## 17.7 Security

Do not redirect to unvalidated user-provided URL.

Open redirect risk.

---

# 18. Error Pages dan Exception Handling

## 18.1 JSP errorPage directive

```jsp
<%@ page errorPage="/WEB-INF/views/error.jsp" %>
```

## 18.2 Error page

```jsp
<%@ page isErrorPage="true" %>
Error: ${pageContext.exception.message}
```

Be careful not to expose internal details.

## 18.3 web.xml error-page

```xml
<error-page>
  <error-code>404</error-code>
  <location>/WEB-INF/views/errors/404.jsp</location>
</error-page>

<error-page>
  <exception-type>java.lang.Throwable</exception-type>
  <location>/WEB-INF/views/errors/500.jsp</location>
</error-page>
```

## 18.4 Production error page

Show friendly message.

Log internal exception server-side.

## 18.5 Avoid stack trace in JSP

Do not show:

```jsp
<%= exception.printStackTrace(...) %>
```

## 18.6 Request attributes

Servlet error attributes may be available:

```text
jakarta.servlet.error.status_code
jakarta.servlet.error.exception
jakarta.servlet.error.request_uri
```

## 18.7 Security

Error pages must not leak:

- stack traces;
- SQL;
- internal paths;
- tokens;
- user data.

---

# 19. Tag Libraries: Mental Model

Tag libraries encapsulate reusable view logic.

## 19.1 Why tags?

Instead of scriptlet:

```jsp
<% if (condition) { %>
...
<% } %>
```

use tag:

```jsp
<c:if test="${condition}">
...
</c:if>
```

## 19.2 Tag library consists of

- tag handler class or tag file;
- Tag Library Descriptor / TLD;
- URI;
- prefix in JSP.

## 19.3 Declaration

```jsp
<%@ taglib prefix="c" uri="jakarta.tags.core" %>
```

## 19.4 Tag invocation

```jsp
<c:forEach var="user" items="${users}">
  ${user.name}
</c:forEach>
```

## 19.5 Tags are executed on server

They produce output or control body evaluation.

## 19.6 Good tags

- layout fragments;
- output formatting;
- simple control flow;
- reusable widgets.

## 19.7 Bad tags

- hidden database access;
- business transactions;
- authorization engine;
- complex side effects.

---

# 20. Jakarta Standard Tag Library / Jakarta Tags / JSTL

Jakarta Standard Tag Library represents a set of tags to simplify Jakarta Server Pages development.

It provides tags for common tasks:

- iteration;
- conditionals;
- URL handling;
- output escaping;
- formatting;
- internationalization;
- XML;
- SQL.

## 20.1 Modern naming

Historical:

```text
JSTL / JavaServer Pages Standard Tag Library
```

Modern:

```text
Jakarta Standard Tag Library / Jakarta Tags
```

## 20.2 Jakarta Tags 3.0

Jakarta Standard Tag Library 3.0 was released for Jakarta EE 10.

The specification page shows 3.1 under development for Jakarta EE 12.

There are service releases to work with newer Jakarta EE runtimes.

## 20.3 URI changes

Modern tag URI example:

```jsp
<%@ taglib prefix="c" uri="jakarta.tags.core" %>
```

Older legacy:

```jsp
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>
```

Migration may require URI/dependency update.

## 20.4 Use JSTL instead of scriptlets

Core tags are essential for clean JSP.

## 20.5 JSTL is view logic, not business logic

Keep it simple.

## 20.6 SQL tags warning

JSTL includes SQL tags historically, but production should usually not put SQL in JSP.

---

# 21. Core Tags: Condition, Loop, URL, Output

## 21.1 Declare core taglib

```jsp
<%@ taglib prefix="c" uri="jakarta.tags.core" %>
```

## 21.2 Output escaping

```jsp
<c:out value="${user.name}" />
```

Use for user-controlled text.

## 21.3 If

```jsp
<c:if test="${not empty users}">
  ...
</c:if>
```

## 21.4 Choose/when/otherwise

```jsp
<c:choose>
  <c:when test="${user.admin}">Admin</c:when>
  <c:otherwise>User</c:otherwise>
</c:choose>
```

## 21.5 Loop

```jsp
<c:forEach var="user" items="${users}">
  <tr>
    <td><c:out value="${user.name}" /></td>
  </tr>
</c:forEach>
```

## 21.6 Loop status

```jsp
<c:forEach var="item" items="${items}" varStatus="s">
  ${s.index}
</c:forEach>
```

## 21.7 URL

```jsp
<c:url var="userUrl" value="/users/${user.id}" />
<a href="${userUrl}">View</a>
```

## 21.8 Set/remove

```jsp
<c:set var="title" value="Users" />
<c:remove var="title" />
```

Use sparingly; controller should prepare model.

## 21.9 Import/redirect

Some core tags can fetch/redirect.

Avoid if it hides controller flow.

---

# 22. Formatting dan Internationalization Tags

## 22.1 Declare fmt taglib

```jsp
<%@ taglib prefix="fmt" uri="jakarta.tags.fmt" %>
```

## 22.2 Message bundle

```jsp
<fmt:setBundle basename="messages" />
<fmt:message key="label.user.name" />
```

## 22.3 Format number

```jsp
<fmt:formatNumber value="${order.total}" type="currency" />
```

## 22.4 Format date

```jsp
<fmt:formatDate value="${order.createdAt}" pattern="yyyy-MM-dd" />
```

## 22.5 Locale

```jsp
<fmt:setLocale value="${sessionScope.locale}" />
```

## 22.6 Timezone

Handle timezone explicitly.

## 22.7 Modern Java time

JSP/JSTL date formatting historically works with `java.util.Date`.

For `java.time`, prepare formatted values in view model or use custom functions/tags.

## 22.8 i18n strategy

Controller/service prepares locale.

JSP renders localized labels/messages.

---

# 23. Functions Tags / EL Functions

## 23.1 Declare functions

```jsp
<%@ taglib prefix="fn" uri="jakarta.tags.functions" %>
```

## 23.2 Length

```jsp
${fn:length(users)}
```

## 23.3 Contains

```jsp
${fn:contains(user.name, 'Admin')}
```

## 23.4 Escape XML

Some function libraries provide escaping helpers; prefer `c:out` for output.

## 23.5 String helpers

Functions can do:

- substring;
- trim;
- replace;
- split;
- join;
- case conversion.

## 23.6 Keep functions pure

No DB, no side effect.

## 23.7 Complex formatting

Move complex formatting to view model or custom tag/function.

---

# 24. SQL dan XML Tags: Kenapa Biasanya Jangan Dipakai di Production

JSTL historically includes SQL/XML tags.

## 24.1 SQL tag example

```jsp
<sql:query var="users" dataSource="${ds}">
  SELECT * FROM users
</sql:query>
```

## 24.2 Why dangerous?

- SQL in view;
- poor separation of concerns;
- hard to test;
- transaction unclear;
- security risk;
- connection/resource management hidden;
- no domain logic layer.

## 24.3 Production rule

Do not query database from JSP.

Use:

```text
Servlet/controller → service/repository → DTO → JSP
```

## 24.4 XML tags

XML tags can be useful in legacy integration, but often better handled in backend code.

## 24.5 XSLT/XML security

XML processing has security risks:

- XXE;
- entity expansion;
- untrusted XML.

Handle in service layer with secure parser config.

## 24.6 Historical context

SQL/XML tags were useful in demos/small apps.

Not recommended for serious enterprise architecture.

---

# 25. Custom Tags: Classic Tag Handler dan Simple Tag Handler

Custom tags encapsulate reusable view behavior.

## 25.1 Classic tag handler

Implements interfaces like:

```java
Tag
IterationTag
BodyTag
```

or extends support classes.

## 25.2 Simple tag handler

Implements:

```java
SimpleTag
```

or extends:

```java
SimpleTagSupport
```

Usually simpler.

## 25.3 Example simple tag

```java
public class AlertTag extends SimpleTagSupport {
    private String type;

    public void setType(String type) {
        this.type = type;
    }

    @Override
    public void doTag() throws JspException, IOException {
        JspWriter out = getJspContext().getOut();
        out.write("<div class=\"alert alert-" + escape(type) + "\">");
        getJspBody().invoke(null);
        out.write("</div>");
    }
}
```

## 25.4 TLD

Tag library descriptor maps tag name to handler class.

## 25.5 Use cases

- reusable UI widgets;
- formatting;
- authorization-aware display;
- layout helpers;
- field rendering.

## 25.6 Avoid business logic

Custom tags should not perform use-case actions.

## 25.7 Thread safety

Tag handler lifecycle can vary. Do not assume shared mutable state is safe.

## 25.8 Escaping

If tag writes HTML, escape untrusted input.

---

# 26. Tag Files: Reusable View Fragment tanpa Java Class

Tag files allow custom tags written as JSP fragments.

## 26.1 Location

```text
/WEB-INF/tags/alert.tag
```

## 26.2 Example

`alert.tag`:

```jsp
<%@ tag body-content="scriptless" %>
<%@ attribute name="type" required="true" %>

<div class="alert alert-${type}">
  <jsp:doBody />
</div>
```

Use:

```jsp
<%@ taglib prefix="app" tagdir="/WEB-INF/tags" %>

<app:alert type="info">
  Saved successfully.
</app:alert>
```

## 26.3 Benefits

- no Java class;
- reusable view fragment;
- easier for view logic.

## 26.4 Scriptless body

Prefer scriptless tag files.

## 26.5 Attribute validation

Declare required attributes.

## 26.6 Keep simple

If tag file becomes complex, consider component/template architecture.

---

# 27. JSP Fragment dan Body Content

## 27.1 Body content

A tag can process its body.

Example:

```jsp
<app:panel title="Users">
  body content here
</app:panel>
```

## 27.2 `jsp:doBody`

In tag file:

```jsp
<jsp:doBody />
```

## 27.3 `JspFragment`

In simple tag handler:

```java
JspFragment body = getJspBody();
body.invoke(writer);
```

## 27.4 Use cases

- wrapping layout;
- conditional output;
- repeat body;
- decorate body content.

## 27.5 Avoid evaluating body multiple times accidentally

If tag invokes body repeatedly, side effects/output duplicate.

## 27.6 Body content and escaping

Body may contain HTML.

Know whether it is trusted.

---

# 28. MVC dengan Servlet Controller + JSP View

## 28.1 Recommended JSP architecture

```text
HTTP request
  ↓
Servlet/controller
  ↓
service/use case
  ↓
DTO/view model
  ↓
request attributes
  ↓
forward to JSP
  ↓
JSP renders
```

## 28.2 Example controller

```java
@WebServlet("/users")
public class UserListServlet extends HttpServlet {

    @Inject
    UserQueryService userQueryService;

    @Override
    protected void doGet(HttpServletRequest request, HttpServletResponse response)
            throws ServletException, IOException {

        List<UserRow> users = userQueryService.findUsers();
        request.setAttribute("users", users);

        request.getRequestDispatcher("/WEB-INF/views/users/list.jsp")
            .forward(request, response);
    }
}
```

## 28.3 JSP view

```jsp
<%@ taglib prefix="c" uri="jakarta.tags.core" %>

<table>
<c:forEach var="user" items="${users}">
  <tr>
    <td><c:out value="${user.name}" /></td>
  </tr>
</c:forEach>
</table>
```

## 28.4 Controller responsibilities

- authenticate/authorize or delegate;
- parse request;
- validate input;
- call service;
- prepare view model;
- choose view/redirect.

## 28.5 JSP responsibilities

- display data;
- simple conditional/loop;
- escape output;
- render form fields/errors.

## 28.6 Service responsibilities

- business logic;
- transaction;
- authorization/domain policy;
- repository access.

## 28.7 Do not let JSP call service

Keep dependency direction clean.

---

# 29. DTO/View Model untuk JSP

## 29.1 Why view model?

Avoid exposing domain entities directly to view.

## 29.2 Example

```java
public record UserRow(
    UUID id,
    String name,
    String email,
    String statusLabel,
    boolean canEdit
) {}
```

## 29.3 Benefits

- no lazy loading in JSP;
- no entity mutation;
- no accidental sensitive fields;
- easier formatting;
- better testability.

## 29.4 Avoid JPA entity in JSP

Bad:

```jsp
${user.passwordHash}
${user.orders.size()}
```

Could leak data or trigger lazy loading.

## 29.5 Precompute authorization display flags

JSP:

```jsp
<c:if test="${user.canEdit}">
  ...
</c:if>
```

But action still must enforce server-side authorization.

## 29.6 Preformat dates?

For simple formatting use fmt tags.

For complex timezone/business formatting, use view model.

## 29.7 Immutable DTO

Prefer records/immutable classes.

---

# 30. Form Handling

## 30.1 GET form

```jsp
<form method="get" action="${pageContext.request.contextPath}/users">
  <input name="q" value="${param.q}" />
</form>
```

## 30.2 POST form

```jsp
<form method="post" action="${pageContext.request.contextPath}/users/create">
  <input name="name" value="${form.name}" />
  <button type="submit">Save</button>
</form>
```

## 30.3 Controller parse

```java
String name = request.getParameter("name");
```

Validate and map to command.

## 30.4 On validation error

Controller:

```java
request.setAttribute("form", form);
request.setAttribute("errors", errors);
forward back to JSP;
```

## 30.5 On success

Use redirect:

```java
response.sendRedirect(contextPath + "/users");
```

## 30.6 CSRF token

Include hidden CSRF token for state-changing forms.

## 30.7 Encoding

Set request encoding UTF-8.

## 30.8 File upload

Use Servlet multipart support, not scriptlet.

---

# 31. Validation dan Error Display

## 31.1 Validate in controller/service

JSP should display errors.

## 31.2 Error model

```java
public record FieldError(String field, String message) {}
```

or map:

```java
Map<String, String> errors;
```

## 31.3 JSP display

```jsp
<c:if test="${not empty errors.name}">
  <span class="error"><c:out value="${errors.name}" /></span>
</c:if>
```

## 31.4 Global errors

```jsp
<c:forEach var="error" items="${globalErrors}">
  <div class="error"><c:out value="${error}" /></div>
</c:forEach>
```

## 31.5 Jakarta Validation

Use Bean Validation on command DTO:

```java
public record CreateUserCommand(
    @NotBlank String name,
    @Email String email
) {}
```

## 31.6 Preserve submitted values

On validation failure, forward back with form object.

## 31.7 Avoid validating only in JavaScript

Client validation is UX enhancement only.

---

# 32. Session Management

## 32.1 Session use cases

- authenticated user identity reference;
- flash messages;
- CSRF token;
- small preferences.

## 32.2 Avoid storing

- large lists;
- JPA entities;
- open resources;
- huge forms;
- sensitive secrets.

## 32.3 Session fixation

After login, rotate session ID.

## 32.4 Session timeout

Handle expired session gracefully.

## 32.5 Flash messages

Use session briefly:

```text
put flash message
redirect
display and remove
```

## 32.6 Cluster

Session replication/sticky sessions matter.

Keep session small.

## 32.7 Logout

Invalidate session and clear security context/cookies as appropriate.

---

# 33. Security: XSS, CSRF, AuthZ, Session, Direct JSP Access

## 33.1 XSS

JSP output must be escaped.

Bad:

```jsp
${userInput}
```

if rendered raw in HTML without escaping.

Safer:

```jsp
<c:out value="${userInput}" />
```

## 33.2 Context-sensitive escaping

HTML text escaping differs from JavaScript/URL/CSS attribute contexts.

Do not blindly insert untrusted value into script:

```jsp
<script>
  const name = "${user.name}";
</script>
```

Use JSON encoder.

## 33.3 CSRF

State-changing POST forms need CSRF token.

## 33.4 Authorization

Do not rely on hiding buttons.

Controller/action must check authorization.

## 33.5 Direct JSP access

Place JSP under `/WEB-INF/views`.

Only controller forwards.

## 33.6 Session

Use secure cookies:

- HttpOnly;
- Secure;
- SameSite.

## 33.7 Error pages

No stack traces.

## 33.8 Open redirect

Validate redirect targets.

## 33.9 Sensitive data

Do not put secrets in hidden fields.

Hidden fields are client-controlled.

## 33.10 Clickjacking

Set frame protection headers.

---

# 34. JSP dan Static Resources

## 34.1 Static resource path

```text
/static/css/app.css
/static/js/app.js
```

## 34.2 Context path

Use:

```jsp
${pageContext.request.contextPath}
```

or `c:url`:

```jsp
<link rel="stylesheet" href="<c:url value='/static/css/app.css' />" />
```

## 34.3 Cache

Serve static resources with cache headers.

## 34.4 Fingerprinting

Use versioned filenames:

```text
app.abc123.css
```

## 34.5 Do not serve through JSP

CSS/JS/images should be static, not JSP unless necessary.

## 34.6 CSP

Use Content Security Policy.

Avoid inline scripts if possible.

## 34.7 Asset pipeline

For modern frontend assets, build separately and reference compiled static assets.

---

# 35. Performance Engineering

## 35.1 Main costs

- JSP translation/compilation;
- tag execution;
- EL evaluation;
- includes;
- controller DB/service calls;
- output buffering;
- session replication;
- large response.

## 35.2 Precompile JSP

Avoid first-request latency.

## 35.3 Avoid DB in JSP

Move data access to service/controller.

## 35.4 Avoid excessive includes

Many dynamic includes can add dispatch overhead.

## 35.5 Keep EL simple

Complex method calls in EL can be repeated.

## 35.6 Cache static fragments?

Use HTTP caching/CDN for static assets.

## 35.7 Compression

Enable gzip/brotli at server/proxy for text responses.

## 35.8 Pagination

Do not render thousands of rows.

## 35.9 Buffering

JSP buffer settings affect response commit.

## 35.10 Monitor

Track:

- response time by view;
- error rate;
- JSP compilation time;
- generated servlet errors;
- session size;
- response size.

---

# 36. Modern Relevance: Kapan JSP Masih Masuk Akal?

## 36.1 Reasonable

JSP can still be reasonable for:

- existing legacy apps;
- simple server-rendered pages;
- Servlet MVC app;
- internal admin pages;
- teams familiar with JSP/JSTL;
- low frontend complexity.

## 36.2 Less ideal

Less ideal for:

- modern component-rich UI;
- public high-scale frontend;
- SPA/mobile architecture;
- strong separation of frontend/backend teams;
- apps needing sophisticated client-side state.

## 36.3 If starting new Jakarta EE UI

Consider:

- Faces/Facelets;
- REST + frontend;
- template engine;
- Jakarta MVC ecosystem;
- JSP only for simple view compatibility.

## 36.4 Maintenance strategy

For existing JSP app:

- remove scriptlets;
- move logic to controllers/services;
- add JSTL/EL;
- put views under WEB-INF;
- add tests;
- migrate `javax` to `jakarta`;
- improve security.

## 36.5 Do not rewrite blindly

A stable JSP internal app may only need modernization, not total rewrite.

---

# 37. Migration: `javax.servlet.jsp` ke `jakarta.servlet.jsp`

## 37.1 Package migration

Old:

```java
javax.servlet.jsp.*
javax.servlet.jsp.tagext.*
```

New:

```java
jakarta.servlet.jsp.*
jakarta.servlet.jsp.tagext.*
```

## 37.2 JSTL/taglib migration

Old URIs:

```jsp
http://java.sun.com/jsp/jstl/core
```

Modern Jakarta Tags URI:

```jsp
jakarta.tags.core
```

## 37.3 Dependencies

Update:

- JSP API;
- JSTL/Jakarta Tags API;
- JSTL implementation;
- Servlet API;
- EL API.

## 37.4 Server runtime

Need Jakarta EE 10/11 compatible server.

Old Java EE app cannot just run on Jakarta runtime without namespace changes.

## 37.5 Tag libraries

Custom tags compiled against `javax.servlet.jsp.tagext` must be recompiled/migrated.

## 37.6 TLD

Update TLD schema/handler class names if needed.

## 37.7 Web.xml

Update schemas and Servlet package references.

## 37.8 Automated migration

Tools can rewrite imports/namespaces, but manual testing required.

## 37.9 Test focus

- tag rendering;
- EL resolution;
- JSTL URIs;
- custom tags;
- error pages;
- includes;
- form submissions.

---

# 38. Migration dari Scriptlet JSP ke MVC + JSTL/EL

## 38.1 Step 1 — Identify scriptlets

Search:

```text
<%
<%!
<%=
```

## 38.2 Step 2 — Classify logic

- data access;
- business logic;
- formatting;
- simple condition;
- loop;
- security check;
- output.

## 38.3 Step 3 — Move data access/business logic

Move to:

```text
Servlet/controller → service → repository
```

## 38.4 Step 4 — Create view model

```java
record UserPage(List<UserRow> users, String search, Map<String, String> errors) {}
```

## 38.5 Step 5 — Replace scriptlet loops

Scriptlet:

```jsp
<% for (User u : users) { %>
```

JSTL:

```jsp
<c:forEach var="user" items="${users}">
```

## 38.6 Step 6 — Replace output expression

Scriptlet:

```jsp
<%= user.getName() %>
```

Safer:

```jsp
<c:out value="${user.name}" />
```

## 38.7 Step 7 — Move auth check

View can hide button, but controller/service must enforce.

## 38.8 Step 8 — Add tests

Regression test rendered pages.

## 38.9 Step 9 — Incremental refactor

Do not rewrite all at once unless necessary.

---

# 39. Testing Strategy

## 39.1 Unit test controllers

Controller/service prepares model attributes.

## 39.2 Unit test services

Business logic outside JSP.

## 39.3 Integration test JSP rendering

Use server integration test.

Verify:

- page renders;
- model displayed;
- escaping;
- loops;
- conditions;
- forms.

## 39.4 Browser tests

Use Playwright/Selenium for flows.

## 39.5 Security tests

- XSS payload display;
- CSRF token required;
- unauthorized URL access;
- direct JSP access blocked;
- open redirect.

## 39.6 Migration tests

For legacy migration:

- compare old/new outputs;
- custom tags;
- JSTL URIs;
- includes;
- errors.

## 39.7 Performance tests

Test large lists and high concurrency.

## 39.8 Error page tests

Trigger 404/500 and verify safe error pages.

## 39.9 Snapshot tests

Can be useful for stable HTML fragments, but avoid brittle tests on formatting.

---

# 40. Observability dan Debugging

## 40.1 JSP compilation errors

Errors may occur at:

- translation time;
- compilation time;
- runtime.

## 40.2 Generated source

Containers often store generated servlet source in work/temp directory.

Inspect when debugging line numbers.

## 40.3 Logs

Log controller route/view name, not full response.

## 40.4 Metrics

Track:

- request count by page/controller;
- render time;
- error count;
- JSP compile count;
- session size;
- response size.

## 40.5 Correlation ID

Add correlation ID in request/logs.

## 40.6 Development settings

Development mode may recompile JSP frequently.

Production should be stable/precompiled.

## 40.7 Tag debugging

Custom tag errors may wrap exceptions in `JspException`.

Unwrap root cause.

## 40.8 EL debugging

Use simpler expressions and explicit scopes.

---

# 41. Production Failure Modes

## 41.1 First request slow

Cause:

- JSP translation/compilation on first hit.

Fix:

- precompile/warmup.

## 41.2 XSS

Cause:

- unescaped `${userInput}` or scriptlet output.

Fix:

- `c:out`, context-aware escaping.

## 41.3 Direct JSP access bypasses controller

Cause:

- JSP under web root.

Fix:

- put under `/WEB-INF/views`.

## 41.4 Session memory high

Cause:

- storing large model in session.

Fix:

- request scope/pagination.

## 41.5 DB connection leak

Cause:

- SQL in JSP/scriptlet.

Fix:

- move to service/repository with proper resource management.

## 41.6 Custom tag thread-safety bug

Cause:

- mutable shared state.

Fix:

- avoid shared mutable fields; understand tag lifecycle.

## 41.7 Wrong JSTL URI

Cause:

- migration to Jakarta Tags but old URI/dependency.

Fix:

- update URI/dependency/server.

## 41.8 EL property not found

Cause:

- typo, wrong scope, missing getter, model not set.

Fix:

- explicit scope/model tests.

## 41.9 Response committed before forward

Cause:

- output written before forward/error handling.

Fix:

- controller decides before writing; buffer appropriately.

## 41.10 Open redirect

Cause:

- redirect URL from request parameter.

Fix:

- allowlist internal paths.

## 41.11 JSP compile failure in production

Cause:

- not precompiled/tested; runtime lacks compiler/dependency.

Fix:

- precompile CI.

---

# 42. Best Practices dan Anti-Patterns

## 42.1 Best practices

- Use JSP as view only.
- Put JSP under `/WEB-INF/views`.
- Use Servlet/controller for request handling.
- Use service layer for business logic.
- Use DTO/view model.
- Use JSTL/EL, not scriptlets.
- Escape user output with `c:out`.
- Use PRG after POST.
- Validate inputs server-side.
- Use CSRF tokens.
- Keep session small.
- Precompile JSP in production.
- Test custom tags.
- Migrate `javax` to `jakarta` carefully.

## 42.2 Anti-pattern: SQL in JSP

JSP must not access DB.

## 42.3 Anti-pattern: Scriptlet-heavy JSP

Move logic to controller/service.

## 42.4 Anti-pattern: Direct access to JSP view

Use `/WEB-INF`.

## 42.5 Anti-pattern: Hidden field as trusted data

Hidden fields are user-controlled.

## 42.6 Anti-pattern: Business authorization only in JSP

Must enforce in controller/service.

## 42.7 Anti-pattern: Application scope for per-user data

Leaks across users.

## 42.8 Anti-pattern: Swallowing JSP exceptions

Log root cause and show safe error page.

---

# 43. Checklist Review

## 43.1 Architecture

- [ ] JSP is view only?
- [ ] Controller prepares model?
- [ ] Service handles business logic?
- [ ] JSP under `/WEB-INF/views`?
- [ ] DTO/view model used?
- [ ] No SQL in JSP?
- [ ] No scriptlets?

## 43.2 Security

- [ ] User output escaped?
- [ ] CSRF token used for POST?
- [ ] Authorization enforced server-side?
- [ ] Direct JSP access blocked?
- [ ] Error pages safe?
- [ ] Redirect targets validated?
- [ ] Session cookies secure?

## 43.3 Migration

- [ ] `javax` imports replaced?
- [ ] JSP/JSTL dependencies updated?
- [ ] Taglib URIs updated?
- [ ] Custom tags recompiled?
- [ ] TLD updated?
- [ ] Runtime supports Pages 4.0?

## 43.4 Performance

- [ ] JSP precompiled/warmed?
- [ ] Large lists paginated?
- [ ] Session small?
- [ ] Static resources cached?
- [ ] Dynamic includes reasonable?

## 43.5 Testing

- [ ] Render tests?
- [ ] Form flow tests?
- [ ] XSS tests?
- [ ] CSRF tests?
- [ ] Error page tests?
- [ ] Custom tag tests?

---

# 44. Case Study 1: Legacy Admin JSP yang Perlu Dimodernisasi

## 44.1 Initial state

`adminUsers.jsp` contains:

- SQL query;
- scriptlet loops;
- role check scriptlet;
- raw `<%= userInput %>`;
- no CSRF;
- directly accessible URL.

## 44.2 Refactor target

```text
GET /admin/users
  ↓ AdminUserServlet
  ↓ UserAdminService
  ↓ UserPage DTO
  ↓ /WEB-INF/views/admin/users.jsp
```

## 44.3 JSP after refactor

```jsp
<c:forEach var="user" items="${page.users}">
  <td><c:out value="${user.name}" /></td>
</c:forEach>
```

## 44.4 Security

- controller checks admin;
- POST actions check admin;
- CSRF token;
- output escaped.

## 44.5 Benefits

- testable service;
- safer output;
- no direct view bypass;
- cleaner migration.

---

# 45. Case Study 2: XSS karena `${userInput}` Tidak Di-escape dengan Benar

## 45.1 Problem

User name:

```html
<script>alert(1)</script>
```

JSP renders:

```jsp
${user.name}
```

If output context does not escape correctly, XSS.

## 45.2 Fix

Use:

```jsp
<c:out value="${user.name}" />
```

## 45.3 JavaScript context

If inserting into JS:

```jsp
<script>
const name = "${user.name}";
</script>
```

`c:out` is not enough for JS string context.

Use JSON encoder.

## 45.4 Lesson

Escaping is context-sensitive.

---

# 46. Case Study 3: JSP Langsung Query Database

## 46.1 Bad

```jsp
<%
ResultSet rs = statement.executeQuery("select * from users");
%>
```

## 46.2 Problems

- resource leak;
- SQL injection risk;
- no transaction boundary;
- no service abstraction;
- hard to test;
- view knows schema.

## 46.3 Fix

Move query to repository/service.

Controller sets:

```java
request.setAttribute("users", users);
```

JSP renders.

## 46.4 Lesson

JSP should not own data access.

---

# 47. Case Study 4: Include Salah Pilih dan Performance Turun

## 47.1 Problem

Page has 30 dynamic includes:

```jsp
<jsp:include page="/fragment.jsp" />
```

Each include dispatches dynamically.

## 47.2 Symptoms

High render time.

## 47.3 Analyze

Some fragments are static layout.

## 47.4 Fix

Use static include/tag file/template approach for static fragments.

Use dynamic include only where runtime dispatch needed.

## 47.5 Lesson

Include choice affects generated servlet structure and runtime dispatch cost.

---

# 48. Latihan Bertahap

## Latihan 1 — Basic JSP

Create JSP with UTF-8 and EL output.

## Latihan 2 — Servlet controller + JSP view

Forward to `/WEB-INF/views/hello.jsp`.

## Latihan 3 — JSTL loop

Render list of DTOs with `c:forEach`.

## Latihan 4 — Escaping

Render XSS payload with and without `c:out`.

Observe difference.

## Latihan 5 — Form POST + PRG

Implement create form with validation and redirect.

## Latihan 6 — Static vs dynamic include

Create both and inspect behavior.

## Latihan 7 — Custom tag file

Create `/WEB-INF/tags/alert.tag`.

## Latihan 8 — Error page

Configure 404/500 JSP error pages.

## Latihan 9 — Migration

Convert a small `javax.servlet.jsp.tagext` custom tag to `jakarta.servlet.jsp.tagext`.

## Latihan 10 — Precompile or inspect generated servlet

Find generated JSP servlet in container work directory.

---

# 49. Mini Project: Jakarta Pages MVC Lab

## 49.1 Goal

Create:

```text
jakarta-pages-mvc-lab/
```

## 49.2 Modules/pages

```text
servlet-controller/
jsp-view/
jstl-core/
form-validation/
prg/
custom-tag-file/
custom-tag-handler/
error-pages/
security/
migration-javax-to-jakarta/
```

## 49.3 Deliverables

```text
README.md
JSP-MENTAL-MODEL.md
TRANSLATION-TO-SERVLET.md
MVC-WITH-JSP.md
JSTL-TAGS.md
CUSTOM-TAGS.md
SECURITY.md
MIGRATION.md
PERFORMANCE.md
FAILURE-MODES.md
```

## 49.4 Required experiments

1. Show JSP translated to servlet.
2. Render DTO list with JSTL.
3. Implement safe output escaping.
4. Implement form validation.
5. Implement PRG.
6. Protect JSP under WEB-INF.
7. Create tag file.
8. Create simple tag handler.
9. Configure safe error page.
10. Run XSS/CSRF/security tests.

## 49.5 Evaluation questions

1. Why is JSP compiled to Servlet?
2. What is `_jspService`?
3. Why are declarations thread-safety risk?
4. Why avoid scriptlets?
5. Difference static include vs dynamic include?
6. Why put JSP under WEB-INF?
7. What does `c:out` solve?
8. Why should SQL not be in JSP?
9. How migrate `javax.servlet.jsp` to `jakarta.servlet.jsp`?
10. When is JSP still reasonable today?

---

# 50. Referensi Resmi

Referensi utama:

1. Jakarta Pages 4.0  
   https://jakarta.ee/specifications/pages/4.0/

2. Jakarta Server Pages 4.0 Specification  
   https://jakarta.ee/specifications/pages/4.0/jakarta-server-pages-spec-4.0

3. Jakarta Pages Specifications Overview  
   https://jakarta.ee/specifications/pages/

4. Jakarta EE Tutorial — Jakarta Pages  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/web/jakarta-pages/jakarta-pages.html

5. Jakarta Servlet, Jakarta Faces and Jakarta Server Pages Explained  
   https://jakarta.ee/learn/specification-guides/servlet-faces-and-server-pages-explained/

6. Jakarta Standard Tag Library  
   https://jakarta.ee/specifications/tags/

7. Jakarta Standard Tag Library 3.0  
   https://jakarta.ee/specifications/tags/3.0/

8. Jakarta Tags Core Tag Docs  
   https://jakarta.ee/specifications/tags/3.0/tagdocs/c/tld-summary

9. Jakarta Expression Language 6.0  
   https://jakarta.ee/specifications/expression-language/6.0/

10. Jakarta Servlet 6.1  
    https://jakarta.ee/specifications/servlet/6.1/

---

# Penutup

Jakarta Pages / JSP adalah template engine server-side yang dikompilasi menjadi Servlet.

Mental model ringkas:

```text
JSP source
  ↓ translation
generated servlet source
  ↓ compilation
servlet class
  ↓ _jspService per request
HTML response
```

Prinsip paling penting:

```text
JSP is a view technology.
Do not turn it into controller, service, repository, and security policy all at once.
```

Gunakan JSP dengan bersih:

```text
Servlet/controller prepares model
service handles business logic
JSP renders with EL/JSTL
output is escaped
POST uses CSRF and PRG
views live under WEB-INF
```

Engineer top-tier tidak hanya tahu tag JSP. Ia tahu JSP dikompilasi menjadi Servlet, kenapa declaration menjadi shared field, kenapa scriptlet berbahaya, kenapa direct JSP access bisa bypass controller, kenapa output escaping context-sensitive, dan bagaimana memodernisasi JSP legacy tanpa rewrite brutal.

Bagian berikutnya akan membahas **Jakarta Standard Tag Library / Jakarta Tags** lebih dalam: core/fmt/functions/xml/sql tags, tag library mechanics, TLD, tag files, custom tags, tag pooling, tag lifecycle, security, and migration from old JSTL URIs to Jakarta Tags.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Bagian 27 — Jakarta Expression Language (`jakarta.el`): Expression Evaluation, Resolver Chain, Coercion, Method Expression, dan Security](./learn-java-jakarta-part-027.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: Bagian 29 — Jakarta Standard Tag Library / Jakarta Tags: Core, Formatting, Functions, XML, SQL, Custom Tags, dan Migration](./learn-java-jakarta-part-029.md)
