# learn-java-jakarta-part-029.md

# Bagian 29 — Jakarta Standard Tag Library / Jakarta Tags: Core, Formatting, Functions, XML, SQL, Custom Tags, dan Migration

> Target pembaca: Java engineer yang ingin memahami Jakarta Standard Tag Library / Jakarta Tags / JSTL bukan hanya sebagai kumpulan tag `<c:forEach>`, tetapi sebagai **view-control vocabulary** untuk Jakarta Pages/JSP: conditional rendering, iteration, safe output, URL handling, formatting, i18n, functions, XML/SQL legacy tags, tag library mechanics, TLD, custom tags, tag files, lifecycle, security, migration, dan production pitfalls.
>
> Fokus bagian ini: Jakarta Tags 3.0/3.0.x dalam Jakarta EE 11, taglib URI modern `jakarta.tags.*`, core/fmt/functions/xml/sql libraries, `c:out`, `c:if`, `c:choose`, `c:forEach`, `c:url`, `fmt:message`, `fmt:formatDate`, `fn:*`, tag files, custom tag handlers, tag lifecycle, tag pooling, escaping, SQL tag anti-pattern, migration dari old JSTL URIs, and debugging `Unable to find taglib`.

---

## Daftar Isi

1. [Orientasi: Kenapa Jakarta Tags Penting?](#1-orientasi-kenapa-jakarta-tags-penting)
2. [Mental Model: Tag Library sebagai View-Level Abstraction](#2-mental-model-tag-library-sebagai-view-level-abstraction)
3. [Jakarta Standard Tag Library 3.0 dalam Jakarta EE 11](#3-jakarta-standard-tag-library-30-dalam-jakarta-ee-11)
4. [Jakarta Tags vs JSP Scriptlet vs EL vs Custom Tag](#4-jakarta-tags-vs-jsp-scriptlet-vs-el-vs-custom-tag)
5. [Dependency, Runtime, dan URI Modern](#5-dependency-runtime-dan-uri-modern)
6. [Peta Tag Libraries](#6-peta-tag-libraries)
7. [Core Library `c`](#7-core-library-c)
8. [`c:out`: Safe Output dan Escaping](#8-cout-safe-output-dan-escaping)
9. [`c:set` dan `c:remove`: Variable Management](#9-cset-dan-cremove-variable-management)
10. [`c:if`: Conditional Rendering](#10-cif-conditional-rendering)
11. [`c:choose`, `c:when`, `c:otherwise`](#11-cchoose-cwhen-cotherwise)
12. [`c:forEach`: Iteration](#12-cforeach-iteration)
13. [`c:forTokens`: Token Iteration](#13-cfortokens-token-iteration)
14. [`c:url`, `c:param`: URL Construction](#14-curl-cparam-url-construction)
15. [`c:redirect`: Redirect dari View? Hati-Hati](#15-credirect-redirect-dari-view-hati-hati)
16. [`c:import`: Import Resource? Hati-Hati](#16-cimport-import-resource-hati-hati)
17. [`c:catch`: Error Handling di View](#17-ccatch-error-handling-di-view)
18. [Formatting Library `fmt`](#18-formatting-library-fmt)
19. [`fmt:setLocale`, `fmt:setBundle`, `fmt:bundle`](#19-fmtsetlocale-fmtsetbundle-fmtbundle)
20. [`fmt:message`: Internationalized Messages](#20-fmtmessage-internationalized-messages)
21. [`fmt:formatNumber` dan `fmt:parseNumber`](#21-fmtformatnumber-dan-fmtparsenumber)
22. [`fmt:formatDate` dan `fmt:parseDate`](#22-fmtformatdate-dan-fmtparsedate)
23. [`fmt:timeZone` dan `fmt:setTimeZone`](#23-fmttimezone-dan-fmtsettimezone)
24. [Functions Library `fn`](#24-functions-library-fn)
25. [XML Library `x`](#25-xml-library-x)
26. [SQL Library `sql`: Kenapa Hampir Selalu Anti-Pattern](#26-sql-library-sql-kenapa-hampir-selalu-anti-pattern)
27. [Tag Library Descriptor / TLD](#27-tag-library-descriptor--tld)
28. [Tag Lifecycle dan Body Evaluation](#28-tag-lifecycle-dan-body-evaluation)
29. [Classic Tag Handler vs Simple Tag Handler](#29-classic-tag-handler-vs-simple-tag-handler)
30. [Tag Files: Custom Tag Tanpa Java Class](#30-tag-files-custom-tag-tanpa-java-class)
31. [JSP Fragment dan Dynamic Attributes](#31-jsp-fragment-dan-dynamic-attributes)
32. [TagExtraInfo dan TagLibraryValidator](#32-tagextrainfo-dan-taglibraryvalidator)
33. [Tag Pooling dan Thread Safety](#33-tag-pooling-dan-thread-safety)
34. [Custom Function Library](#34-custom-function-library)
35. [MVC Pattern dengan Jakarta Tags](#35-mvc-pattern-dengan-jakarta-tags)
36. [Security: XSS, URL, CSRF, AuthZ, Tag Injection](#36-security-xss-url-csrf-authz-tag-injection)
37. [Performance Engineering](#37-performance-engineering)
38. [Migration dari JSTL Lama ke Jakarta Tags](#38-migration-dari-jstl-lama-ke-jakarta-tags)
39. [Debugging: `Unable to find taglib`](#39-debugging-unable-to-find-taglib)
40. [Testing Strategy](#40-testing-strategy)
41. [Production Failure Modes](#41-production-failure-modes)
42. [Best Practices dan Anti-Patterns](#42-best-practices-dan-anti-patterns)
43. [Checklist Review](#43-checklist-review)
44. [Case Study 1: Menghapus Scriptlet dengan JSTL Core](#44-case-study-1-menghapus-scriptlet-dengan-jstl-core)
45. [Case Study 2: XSS karena Output Tidak Lewat `c:out`](#45-case-study-2-xss-karena-output-tidak-lewat-cout)
46. [Case Study 3: SQL Tags di JSP Membuat Architecture Bocor](#46-case-study-3-sql-tags-di-jsp-membuat-architecture-bocor)
47. [Case Study 4: Migrasi URI Lama ke `jakarta.tags.*`](#47-case-study-4-migrasi-uri-lama-ke-jakartatags)
48. [Latihan Bertahap](#48-latihan-bertahap)
49. [Mini Project: Jakarta Tags Modern JSP Lab](#49-mini-project-jakarta-tags-modern-jsp-lab)
50. [Referensi Resmi](#50-referensi-resmi)

---

# 1. Orientasi: Kenapa Jakarta Tags Penting?

Jika Jakarta Pages/JSP adalah template engine, Jakarta Tags adalah vocabulary yang membuat JSP lebih bersih.

Tanpa tags, JSP legacy sering berisi:

```jsp
<% if (users != null && !users.isEmpty()) { %>
  <% for (User user : users) { %>
    <tr><td><%= user.getName() %></td></tr>
  <% } %>
<% } %>
```

Dengan Jakarta Tags:

```jsp
<c:if test="${not empty users}">
  <c:forEach var="user" items="${users}">
    <tr><td><c:out value="${user.name}" /></td></tr>
  </c:forEach>
</c:if>
```

Lebih deklaratif, lebih aman, dan lebih mudah dibaca.

## 1.1 Jakarta Tags bukan pengganti service layer

Tags menyederhanakan view logic.

Tags bukan tempat:

- query database;
- memulai transaction;
- memanggil external API;
- melakukan business workflow;
- menentukan final authorization;
- memproses pembayaran;
- membuat side effect penting.

## 1.2 Tujuan utama

Jakarta Tags membantu:

- menghilangkan scriptlet;
- membuat conditional rendering;
- melakukan iteration;
- output escaping;
- membangun URL;
- i18n/formatting;
- string helper functions;
- reusable view fragments;
- custom view components ringan.

## 1.3 Nama historis

Dulu sering disebut:

```text
JSTL / JSP Standard Tag Library
```

Sekarang:

```text
Jakarta Standard Tag Library / Jakarta Tags
```

Kamu akan melihat semua nama ini di codebase legacy.

## 1.4 Prinsip utama

```text
Use tags to express presentation logic.
Keep business logic outside JSP.
```

---

# 2. Mental Model: Tag Library sebagai View-Level Abstraction

Tag library adalah kumpulan tag yang dipanggil dari JSP.

Setiap tag memiliki:

- prefix;
- URI;
- handler;
- attributes;
- optional body;
- output behavior;
- lifecycle.

## 2.1 Tag declaration

```jsp
<%@ taglib prefix="c" uri="jakarta.tags.core" %>
```

## 2.2 Tag invocation

```jsp
<c:forEach var="item" items="${items}">
  ...
</c:forEach>
```

## 2.3 Runtime mental model

```text
JSP translated to Servlet
  ↓
tag invocation translated to tag handler calls
  ↓
EL attributes evaluated
  ↓
tag controls body execution/output
```

## 2.4 Tag as view abstraction

A tag can hide repetitive rendering pattern.

Example:

```jsp
<app:alert type="error" message="${error}" />
```

instead of repeating HTML structure.

## 2.5 Tag body

Some tags evaluate body:

```jsp
<c:if test="${condition}">
  body rendered if true
</c:if>
```

Some iterate body:

```jsp
<c:forEach items="${items}">
  body repeated
</c:forEach>
```

Some write output directly:

```jsp
<c:out value="${value}" />
```

## 2.6 Tag is server-side

Tags run on server during JSP rendering.

They are not browser components.

## 2.7 Tags are not free

Each tag has processing overhead.

Use cleanly, but avoid thousands of unnecessary nested tags in large tables.

---

# 3. Jakarta Standard Tag Library 3.0 dalam Jakarta EE 11

Jakarta Standard Tag Library 3.0 is release for Jakarta EE 10, but Jakarta EE 11 includes Standard Tag Libraries 3.0 in the Web Profile.

There are 3.0.x service releases to improve compatibility with Jakarta EE 10 and Jakarta EE 11 APIs.

## 3.1 Specification purpose

Jakarta Standard Tag Library encapsulates as simple tags common functionality used by many web applications.

It supports:

- iteration;
- conditionals;
- XML manipulation;
- internationalization;
- SQL tags;
- integration framework for custom tags.

## 3.2 Jakarta EE 11 status

Jakarta EE 11 release page lists:

```text
Standard Tag Libraries 3.0
```

in the Web Profile.

## 3.3 Jakarta Tags 3.1

Jakarta Standard Tag Library 3.1 is under development for Jakarta EE 12.

For Jakarta EE 11 target, use 3.0.x compatible release.

## 3.4 URI modernization

Jakarta Tags 3.0 renamed old taglib URIs to new `jakarta.tags.*` URIs.

Modern examples:

```jsp
<%@ taglib prefix="c" uri="jakarta.tags.core" %>
<%@ taglib prefix="fmt" uri="jakarta.tags.fmt" %>
<%@ taglib prefix="fn" uri="jakarta.tags.functions" %>
<%@ taglib prefix="x" uri="jakarta.tags.xml" %>
<%@ taglib prefix="sql" uri="jakarta.tags.sql" %>
```

## 3.5 Compatibility warning

Using the right URI is not enough.

Runtime must have Jakarta Tags API/implementation available.

This is a common migration issue.

---

# 4. Jakarta Tags vs JSP Scriptlet vs EL vs Custom Tag

## 4.1 JSP scriptlet

Java code inside JSP:

```jsp
<% for (...) { %>
```

Avoid.

## 4.2 EL

Expression evaluation:

```jsp
${user.name}
```

Good for reading values/simple expressions.

## 4.3 Jakarta Tags

Declarative tags:

```jsp
<c:forEach items="${users}" var="user">
```

Good for control flow and formatting.

## 4.4 Custom tag

Your reusable tag:

```jsp
<app:formField label="Email" value="${form.email}" />
```

Good for repeated view patterns.

## 4.5 Decision table

| Need | Prefer |
|---|---|
| Read property | EL |
| Escape output | `c:out` |
| Loop | `c:forEach` |
| Conditional render | `c:if` / `c:choose` |
| Localized message | `fmt:message` |
| Format number/date | `fmt:*` |
| String helper | `fn:*` |
| Reusable HTML fragment | tag file/custom tag |
| Business logic | Java service/controller |
| DB query | repository/service |
| Authorization | controller/service/security layer |

## 4.6 Rule of thumb

If the tag expression becomes hard to read, move logic to view model.

---

# 5. Dependency, Runtime, dan URI Modern

## 5.1 API dependency

Typical API coordinate:

```xml
<dependency>
  <groupId>jakarta.servlet.jsp.jstl</groupId>
  <artifactId>jakarta.servlet.jsp.jstl-api</artifactId>
  <version>3.0.2</version>
</dependency>
```

## 5.2 Implementation dependency

A standalone Servlet container may need implementation dependency too.

Common implementations may be provided by Eclipse WaSP or bundled in Jakarta EE server.

Check your runtime.

## 5.3 Jakarta EE server vs plain Servlet container

Full Jakarta EE servers often provide more APIs.

Plain Tomcat/Jetty may require adding JSTL/Jakarta Tags jars.

## 5.4 URI modern

Core:

```jsp
<%@ taglib prefix="c" uri="jakarta.tags.core" %>
```

Formatting:

```jsp
<%@ taglib prefix="fmt" uri="jakarta.tags.fmt" %>
```

Functions:

```jsp
<%@ taglib prefix="fn" uri="jakarta.tags.functions" %>
```

XML:

```jsp
<%@ taglib prefix="x" uri="jakarta.tags.xml" %>
```

SQL:

```jsp
<%@ taglib prefix="sql" uri="jakarta.tags.sql" %>
```

## 5.5 Old URIs

Legacy:

```jsp
http://java.sun.com/jsp/jstl/core
http://java.sun.com/jsp/jstl/fmt
http://java.sun.com/jsp/jstl/functions
```

These are old Java EE/JSTL era URIs.

## 5.6 Common error

```text
Unable to find taglib [c] for URI [jakarta.tags.core]
```

Usually means:

- missing JSTL/Jakarta Tags implementation;
- wrong dependency version;
- runtime not scanning TLD;
- old/new URI mismatch;
- API jar present but implementation missing;
- incompatible container version.

## 5.7 Version alignment

Align:

- Servlet version;
- JSP/Jakarta Pages version;
- EL version;
- JSTL/Jakarta Tags API/impl;
- runtime.

---

# 6. Peta Tag Libraries

Jakarta Tags standard libraries:

| Prefix | URI | Purpose |
|---|---|---|
| `c` | `jakarta.tags.core` | conditionals, loops, output, URL, variables |
| `fmt` | `jakarta.tags.fmt` | i18n, message bundles, number/date formatting |
| `fn` | `jakarta.tags.functions` | EL string/collection helper functions |
| `x` | `jakarta.tags.xml` | XML parse/transform/query |
| `sql` | `jakarta.tags.sql` | SQL query/update/transaction tags |

## 6.1 Most used

In production JSP, most commonly used:

- core;
- fmt;
- functions.

## 6.2 XML tags

Useful in legacy systems, but often better in backend.

## 6.3 SQL tags

Mostly avoid in production.

## 6.4 Custom tag libraries

Teams often create:

```jsp
<app:layout>
<app:field>
<sec:authorize>
```

Be careful with hidden logic.

## 6.5 Tag files

Quick way to build custom tags without Java class.

---

# 7. Core Library `c`

Declare:

```jsp
<%@ taglib prefix="c" uri="jakarta.tags.core" %>
```

Core library includes tags for:

- output;
- variable assignment/removal;
- conditional rendering;
- branching;
- iteration;
- URL building;
- import;
- redirect;
- catch.

## 7.1 Core tag categories

```text
Output:
  c:out

Variable:
  c:set, c:remove

Conditional:
  c:if, c:choose, c:when, c:otherwise

Iteration:
  c:forEach, c:forTokens

URL:
  c:url, c:param, c:redirect, c:import

Error:
  c:catch
```

## 7.2 Core library purpose

Replace common scriptlet patterns.

## 7.3 Core does not mean business core

It is view-level core.

## 7.4 Keep logic simple

Use core tags for presentation branching, not domain workflow.

---

# 8. `c:out`: Safe Output dan Escaping

`c:out` evaluates expression and writes output.

## 8.1 Basic

```jsp
<c:out value="${user.name}" />
```

## 8.2 Why use it?

It escapes XML/HTML special chars by default depending tag behavior/config.

User input:

```html
<script>alert(1)</script>
```

becomes text, not executable script.

## 8.3 Default value

```jsp
<c:out value="${user.nickname}" default="-" />
```

## 8.4 Escaping control

Some versions support:

```jsp
<c:out value="${html}" escapeXml="false" />
```

Use with extreme caution.

## 8.5 Context-sensitive escaping

`c:out` is good for HTML text context.

For JavaScript context, URL context, CSS context, you need correct encoder for that context.

Bad:

```jsp
<script>
  const name = '<c:out value="${user.name}" />';
</script>
```

HTML escaping is not necessarily JS escaping.

## 8.6 Best practice

Use `c:out` for untrusted text.

Do not use raw `${...}` for user content unless framework guarantees correct escaping in that context.

## 8.7 Do not disable escaping for CMS/user HTML unless sanitized

If you need rich HTML, sanitize first server-side.

---

# 9. `c:set` dan `c:remove`: Variable Management

## 9.1 Set variable

```jsp
<c:set var="title" value="Users" />
```

## 9.2 Scope

```jsp
<c:set var="title" value="Users" scope="request" />
```

Scopes:

- page;
- request;
- session;
- application.

## 9.3 Set property

```jsp
<c:set target="${user}" property="name" value="Fajar" />
```

Use sparingly.

JSP should not mutate domain objects in complex ways.

## 9.4 Remove

```jsp
<c:remove var="title" />
```

## 9.5 Good use

- local display variable;
- computed display title;
- tag composition.

## 9.6 Bad use

- building business state;
- mutating session/application data;
- changing entity;
- controlling workflow.

## 9.7 Prefer controller-prepared model

If variable is important, prepare it in controller/view model.

---

# 10. `c:if`: Conditional Rendering

## 10.1 Basic

```jsp
<c:if test="${not empty users}">
  ...
</c:if>
```

## 10.2 No else

`c:if` only has then branch.

Use `c:choose` for else.

## 10.3 Good use

```jsp
<c:if test="${user.canEdit}">
  <a href="...">Edit</a>
</c:if>
```

## 10.4 Not authorization by itself

Hiding UI is not security.

Controller/action must enforce authorization.

## 10.5 Avoid expensive tests

Bad:

```jsp
<c:if test="${permissionService.canEdit(user, item)}">
```

This can run many times in table.

Better:

```java
UserRow.canEdit
```

precomputed.

## 10.6 Null safety

Use EL `empty`, `not empty`, and DTO defaults.

---

# 11. `c:choose`, `c:when`, `c:otherwise`

## 11.1 Basic

```jsp
<c:choose>
  <c:when test="${user.admin}">
    Admin
  </c:when>
  <c:when test="${user.active}">
    Active User
  </c:when>
  <c:otherwise>
    Inactive
  </c:otherwise>
</c:choose>
```

## 11.2 Equivalent to if/else-if/else

Cleaner than multiple `c:if`.

## 11.3 Good use

- display label based on status;
- render small alternatives;
- handle empty states.

## 11.4 Bad use

Large business decision trees in JSP.

Move to view model:

```java
statusLabel
statusCssClass
availableActions
```

## 11.5 Ordering matters

First matching `c:when` wins.

## 11.6 Keep branches small

If branch huge, split into tag file/include.

---

# 12. `c:forEach`: Iteration

## 12.1 Basic collection

```jsp
<c:forEach var="user" items="${users}">
  <tr>
    <td><c:out value="${user.name}" /></td>
  </tr>
</c:forEach>
```

## 12.2 varStatus

```jsp
<c:forEach var="user" items="${users}" varStatus="status">
  ${status.index}
  ${status.count}
  ${status.first}
  ${status.last}
</c:forEach>
```

## 12.3 Range loop

```jsp
<c:forEach var="i" begin="1" end="10">
  ${i}
</c:forEach>
```

## 12.4 Step

```jsp
<c:forEach var="i" begin="0" end="10" step="2">
  ${i}
</c:forEach>
```

## 12.5 Map iteration

```jsp
<c:forEach var="entry" items="${map}">
  <c:out value="${entry.key}" />
  <c:out value="${entry.value}" />
</c:forEach>
```

## 12.6 Avoid huge loops

Do not render 100k rows.

Paginate.

## 12.7 Avoid DB calls inside loop

Bad:

```jsp
${userService.findRole(user.id)}
```

Preload data.

## 12.8 Table row security

Even if edit button hidden per row, backend must enforce edit action.

---

# 13. `c:forTokens`: Token Iteration

## 13.1 Basic

```jsp
<c:forTokens var="tag" items="${article.tagsCsv}" delims=",">
  <span><c:out value="${tag}" /></span>
</c:forTokens>
```

## 13.2 Use cases

- simple comma-separated display;
- legacy string values.

## 13.3 Better model

Prefer server-side model as collection:

```java
List<String> tags
```

then use `c:forEach`.

## 13.4 Trimming

Token handling may not trim as you expect.

Prepare data in controller.

## 13.5 Avoid parsing business data in JSP

If tokenization is meaningful, do it in backend.

---

# 14. `c:url`, `c:param`: URL Construction

## 14.1 Basic

```jsp
<c:url var="userUrl" value="/users/detail">
  <c:param name="id" value="${user.id}" />
</c:url>

<a href="${userUrl}">View</a>
```

## 14.2 Context path

`c:url` can handle context-relative URLs.

## 14.3 URL encoding

Parameters are encoded.

## 14.4 Session ID rewriting

In old/session-url-rewriting scenarios, `c:url` can append session ID if cookies disabled.

## 14.5 Use for links/forms

```jsp
<form action="<c:url value='/users/create' />" method="post">
```

But nesting tag inside attribute can be awkward.

Often use var first.

## 14.6 Avoid manual concatenation

Bad:

```jsp
<a href="/users?id=${user.id}">
```

Context path and encoding issues.

## 14.7 Open redirect

Do not build redirect URL from untrusted absolute URL.

---

# 15. `c:redirect`: Redirect dari View? Hati-Hati

## 15.1 Basic

```jsp
<c:redirect url="/login" />
```

## 15.2 Why caution?

Redirect is control flow.

In MVC, controller should usually decide redirect before forwarding to JSP.

## 15.3 Bad pattern

JSP:

```jsp
<c:if test="${not user.admin}">
  <c:redirect url="/login" />
</c:if>
```

This hides authorization flow in view.

## 15.4 Better

Controller/filter/security layer:

```java
if (!authorized) {
    response.sendRedirect(...);
    return;
}
```

## 15.5 Use cases

`c:redirect` may be okay in simple legacy pages, but avoid for architecture clarity.

## 15.6 Security

Validate URLs.

Avoid open redirect.

---

# 16. `c:import`: Import Resource? Hati-Hati

## 16.1 Basic

```jsp
<c:import url="/fragment.jsp" />
```

or external:

```jsp
<c:import url="https://example.com/data" />
```

depending configuration.

## 16.2 Use cases

- include resource;
- fetch internal fragment;
- legacy integration.

## 16.3 Risks

- SSRF if URL influenced by user;
- latency in view render;
- failure coupling;
- caching complexity;
- security boundary confusion.

## 16.4 Prefer controller/service

Do not fetch remote data from JSP.

Controller/service should fetch data and pass view model.

## 16.5 Internal include

Use `jsp:include` or tag files/templates for internal fragments.

## 16.6 External import

Avoid in production JSP unless very controlled.

---

# 17. `c:catch`: Error Handling di View

## 17.1 Basic

```jsp
<c:catch var="err">
  ...
</c:catch>

<c:if test="${not empty err}">
  Error occurred.
</c:if>
```

## 17.2 Use cases

- optional view fragment;
- legacy defensive rendering.

## 17.3 Danger

It can hide real errors.

## 17.4 Do not catch business/system errors silently

Controller/service should handle errors.

## 17.5 Logging

`c:catch` itself does not log root cause.

## 17.6 Production guidance

Use sparingly. Prefer proper error pages and controller error handling.

---

# 18. Formatting Library `fmt`

Declare:

```jsp
<%@ taglib prefix="fmt" uri="jakarta.tags.fmt" %>
```

The `fmt` library provides i18n-capable formatting.

## 18.1 Categories

- locale;
- resource bundles;
- messages;
- number formatting/parsing;
- date/time formatting/parsing;
- timezone.

## 18.2 Why use fmt?

To avoid hardcoded labels/date/number formats.

## 18.3 View responsibility

Formatting is view responsibility when simple.

Complex business formatting can be precomputed.

## 18.4 Locale source

Locale can come from:

- request Accept-Language;
- user preference;
- session;
- application setting.

## 18.5 Timezone source

Timezone should be explicit for user/business context.

## 18.6 Java time caution

JSTL date tags historically work with `java.util.Date`.

For `java.time`, prepare compatible values or custom formatter/tags.

---

# 19. `fmt:setLocale`, `fmt:setBundle`, `fmt:bundle`

## 19.1 Set locale

```jsp
<fmt:setLocale value="${sessionScope.locale}" />
```

## 19.2 Set bundle

```jsp
<fmt:setBundle basename="messages" />
```

## 19.3 Bundle scope

Can store bundle config in scope.

## 19.4 Bundle block

```jsp
<fmt:bundle basename="messages">
  <fmt:message key="label.users" />
</fmt:bundle>
```

## 19.5 Prefer app-wide config

For consistent i18n, configure locale/bundle centrally.

## 19.6 Avoid setting locale randomly per fragment

Can create inconsistent page.

## 19.7 Missing keys

Decide missing key behavior and test.

---

# 20. `fmt:message`: Internationalized Messages

## 20.1 Basic

```jsp
<fmt:message key="user.list.title" />
```

## 20.2 With parameter

```jsp
<fmt:message key="user.greeting">
  <fmt:param value="${user.name}" />
</fmt:message>
```

Properties:

```properties
user.greeting=Hello {0}
```

## 20.3 Escaping

Parameters may be user-controlled.

Ensure output context is safe.

## 20.4 Message design

Keep message keys stable.

```text
user.list.title
error.user.email.required
button.save
```

## 20.5 Avoid concatenating localized text

Bad:

```jsp
<fmt:message key="hello" /> ${user.name}
```

Some languages require different order.

Use parameters.

## 20.6 Missing bundle

If bundle not found, tag may fail or show key depending config.

## 20.7 Testing i18n

Test with multiple locales and long strings.

---

# 21. `fmt:formatNumber` dan `fmt:parseNumber`

## 21.1 Format number

```jsp
<fmt:formatNumber value="${order.total}" type="number" />
```

## 21.2 Currency

```jsp
<fmt:formatNumber value="${order.total}" type="currency" currencyCode="SGD" />
```

## 21.3 Percent

```jsp
<fmt:formatNumber value="${rate}" type="percent" />
```

## 21.4 Pattern

```jsp
<fmt:formatNumber value="${amount}" pattern="#,##0.00" />
```

## 21.5 Parse number

```jsp
<fmt:parseNumber value="${param.amount}" var="amount" />
```

## 21.6 Production guidance

Parsing user input in JSP is usually not ideal.

Controller should parse/validate.

## 21.7 Locale

Number formatting is locale-sensitive.

## 21.8 Money

For monetary amounts, use BigDecimal/currency carefully in backend; format in view.

---

# 22. `fmt:formatDate` dan `fmt:parseDate`

## 22.1 Format date

```jsp
<fmt:formatDate value="${user.createdAt}" pattern="yyyy-MM-dd" />
```

## 22.2 Date/time styles

```jsp
<fmt:formatDate value="${now}" type="both" dateStyle="medium" timeStyle="short" />
```

## 22.3 Parse date

```jsp
<fmt:parseDate value="${param.date}" pattern="yyyy-MM-dd" var="date" />
```

## 22.4 Production guidance

Parsing user input should be in controller/service.

JSP should display.

## 22.5 Timezone

Use `fmt:timeZone` or set timezone.

## 22.6 Java time

If model uses `Instant`, `LocalDate`, etc., test compatibility.

Often better to convert to view-specific display string or `Date`.

## 22.7 User timezone

Show dates in user/business timezone.

## 22.8 Avoid ambiguous formats

Prefer clear date/time formatting.

---

# 23. `fmt:timeZone` dan `fmt:setTimeZone`

## 23.1 Block timezone

```jsp
<fmt:timeZone value="Asia/Singapore">
  <fmt:formatDate value="${event.time}" type="both" />
</fmt:timeZone>
```

## 23.2 Set timezone

```jsp
<fmt:setTimeZone value="${user.timeZone}" />
```

## 23.3 Business timezone

For government/enterprise apps, business timezone may be fixed.

## 23.4 User timezone

For global apps, user preference matters.

## 23.5 Store in UTC

Backend should store timestamps in UTC/Instant.

Format in view.

## 23.6 DST

Timezone formatting must handle DST if applicable.

## 23.7 Avoid hardcoded server timezone

Server timezone may differ.

---

# 24. Functions Library `fn`

Declare:

```jsp
<%@ taglib prefix="fn" uri="jakarta.tags.functions" %>
```

Functions are EL functions, not tags.

## 24.1 Length

```jsp
${fn:length(users)}
```

## 24.2 Contains

```jsp
${fn:contains(user.name, 'Admin')}
```

## 24.3 Starts/ends with

```jsp
${fn:startsWith(file.name, 'report')}
${fn:endsWith(file.name, '.pdf')}
```

## 24.4 Escape XML

```jsp
${fn:escapeXml(userInput)}
```

But `c:out` is often clearer.

## 24.5 Substring

```jsp
${fn:substring(text, 0, 10)}
```

## 24.6 Replace

```jsp
${fn:replace(text, '\n', '<br/>')}
```

Careful: replacing with HTML may need escaping/sanitization.

## 24.7 Split/join

```jsp
${fn:split(tags, ',')}
${fn:join(array, ', ')}
```

## 24.8 Case conversion

```jsp
${fn:toLowerCase(value)}
${fn:toUpperCase(value)}
```

## 24.9 Keep simple

If expression becomes complex, move to view model.

---

# 25. XML Library `x`

Declare:

```jsp
<%@ taglib prefix="x" uri="jakarta.tags.xml" %>
```

## 25.1 Use cases

- parse XML;
- query XML;
- transform XML;
- legacy integrations.

## 25.2 Example concept

```jsp
<x:parse var="doc" xml="${xml}" />
<x:out select="$doc/root/name" />
```

## 25.3 Modern caution

XML processing in view is often bad separation.

## 25.4 Security risks

Untrusted XML can trigger:

- XXE;
- entity expansion;
- resource exhaustion;
- malicious external references.

## 25.5 Recommendation

Parse/validate XML in backend service with secure parser config.

Pass safe DTO to JSP.

## 25.6 XSLT

If using transformation, treat stylesheet/input as sensitive.

## 25.7 Legacy maintenance

Understand XML tags to maintain old JSP, but avoid new usage in production.

---

# 26. SQL Library `sql`: Kenapa Hampir Selalu Anti-Pattern

Declare:

```jsp
<%@ taglib prefix="sql" uri="jakarta.tags.sql" %>
```

## 26.1 What it can do

Historically supports:

- data source;
- query;
- update;
- transaction;
- parameters.

## 26.2 Example

```jsp
<sql:query var="users" dataSource="${ds}">
  SELECT * FROM users
</sql:query>
```

## 26.3 Why it is dangerous in real apps

- SQL in view;
- poor separation of concerns;
- no domain model;
- transaction unclear;
- SQL injection risk if misused;
- resource management hidden;
- hard to test;
- authorization bypass risk;
- impossible to reuse logic;
- noisy error handling.

## 26.4 Correct architecture

```text
Controller/Servlet
  ↓
Service / Use Case
  ↓
Repository / DAO
  ↓
DTO / ViewModel
  ↓
JSP + JSTL for rendering
```

## 26.5 When acceptable?

- educational demo;
- quick prototype;
- internal throwaway page.

Even then, avoid for code that lives.

## 26.6 Migration priority

Remove SQL tags early during JSP modernization.

---

# 27. Tag Library Descriptor / TLD

TLD describes tag library.

## 27.1 Purpose

TLD maps:

- URI;
- tag names;
- tag handler classes;
- attributes;
- functions;
- validators.

## 27.2 Location

Common:

```text
WEB-INF/mytags.tld
META-INF/*.tld inside JAR
```

## 27.3 TLD snippet concept

```xml
<taglib>
  <tlib-version>1.0</tlib-version>
  <short-name>app</short-name>
  <uri>https://example.com/tags/app</uri>

  <tag>
    <name>alert</name>
    <tag-class>com.example.web.tags.AlertTag</tag-class>
    <body-content>scriptless</body-content>
    <attribute>
      <name>type</name>
      <required>true</required>
      <rtexprvalue>true</rtexprvalue>
    </attribute>
  </tag>
</taglib>
```

## 27.4 Function declaration

TLD can declare EL functions mapping to Java static methods.

## 27.5 Tag discovery

Container scans TLDs in app/JAR.

## 27.6 Debugging

If taglib cannot be found, check:

- TLD location;
- URI;
- dependency;
- JAR contents;
- web.xml mapping;
- container scanning.

## 27.7 Versioning

Tag URI should be stable.

Do not change URI casually.

---

# 28. Tag Lifecycle dan Body Evaluation

Tag lifecycle differs depending classic vs simple tags.

## 28.1 Classic tag

Uses methods such as:

```text
setPageContext
setParent
doStartTag
doAfterBody
doEndTag
release
```

## 28.2 Simple tag

Uses:

```text
setJspContext
setParent
setJspBody
doTag
```

## 28.3 Body content

Tags can:

- skip body;
- evaluate body once;
- evaluate body repeatedly;
- buffer body;
- transform body.

## 28.4 Iteration tags

`c:forEach` evaluates body repeatedly.

## 28.5 Conditional tags

`c:if` may skip body.

## 28.6 Output tags

`c:out` writes output.

## 28.7 Lifecycle implications

Tag handler may be reused/poolable.

Do not store request-specific state without resetting.

---

# 29. Classic Tag Handler vs Simple Tag Handler

## 29.1 Classic Tag Handler

Implements:

```java
Tag
IterationTag
BodyTag
```

or extends:

```java
TagSupport
BodyTagSupport
```

More complex but powerful.

## 29.2 Simple Tag Handler

Implements:

```java
SimpleTag
```

or extends:

```java
SimpleTagSupport
```

Usually preferred for new simple custom tags.

## 29.3 Simple tag example

```java
public class AlertTag extends SimpleTagSupport {
    private String type;

    public void setType(String type) {
        this.type = type;
    }

    @Override
    public void doTag() throws JspException, IOException {
        JspWriter out = getJspContext().getOut();
        out.write("<div class=\"alert alert-");
        out.write(escape(type));
        out.write("\">");
        if (getJspBody() != null) {
            getJspBody().invoke(null);
        }
        out.write("</div>");
    }
}
```

## 29.4 Attribute setters

Container calls setters for tag attributes.

## 29.5 Body invocation

Simple tag can invoke body with `getJspBody().invoke(...)`.

## 29.6 Thread safety

Do not assume one tag instance per request forever.

Avoid static mutable state.

## 29.7 Cleanup

Reset fields if pooling/reuse possible.

---

# 30. Tag Files: Custom Tag Tanpa Java Class

Tag files are JSP fragments used as custom tags.

## 30.1 Location

```text
/WEB-INF/tags/alert.tag
```

## 30.2 Declare tagdir

```jsp
<%@ taglib prefix="app" tagdir="/WEB-INF/tags" %>
```

## 30.3 Use tag file

```jsp
<app:alert type="info">
  Saved successfully.
</app:alert>
```

## 30.4 `alert.tag`

```jsp
<%@ tag body-content="scriptless" %>
<%@ attribute name="type" required="true" %>

<div class="alert alert-${type}">
  <jsp:doBody />
</div>
```

## 30.5 Benefits

- fast to build;
- no Java class;
- good for HTML fragments;
- reusable.

## 30.6 Limitations

- still JSP;
- can become messy if too complex;
- performance depends rendering complexity.

## 30.7 Best use

Use tag files for presentation components:

- alert;
- panel;
- field layout;
- pagination control;
- breadcrumb.

## 30.8 Avoid business logic

Same rule.

---

# 31. JSP Fragment dan Dynamic Attributes

## 31.1 JSP Fragment

A `JspFragment` represents tag body that can be invoked by tag.

In simple tag:

```java
JspFragment body = getJspBody();
body.invoke(null);
```

## 31.2 Body can be delayed

Tag controls when body executes.

## 31.3 Dynamic attributes

Custom tags can accept attributes not declared upfront if configured.

Use cases:

- pass-through HTML attributes;
- flexible component API.

## 31.4 Risk

Dynamic attributes can accidentally allow unsafe HTML/event attributes.

Example:

```jsp
<app:button onclick="${userInput}">
```

## 31.5 Validate dynamic attrs

Allowlist attributes and escape values.

## 31.6 Keep tag API explicit

Dynamic attributes are powerful but reduce clarity.

---

# 32. TagExtraInfo dan TagLibraryValidator

## 32.1 TagExtraInfo

Allows tag to provide extra translation-time information such as scripting variables.

Mostly relevant to classic JSP/tag model.

## 32.2 TagLibraryValidator

Can validate JSP pages using tag library at translation time.

## 32.3 Use cases

- enforce tag nesting rules;
- validate required structure;
- detect invalid combinations.

## 32.4 Modern use

Less common in application-level code, more relevant for library authors.

## 32.5 Caution

Complex validation can slow translation and be hard to maintain.

## 32.6 Benefit

Catch errors before runtime.

---

# 33. Tag Pooling dan Thread Safety

## 33.1 Tag pooling

Containers may reuse tag handler instances for performance.

## 33.2 Why it matters

If tag instance is reused, fields from previous use can leak if not reset.

## 33.3 Bad tag

```java
public class BadTag extends SimpleTagSupport {
    private String userSpecificValue;
}
```

If not reset correctly, stale value risk.

## 33.4 Good practice

- set all attributes before use;
- reset fields after `doTag`;
- avoid static mutable state;
- make helper services thread-safe;
- do not store request/session data in static fields.

## 33.5 Attribute lifecycle

Container calls setters for attributes.

But optional attributes may retain old value if pooling and not reset depending handler lifecycle.

Defensive reset helps.

## 33.6 Thread safety

Tag instance may not be used concurrently, but do not rely on undocumented behavior.

Static/shared dependencies must be thread-safe.

## 33.7 Testing

Test repeated tag invocations with different attributes.

---

# 34. Custom Function Library

Custom functions expose static Java methods to EL.

## 34.1 Static method

```java
public final class MaskFunctions {
    public static String maskEmail(String email) {
        ...
    }
}
```

## 34.2 TLD function

```xml
<function>
  <name>maskEmail</name>
  <function-class>com.example.web.fn.MaskFunctions</function-class>
  <function-signature>java.lang.String maskEmail(java.lang.String)</function-signature>
</function>
```

## 34.3 JSP usage

```jsp
<%@ taglib prefix="appfn" uri="https://example.com/tags/functions" %>

${appfn:maskEmail(user.email)}
```

## 34.4 Good functions

- pure;
- deterministic;
- cheap;
- formatting/masking.

## 34.5 Bad functions

- database calls;
- network calls;
- state mutation;
- security decisions;
- complex business rules.

## 34.6 Security

Do not expose dangerous static methods.

## 34.7 Performance

Functions may be called repeatedly during render.

---

# 35. MVC Pattern dengan Jakarta Tags

## 35.1 Correct layering

```text
Servlet/controller:
  parse input
  call service
  prepare view model
  forward to JSP

JSP + Tags:
  render view model
  simple condition/loop
  escape output
```

## 35.2 Controller example

```java
request.setAttribute("page", userPage);
request.getRequestDispatcher("/WEB-INF/views/users/list.jsp")
    .forward(request, response);
```

## 35.3 JSP example

```jsp
<c:choose>
  <c:when test="${empty page.users}">
    <p>No users found.</p>
  </c:when>
  <c:otherwise>
    <table>
      <c:forEach var="user" items="${page.users}">
        <tr>
          <td><c:out value="${user.name}" /></td>
        </tr>
      </c:forEach>
    </table>
  </c:otherwise>
</c:choose>
```

## 35.4 View model

```java
record UserPage(
    List<UserRow> users,
    boolean canCreate,
    String searchTerm
) {}
```

## 35.5 Avoid service in JSP

Bad:

```jsp
${userService.findAll()}
```

## 35.6 Authorization

`canCreate` controls display.

Actual create endpoint still checks permission.

## 35.7 Error handling

Controller provides errors; JSP displays.

---

# 36. Security: XSS, URL, CSRF, AuthZ, Tag Injection

## 36.1 XSS

Use `c:out` for untrusted text.

## 36.2 Context-specific escaping

HTML text:

```jsp
<c:out value="${value}" />
```

HTML attribute:

```jsp
<input value="<c:out value='${value}' />">
```

JavaScript:

```jsp
<script>
const data = ${jsonEncodedData};
</script>
```

Need JSON/JS encoder.

URL:

Use `c:url`, not string concat.

## 36.3 CSRF

Tags do not automatically protect forms.

Add CSRF token:

```jsp
<input type="hidden" name="csrf" value="${csrfToken}" />
```

or use framework support.

## 36.4 Authorization

Do not rely on:

```jsp
<c:if test="${user.admin}">
```

as only protection.

## 36.5 Tag injection

If custom tag accepts raw HTML/body/attributes, sanitize/escape.

## 36.6 Dynamic attributes

Pass-through attributes can enable XSS if not controlled.

## 36.7 SQL tag

Avoid SQL tags; security risk.

## 36.8 Import tag and SSRF

`c:import` with untrusted URL can create SSRF risk.

## 36.9 URL redirect

`c:redirect` with untrusted target can create open redirect.

---

# 37. Performance Engineering

## 37.1 Tag overhead

Each tag has runtime processing.

Usually fine, but thousands of nested tags in large table can matter.

## 37.2 EL evaluation

Tag attributes use EL. Expensive expressions can hurt.

## 37.3 Functions

Functions repeated in loops can cost.

Precompute when needed.

## 37.4 Formatting in loops

Date/number formatting for large tables can be costly.

Paginate and preformat if necessary.

## 37.5 Dynamic includes/imports

`c:import` and `jsp:include` can add overhead.

## 37.6 Tag files

Tag files improve reuse but can generate additional complexity.

## 37.7 Avoid huge pages

Paginate.

## 37.8 Precompile JSP

Catch tag/TLD errors early and reduce first-hit cost.

## 37.9 Measure

Use profiling and real render metrics.

Do not guess.

---

# 38. Migration dari JSTL Lama ke Jakarta Tags

## 38.1 Old imports

```jsp
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>
```

## 38.2 New imports

```jsp
<%@ taglib prefix="c" uri="jakarta.tags.core" %>
```

## 38.3 Other URIs

```jsp
jakarta.tags.fmt
jakarta.tags.functions
jakarta.tags.xml
jakarta.tags.sql
```

## 38.4 Dependencies

Old:

```text
javax.servlet:jstl
javax.servlet.jsp.jstl
```

New:

```text
jakarta.servlet.jsp.jstl:jakarta.servlet.jsp.jstl-api
implementation compatible with Jakarta
```

## 38.5 Package change

Custom tag classes:

Old:

```java
javax.servlet.jsp.tagext.SimpleTagSupport
```

New:

```java
jakarta.servlet.jsp.tagext.SimpleTagSupport
```

## 38.6 TLD update

Update class names and schemas if needed.

## 38.7 Runtime alignment

Tomcat 9 = Javax era.

Tomcat 10+ = Jakarta era.

Jakarta EE 11 runtime uses Jakarta namespaces.

## 38.8 Service release note

Jakarta Tags 3.0.2 exists as a service release to function with both Jakarta EE 10 and Jakarta EE 11 APIs.

## 38.9 Migration checklist

- update JSP taglib URIs;
- update dependencies;
- update custom tag imports;
- update TLD handler classes;
- test all pages;
- inspect runtime TLD discovery.

---

# 39. Debugging: `Unable to find taglib`

Common error:

```text
Unable to find taglib [c] for URI [jakarta.tags.core]
```

## 39.1 Cause 1 — Missing implementation

You added API jar but not implementation.

Fix: add compatible implementation or use server that provides it.

## 39.2 Cause 2 — Wrong URI

Using `jakarta.tags.core` with old JSTL jars or old URI with new jars.

Fix: align URI and version.

## 39.3 Cause 3 — Container mismatch

Example:

- Tomcat 9 with Jakarta Tags 3.x;
- Tomcat 10/11 with old Javax JSTL.

Fix: align container generation.

## 39.4 Cause 4 — TLD not scanned

JAR not in `WEB-INF/lib`, wrong packaging, shaded jar issue.

## 39.5 Cause 5 — IDE false positive

IDE may not recognize Jakarta tag URIs though runtime works.

Check actual runtime and dependencies.

## 39.6 Cause 6 — Conflicting jars

Both old and new JSTL jars present.

Remove duplicates.

## 39.7 Diagnostic steps

1. Check runtime Servlet/JSP version.
2. Check JSTL/Jakarta Tags API/impl jars.
3. Check taglib URI in JSP.
4. Inspect `WEB-INF/lib`.
5. Check server logs for TLD scanning.
6. Verify no old `javax` JSTL jars.
7. Try minimal JSP with only `c:out`.

## 39.8 Minimal page

```jsp
<%@ taglib prefix="c" uri="jakarta.tags.core" %>
<c:out value="hello" />
```

If this fails, dependency/runtime issue.

---

# 40. Testing Strategy

## 40.1 Render tests

Run page through container and verify output.

## 40.2 Security tests

- XSS payload escaped;
- URL encoded;
- no open redirect;
- direct JSP blocked;
- authz enforced server-side.

## 40.3 Tag file tests

Render custom tag with different attributes/body.

## 40.4 Custom tag handler tests

Unit test helper logic.

Integration test actual JSP invocation.

## 40.5 Migration tests

Compare output before/after URI/package migration.

## 40.6 i18n tests

Test multiple locales and missing keys.

## 40.7 Performance tests

Render list pages with realistic data volume.

## 40.8 Negative tests

- missing attribute;
- null values;
- empty collection;
- special characters;
- invalid URL param.

## 40.9 Precompile JSP in CI

Catch TLD/tag syntax errors before runtime.

---

# 41. Production Failure Modes

## 41.1 Taglib not found

Cause:

- missing dependency/implementation;
- URI mismatch;
- runtime mismatch.

## 41.2 XSS

Cause:

- raw EL output;
- `escapeXml=false`;
- unsafe custom tag/dynamic attr.

## 41.3 Hidden authorization bypass

Cause:

- view hides button but endpoint unprotected.

## 41.4 SQL in JSP

Cause:

- `sql:*` tags.

## 41.5 Slow rendering

Cause:

- large loops;
- expensive EL/functions;
- dynamic imports;
- too many formatting calls.

## 41.6 Memory/session growth

Cause:

- tags set large objects in session/application scope.

## 41.7 Stale data

Cause:

- view-level cached variables incorrectly scoped.

## 41.8 Open redirect

Cause:

- `c:redirect` with untrusted URL.

## 41.9 SSRF

Cause:

- `c:import` with untrusted URL.

## 41.10 Tag handler state leak

Cause:

- tag pooling and fields not reset.

## 41.11 Migration half-done

Cause:

- JSP URI updated but custom tag classes still `javax`.

---

# 42. Best Practices dan Anti-Patterns

## 42.1 Best practices

- Use Jakarta Tags to replace scriptlets.
- Use `c:out` for untrusted text.
- Use `c:url` for URLs.
- Use `c:forEach` for simple loops.
- Use `c:choose` for small display branches.
- Use `fmt` for simple i18n/formatting.
- Use `fn` for simple string helpers.
- Use tag files for reusable view fragments.
- Keep custom tags pure/view-level.
- Keep business logic in controller/service.
- Precompute expensive display data in view model.
- Avoid SQL/XML processing in JSP for production.
- Align taglib URIs and dependencies during migration.
- Test XSS and taglib resolution.

## 42.2 Anti-pattern: Tags as business workflow

Bad:

```jsp
<c:if test="${paymentService.charge(order)}">
```

## 42.3 Anti-pattern: SQL tags

Do not query DB from JSP.

## 42.4 Anti-pattern: `escapeXml=false`

Dangerous unless content sanitized/trusted.

## 42.5 Anti-pattern: Complex EL in `test`

Move to view model.

## 42.6 Anti-pattern: Session-scope variables from JSP

Avoid mutating session from view.

## 42.7 Anti-pattern: Custom tag with hidden side effects

Tags should render, not mutate system state.

## 42.8 Anti-pattern: Ignoring URI migration

Old JSTL URIs and Jakarta runtimes often fail.

---

# 43. Checklist Review

## 43.1 Dependency/runtime

- [ ] Jakarta Tags API present?
- [ ] Implementation present if needed?
- [ ] Runtime compatible?
- [ ] No old `javax` JSTL jars?
- [ ] URI uses `jakarta.tags.*`?
- [ ] Custom tags migrated to `jakarta.servlet.jsp.tagext`?

## 43.2 JSP usage

- [ ] No scriptlets?
- [ ] `c:out` for user text?
- [ ] `c:url` for links?
- [ ] `c:forEach` with paginated data?
- [ ] `fmt` configured correctly?
- [ ] `fn` used only for simple helpers?

## 43.3 Architecture

- [ ] Controller prepares model?
- [ ] Service handles business?
- [ ] JSP does not query DB?
- [ ] JSP does not call external APIs?
- [ ] Authorization enforced outside view?

## 43.4 Security

- [ ] XSS tested?
- [ ] Open redirect prevented?
- [ ] `c:import` not user-controlled?
- [ ] CSRF token included in forms?
- [ ] Custom tags escape output?
- [ ] Dynamic attributes validated?

## 43.5 Custom tags

- [ ] Attributes documented?
- [ ] Body content mode appropriate?
- [ ] Thread-safe?
- [ ] State reset?
- [ ] Tested with repeated invocation?

---

# 44. Case Study 1: Menghapus Scriptlet dengan JSTL Core

## 44.1 Before

```jsp
<% if (users != null && !users.isEmpty()) { %>
<table>
<% for (User user : users) { %>
  <tr>
    <td><%= user.getName() %></td>
  </tr>
<% } %>
</table>
<% } else { %>
<p>No users</p>
<% } %>
```

## 44.2 After

```jsp
<c:choose>
  <c:when test="${not empty users}">
    <table>
      <c:forEach var="user" items="${users}">
        <tr>
          <td><c:out value="${user.name}" /></td>
        </tr>
      </c:forEach>
    </table>
  </c:when>
  <c:otherwise>
    <p>No users</p>
  </c:otherwise>
</c:choose>
```

## 44.3 Benefits

- no Java code in JSP;
- safer output;
- clearer view logic;
- easier migration.

## 44.4 Remaining improvement

Use DTO/view model, not entity.

---

# 45. Case Study 2: XSS karena Output Tidak Lewat `c:out`

## 45.1 Problem

```jsp
<td>${comment.text}</td>
```

Comment contains:

```html
<img src=x onerror=alert(1)>
```

## 45.2 Fix

```jsp
<td><c:out value="${comment.text}" /></td>
```

## 45.3 But context matters

If rendering inside JavaScript, use JSON encoder.

## 45.4 Lesson

Tags help, but security still requires context-aware escaping.

---

# 46. Case Study 3: SQL Tags di JSP Membuat Architecture Bocor

## 46.1 Bad

```jsp
<sql:query var="users" dataSource="${ds}">
  SELECT id, name, email FROM users
</sql:query>
```

## 46.2 Problems

- view owns SQL;
- no service authorization;
- query duplicated;
- hard to test;
- DB details leaked;
- transaction unclear.

## 46.3 Refactor

Controller:

```java
List<UserRow> users = userService.findUsers(filter);
request.setAttribute("users", users);
```

JSP:

```jsp
<c:forEach var="user" items="${users}">
  ...
</c:forEach>
```

## 46.4 Lesson

SQL tags are historical convenience, not production architecture.

---

# 47. Case Study 4: Migrasi URI Lama ke `jakarta.tags.*`

## 47.1 Before

```jsp
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>
```

Dependencies include old JSTL.

## 47.2 After

```jsp
<%@ taglib prefix="c" uri="jakarta.tags.core" %>
```

Dependencies align with Jakarta Tags 3.0.x.

## 47.3 Failure

Runtime error:

```text
Unable to find taglib [c] for URI [jakarta.tags.core]
```

## 47.4 Root cause examples

- only API jar, no implementation;
- Tomcat/runtime mismatch;
- old JSTL jar still present;
- IDE deployment missing jar;
- TLD scanning disabled/failing.

## 47.5 Fix

Use compatible runtime and dependencies.

Test minimal page.

## 47.6 Lesson

Migration is namespace + dependency + runtime, not just URI search-replace.

---

# 48. Latihan Bertahap

## Latihan 1 — Core tag setup

Create JSP with:

```jsp
<%@ taglib prefix="c" uri="jakarta.tags.core" %>
```

Render `<c:out>`.

## Latihan 2 — Replace scriptlet loop

Convert scriptlet `for` to `c:forEach`.

## Latihan 3 — Conditional rendering

Use `c:choose` for empty/non-empty list.

## Latihan 4 — URL building

Use `c:url` and `c:param`.

## Latihan 5 — i18n

Use `fmt:setBundle` and `fmt:message`.

## Latihan 6 — Formatting

Format currency/date for two locales.

## Latihan 7 — Functions

Use `fn:length`, `fn:contains`, `fn:escapeXml`.

## Latihan 8 — Tag file

Create `/WEB-INF/tags/alert.tag`.

## Latihan 9 — Custom function

Create `maskEmail` EL function via TLD.

## Latihan 10 — Migration

Take old JSTL URI JSP and migrate to `jakarta.tags.*`.

---

# 49. Mini Project: Jakarta Tags Modern JSP Lab

## 49.1 Goal

Create:

```text
jakarta-tags-modern-jsp-lab/
```

## 49.2 Modules/pages

```text
core-output/
core-conditions/
core-iteration/
core-url/
fmt-i18n/
fmt-formatting/
functions/
tag-files/
custom-functions/
migration/
security/
```

## 49.3 Deliverables

```text
README.md
TAGS-MENTAL-MODEL.md
CORE-TAGS.md
FMT-TAGS.md
FUNCTIONS.md
TAG-FILES.md
CUSTOM-TAGS.md
SECURITY.md
MIGRATION.md
FAILURE-MODES.md
```

## 49.4 Required experiments

1. Render escaped output.
2. Render list with `c:forEach`.
3. Render empty state with `c:choose`.
4. Build encoded URL with `c:url`.
5. Render localized message.
6. Format date/number in different locale.
7. Use functions.
8. Create tag file.
9. Create custom function.
10. Simulate taglib not found and fix dependency/URI.

## 49.5 Evaluation questions

1. What problem does Jakarta Tags solve?
2. Why use `c:out`?
3. Why avoid scriptlets?
4. Why avoid SQL tags?
5. Difference tag and EL function?
6. What is TLD?
7. What causes `Unable to find taglib`?
8. What changed in Jakarta Tags URI?
9. Why are custom tags thread-safety sensitive?
10. Where should business logic live?

---

# 50. Referensi Resmi

Referensi utama:

1. Jakarta Standard Tag Library  
   https://jakarta.ee/specifications/tags/

2. Jakarta Standard Tag Library 3.0  
   https://jakarta.ee/specifications/tags/3.0/

3. Jakarta Standard Tag Library 3.0 Specification  
   https://jakarta.ee/specifications/tags/3.0/jakarta-tags-spec-3.0

4. Jakarta Tags Core Tag Docs  
   https://jakarta.ee/specifications/tags/3.0/tagdocs/c/tld-summary

5. Jakarta Tags Formatting Tag Docs  
   https://jakarta.ee/specifications/tags/3.0/tagdocs/fmt/tld-summary

6. Jakarta Standard Tag Library API Docs  
   https://jakarta.ee/specifications/tags/3.0/apidocs/

7. Jakarta EE 11 Release  
   https://jakarta.ee/release/11/

8. Jakarta Pages 4.0  
   https://jakarta.ee/specifications/pages/4.0/

9. Jakarta Expression Language 6.0  
   https://jakarta.ee/specifications/expression-language/6.0/

10. Jakarta Servlet 6.1  
    https://jakarta.ee/specifications/servlet/6.1/

---

# Penutup

Jakarta Tags adalah standard tag library untuk membuat JSP lebih bersih dan mengurangi kebutuhan scriptlet.

Mental model ringkas:

```text
JSP view
  ↓
taglib directive maps prefix to URI
  ↓
tag invocation uses handler/TLD
  ↓
EL attributes evaluated
  ↓
tag controls output/body evaluation
```

Gunakan tags untuk:

```text
output escaping
conditionals
loops
URLs
i18n
formatting
simple functions
reusable view fragments
```

Jangan gunakan tags untuk:

```text
database access
business transaction
external API calls
security policy utama
large complex rule trees
side effects penting
```

Prinsip paling penting:

```text
Jakarta Tags should make JSP cleaner, not make JSP become the application layer.
```

Engineer top-tier tahu bahwa `c:forEach` bukan sekadar loop. Ia tahu TLD, URI migration, tag handler lifecycle, tag pooling, escaping, URL safety, why SQL tags are historical baggage, dan bagaimana memodernisasi JSP legacy dengan tags tanpa memindahkan business logic ke view.

Bagian berikutnya akan membahas **Jakarta Debugging Support for Other Languages (`jakarta.debugging`)**: Source Map support, debugging non-Java languages/templates generated into Jakarta artifacts, runtime mapping, and why it matters for tooling/observability.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Bagian 28 — Jakarta Pages / JSP (`jakarta.servlet.jsp`): Translation to Servlet, Tag Libraries, EL, JSTL, dan Modern Relevance](./learn-java-jakarta-part-028.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: Bagian 30 — Jakarta Debugging Support for Other Languages: SMAP, SourceDebugExtension, Generated Code, dan Tooling-Oriented Debuggability](./learn-java-jakarta-part-030.md)
