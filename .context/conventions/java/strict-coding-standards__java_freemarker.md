# Strict Coding Standards — Java FreeMarker

## 0. Purpose

This standard defines mandatory rules for using **Apache FreeMarker** in Java applications.

It applies to HTML rendering, email templates, generated text files, configuration snippets, code generation, and any runtime/template-driven text output.

This document is a contract for LLM code agents and reviewers. It is not a tutorial.

## 1. Core Principle

FreeMarker templates must be deterministic, safe, and presentation-focused.

The Java application prepares data. The template renders data.

Templates must not become a hidden programming layer for:

- business rules,
- authorization,
- database access,
- network access,
- complex state transitions,
- unbounded iteration,
- unsafe dynamic evaluation,
- security-sensitive transformation.

## 2. Baseline References

This standard is grounded in these primary references:

- Apache FreeMarker home: https://freemarker.apache.org/
- Apache FreeMarker manual: https://freemarker.apache.org/docs/index.html
- Auto-escaping and output formats: https://freemarker.apache.org/docs/dgui_misc_autoescaping.html
- Error handling: https://freemarker.apache.org/docs/pgui_config_errorhandling.html
- Configuration API: https://freemarker.apache.org/docs/api/freemarker/template/Configuration.html
- OWASP Cross-Site Scripting Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
- OWASP Input Validation Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html

## 3. Scope

This file governs:

- `.ftl` templates,
- FreeMarker `Configuration`,
- template loaders,
- output formats,
- auto-escaping,
- template exception handling,
- model object design,
- custom directives/functions,
- template caching,
- email/HTML/text rendering,
- integration with Spring/Quarkus/servlet runtimes,
- template testing and review.

This file does not replace:

- `strict-coding-standards__java_string.md`
- `strict-coding-standards__java_json.md`
- `strict-coding-standards__java_xml.md`
- `strict-coding-standards__java_security.md`
- `strict-coding-standards__java_validation.md`
- `strict-coding-standards__java_logging.md`

## 4. Version and Dependency Rules

### 4.1 Version pinning

FreeMarker version must be pinned through Maven/Gradle dependency management.

Allowed:

```xml
<dependency>
  <groupId>org.freemarker</groupId>
  <artifactId>freemarker</artifactId>
  <version>${freemarker.version}</version>
</dependency>
```

Forbidden:

- transitive-only FreeMarker dependency;
- dynamic versions;
- multiple FreeMarker versions in one runtime;
- unreviewed framework override.

### 4.2 Centralized configuration

A FreeMarker `Configuration` object must be created centrally and treated as application infrastructure.

Do not create a new `Configuration` per request.

## 5. LLM Agent Non-Negotiable Rules

An LLM code agent MUST:

1. define the output type of the template;
2. enable context-appropriate escaping for HTML/XML outputs;
3. use `RETHROW_HANDLER` or equivalent safe error handling in production;
4. keep templates presentation-focused;
5. avoid raw output unless a trusted/sanitized type is used;
6. avoid dynamic template names from user input;
7. avoid dynamic evaluation of template fragments from user input;
8. pass explicit view models instead of domain entities;
9. add tests for escaping and missing model fields;
10. document every custom directive/function.

## 6. Allowed, Restricted, and Forbidden Constructs

| Construct | Status | Rule |
|---|---:|---|
| Central singleton `Configuration` | Allowed | Configure once at startup. |
| Auto-escaping with HTML output format | Allowed | Required for HTML templates. |
| `TemplateExceptionHandler.RETHROW_HANDLER` | Allowed | Production default. |
| DTO/view-model data model | Allowed | Must be explicit and stable. |
| Custom directives | Restricted | Presentation-only; must be tested. |
| Shared variables | Restricted | Must be immutable and infrastructure-owned. |
| `?no_esc` | Restricted | Requires trusted/sanitized content proof. |
| `?html` everywhere | Restricted | Prefer output format auto-escaping; avoid double escaping. |
| User-controlled template name | Forbidden | Must map through allow-list. |
| User-controlled template source | Forbidden | Template injection risk. |
| `TemplateExceptionHandler.DEBUG_HANDLER` in production | Forbidden | Can leak implementation details. |
| Suppressing template exceptions silently | Forbidden | Masks rendering corruption. |
| Domain entity direct rendering | Forbidden by default | Use view model. |
| Service/repository calls from template | Forbidden | Violates architecture boundary. |

## 7. Configuration Rules

### 7.1 Required configuration posture

Production configuration must define:

- template loader location;
- default encoding, normally UTF-8;
- output format per template family;
- auto-escaping policy;
- safe exception handler;
- incompatible improvements/version policy;
- template update/caching behavior;
- locale/time zone strategy;
- object wrapper policy.

Example posture:

```java
Configuration cfg = new Configuration(Configuration.VERSION_2_3_34);
cfg.setDefaultEncoding(StandardCharsets.UTF_8.name());
cfg.setTemplateExceptionHandler(TemplateExceptionHandler.RETHROW_HANDLER);
cfg.setLogTemplateExceptions(false);
cfg.setWrapUncheckedExceptions(true);
```

The exact framework integration may vary, but these decisions must exist.

### 7.2 Template loader

Template loading must use fixed, application-owned locations.

Allowed:

```text
classpath:/templates/
/WEB-INF/templates/
```

Forbidden:

- loading templates from user-writable directories;
- loading templates from request parameters;
- loading templates from URLs controlled by users;
- runtime editing of production templates without deployment governance.

### 7.3 Template name allow-list

If template selection is dynamic, it must use an allow-list.

Allowed:

```java
Map<NotificationType, String> templates = Map.of(
    NotificationType.APPROVED, "mail/application-approved.ftl",
    NotificationType.REJECTED, "mail/application-rejected.ftl"
);
```

Forbidden:

```java
cfg.getTemplate(request.getParameter("template"));
```

## 8. Output Format and Escaping Rules

### 8.1 HTML templates

HTML templates must use HTML output format and auto-escaping.

Every dynamic value is untrusted by default.

Forbidden:

```ftl
${userInput?no_esc}
```

Allowed only with trusted wrapper:

```ftl
${article.sanitizedHtml?no_esc}
```

The type/name must make sanitization explicit.

### 8.2 Text templates

Plain text templates must not assume HTML escaping.

Rules:

- email subject lines must strip/control CRLF injection;
- generated config files must escape according to target syntax;
- generated SQL/XML/JSON must use target-specific serializers where possible.

### 8.3 JavaScript/CSS contexts

Avoid placing dynamic values inside inline JavaScript or CSS.

If unavoidable:

- use JSON serialization for JavaScript values;
- use strict allow-list for CSS values;
- never use raw string concatenation.

Forbidden:

```ftl
<script>
  const name = '${user.name}';
</script>
```

Prefer:

```ftl
<script type="application/json" id="page-data">
${pageDataJson?no_esc}
</script>
```

`pageDataJson` must be produced by a JSON serializer and safe for script context.

## 9. Data Model Rules

### 9.1 Explicit view model

Templates must receive a documented model.

Preferred:

```java
record UserPageView(
    String displayName,
    List<MenuItemView> menuItems,
    boolean canEdit
) {}
```

Avoid passing:

- JPA entities;
- Hibernate proxies;
- request/session/application objects;
- service objects;
- repositories;
- arbitrary maps without schema.

### 9.2 Missing values

Templates must handle optional values deliberately.

Allowed:

```ftl
<#if user.middleName??>
  ${user.middleName}
</#if>
```

Avoid silent broad defaults that hide bugs:

```ftl
${user.middleName!''}
```

Allowed only for display fields where absence is expected.

### 9.3 Collections

Collections passed to templates must be bounded and pre-sorted if order matters.

Do not perform expensive filtering/sorting in templates.

## 10. Business Logic Boundary

Allowed template logic:

- simple conditional display;
- loop over already-prepared list;
- include layout/fragment;
- format display values using approved formatting;
- choose CSS class from precomputed status.

Forbidden template logic:

- authorization decisions;
- state transition checks;
- fee calculation;
- database lookup;
- feature flag fetch;
- remote API call;
- retry/fallback;
- complex validation.

If the template needs complex logic, introduce a view model field.

## 11. Custom Directives and Functions

Custom directives/functions are restricted.

They must:

1. be presentation-oriented;
2. have deterministic output;
3. avoid side effects;
4. avoid I/O;
5. escape output correctly;
6. be unit-tested;
7. be documented.

Allowed examples:

- pagination component;
- safe status badge;
- localized label resolver backed by immutable message source.

Forbidden examples:

- directive that queries a repository;
- directive that fetches user permissions remotely;
- directive that renders unsanitized HTML;
- directive that mutates session/request state.

## 12. Includes, Imports, and Macros

### 12.1 Includes

Includes must be static or allow-listed.

Forbidden:

```ftl
<#include request.template>
```

Allowed:

```ftl
<#include "layout/header.ftl">
```

### 12.2 Macros

Macros should be pure rendering units.

Macro parameters must be explicit. Avoid macros that depend on hidden global variables.

Allowed:

```ftl
<#macro fieldError field errors>
  <#if errors[field]??>
    <span class="error">${errors[field][0]}</span>
  </#if>
</#macro>
```

## 13. Email Template Rules

Email rendering must define:

- subject template;
- body text template;
- body HTML template, if used;
- locale;
- timezone;
- escaping mode;
- unsubscribe/footer/legal requirements if applicable.

Email subjects must protect against header injection.

Forbidden:

```java
message.setSubject(template.processToString(model));
```

unless CR/LF and control characters are handled.

## 14. Error Handling Rules

Production must not render FreeMarker debug output to users.

Use:

```java
TemplateExceptionHandler.RETHROW_HANDLER
```

or framework-equivalent behavior that:

- stops rendering on error;
- does not expose stack trace to response;
- logs safely server-side;
- returns safe error page/response.

Do not suppress errors by returning partial corrupted documents unless explicitly designed and monitored.

## 15. Security Rules

### 15.1 Template injection

User input must never become template source.

Forbidden:

```java
new Template("user", userProvidedTemplateString, cfg).process(model, writer);
```

unless this is a sandboxed admin-only template-authoring product with separate security design.

### 15.2 Unsafe object exposure

Do not expose objects that allow arbitrary method access to sensitive operations.

Forbidden model contents:

- `HttpServletRequest`,
- `HttpSession`,
- `ApplicationContext`,
- service/repository beans,
- filesystem objects,
- classloaders,
- process/runtime objects,
- secrets.

### 15.3 Secrets

Never render secrets into templates except one-time credential delivery flows with explicit approval, expiration, audit, and redaction.

## 16. Performance and Caching Rules

### 16.1 Template caching

Template caching must be configured through `Configuration` or framework settings.

Production must avoid re-parsing templates per request.

### 16.2 Model size

Do not pass huge object graphs to templates.

The model should contain only fields needed for rendering.

### 16.3 Streaming

Large generated output must be streamed to a bounded `Writer`/response pipeline where possible.

Do not render huge documents fully in memory unless bounded and justified.

## 17. Internationalization and Formatting

Locale, timezone, currency, and formatting rules must be explicit.

Follow:

- `strict-coding-standards__java_string.md`
- `strict-coding-standards__java_number.md`
- `strict-coding-standards__java_time_date.md`

Do not manually concatenate dates/money in templates when a formatter or preformatted view model is required.

## 18. Testing Requirements

Template changes require tests for:

1. successful rendering with representative model;
2. missing optional fields;
3. escaping of user-controlled values;
4. raw HTML restrictions;
5. template-not-found handling;
6. invalid model handling;
7. locale/timezone formatting;
8. generated email header safety;
9. custom directive behavior;
10. no stack trace leakage.

Tests should render actual templates, not only verify controller code.

## 19. Anti-Patterns

Forbidden anti-patterns:

- templates as business logic layer;
- templates as security decision layer;
- templates loading templates from request parameter;
- `?no_esc` as a convenience;
- debug exception handler in production;
- raw maps with undocumented keys;
- exposing domain entity graphs;
- hiding template errors with broad defaults;
- dynamic evaluation of user content;
- service/repository beans in model.

## 20. Reviewer Checklist

A reviewer must reject FreeMarker changes if:

- output format/escaping is unclear;
- user input can become template source/name;
- raw output is used without trusted content proof;
- model exposes services, requests, sessions, entities, or secrets;
- template performs business/security/data-access logic;
- production error handling leaks details;
- includes are dynamic without allow-list;
- custom directives are untested;
- large output is unbounded;
- tests do not render templates with malicious strings.

## 21. LLM Prompt Contract

When implementing FreeMarker code, the LLM agent must follow this contract:

```text
Use FreeMarker only for rendering, not business logic.
Configure FreeMarker centrally with explicit encoding, output format, auto-escaping, and safe error handling.
Use explicit view models.
Do not expose services, repositories, request/session objects, entities, classloaders, or secrets to templates.
Do not use user input as template source or template name.
Do not use ?no_esc unless the value is a trusted/sanitized content type and the reason is documented.
Add tests that render the actual template and verify escaping, missing fields, and error behavior.
```

## 22. Final Rule

A FreeMarker template may be expressive, but it must not be powerful enough to damage the system.

If rendering requires hidden computation, hidden state, or unsafe output, move that responsibility back into typed Java code.
