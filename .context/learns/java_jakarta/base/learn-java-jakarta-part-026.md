# learn-java-jakarta-part-026.md

# Bagian 26 — Jakarta Faces (`jakarta.faces`): Component-Based Server-Side UI, Lifecycle, State, Validation, Ajax, dan Modern Relevance

> Target pembaca: Java engineer yang ingin memahami Jakarta Faces / JSF bukan sebagai “framework UI lama”, tetapi sebagai **server-side component-based web framework** dengan lifecycle yang sangat spesifik: component tree, view state, request processing phases, conversion, validation, model update, action invocation, navigation, templating, Ajax partial rendering, CDI backing beans, dan state management.
>
> Fokus bagian ini: Jakarta Faces 4.1 di Jakarta EE 11, mental model component tree, Facelets, lifecycle phases, managed state, view scoped bean, forms, converters/validators, messages, navigation, Ajax, composite components, templates, resource handling, security, performance, testing, migration, and production failure modes.

---

## Daftar Isi

1. [Orientasi: Kenapa Masih Perlu Memahami Jakarta Faces?](#1-orientasi-kenapa-masih-perlu-memahami-jakarta-faces)
2. [Mental Model: Server-Side Component Framework](#2-mental-model-server-side-component-framework)
3. [Jakarta Faces 4.1 dalam Jakarta EE 11](#3-jakarta-faces-41-dalam-jakarta-ee-11)
4. [Faces vs Servlet vs Jakarta REST vs SPA Framework](#4-faces-vs-servlet-vs-jakarta-rest-vs-spa-framework)
5. [Dependency, Runtime, dan Packaging](#5-dependency-runtime-dan-packaging)
6. [Peta API dan Namespace `jakarta.faces`](#6-peta-api-dan-namespace-jakartafaces)
7. [Facelets: View Declaration Language](#7-facelets-view-declaration-language)
8. [Component Tree: Inti Mental Model Faces](#8-component-tree-inti-mental-model-faces)
9. [View State: Server-Side vs Client-Side State](#9-view-state-server-side-vs-client-side-state)
10. [Faces Lifecycle: 6 Phases](#10-faces-lifecycle-6-phases)
11. [Restore View Phase](#11-restore-view-phase)
12. [Apply Request Values Phase](#12-apply-request-values-phase)
13. [Process Validations Phase](#13-process-validations-phase)
14. [Update Model Values Phase](#14-update-model-values-phase)
15. [Invoke Application Phase](#15-invoke-application-phase)
16. [Render Response Phase](#16-render-response-phase)
17. [Immediate, Validation Short-Circuit, dan Lifecycle Edge Cases](#17-immediate-validation-short-circuit-dan-lifecycle-edge-cases)
18. [Backing Bean dengan CDI](#18-backing-bean-dengan-cdi)
19. [Scopes: Request, View, Session, Application, Conversation](#19-scopes-request-view-session-application-conversation)
20. [Forms dan Input Components](#20-forms-dan-input-components)
21. [Conversion](#21-conversion)
22. [Validation](#22-validation)
23. [Messages dan Error Display](#23-messages-dan-error-display)
24. [Action, ActionListener, ValueChangeListener](#24-action-actionlistener-valuechangelistener)
25. [Navigation](#25-navigation)
26. [Ajax dan Partial Page Rendering](#26-ajax-dan-partial-page-rendering)
27. [Templating dengan Facelets](#27-templating-dengan-facelets)
28. [Composite Components](#28-composite-components)
29. [Resource Handling: CSS, JS, Images](#29-resource-handling-css-js-images)
30. [Data Tables dan Repeated Components](#30-data-tables-dan-repeated-components)
31. [Events dan Lifecycle Hooks](#31-events-dan-lifecycle-hooks)
32. [Internationalization dan Accessibility](#32-internationalization-dan-accessibility)
33. [Security: CSRF, XSS, Authorization, View State](#33-security-csrf-xss-authorization-view-state)
34. [Performance Engineering](#34-performance-engineering)
35. [State Saving Pitfalls](#35-state-saving-pitfalls)
36. [Integration dengan CDI, Bean Validation, JPA, Security](#36-integration-dengan-cdi-bean-validation-jpa-security)
37. [Modern Relevance: Kapan Faces Masih Masuk Akal?](#37-modern-relevance-kapan-faces-masih-masuk-akal)
38. [Migration: JSF/Jakarta Faces Legacy ke Modern Jakarta](#38-migration-jsfjakarta-faces-legacy-ke-modern-jakarta)
39. [Testing Strategy](#39-testing-strategy)
40. [Observability dan Debugging](#40-observability-dan-debugging)
41. [Production Failure Modes](#41-production-failure-modes)
42. [Best Practices dan Anti-Patterns](#42-best-practices-dan-anti-patterns)
43. [Checklist Review](#43-checklist-review)
44. [Case Study 1: Internal Admin CRUD yang Cocok untuk Faces](#44-case-study-1-internal-admin-crud-yang-cocok-untuk-faces)
45. [Case Study 2: View State Membengkak](#45-case-study-2-view-state-membengkak)
46. [Case Study 3: Validation Tidak Jalan karena Lifecycle Salah Dipahami](#46-case-study-3-validation-tidak-jalan-karena-lifecycle-salah-dipahami)
47. [Case Study 4: Session Scope Membuat Memory Leak](#47-case-study-4-session-scope-membuat-memory-leak)
48. [Latihan Bertahap](#48-latihan-bertahap)
49. [Mini Project: Jakarta Faces Lifecycle Lab](#49-mini-project-jakarta-faces-lifecycle-lab)
50. [Referensi Resmi](#50-referensi-resmi)

---

# 1. Orientasi: Kenapa Masih Perlu Memahami Jakarta Faces?

Jakarta Faces, yang dulu dikenal sebagai JavaServer Faces / JSF, adalah server-side UI framework.

Banyak tim modern memakai:

- REST + React/Vue/Angular;
- server-side rendered MVC;
- HTMX;
- template engine;
- mobile-first APIs.

Jadi kenapa masih belajar Faces?

Karena di enterprise Java, kamu masih akan menemukan:

- internal admin systems;
- government back-office apps;
- legacy Java EE applications;
- PrimeFaces/OmniFaces ecosystems;
- form-heavy workflows;
- server-rendered portals;
- applications where Java team owns UI and backend together.

Selain itu, Faces mengajarkan mental model penting:

```text
UI is not just HTML string.
UI can be a stateful component tree with lifecycle.
```

## 1.1 Faces bukan Servlet biasa

Servlet biasanya:

```text
request in → code runs → response out
```

Faces:

```text
request in
  ↓
restore component tree
  ↓
apply request values
  ↓
convert/validate
  ↓
update backing bean
  ↓
invoke action
  ↓
render component tree
```

Jika kamu tidak paham lifecycle, bug-nya terasa “magis”.

## 1.2 Faces bukan SPA

SPA menyimpan banyak state di browser.

Faces menyimpan/rekonstruksi component tree dan state server-side/client-side.

## 1.3 Faces cocok untuk apa?

Faces bisa cocok untuk:

- internal CRUD admin;
- complex form workflows;
- server-side validation-heavy UI;
- enterprise apps dengan Java full-stack team;
- apps yang ingin component library matang seperti PrimeFaces;
- apps dengan accessibility/internationalization server-side.

## 1.4 Faces kurang cocok untuk apa?

Kurang cocok untuk:

- public high-scale consumer UI yang butuh frontend-rich interaction;
- offline-first apps;
- mobile app API;
- microfrontend ecosystem;
- highly interactive client-side state apps;
- systems where frontend and backend teams independent.

## 1.5 Top-tier perspective

Top-tier engineer tidak merendahkan teknologi karena “lama”.

Ia bertanya:

```text
What problem does this abstraction solve?
What trade-offs does it introduce?
Where does it fit today?
What are its failure modes?
```

---

# 2. Mental Model: Server-Side Component Framework

Faces adalah component-based MVC framework untuk web UI.

## 2.1 Component

UI terdiri dari components:

```xml
<h:inputText value="#{userForm.name}" />
<h:commandButton value="Save" action="#{userForm.save}" />
```

Ini bukan hanya HTML.

Setiap tag menghasilkan server-side UI component object.

## 2.2 Component tree

Faces membangun tree:

```text
UIViewRoot
  └── HtmlForm
      ├── HtmlInputText
      ├── HtmlMessage
      └── HtmlCommandButton
```

Component tree diproses sepanjang lifecycle.

## 2.3 Backing bean

Backing bean menyimpan model/action untuk view.

```java
@Named
@ViewScoped
public class UserForm implements Serializable {
    private String name;

    public String save() {
        ...
        return "success";
    }
}
```

## 2.4 Lifecycle

Faces lifecycle memproses request dalam phases.

Ini membedakan Faces dari template engine sederhana.

## 2.5 State

Faces perlu menyimpan view state agar postback bisa merekonstruksi tree dan component values.

## 2.6 Rendering

Renderer mengubah component tree menjadi HTML.

## 2.7 Event-driven server-side UI

Button click, value change, Ajax event diproses sebagai server-side events.

## 2.8 Why this matters

Bug Faces sering terjadi karena developer berpikir:

```text
HTML form submit directly sets Java fields
```

Padahal ada conversion, validation, model update, action, rendering phases.

---

# 3. Jakarta Faces 4.1 dalam Jakarta EE 11

Jakarta Faces 4.1 adalah release untuk Jakarta EE 11.

Jakarta Faces mendefinisikan MVC framework untuk membangun user interfaces untuk web applications, termasuk:

- UI components;
- state management;
- event handling;
- input validation;
- page navigation;
- internationalization;
- accessibility.

## 3.1 Nama

Dulu:

```text
JavaServer Faces / JSF
```

Sekarang:

```text
Jakarta Faces
```

## 3.2 Package modern

```java
jakarta.faces
```

Bukan:

```java
javax.faces
```

## 3.3 Faces 4.1 changes

Faces 4.1:

- release untuk Jakarta EE 11;
- menghapus referensi SecurityManager;
- lebih aligned dengan CDI;
- menyediakan small enhancements and clarifications.

## 3.4 Faces 5.0

Faces 5.0 under development untuk Jakarta EE 12.

Target kita di seri ini: Jakarta EE 11 / Faces 4.1.

## 3.5 Faces dan Jakarta EE profiles

Jakarta Faces ada di Web Profile dan Platform.

Ini penting karena Faces adalah web UI framework.

---

# 4. Faces vs Servlet vs Jakarta REST vs SPA Framework

## 4.1 Servlet

Low-level request/response.

```java
doGet(req, resp)
```

Kamu mengelola HTML sendiri.

## 4.2 Faces

Server-side component UI.

```xml
<h:form>
  <h:inputText value="#{bean.name}" />
</h:form>
```

Container/framework mengelola lifecycle.

## 4.3 Jakarta REST

Resource API.

```java
@GET
@Path("/users/{id}")
public UserDto get(...) {}
```

Biasanya untuk JSON/API, bukan server-side component UI.

## 4.4 SPA

Client-side app:

```text
browser runs React/Vue/Angular
backend exposes REST/GraphQL
```

State banyak di client.

## 4.5 Decision table

| Need | Good fit |
|---|---|
| Low-level HTTP handling | Servlet |
| JSON API | Jakarta REST |
| Server-side enterprise forms | Faces |
| Rich client-side UI | SPA |
| Simple server template | MVC/template engine |
| Admin CRUD with component library | Faces/PrimeFaces |
| Mobile app backend | REST/GraphQL |
| Realtime bidirectional | WebSocket |

## 4.6 Faces trade-off

Pros:

- rapid form UI;
- server-side validation/conversion;
- component library;
- integrated with Jakarta EE;
- less frontend build complexity;
- good for internal apps.

Cons:

- lifecycle complexity;
- state management overhead;
- harder to scale statelessly;
- less natural for modern frontend teams;
- Ajax abstraction can hide HTTP details;
- large component tree performance pitfalls.

---

# 5. Dependency, Runtime, dan Packaging

## 5.1 Maven API dependency

If needed:

```xml
<dependency>
  <groupId>jakarta.faces</groupId>
  <artifactId>jakarta.faces-api</artifactId>
  <version>4.1.0</version>
  <scope>provided</scope>
</dependency>
```

Many runtimes provide Faces API/implementation.

## 5.2 Implementation

API jar is not enough.

Need implementation such as:

- Eclipse Mojarra;
- Apache MyFaces;
- runtime-provided Faces implementation.

## 5.3 WAR packaging

Typical:

```text
app.war
  index.xhtml
  WEB-INF/
    web.xml
    faces-config.xml
    templates/
  resources/
    css/
    js/
```

## 5.4 Faces servlet mapping

Faces requests are processed by FacesServlet.

Example `web.xml`:

```xml
<servlet>
  <servlet-name>Faces Servlet</servlet-name>
  <servlet-class>jakarta.faces.webapp.FacesServlet</servlet-class>
  <load-on-startup>1</load-on-startup>
</servlet>

<servlet-mapping>
  <servlet-name>Faces Servlet</servlet-name>
  <url-pattern>*.xhtml</url-pattern>
</servlet-mapping>
```

Modern runtimes may auto-map depending configuration.

## 5.5 Facelets files

Use `.xhtml`.

## 5.6 Context params

Important context params include:

- project stage;
- state saving method;
- facelets refresh period;
- partial state saving;
- client window mode.

Names/values depend spec/runtime.

## 5.7 Third-party component libraries

Common:

- PrimeFaces;
- OmniFaces;
- BootsFaces;
- others.

Evaluate compatibility with Faces 4.1/Jakarta namespace.

---

# 6. Peta API dan Namespace `jakarta.faces`

Important packages:

```text
jakarta.faces.application
jakarta.faces.component
jakarta.faces.context
jakarta.faces.convert
jakarta.faces.validator
jakarta.faces.event
jakarta.faces.lifecycle
jakarta.faces.render
jakarta.faces.view
jakarta.faces.view.facelets
jakarta.faces.webapp
```

## 6.1 `jakarta.faces.context`

Core request context:

- `FacesContext`;
- `ExternalContext`;
- `PartialViewContext`.

## 6.2 `jakarta.faces.component`

UI component classes:

- `UIComponent`;
- `UIViewRoot`;
- `UIInput`;
- `UICommand`;
- `UIData`;
- `UIOutput`.

## 6.3 `jakarta.faces.application`

Application-level classes:

- `Application`;
- `FacesMessage`;
- `NavigationHandler`;
- `ResourceHandler`;
- `ViewHandler`.

## 6.4 `jakarta.faces.convert`

Converters.

## 6.5 `jakarta.faces.validator`

Validators.

## 6.6 `jakarta.faces.event`

Lifecycle/events.

## 6.7 `jakarta.faces.view`

View-scoped and view declaration related.

## 6.8 `jakarta.faces.webapp`

FacesServlet and web integration.

---

# 7. Facelets: View Declaration Language

Facelets is the default View Declaration Language for Faces.

It uses XHTML-like files.

## 7.1 Basic page

```xml
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:h="jakarta.faces.html">
<h:head>
    <title>Hello Faces</title>
</h:head>
<h:body>
    <h:form>
        <h:outputText value="Hello #{helloBean.name}" />
    </h:form>
</h:body>
</html>
```

## 7.2 Tag libraries

Common namespaces:

```xml
xmlns:h="jakarta.faces.html"
xmlns:f="jakarta.faces.core"
xmlns:ui="jakarta.faces.facelets"
xmlns:cc="jakarta.faces.composite"
```

Some older code uses legacy namespace URIs.

Migration may require updating.

## 7.3 HTML passthrough

Faces supports pass-through attributes/elements for HTML5 integration.

## 7.4 Facelets is not JSP

Old JSF used JSP in early versions.

Modern Faces uses Facelets.

## 7.5 Templates

Facelets supports:

- `ui:composition`;
- `ui:define`;
- `ui:insert`;
- `ui:include`;
- `ui:decorate`.

## 7.6 View build time vs request time

Facelets builds component tree, not simply emits HTML.

This is key.

---

# 8. Component Tree: Inti Mental Model Faces

Faces page is a component tree.

## 8.1 Example view

```xml
<h:form id="form">
    <h:inputText id="name" value="#{userForm.name}" required="true" />
    <h:message for="name" />
    <h:commandButton value="Save" action="#{userForm.save}" />
</h:form>
```

## 8.2 Component tree

```text
UIViewRoot
  └── form
      ├── name input
      ├── message
      └── command button
```

## 8.3 Component IDs

Component IDs generate client IDs.

Example:

```html
<input id="form:name" name="form:name" ...>
```

## 8.4 Naming container

Forms/tables/components can be naming containers, affecting client ID.

## 8.5 Why IDs matter

Ajax update/render targets use component IDs.

Debugging Faces often means understanding client ID.

## 8.6 Component local value

Input components have local submitted/converted values before model update.

This explains why bean property may not change if validation fails.

## 8.7 Tree restoration

On postback, Faces restores previous tree using view state.

## 8.8 Dynamic components

If you build dynamic components, ensure stable IDs/tree structure.

Otherwise view state restore fails.

---

# 9. View State: Server-Side vs Client-Side State

Faces needs view state across postbacks.

## 9.1 Hidden field

Rendered page contains hidden view state field.

Example concept:

```html
<input type="hidden" name="jakarta.faces.ViewState" value="..." />
```

## 9.2 Server-side state saving

Server stores state, client gets token/reference.

Pros:

- smaller client payload;
- less exposure.

Cons:

- server memory/session usage;
- cluster replication issue.

## 9.3 Client-side state saving

Client carries serialized/encrypted/signed state.

Pros:

- less server memory;
- more stateless-ish.

Cons:

- larger payload;
- security must be strong;
- bandwidth cost.

## 9.4 Partial state saving

Faces stores delta/partial state to reduce size.

## 9.5 View state is not business state

Do not rely on view state for important domain state.

Business state belongs in database.

## 9.6 Common problem

Large data table in view state makes page huge or session memory high.

## 9.7 Security

Client-side state must be protected from tampering.

Use runtime secure configuration.

## 9.8 Cluster

Server-side view state in session requires sticky session or session replication.

---

# 10. Faces Lifecycle: 6 Phases

Faces lifecycle is central.

Typical phases:

1. Restore View
2. Apply Request Values
3. Process Validations
4. Update Model Values
5. Invoke Application
6. Render Response

## 10.1 Full lifecycle

```text
Request
  ↓
Restore View
  ↓
Apply Request Values
  ↓
Process Validations
  ↓
Update Model Values
  ↓
Invoke Application
  ↓
Render Response
```

## 10.2 Initial request

For first GET, Faces builds view and renders response.

No form values to process.

## 10.3 Postback

For form submit/Ajax postback, Faces restores previous view and processes submitted values.

## 10.4 Lifecycle can short-circuit

If validation fails:

```text
Render Response
```

happens early, skipping model update and action invocation.

## 10.5 Why actions don't fire?

Often because:

- validation failed;
- conversion failed;
- component not processed;
- wrong form;
- button immediate behavior;
- Ajax execute doesn't include input/button;
- view expired;
- disabled component not submitted.

## 10.6 Debug lifecycle

Log phases or use PhaseListener.

---

# 11. Restore View Phase

## 11.1 What happens?

Faces obtains or builds view/component tree.

Initial request:

```text
create new UIViewRoot/component tree
```

Postback:

```text
restore previous component tree from view state
```

## 11.2 View metadata

Metadata like `f:metadata` and view actions may be processed.

## 11.3 View expired

If server-side view state missing:

```text
ViewExpiredException
```

Causes:

- session expired;
- view state evicted;
- cluster node mismatch;
- redeploy;
- user old tab.

## 11.4 Stable component tree

Dynamic includes/components must be stable between render and postback.

## 11.5 Initial GET

Use GET params and view actions carefully.

## 11.6 Common bug

Conditional rendering changes component tree before postback restoration.

## 11.7 Fix

Use stable IDs and deterministic component structure.

---

# 12. Apply Request Values Phase

## 12.1 What happens?

Components decode request parameters.

Input component gets submitted value.

```text
HTTP parameter → component submittedValue
```

## 12.2 Model not updated yet

At this phase, bean property is not necessarily updated.

## 12.3 Action source decoded

Buttons/links determine which action submitted.

## 12.4 `immediate=true`

Immediate components can be processed earlier.

Useful but often misunderstood.

## 12.5 Ajax execute

Only components included in Ajax execute/process are decoded/processed.

Example:

```xml
<f:ajax execute="@this name" render="messages" />
```

## 12.6 Disabled/read-only input

Disabled input may not submit value.

## 12.7 Multiple forms

Only submitted form sends its values.

---

# 13. Process Validations Phase

## 13.1 Conversion first

String submitted values convert to target types.

Example:

```text
"2026-06-12" → LocalDate
```

## 13.2 Validation next

Validators run after successful conversion.

## 13.3 Required validation

```xml
<h:inputText value="#{bean.name}" required="true" />
```

## 13.4 Bean Validation

Faces integrates with Jakarta Validation.

```java
@NotBlank
private String name;
```

## 13.5 Failure

On conversion/validation failure:

- message added;
- component invalid;
- lifecycle jumps to Render Response;
- Update Model Values skipped;
- action skipped.

## 13.6 Why bean still old?

Because invalid component does not update model.

## 13.7 Custom validator

```java
@FacesValidator
public class UsernameValidator implements Validator<String> {
    @Override
    public void validate(FacesContext context, UIComponent component, String value) {
        ...
    }
}
```

## 13.8 Avoid DB-heavy validation per keystroke

Ajax validation can trigger often.

Cache/throttle or validate on submit.

---

# 14. Update Model Values Phase

## 14.1 What happens?

Converted and validated component values are written to backing bean properties.

```text
component localValue → bean property
```

## 14.2 Only valid components update

Invalid components do not update model.

## 14.3 Setter called

Bean setters may be invoked.

Avoid heavy business logic in setters.

## 14.4 Type safety

If converter wrong, update fails.

## 14.5 Common bug

Developer expects action to see submitted value, but validation failure prevents update.

## 14.6 Avoid side effects in setters

Setter should assign value.

Business work belongs in action/service.

## 14.7 Model update precedes action

Action method sees updated model if validation succeeds.

---

# 15. Invoke Application Phase

## 15.1 What happens?

Action methods/listeners execute.

```xml
<h:commandButton value="Save" action="#{userForm.save}" />
```

```java
public String save() {
    service.save(model);
    return "list?faces-redirect=true";
}
```

## 15.2 Action return

Return string can be navigation outcome.

## 15.3 Void action

Can stay on same view.

## 15.4 Business service call

This phase is where application use case usually runs.

## 15.5 Transaction boundary

Action method/backing bean may call `@Transactional` service.

Avoid putting transaction-heavy logic in view bean directly.

## 15.6 Exceptions

Handle expected domain errors and show messages.

Unexpected errors go to error page/log.

## 15.7 Navigation

Faces determines next view/outcome.

---

# 16. Render Response Phase

## 16.1 What happens?

Component tree renders HTML response.

## 16.2 Messages displayed

Messages added during lifecycle are rendered by:

```xml
<h:messages />
<h:message for="field" />
```

## 16.3 State saved

Faces saves view state for future postback.

## 16.4 Ajax render

For Ajax request, only partial response for target components may be rendered.

## 16.5 Rendered attribute

```xml
<h:panelGroup rendered="#{bean.showDetails}">
```

If `rendered=false`, component may not participate as expected.

## 16.6 Encoding

Use proper charset.

## 16.7 Performance

Rendering large trees/tables can be expensive.

---

# 17. Immediate, Validation Short-Circuit, dan Lifecycle Edge Cases

## 17.1 `immediate=true`

Can cause component/action to be processed earlier.

Common for cancel button:

```xml
<h:commandButton value="Cancel"
                 action="#{bean.cancel}"
                 immediate="true" />
```

This can skip validation of other fields.

## 17.2 Misuse

Using `immediate=true` to “fix” broken lifecycle can hide real issue.

## 17.3 Ajax execute/render

Common bug:

```xml
<f:ajax render="result" />
```

but forgot:

```xml
execute="@form"
```

Only `@this` may be processed by default depending tag/component.

## 17.4 Multiple forms

A button in one form won't submit fields in another form.

## 17.5 `rendered=false`

Components not rendered may not be in tree/processed as expected.

## 17.6 Validation failure skips action

If action not called, inspect messages/conversion errors.

## 17.7 ViewExpiredException

Old tab or session expiration.

Handle gracefully.

---

# 18. Backing Bean dengan CDI

Modern Faces uses CDI managed beans.

## 18.1 Basic bean

```java
@Named
@RequestScoped
public class HelloBean {
    private String name;

    public String greet() {
        return "Hello " + name;
    }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }
}
```

## 18.2 Access in Facelets

```xml
<h:inputText value="#{helloBean.name}" />
<h:commandButton value="Greet" action="#{helloBean.greet}" />
```

## 18.3 Avoid old managed bean annotations

Old JSF managed bean model is removed/deprecated in modern Faces.

Use CDI:

```java
@Named
```

## 18.4 Serializable for passivating scopes

View/session scoped beans often need `Serializable`.

```java
@Named
@ViewScoped
public class UserForm implements Serializable {
}
```

## 18.5 Keep backing bean thin

Backing bean coordinates UI.

Business logic in service/use case.

## 18.6 Injection

```java
@Inject
UserService userService;
```

## 18.7 Do not inject EntityManager into long-lived UI bean casually

Prefer service boundary.

---

# 19. Scopes: Request, View, Session, Application, Conversation

## 19.1 RequestScoped

One HTTP request.

Good for simple pages.

Postback creates new bean.

## 19.2 ViewScoped

Lives as long as user interacts with same view.

Good for form state, table filters, wizard page.

## 19.3 SessionScoped

Lives across session.

Use sparingly.

Can cause memory bloat.

## 19.4 ApplicationScoped

Shared app-wide singleton.

Must be thread-safe.

## 19.5 ConversationScoped

Explicit multi-request conversation.

Useful for workflows but more complex.

## 19.6 Scope decision

| Need | Scope |
|---|---|
| Stateless simple action | Request |
| Form state across postbacks | View |
| User preferences/current session data | Session |
| Shared config/cache | Application |
| Multi-page wizard | Conversation/View with persisted draft |

## 19.7 Avoid SessionScoped by default

Session state hurts memory and clustering.

## 19.8 ViewScoped pitfalls

View state and bean serialization.

Do not store huge lists unless needed.

---

# 20. Forms dan Input Components

## 20.1 Form

Faces inputs/buttons need `h:form`.

```xml
<h:form id="form">
    ...
</h:form>
```

## 20.2 Input text

```xml
<h:inputText id="name" value="#{userForm.name}" />
```

## 20.3 Output text

```xml
<h:outputText value="#{user.name}" />
```

Faces escapes by default for output text unless configured.

## 20.4 Command button

```xml
<h:commandButton value="Save" action="#{userForm.save}" />
```

## 20.5 Select menu

```xml
<h:selectOneMenu value="#{form.status}">
    <f:selectItem itemValue="ACTIVE" itemLabel="Active" />
    <f:selectItem itemValue="INACTIVE" itemLabel="Inactive" />
</h:selectOneMenu>
```

## 20.6 Required

```xml
<h:inputText required="true" requiredMessage="Name is required" />
```

## 20.7 Label

Use label for accessibility:

```xml
<h:outputLabel for="name" value="Name" />
```

## 20.8 Multiple forms caution

Use one form per logical submit area.

Ajax update across forms can be tricky.

---

# 21. Conversion

HTTP request values are strings.

Faces converters transform them to Java types.

## 21.1 Built-in conversion

Examples:

- number;
- date/time;
- enum;
- boolean;
- UUID in newer Faces improvements.

## 21.2 Date conversion

```xml
<h:inputText value="#{form.birthDate}">
    <f:convertDateTime type="localDate" pattern="yyyy-MM-dd" />
</h:inputText>
```

Exact support depends Faces version/component.

## 21.3 Custom converter

```java
@FacesConverter(forClass = UserId.class, managed = true)
public class UserIdConverter implements Converter<UserId> {
    @Override
    public UserId getAsObject(FacesContext context, UIComponent component, String value) {
        return new UserId(UUID.fromString(value));
    }

    @Override
    public String getAsString(FacesContext context, UIComponent component, UserId value) {
        return value.value().toString();
    }
}
```

## 21.4 Converter failure

Throw `ConverterException` with message.

## 21.5 Avoid entity converters that hit DB excessively

Common anti-pattern:

```text
converter loads entity by ID for every row/input
```

Can cause N+1.

Prefer ID values and service loading at action boundary.

## 21.6 Locale

Number/date conversion must respect locale.

## 21.7 Conversion before validation

Validation sees converted object.

---

# 22. Validation

Faces supports component validators and Jakarta Bean Validation integration.

## 22.1 Required

```xml
<h:inputText value="#{form.email}" required="true" />
```

## 22.2 Built-in validators

Examples:

```xml
<f:validateLength minimum="3" maximum="50" />
<f:validateRegex pattern="..." />
<f:validateLongRange minimum="1" maximum="100" />
```

## 22.3 Bean Validation

```java
@NotBlank
@Email
private String email;
```

Faces can validate model constraints.

## 22.4 Custom validator

```java
@FacesValidator(value = "uniqueEmailValidator", managed = true)
public class UniqueEmailValidator implements Validator<String> {

    @Inject
    UserService userService;

    @Override
    public void validate(FacesContext context, UIComponent component, String value) {
        if (userService.emailExists(value)) {
            throw new ValidatorException(
                new FacesMessage(FacesMessage.SEVERITY_ERROR, "Email already used", null)
            );
        }
    }
}
```

## 22.5 Business validation

Some validation requires use-case context.

Do in action/service, then add FacesMessage.

## 22.6 Validation groups

Can integrate with Bean Validation groups for different forms/states.

## 22.7 Ajax validation

Can validate field as user changes.

Be careful with performance and UX.

## 22.8 Security

Client-side validation is not enough.

Server-side validation always required.

---

# 23. Messages dan Error Display

## 23.1 FacesMessage

```java
FacesContext.getCurrentInstance().addMessage(
    null,
    new FacesMessage(FacesMessage.SEVERITY_INFO, "Saved", null)
);
```

## 23.2 Component-specific message

```java
context.addMessage("form:email", new FacesMessage("Invalid email"));
```

## 23.3 Display all messages

```xml
<h:messages globalOnly="false" />
```

## 23.4 Display field message

```xml
<h:message for="email" />
```

## 23.5 Severity

- INFO;
- WARN;
- ERROR;
- FATAL.

## 23.6 Flash scope for redirect

Messages may need to survive redirect.

Use flash:

```java
FacesContext.getCurrentInstance().getExternalContext()
    .getFlash().setKeepMessages(true);
```

## 23.7 Avoid leaking sensitive details

Do not show stack trace or internal IDs to user.

## 23.8 UX

Show clear field-level messages.

---

# 24. Action, ActionListener, ValueChangeListener

## 24.1 Action

```xml
<h:commandButton value="Save" action="#{form.save}" />
```

Action returns navigation outcome or void.

## 24.2 ActionListener

Handles action event.

```xml
<h:commandButton value="Save" actionListener="#{form.onSaveClicked}" />
```

Use less often.

## 24.3 ValueChangeListener

Triggered when value changes after conversion/validation.

```xml
<h:inputText valueChangeListener="#{form.onNameChange}" />
```

## 24.4 Prefer action for business command

Keep UI event mechanics simple.

## 24.5 Avoid too much logic in listeners

Listeners can make lifecycle harder to reason about.

## 24.6 Ajax listener

```xml
<f:ajax listener="#{form.onAjax}" render="panel" />
```

## 24.7 Event ordering

Listeners run in lifecycle phases. Know when values are updated.

---

# 25. Navigation

## 25.1 Implicit navigation

Return view ID/outcome:

```java
public String save() {
    service.save(model);
    return "list";
}
```

## 25.2 Redirect

```java
return "list?faces-redirect=true";
```

Redirect avoids duplicate form submit and updates browser URL.

## 25.3 Post-Redirect-Get

For successful form submission, use PRG:

```text
POST submit → redirect → GET result page
```

## 25.4 Stay on same page

Return null/void.

## 25.5 Navigation rules

Can be configured in `faces-config.xml`, but implicit navigation is common.

## 25.6 View parameters

Use GET parameters with `f:viewParam`.

## 25.7 Bookmarkability

Use GET views for pages users should bookmark/share.

## 25.8 Avoid navigation spaghetti

Keep outcomes clear.

---

# 26. Ajax dan Partial Page Rendering

Faces supports Ajax via `f:ajax`.

## 26.1 Basic Ajax

```xml
<h:inputText id="name" value="#{form.name}">
    <f:ajax event="keyup" render="preview" />
</h:inputText>

<h:panelGroup id="preview">
    <h:outputText value="#{form.name}" />
</h:panelGroup>
```

## 26.2 Execute

Defines components processed.

```xml
<f:ajax execute="@this" render="preview" />
```

## 26.3 Render

Defines components re-rendered.

```xml
<f:ajax execute="@form" render="messages result" />
```

## 26.4 Common keywords

- `@this`;
- `@form`;
- `@all`;
- `@none`.

## 26.5 Partial response

Faces returns XML partial response instructing browser JS to update DOM.

## 26.6 Common bug

Component ID wrong due naming container.

Use correct client/component ID.

## 26.7 Ajax validation

If validation fails, update messages.

## 26.8 Performance

Too much Ajax can overload server.

Debounce frequent events.

## 26.9 Progressive enhancement

Ensure critical forms work without over-reliance on JS where required.

---

# 27. Templating dengan Facelets

## 27.1 Template

`/WEB-INF/templates/main.xhtml`

```xml
<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:ui="jakarta.faces.facelets"
      xmlns:h="jakarta.faces.html">
<h:head>
    <title><ui:insert name="title">App</ui:insert></title>
</h:head>
<h:body>
    <header>...</header>
    <main>
        <ui:insert name="content" />
    </main>
</h:body>
</html>
```

## 27.2 Page using template

```xml
<ui:composition template="/WEB-INF/templates/main.xhtml"
                xmlns:ui="jakarta.faces.facelets"
                xmlns:h="jakarta.faces.html">
    <ui:define name="title">Users</ui:define>
    <ui:define name="content">
        <h:outputText value="User page" />
    </ui:define>
</ui:composition>
```

## 27.3 Benefits

- consistent layout;
- reuse;
- separation layout/content.

## 27.4 Include

```xml
<ui:include src="/WEB-INF/fragments/menu.xhtml" />
```

## 27.5 Avoid dynamic include abuse

Dynamic include can complicate state restoration.

## 27.6 Template location

Put templates/fragments under `WEB-INF` if not directly accessible.

---

# 28. Composite Components

Composite components let you create reusable Faces components with Facelets.

## 28.1 Location

```text
/resources/components/inputText.xhtml
```

## 28.2 Component

```xml
<ui:component xmlns="http://www.w3.org/1999/xhtml"
              xmlns:cc="jakarta.faces.composite"
              xmlns:h="jakarta.faces.html">
    <cc:interface>
        <cc:attribute name="label" required="true" />
        <cc:attribute name="value" required="true" />
    </cc:interface>

    <cc:implementation>
        <h:outputLabel value="#{cc.attrs.label}" />
        <h:inputText value="#{cc.attrs.value}" />
    </cc:implementation>
</ui:component>
```

## 28.3 Usage

```xml
<my:inputText label="Name" value="#{form.name}" />
```

with namespace:

```xml
xmlns:my="jakarta.faces.composite/components"
```

## 28.4 Use cases

- reusable form fields;
- layout widgets;
- consistent error display;
- design system.

## 28.5 Caution

Composite component IDs/naming can complicate Ajax updates.

## 28.6 Keep component API stable

Treat component attributes as contract.

---

# 29. Resource Handling: CSS, JS, Images

## 29.1 Resource directory

```text
src/main/webapp/resources/
  css/app.css
  js/app.js
  images/logo.png
```

## 29.2 Include CSS

```xml
<h:outputStylesheet library="css" name="app.css" />
```

## 29.3 Include JS

```xml
<h:outputScript library="js" name="app.js" target="body" />
```

## 29.4 Image

```xml
<h:graphicImage library="images" name="logo.png" />
```

## 29.5 Versioning/cache

Faces resource handler can support cache/version semantics depending config.

## 29.6 CDN/static server

For large production apps, static resources may be served by CDN/web server.

## 29.7 Security

Do not expose sensitive files under public resources.

## 29.8 Custom resources

ResourceHandler can be customized for advanced cases.

---

# 30. Data Tables dan Repeated Components

## 30.1 Basic table

```xml
<h:dataTable value="#{userList.users}" var="user">
    <h:column>
        <f:facet name="header">Name</f:facet>
        <h:outputText value="#{user.name}" />
    </h:column>
</h:dataTable>
```

## 30.2 UIData

Data table uses `UIData` component.

## 30.3 Large data caution

Do not load 100k rows into view.

Use pagination/lazy loading.

## 30.4 Row state

Repeated components can have per-row component state.

This can bloat view state.

## 30.5 Stable row keys

Component libraries often need row keys for selection/editing.

## 30.6 N+1 rendering

If each row calls service/DB in getter, performance collapses.

## 30.7 Getter rule

Getters may be called many times during render.

Keep getters cheap.

Bad:

```java
public List<User> getUsers() {
    return userService.findAll(); // called multiple times
}
```

Better:

```java
@PostConstruct
void init() {
    users = userService.findPage(...);
}
```

or explicit lazy model.

---

# 31. Events dan Lifecycle Hooks

## 31.1 PhaseListener

Observe lifecycle phases.

```java
public class DebugPhaseListener implements PhaseListener {
    public void beforePhase(PhaseEvent event) {}
    public void afterPhase(PhaseEvent event) {}
    public PhaseId getPhaseId() { return PhaseId.ANY_PHASE; }
}
```

## 31.2 System events

Faces has system events for component/view lifecycle.

## 31.3 PreRenderViewEvent

Can run before render.

Use carefully.

## 31.4 ViewAction

`f:viewAction` can invoke action during view lifecycle for GET.

## 31.5 PostConstructViewMapEvent

Related to view scope lifecycle.

Faces 4.1 enhances lifecycle events for built-in scopes.

## 31.6 Avoid abusing phase listeners

Global phase listeners can create invisible coupling.

## 31.7 Debugging

Phase listener is useful to understand lifecycle but should not become core business logic.

---

# 32. Internationalization dan Accessibility

## 32.1 Resource bundles

Define message bundles:

```properties
label.name=Name
error.required=This field is required
```

## 32.2 Configure bundle

In `faces-config.xml` or application config.

## 32.3 Use in view

```xml
<h:outputText value="#{msg['label.name']}" />
```

## 32.4 Locale

Faces can determine locale from request/user preference.

## 32.5 Date/number formatting

Use converters with locale-aware formatting.

## 32.6 Accessibility

Use:

- proper labels;
- ARIA where needed;
- semantic HTML;
- error messages linked to fields;
- keyboard navigation;
- focus management after Ajax.

## 32.7 Component library caution

Do not assume all components are accessible by default.

Test.

## 32.8 Internationalized validation

Validation messages should be localized.

---

# 33. Security: CSRF, XSS, Authorization, View State

## 33.1 CSRF

Faces has built-in view state token behavior that helps with postback integrity, but do not rely blindly for all security patterns.

For sensitive operations, also ensure:

- same-site cookies;
- origin/referer validation where appropriate;
- proper authentication;
- logout/session management;
- no unsafe GET actions.

## 33.2 XSS

`h:outputText` escapes by default.

Danger:

```xml
<h:outputText value="#{bean.html}" escape="false" />
```

Use only with sanitized trusted HTML.

## 33.3 Authorization

Protect pages/actions.

Do not rely only on hiding buttons:

```xml
rendered="#{user.admin}"
```

Server action must check authorization too.

## 33.4 View state security

Client-side state must be signed/encrypted as appropriate.

Configure securely.

## 33.5 Session fixation

Handled at authentication layer.

## 33.6 File upload

If using component library upload:

- validate size/type;
- scan;
- store safely.

## 33.7 Error pages

Do not expose stack traces.

## 33.8 Sensitive data in view state

Avoid putting secrets/large PII in component state.

---

# 34. Performance Engineering

## 34.1 Main costs

- component tree build/restore;
- view state serialization;
- validation/conversion;
- rendering;
- component library overhead;
- data table rows;
- getters called repeatedly;
- Ajax frequency;
- session replication;
- large forms.

## 34.2 Keep getters cheap

No DB calls in getters.

## 34.3 Pagination

Large lists need pagination/lazy loading.

## 34.4 View scope size

Keep view-scoped beans small.

## 34.5 State saving method

Tune server/client state saving based on memory vs bandwidth/security.

## 34.6 Partial state saving

Ensure enabled unless reason not.

## 34.7 Ajax debounce

Do not send Ajax on every key stroke without debounce.

## 34.8 Component library

PrimeFaces components can be powerful but heavy.

Use only needed components.

## 34.9 Static resources

Use proper caching/CDN.

## 34.10 Profiling

Measure:

- render time;
- view state size;
- session size;
- lifecycle phase time;
- DB queries during render;
- Ajax request rate.

---

# 35. State Saving Pitfalls

## 35.1 View state too large

Causes:

- huge component tree;
- large view-scoped bean;
- data table state;
- storing entities/lists in view.

## 35.2 Client payload too large

Client-side state increases HTML size.

## 35.3 Session memory high

Server-side state increases session memory.

## 35.4 Cluster replication slow

Large sessions/view states replicate slowly.

## 35.5 ViewExpiredException

State missing/expired.

## 35.6 Non-serializable view bean

Passivation/serialization failure.

## 35.7 Entity in view state

JPA entities in view-scoped bean can become detached/stale/heavy.

Prefer DTOs.

## 35.8 Multiple tabs

View/window state can clash.

Faces has ClientWindow concept.

## 35.9 Mitigation

- keep view state small;
- use DTOs;
- paginate;
- avoid storing huge lists;
- configure state saving;
- use PRG;
- test session size.

---

# 36. Integration dengan CDI, Bean Validation, JPA, Security

## 36.1 CDI

Use CDI beans:

```java
@Named
@ViewScoped
```

## 36.2 Bean Validation

Use constraints on model/view DTO.

Faces validates automatically in lifecycle.

## 36.3 JPA

Do not bind UI directly to managed JPA entity for complex workflows.

Prefer form DTO:

```java
public class UserFormModel {
    @NotBlank
    private String name;
}
```

Then service maps DTO to entity.

## 36.4 Transaction

Backing bean calls service:

```java
@Transactional
public void save(UserFormModel model) { ... }
```

## 36.5 Security

Use Jakarta Security/CDI to access caller.

But authorization belongs in service/domain.

## 36.6 REST integration

Faces page can call application services directly, not necessarily REST.

For SPA coexistence, REST and Faces can live in same app but keep boundaries clear.

## 36.7 WebSocket/Ajax push

Faces ecosystem historically supports push through component libraries or WebSocket integration.

Use carefully.

---

# 37. Modern Relevance: Kapan Faces Masih Masuk Akal?

## 37.1 Still reasonable

Faces can be good for:

- internal admin;
- back-office workflows;
- form-heavy enterprise UI;
- small team full-stack Java;
- apps needing mature server-side component library;
- low frontend build complexity;
- government/enterprise systems with long lifecycle.

## 37.2 Less ideal

Faces may be less ideal for:

- public consumer apps;
- highly interactive frontend;
- separate frontend/backend teams;
- mobile-first APIs;
- microfrontend;
- offline-first;
- large client-side state apps.

## 37.3 PrimeFaces ecosystem

PrimeFaces gives rich components.

This can make Faces productive for admin UI.

But component richness can hide complexity and increase view state/performance cost.

## 37.4 Compared to HTMX

HTMX gives server-driven UI with less component lifecycle.

Faces gives richer component state/lifecycle.

Choice depends complexity.

## 37.5 Legacy modernization

You do not always need to rewrite Faces app to SPA.

Options:

- upgrade JSF → Jakarta Faces;
- clean backing beans;
- reduce session state;
- isolate services;
- improve component usage;
- gradually expose REST APIs;
- migrate pages incrementally.

## 37.6 Strategic question

Ask:

```text
Is UI complexity better managed server-side or client-side?
```

---

# 38. Migration: JSF/Jakarta Faces Legacy ke Modern Jakarta

## 38.1 Namespace migration

Old:

```java
javax.faces.*
javax.inject.*
javax.enterprise.context.*
```

New:

```java
jakarta.faces.*
jakarta.inject.*
jakarta.enterprise.context.*
```

## 38.2 Tag namespace migration

Legacy XML namespaces may need update.

Modern examples use Jakarta namespace URIs.

## 38.3 Managed beans

Replace old JSF managed bean annotations with CDI:

Old:

```java
@ManagedBean
@ViewScoped
```

Modern:

```java
@Named
@ViewScoped
```

## 38.4 Dependencies

Ensure component libraries support Jakarta namespace.

PrimeFaces has Jakarta-compatible versions.

## 38.5 Faces config

Update schema versions.

## 38.6 Web.xml

Update servlet class:

```java
jakarta.faces.webapp.FacesServlet
```

## 38.7 Removed/deprecated features

Old native managed bean model and old EL references may be removed in modern Faces.

## 38.8 Test lifecycle

Migration can break:

- converters;
- validators;
- CDI injection;
- scopes;
- view state;
- component library behavior.

## 38.9 Strategy

- upgrade runtime first in branch;
- run full UI regression tests;
- fix namespace imports;
- update components;
- test forms/Ajax;
- inspect view state/session size.

---

# 39. Testing Strategy

## 39.1 Unit test backing bean

Keep business logic out, then backing bean tests are simple.

## 39.2 Unit test service/domain

Most important logic belongs here.

## 39.3 Integration test Faces pages

Use browser automation:

- Selenium;
- Playwright;
- HtmlUnit where compatible;
- Arquillian if using Jakarta EE integration style.

## 39.4 Test lifecycle scenarios

- validation success;
- validation failure;
- conversion failure;
- Ajax partial update;
- cancel immediate;
- navigation redirect;
- view expired;
- multi-tab.

## 39.5 Accessibility tests

Use automated tools and manual keyboard testing.

## 39.6 Security tests

- unauthorized page access;
- action authorization;
- XSS escaping;
- CSRF/postback;
- view state tampering if client-side.

## 39.7 Performance tests

- large table;
- many concurrent sessions;
- Ajax frequency;
- session size;
- view state size.

## 39.8 Snapshot rendered HTML?

Useful but fragile.

Focus on user-visible behavior.

---

# 40. Observability dan Debugging

## 40.1 Project stage

Use development stage in local:

```xml
<context-param>
  <param-name>jakarta.faces.PROJECT_STAGE</param-name>
  <param-value>Development</param-value>
</context-param>
```

Production should not expose detailed debug.

## 40.2 Phase listener logging

Useful for lifecycle debugging.

## 40.3 Metrics

Track:

- request count by view;
- render time;
- validation failure count;
- view expired count;
- session count;
- view state size;
- Ajax request rate;
- error count.

## 40.4 Logs

Include:

- viewId;
- user;
- session id hash;
- correlation id;
- action;
- validation errors count;
- exception.

## 40.5 View state size

Instrument response size and hidden state size.

## 40.6 Thread dumps

Slow Faces pages may show:

- DB calls in getters;
- rendering loops;
- blocked session replication;
- component library work.

## 40.7 Component tree debug

In development, inspect component tree with tooling/runtime support.

---

# 41. Production Failure Modes

## 41.1 Action not invoked

Cause:

- validation/conversion failed;
- wrong form;
- Ajax execute missing;
- button not submitted;
- immediate behavior misunderstood.

## 41.2 ViewExpiredException

Cause:

- session expired;
- server-side state evicted;
- cluster/sticky issue;
- old tab.

## 41.3 Session memory explosion

Cause:

- SessionScoped large objects;
- server-side state with big trees;
- storing entities/lists.

## 41.4 Huge client payload

Cause:

- client-side view state huge.

## 41.5 N+1 during render

Cause:

- DB calls in getter/table row.

## 41.6 Ajax update fails

Cause:

- wrong component ID/naming container;
- target not rendered;
- validation failure;
- JavaScript error.

## 41.7 Duplicate form submit

Cause:

- no PRG;
- browser refresh.

## 41.8 Stale entity update

Cause:

- JPA entity stored in view across long time.

## 41.9 XSS

Cause:

- `escape=false` with untrusted data.

## 41.10 Unauthorized action

Cause:

- button hidden but action not server-authorized.

## 41.11 Multi-tab state conflict

Cause:

- same view/session state reused.

## 41.12 Component library version mismatch

Cause:

- using non-Jakarta compatible library with Faces 4.x.

---

# 42. Best Practices dan Anti-Patterns

## 42.1 Best practices

- Understand lifecycle.
- Use CDI beans.
- Keep backing beans thin.
- Use ViewScoped for form state, not SessionScoped by default.
- Use DTO/form model instead of JPA entity in view.
- Keep getters cheap.
- Use Bean Validation for field constraints.
- Use PRG after successful submit.
- Keep view state small.
- Paginate large tables.
- Use Ajax execute/render deliberately.
- Protect actions server-side.
- Escape output by default.
- Test validation/conversion/Ajax flows.

## 42.2 Anti-pattern: DB call in getter

Bad because render may call getter many times.

## 42.3 Anti-pattern: SessionScoped everything

Causes memory and cluster issues.

## 42.4 Anti-pattern: Business logic in backing bean

Hard to test and reuse.

## 42.5 Anti-pattern: Binding directly to JPA entity

Detached/stale/security issues.

## 42.6 Anti-pattern: Hiding button as authorization

Rendered false is not security.

## 42.7 Anti-pattern: `immediate=true` everywhere

Lifecycle band-aid.

## 42.8 Anti-pattern: Huge data table without pagination

Performance killer.

## 42.9 Anti-pattern: `escape=false`

XSS risk unless sanitized/trusted.

---

# 43. Checklist Review

## 43.1 View/lifecycle

- [ ] Is form inside `h:form`?
- [ ] Are component IDs stable?
- [ ] Is Ajax execute/render correct?
- [ ] Are validation messages displayed?
- [ ] Is PRG used after successful submit?
- [ ] Is ViewExpiredException handled?

## 43.2 Bean/scope

- [ ] CDI `@Named` used?
- [ ] Scope appropriate?
- [ ] View/session beans serializable if needed?
- [ ] Backing bean thin?
- [ ] No DB calls in getters?
- [ ] No huge lists in session/view?

## 43.3 Validation/conversion

- [ ] Required fields defined?
- [ ] Bean Validation used?
- [ ] Custom converter tested?
- [ ] Conversion errors user-friendly?
- [ ] Business validation in service/action?

## 43.4 Security

- [ ] Output escaped?
- [ ] Authorization enforced server-side?
- [ ] Sensitive data not in view state?
- [ ] Client-side state secured?
- [ ] Error pages safe?

## 43.5 Performance

- [ ] Large tables paginated?
- [ ] View state size measured?
- [ ] Session size measured?
- [ ] Ajax frequency controlled?
- [ ] Static resources cached?

---

# 44. Case Study 1: Internal Admin CRUD yang Cocok untuk Faces

## 44.1 Requirement

Internal admin manages reference data:

- search users;
- edit status;
- validate fields;
- show messages;
- audit change.

## 44.2 Why Faces fits

- form-heavy;
- internal users;
- server-side validation;
- component table;
- limited frontend complexity;
- Java team can own full stack.

## 44.3 Design

```text
UserAdminPage.xhtml
  ↓
UserAdminBean @ViewScoped
  ↓
UserAdminService @Transactional
  ↓
UserRepository
```

## 44.4 Avoid

- storing all users in session;
- DB calls in getters;
- direct entity binding;
- button hiding as security.

## 44.5 Good practice

Use paginated DTOs and service authorization.

---

# 45. Case Study 2: View State Membengkak

## 45.1 Problem

Page loads 5,000 rows into `@ViewScoped` bean and displays table.

Server memory/session high.

Client hidden view state huge.

## 45.2 Cause

Component tree + row state + bean state too large.

## 45.3 Fix

- paginate;
- lazy load;
- store filters, not all rows;
- use DTOs;
- reduce component nesting;
- tune state saving;
- avoid session scope.

## 45.4 Measurement

Log view state size and session size.

## 45.5 Lesson

Faces state is powerful but not free.

---

# 46. Case Study 3: Validation Tidak Jalan karena Lifecycle Salah Dipahami

## 46.1 Problem

Developer says:

```text
Save button action is not called.
```

## 46.2 Root cause

Another required field in same form failed validation.

Lifecycle jumped to Render Response.

## 46.3 Fix

- show `h:messages`;
- understand validation phase;
- split form if needed;
- use Ajax execute to process intended fields;
- use `immediate=true` only for cancel/reset.

## 46.4 Debug

Add phase listener and inspect messages.

## 46.5 Lesson

Action is invoked only after successful conversion/validation/model update unless lifecycle altered.

---

# 47. Case Study 4: Session Scope Membuat Memory Leak

## 47.1 Problem

`@SessionScoped UserAdminBean` stores:

```java
List<UserEntity> allUsers;
```

for every admin session.

Memory grows.

Cluster replication slow.

## 47.2 Fix

Use `@ViewScoped`.

Store only:

- filters;
- current page;
- selected IDs.

Load page data as needed.

## 47.3 Entity issue

Do not store JPA entities across long session.

Use DTOs.

## 47.4 Lesson

Session scope is expensive shared user memory.

---

# 48. Latihan Bertahap

## Latihan 1 — Hello Faces

Create basic `.xhtml` page with `@Named @RequestScoped` bean.

## Latihan 2 — Lifecycle logging

Add PhaseListener to log phases.

Submit form and observe.

## Latihan 3 — Validation failure

Create required field.

Observe action skipped.

## Latihan 4 — Converter

Create converter for UUID/UserId.

Test invalid input.

## Latihan 5 — ViewScoped form

Create edit form with `@ViewScoped` bean.

Test multiple postbacks.

## Latihan 6 — Ajax partial render

Use `f:ajax execute/render`.

Debug component IDs.

## Latihan 7 — Template

Create Facelets template and pages.

## Latihan 8 — Composite component

Create reusable input field component.

## Latihan 9 — View state size

Render table with many rows.

Measure view state size.

## Latihan 10 — Security

Hide admin button and then call action manually.

Add server-side authorization.

---

# 49. Mini Project: Jakarta Faces Lifecycle Lab

## 49.1 Goal

Create:

```text
jakarta-faces-lifecycle-lab/
```

## 49.2 Modules/pages

```text
hello/
form-validation/
converter/
ajax/
view-scope/
navigation-prg/
template/
composite-component/
data-table-pagination/
security/
view-state-measurement/
```

## 49.3 Deliverables

```text
README.md
FACES-MENTAL-MODEL.md
LIFECYCLE-PHASES.md
VIEW-STATE.md
SCOPES.md
VALIDATION-CONVERSION.md
AJAX-PARTIAL-RENDERING.md
SECURITY.md
PERFORMANCE.md
FAILURE-MODES.md
```

## 49.4 Required experiments

1. Log all lifecycle phases.
2. Demonstrate validation short-circuit.
3. Demonstrate `immediate=true` cancel.
4. Demonstrate Ajax execute/render.
5. Build custom converter.
6. Build custom validator.
7. Measure view state size.
8. Compare RequestScoped vs ViewScoped.
9. Implement PRG.
10. Test unauthorized action server-side.

## 49.5 Evaluation questions

1. What is component tree?
2. What is view state?
3. Why does validation failure skip action?
4. When does model update happen?
5. Why are getters called many times?
6. Why is SessionScoped dangerous?
7. How does Ajax partial rendering work?
8. Why is hiding button not authorization?
9. What causes ViewExpiredException?
10. When is Faces still a good choice?

---

# 50. Referensi Resmi

Referensi utama:

1. Jakarta Faces 4.1  
   https://jakarta.ee/specifications/faces/4.1/

2. Jakarta Faces 4.1 Specification  
   https://jakarta.ee/specifications/faces/4.1/jakarta-faces-4.1

3. Jakarta Faces 4.1 API Docs  
   https://jakarta.ee/specifications/faces/4.1/apidocs/jakarta.faces/module-summary.html

4. Jakarta Faces Specifications Overview  
   https://jakarta.ee/specifications/faces/

5. Jakarta EE Tutorial — Jakarta Faces  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/web/faces-intro/faces-intro.html

6. Jakarta EE Tutorial — Lifecycle of a Jakarta Faces Application  
   https://jakarta.ee/learn/docs/jakartaee-tutorial/current/web/faces-intro/faces-intro.html

7. Jakarta EE 11 Release  
   https://jakarta.ee/release/11/

8. Jakarta CDI 4.1  
   https://jakarta.ee/specifications/cdi/4.1/

9. Jakarta Validation 3.1  
   https://jakarta.ee/specifications/bean-validation/3.1/

10. Jakarta Servlet 6.1  
    https://jakarta.ee/specifications/servlet/6.1/

---

# Penutup

Jakarta Faces adalah server-side component-based UI framework.

Mental model ringkas:

```text
Facelets page
  ↓
component tree
  ↓
view state
  ↓
lifecycle phases
  ↓
conversion/validation/model update/action
  ↓
render response
```

Prinsip paling penting:

```text
Faces is not template rendering.
Faces is stateful component lifecycle processing.
```

Jika kamu memahami component tree dan lifecycle, Faces menjadi masuk akal. Jika tidak, ia terasa “magis”.

Gunakan Faces dengan bijak:

- cocok untuk form-heavy internal/admin apps;
- cocok jika Java team owns UI/backend;
- cocok jika component library memberi productivity;
- kurang cocok jika UI sangat client-side rich atau frontend/backend ownership terpisah.

Engineer top-tier tidak hanya tahu `h:inputText`. Ia tahu kapan model value di-update, kenapa action tidak terpanggil, kenapa view state membesar, kenapa getter tidak boleh query database, kenapa `SessionScoped` berbahaya, dan kenapa authorization tidak boleh hanya berupa `rendered=false`.

Bagian berikutnya akan membahas **Jakarta Expression Language (`jakarta.el`)**: expression evaluation, value/method expressions, coercion, resolvers, security, integration with Faces/CDI/JSP, and how EL works under the hood.
