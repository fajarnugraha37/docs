# Strict Coding Standards — Java jte

## 0. Purpose

This standard defines mandatory rules for using **jte — Java Template Engine** in Java and Kotlin-compatible Java server applications.

It applies to server-rendered HTML, layout templates, fragments, emails, and any jte-based text rendering.

This document is a contract for LLM code agents and reviewers. It is not a tutorial.

## 1. Core Principle

jte templates are compiled templates and should behave like type-checked view code.

Use jte when you want:

- typed template parameters,
- compile-time feedback,
- low template runtime overhead,
- Java/Kotlin-friendly rendering,
- explicit template contracts.

Do not use jte as a place to hide business logic, service calls, data access, or security decisions.

## 2. Baseline References

This standard is grounded in these primary references:

- jte official documentation: https://jte.gg/
- jte HTML rendering documentation: https://jte.gg/html-rendering/
- jte GitHub repository: https://github.com/casid/jte
- jte runtime API: https://javadoc.io/doc/gg.jte/jte-runtime/latest/index.html
- OWASP Cross-Site Scripting Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
- OWASP Input Validation Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html

## 3. Scope

This file governs:

- `.jte` and `.kte` templates,
- template parameters,
- layout/content patterns,
- HTML escaping,
- raw content,
- template engine configuration,
- precompilation,
- production deployment,
- Spring Boot/Javalin/Quarkus/plain servlet integration,
- template testing and review.

This file does not replace:

- `strict-coding-standards__java_string.md`
- `strict-coding-standards__java_json.md`
- `strict-coding-standards__java_http.md`
- `strict-coding-standards__java_security.md`
- `strict-coding-standards__java_validation.md`
- `strict-coding-standards__java_logging.md`

## 4. Version and Dependency Rules

### 4.1 Version pinning

jte version must be pinned in dependency management.

Forbidden:

- dynamic versions;
- multiple jte runtime versions;
- precompile plugin and runtime version mismatch;
- relying on transitive jte dependency from web framework without review.

### 4.2 Runtime and plugin alignment

If precompilation is used, the jte Gradle/Maven plugin and runtime dependency must be compatible.

The build must fail if templates do not compile.

## 5. LLM Agent Non-Negotiable Rules

An LLM code agent MUST:

1. use explicit typed template parameters;
2. use `ContentType.Html` for HTML rendering;
3. rely on automatic escaping for normal dynamic values;
4. avoid raw content unless the value is trusted and documented;
5. keep templates presentation-focused;
6. avoid service/repository/database/network calls inside templates;
7. precompile templates for production when the framework/build supports it;
8. add tests that render templates with malicious input;
9. keep layout/content contracts explicit;
10. never bypass escaping as a convenience.

## 6. Allowed, Restricted, and Forbidden Constructs

| Construct | Status | Rule |
|---|---:|---|
| Typed `@param` template parameters | Allowed | Required for template contract. |
| `ContentType.Html` | Allowed | Required for HTML output. |
| Layout templates with `Content` | Allowed | Must keep layout contract explicit. |
| Conditionals/loops for display | Allowed | Must be simple and bounded. |
| Precompiled templates | Allowed | Preferred for production. |
| Runtime template loading | Restricted | Allowed mainly for development or controlled plugin systems. |
| Java code in template | Restricted | Presentation logic only. |
| Raw/unsafe content rendering | Restricted | Only trusted/sanitized values. |
| `ContentType.Plain` for HTML | Forbidden | No HTML output escaping. |
| Service/repository call in template | Forbidden | Violates architecture boundary. |
| User-controlled template name | Forbidden | Must map through allow-list. |
| User-controlled template source | Forbidden | Template injection risk. |
| Direct domain entity rendering | Forbidden by default | Use view model. |

## 7. Template Contract Rules

### 7.1 Explicit parameters

Each template must declare its required inputs using typed parameters.

Allowed:

```jte
@param com.example.view.UserPage page
@param java.util.List<com.example.view.MenuItem> menuItems
```

Avoid unstructured maps as primary template model.

Forbidden by default:

```java
Map<String, Object> model
```

unless integrating with a framework boundary that cannot provide typed models.

### 7.2 View models

Pass view models, not entities.

Preferred:

```java
record UserProfileView(
    String displayName,
    String email,
    boolean canEdit,
    List<LinkView> actions
) {}
```

Forbidden by default:

- JPA entities;
- Hibernate proxies;
- request/session objects;
- repository/service objects;
- security principal with sensitive internals;
- large aggregate graphs.

### 7.3 Optional values

Optional rendering behavior must be explicit.

Prefer a view model that already resolves absence:

```java
record UserProfileView(String displayName, Optional<String> phoneNumber) {}
```

Do not rely on templates to guess business defaults.

## 8. HTML Rendering and Escaping Rules

### 8.1 Use HTML content type

For HTML pages, the template engine must be configured with HTML content type.

`ContentType.Html` is required so jte can apply context-sensitive output escaping.

Forbidden:

```java
TemplateEngine.createPrecompiled(ContentType.Plain);
```

for HTML output.

### 8.2 Default dynamic output

Normal dynamic output must use automatic escaping.

Allowed:

```jte
<h1>${page.title}</h1>
```

Do not pre-escape strings before passing them to jte unless the type explicitly represents encoded text. Pre-escaping can cause double escaping or broken output.

### 8.3 Raw content

Raw content is restricted.

Allowed only when all are true:

1. content was sanitized by approved server-side policy;
2. Java type/name communicates trust, such as `TrustedHtml` or `SanitizedHtml`;
3. template line is reviewed;
4. XSS test covers it.

Forbidden:

```jte
@raw(userProvidedHtml)
```

Restricted:

```jte
@raw(article.sanitizedBody().html())
```

## 9. Java Code in Templates

jte allows Java-like code, but this must stay in presentation boundaries.

Allowed:

```jte
@if(page.canEdit())
  <a href="${page.editUrl()}">Edit</a>
@endif
```

Restricted:

```jte
@for(var item : page.items())
  ...
@endfor
```

Only for bounded, precomputed collections.

Forbidden:

```jte
@{ var user = userService.findById(id); }
```

Forbidden operations inside templates:

- service calls;
- repository calls;
- JDBC/JPA/Hibernate calls;
- HTTP calls;
- file I/O;
- thread creation;
- transaction control;
- authorization checks beyond rendering already-computed flags;
- mutation of application state.

## 10. Layout and Content Rules

### 10.1 Layout templates

Layouts must define explicit content slots.

Preferred pattern:

```jte
@param gg.jte.Content content
@param com.example.view.LayoutView layout
<!doctype html>
<html>
  <head><title>${layout.title()}</title></head>
  <body>
    ${content}
  </body>
</html>
```

### 10.2 Fragments

Fragments must be reusable presentation units with typed parameters.

Allowed:

- pagination fragment;
- field error fragment;
- status badge fragment;
- layout/sidebar fragment.

Forbidden:

- fragment that queries current user permissions;
- fragment that performs database lookup;
- fragment that mutates session state.

## 11. Template Name and Loading Rules

### 11.1 Fixed or allow-listed template names

Template names must be compile-time constants or allow-listed.

Allowed:

```java
String template = switch (notificationType) {
    case APPROVED -> "mail/application-approved.jte";
    case REJECTED -> "mail/application-rejected.jte";
};
```

Forbidden:

```java
engine.render(request.getParameter("template"), model, output);
```

### 11.2 User-provided templates

User-provided template source is forbidden unless the system is explicitly a sandboxed template-authoring product.

That requires separate security design and is outside this standard.

## 12. Precompilation and Deployment Rules

### 12.1 Production precompilation

Production should use precompiled templates when supported.

Benefits:

- templates fail during build instead of first request;
- better startup/runtime characteristics;
- safer deployment artifact;
- stronger review signal.

### 12.2 Development mode

Development runtime compilation is allowed only in local/dev profiles.

It must not be accidentally enabled in production.

### 12.3 CI gate

CI must compile templates and fail if any template breaks.

Template compilation is part of build correctness.

## 13. Forms and HTTP Boundary

State-changing forms must include framework-backed CSRF protection.

Hidden fields are untrusted.

Server-side handlers must revalidate:

- identity,
- authorization,
- object ownership,
- workflow state,
- request freshness,
- idempotency if needed.

The template may render fields. It must not make security decisions.

## 14. Internationalization and Formatting

Locale/timezone/currency must be resolved before rendering or passed explicitly through a view model.

Follow:

- `strict-coding-standards__java_string.md`
- `strict-coding-standards__java_number.md`
- `strict-coding-standards__java_time_date.md`

Do not manually concatenate date/money strings inside templates.

## 15. Email Template Rules

For email templates:

- separate subject, text body, and HTML body contracts;
- protect subject against CRLF/header injection;
- use HTML escaping for HTML body;
- avoid remote resources unless approved;
- include unsubscribe/legal/footer requirements where applicable;
- test both plain text and HTML variants.

## 16. Error Handling Rules

Rendering errors must:

- fail the request or job cleanly;
- log template name and correlation ID;
- not leak stack traces to the client;
- not send partially corrupted security-sensitive documents;
- be observable.

Do not catch and ignore rendering exceptions.

## 17. Performance Rules

Templates must not perform expensive computation.

Forbidden:

- sorting large collections in template;
- filtering large collections in template;
- nested loops over large collections;
- CPU-heavy formatting in template;
- per-row service call;
- loading data lazily from entity graph.

Prepare data in Java code before rendering.

## 18. Security Rules

### 18.1 XSS

Treat all dynamic strings as untrusted. Rely on `ContentType.Html` escaping for normal HTML output.

Do not bypass escaping without trusted type proof.

### 18.2 Template injection

Do not let users control template source or template name.

### 18.3 Secrets

Do not pass secrets into template models unless the use case is explicitly a one-time secret delivery flow with audit and expiration.

### 18.4 Inline JavaScript

Avoid inline JavaScript with dynamic values.

If required, pass JSON generated by a real JSON serializer and render it into safe script context with review.

## 19. Testing Requirements

Template changes require tests for:

1. template compilation;
2. successful rendering with representative model;
3. malicious text escaping;
4. raw content restrictions;
5. missing/optional values;
6. layout/fragment composition;
7. forms/CSRF rendering where applicable;
8. locale/timezone/money formatting;
9. email subject CRLF safety;
10. no stack trace leakage on rendering failure.

## 20. Anti-Patterns

Forbidden anti-patterns:

- `ContentType.Plain` for HTML pages;
- `@raw` for convenience;
- service/repository calls in templates;
- passing entities or large aggregate roots;
- user-controlled template names;
- runtime template compilation in production by accident;
- templates as business logic layer;
- hidden authorization logic in template;
- untested fragments;
- ignoring render exceptions.

## 21. Reviewer Checklist

A reviewer must reject jte changes if:

- HTML rendering does not use `ContentType.Html`;
- template parameters are not explicit;
- raw output is used without trusted/sanitized content proof;
- template calls service/repository/database/network;
- dynamic template names are not allow-listed;
- production precompilation/build validation is absent without reason;
- entities/proxies/secrets are passed to templates;
- tests do not render the template with malicious input;
- inline JS/CSS contains dynamic untrusted values.

## 22. LLM Prompt Contract

When implementing jte code, the LLM agent must follow this contract:

```text
Use jte as a typed rendering layer only.
Declare explicit @param values and pass view models, not entities or services.
Use ContentType.Html for HTML rendering.
Rely on automatic escaping for normal dynamic values.
Do not use raw output unless the value is a trusted/sanitized content type and the reason is documented.
Do not use user input as template name or template source.
Precompile templates in production when supported.
Add tests that compile/render actual templates and verify escaping, layout behavior, and failure handling.
```

## 23. Final Rule

jte gives templates stronger type-safety. Do not waste that advantage by smuggling untyped maps, raw HTML, or business logic into the view layer.
