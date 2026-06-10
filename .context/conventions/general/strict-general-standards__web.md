# Strict General Standards: Web

> File: `strict-general-standards__web.md`  
> Category: General Engineering Standard  
> Principle: Web Application Correctness, Security, Accessibility, Performance, and Maintainability  
> Status: Mandatory for LLM-assisted web design, implementation, refactoring, review, and documentation

---

## 1. Purpose

This standard defines how an LLM code agent MUST design, implement, modify, and review web-facing application code.

The goal is to prevent web applications that appear to work in the happy path but are unsafe, inaccessible, inconsistent, slow, brittle across browsers, hard to observe, or coupled to accidental framework behavior.

This standard treats the web as a hostile, distributed, user-agent-driven runtime composed of:

- HTML documents and semantic structure;
- CSS layout and visual presentation;
- JavaScript execution and browser APIs;
- navigation and routing;
- forms and user input;
- accessibility tree and assistive technology behavior;
- HTTP, Fetch, CORS, cookies, caching, and security headers;
- server-rendered, client-rendered, and hybrid rendering models;
- unreliable networks and partial failure;
- privacy, consent, and data minimization constraints.

This file defines general web application standards. HTTP-specific browser-network rules are defined in `strict-general-standards__http_for_web.md`.

---

## 2. Source Baseline

The LLM MUST align web work with these baseline references:

- WHATWG HTML Living Standard for HTML, navigation, forms, document lifecycle, and browser processing model.
- WHATWG Fetch Standard for the browser request/response model.
- W3C Web Content Accessibility Guidelines for accessibility requirements.
- W3C Content Security Policy and Subresource Integrity for browser-side security controls.
- OWASP guidance for web application security testing and verification.
- MDN Web Docs for practical browser-facing documentation, compatibility notes, and implementation guidance.
- Existing project conventions, design system, architecture decision records, security baseline, and accessibility policy.

References are listed at the end of this document.

---

## 3. Core Interpretation

### 3.1 Web code is user-facing distributed system code

The LLM MUST NOT treat web code as merely UI decoration.

A web application is a distributed system where part of the system runs inside an untrusted user agent, under variable device, network, permission, storage, font, locale, accessibility, and browser constraints.

Therefore, every web implementation MUST consider:

- correctness under refresh, back/forward, retry, duplicate submission, slow network, and partial rendering;
- security under malicious input, hostile scripts, compromised extensions, clickjacking, CSRF, XSS, and data leakage;
- accessibility under keyboard-only usage, screen readers, zoom, high contrast, reduced motion, and alternative input methods;
- performance under low-end devices, constrained networks, and large data sets;
- maintainability under changing business rules, browser APIs, and design requirements.

### 3.2 Browser behavior is contract, not implementation detail

The LLM MUST respect browser semantics instead of fighting them.

Examples:

- Use semantic links for navigation instead of clickable `div` elements.
- Use semantic buttons for actions instead of anchors without navigation meaning.
- Use forms and labels correctly instead of hand-rolled inaccessible input handling.
- Preserve focus, history, scroll, validation, and keyboard behavior intentionally.
- Use progressive enhancement when server-rendered or document-first behavior is expected.

### 3.3 Frameworks do not replace web standards

React, Vue, Angular, Svelte, Nuxt, Next.js, Remix, Astro, Web Components, and similar frameworks are implementation tools. They do not replace HTML, CSS, HTTP, Fetch, accessibility, security, or browser lifecycle rules.

The LLM MUST NOT justify incorrect web behavior by saying "the framework handles it" unless the exact framework behavior is verified in code, tests, or official documentation.

---

## 4. Mandatory Rules

### WEB-001: Start from user journey and document state

Before implementing web code, the LLM MUST identify the user journey and document state model.

For every non-trivial page, route, or component, define:

- entry points;
- user goal;
- primary actions;
- secondary actions;
- server state required;
- client state required;
- form state required;
- authentication/authorization state;
- loading state;
- empty state;
- validation state;
- error state;
- success state;
- retry behavior;
- navigation behavior;
- accessibility behavior;
- telemetry points.

Bad:

```text
Build case search page.
```

Good:

```text
Page: Case Search
Entry: /cases
Goal: Find existing enforcement cases.
Server state: paginated case results.
Client state: filters, sorting, selected rows.
Loading: skeleton or busy region.
Empty: no cases match filters.
Validation: date range must be valid.
Error: show retryable network/API error.
A11y: filters keyboard reachable; result count announced.
Telemetry: search submitted, result loaded, search failed.
```

The LLM MUST NOT implement only the happy path when the UI has real user impact.

---

### WEB-002: Use semantic HTML before custom widgets

The LLM MUST use native semantic HTML elements whenever they express the behavior correctly.

Required defaults:

| Intent                 | Preferred element                                                |
| ---------------------- | ---------------------------------------------------------------- |
| Page navigation        | `a[href]`                                                        |
| User-triggered command | `button`                                                         |
| Text input             | `input` / `textarea`                                             |
| Selection              | `select`, radio, checkbox, listbox only when necessary           |
| Data table             | `table` with proper headers                                      |
| Form submission        | `form`                                                           |
| Page sections          | `main`, `header`, `nav`, `section`, `article`, `aside`, `footer` |
| Dialog                 | native `dialog` or accessible framework component                |

Bad:

```html
<div onclick="save()">Save</div>
<span onclick="goToCase(id)">Case 123</span>
```

Good:

```html
<button type="button">Save</button> <a href="/cases/123">Case 123</a>
```

The LLM MUST NOT create custom clickable elements unless native semantics are insufficient and full keyboard, focus, ARIA, and screen-reader behavior are implemented and tested.

---

### WEB-003: Accessibility is mandatory, not optional polish

The LLM MUST implement accessibility as part of the functional definition of done.

Minimum requirements:

- every interactive control MUST be keyboard reachable;
- focus order MUST match visual and logical order;
- visible focus MUST not be removed;
- form controls MUST have accessible labels;
- error messages MUST be associated with fields;
- dynamic status changes MUST be announced when needed;
- color MUST NOT be the only information channel;
- text contrast MUST meet the project accessibility target;
- modal dialogs MUST trap focus and restore focus on close;
- pages/routes MUST have meaningful titles and headings;
- images MUST have correct alternative text or be marked decorative;
- reduced-motion users MUST not be forced through disruptive animation;
- components MUST support zoom and responsive layouts without loss of content.

The LLM MUST NOT use ARIA to hide broken HTML. Prefer native semantics first.

Bad:

```html
<input placeholder="Email" />
```

Good:

```html
<label for="email">Email</label>
<input id="email" name="email" type="email" autocomplete="email" />
```

When building a custom component, the LLM MUST document the accessibility contract:

```text
Component: Date range picker
Keyboard: Tab enters, arrows navigate days, Escape closes
Screen reader: announces selected date and month
Focus: restore to trigger on close
Validation: invalid range linked to control using aria-describedby
```

---

### WEB-004: Separate server state, client UI state, form state, and derived state

The LLM MUST NOT mix unrelated state categories into one uncontrolled object.

State categories:

| State type         | Example                             | Source of truth                |
| ------------------ | ----------------------------------- | ------------------------------ |
| Server state       | case details, user profile          | backend/API/cache              |
| Client UI state    | open panel, active tab              | component/router/store         |
| Form state         | dirty fields, validation errors     | form model                     |
| Derived state      | filtered count, computed label      | computed from other state      |
| Session/auth state | current principal, permissions      | auth provider/session endpoint |
| URL state          | filters, pagination, selected route | URL/router                     |

Mandatory rules:

- Server state MUST not be blindly copied into mutable UI state unless editing or snapshot isolation is required.
- Derived state SHOULD be computed, not stored, unless performance requires memoization.
- URL-relevant state MUST be represented in the URL when users need refresh/share/back behavior.
- Form state MUST preserve dirty/touched/submitting/error states explicitly.
- Authorization state MUST not be inferred solely from hidden buttons.

Bad:

```ts
const state = reactive({
  user: {},
  cases: [],
  page: 1,
  modalOpen: false,
  form: {},
  canApprove: false,
  loading: false,
  error: null,
});
```

Good:

```ts
const caseQuery = useCaseSearchQuery(route.query);
const approvalForm = useApprovalForm();
const dialogState = useDialogState();
const permissions = useCurrentUserPermissions();
const visibleCases = computed(() => caseQuery.data.value?.items ?? []);
```

---

### WEB-005: Model loading, empty, error, and stale states explicitly

The LLM MUST implement all material UI states.

For every API-backed view, define:

- initial state;
- loading state;
- success state;
- empty state;
- validation error state;
- authorization failure state;
- not found state;
- server failure state;
- network timeout/offline state;
- stale data state if cached;
- retry behavior.

Bad:

```ts
if (data) renderData();
```

Good:

```ts
if (query.isLoading) return renderLoading();
if (query.isUnauthorized) return renderUnauthorized();
if (query.isNotFound) return renderNotFound();
if (query.isError) return renderRetryableError(query.error);
if (query.data.items.length === 0) return renderEmptyState();
return renderData(query.data);
```

The LLM MUST NOT leave users with blank screens for expected failure modes.

---

### WEB-006: Preserve navigation, history, refresh, and deep-link behavior

The LLM MUST design routes so that meaningful application state survives browser navigation where expected.

Required:

- route paths MUST represent user-visible locations;
- query parameters SHOULD represent filters, sorting, pagination, and view mode when shareable;
- browser back/forward MUST not corrupt state;
- refresh MUST reload the same logical view;
- protected routes MUST handle unauthenticated and unauthorized users explicitly;
- destructive actions MUST NOT be triggered by `GET` navigation;
- scroll restoration MUST be intentional for long pages/lists;
- route guards MUST not create infinite redirects.

Bad:

```text
Search filters exist only in component memory.
Refreshing the page loses context.
Back button exits the application unexpectedly.
```

Good:

```text
/cases?status=OPEN&assigneeId=123&page=2&sort=createdAt.desc
```

---

### WEB-007: Validate at the right layers

The LLM MUST implement layered validation.

Validation layers:

1. HTML/browser constraints for immediate user feedback.
2. Client-side domain validation for responsive UX.
3. Server-side validation as the authority.
4. Persistence/domain invariants as final protection.

The LLM MUST NOT rely only on client validation.

Required form behavior:

- validate required fields;
- validate type, range, length, and format;
- validate cross-field rules;
- prevent duplicate submission;
- preserve user input after failed submission;
- display field-level and form-level errors;
- map server validation errors to fields when possible;
- announce errors accessibly;
- never expose stack traces or internal error IDs as user-facing text unless safe.

Bad:

```ts
if (!email.includes("@")) return;
await api.createUser(form);
```

Good:

```ts
const result = validateCreateUserForm(form);
if (!result.valid) {
  showFieldErrors(result.errors);
  focusFirstInvalidField();
  return;
}

await submitWithIdempotencyKey(form);
```

---

### WEB-008: Treat all user input and rendered data as untrusted

The LLM MUST assume all user-controlled content is hostile unless proven otherwise.

Mandatory rules:

- Do not use unsafe HTML insertion for untrusted content.
- Do not concatenate user input into scripts, styles, URLs, selectors, or HTML.
- Escape and encode output according to context.
- Sanitize rich text using a proven sanitizer and an explicit allowlist.
- Validate URLs before rendering links.
- Add `rel="noopener noreferrer"` for external links opened in a new tab.
- Do not render untrusted file names, MIME types, or metadata without escaping.
- Do not trust hidden form fields or disabled controls.

Bad:

```ts
element.innerHTML = comment.body;
```

Acceptable only with explicit sanitizer:

```ts
element.innerHTML = sanitizeAllowedRichText(comment.body);
```

Preferred for plain text:

```ts
element.textContent = comment.body;
```

---

### WEB-009: No secrets in browser-delivered code

The LLM MUST NOT place secrets in frontend source, bundles, local storage, session storage, HTML, source maps, logs, or public environment variables.

Forbidden in browser-delivered assets:

- API private keys;
- client secrets;
- database credentials;
- privileged tokens;
- signing keys;
- internal service credentials;
- production-only debug credentials;
- irreversible personal data exports.

Allowed only when intentionally public:

- public analytics IDs;
- public OAuth client IDs where protocol allows;
- public feature flags that do not reveal sensitive controls;
- public API base URLs.

The LLM MUST treat any variable embedded into a frontend bundle as public.

Bad:

```ts
const apiSecret = import.meta.env.VITE_PAYMENT_SECRET;
```

Good:

```ts
// Browser calls backend. Backend signs privileged request.
await fetch("/api/payment-intents", { method: "POST" });
```

---

### WEB-010: Authentication and authorization must be enforced server-side

The LLM MAY hide or disable UI actions based on permissions, but MUST NOT treat UI visibility as authorization.

Required:

- every protected server operation MUST enforce authorization server-side;
- frontend permissions MUST be used only for UX guidance;
- routes MUST handle authentication expiry;
- 401 and 403 MUST be differentiated in UX;
- token refresh failures MUST lead to safe logout or re-authentication;
- privileged UI state MUST be refreshed after role/permission changes when required;
- sensitive routes MUST not cache protected content in shared caches.

Bad:

```ts
if (user.role === "ADMIN") showDeleteButton();
// Backend delete endpoint has no authorization check.
```

Good:

```text
Frontend: hides delete button when permission missing.
Backend: enforces DELETE_CASE permission for DELETE /cases/{caseId}.
Audit: logs denied and successful delete attempts.
```

---

### WEB-011: Use browser storage deliberately

The LLM MUST choose storage based on sensitivity, lifetime, and consistency requirements.

| Storage          | Use for                      | Do not use for                            |
| ---------------- | ---------------------------- | ----------------------------------------- |
| Memory           | transient UI/session state   | long-term persistence                     |
| URL              | shareable filters/view state | secrets or large state                    |
| Cookie           | server session identifiers   | large data or JS-only state               |
| `localStorage`   | low-risk preferences         | tokens, secrets, personal data            |
| `sessionStorage` | tab-scoped low-risk state    | auth secrets                              |
| IndexedDB        | offline data/cache           | unencrypted sensitive data without policy |
| Cache Storage    | PWA/static response cache    | private data without strategy             |

Mandatory rules:

- Do not store access tokens in `localStorage` unless the security architecture explicitly accepts the XSS risk.
- Do not store sensitive personal data in browser storage without encryption, retention, and clearing policy.
- Clear relevant storage on logout.
- Version persisted client state and handle migrations.
- Handle quota exceeded errors.

---

### WEB-012: Use CSP, SRI, and security headers as defense in depth

The LLM MUST not rely on CSP as the only XSS defense, but SHOULD use CSP where the platform allows.

Recommended security controls for web applications:

- Content-Security-Policy with strict script policy where feasible;
- `frame-ancestors` or equivalent clickjacking protection;
- Subresource Integrity for externally hosted scripts/styles where applicable;
- `Referrer-Policy` appropriate to privacy requirements;
- `Permissions-Policy` to disable unused browser capabilities;
- `X-Content-Type-Options: nosniff`;
- HSTS for HTTPS-only deployments;
- secure cookie attributes;
- no sensitive data in source maps served publicly;
- no production debug endpoints or verbose client logs.

The LLM MUST NOT introduce inline scripts, `eval`, dynamic code generation, or broad CSP exceptions unless justified and documented.

Bad:

```http
Content-Security-Policy: default-src * 'unsafe-inline' 'unsafe-eval'
```

Better direction:

```http
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-{nonce}'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
```

Exact policy MUST be adapted to the application and tested before enforcement.

---

### WEB-013: Performance must be designed, measured, and bounded

The LLM MUST consider performance as part of correctness.

Required for user-facing pages:

- avoid unnecessary JavaScript;
- avoid blocking critical rendering path without reason;
- optimize images and media;
- lazy-load non-critical resources;
- paginate or virtualize large lists;
- avoid unbounded DOM growth;
- avoid expensive watchers/effects in hot paths;
- avoid repeated layout thrashing;
- debounce or throttle high-frequency input carefully;
- cancel obsolete network requests;
- use cache intentionally;
- measure bundle size impact for new dependencies.

The LLM MUST NOT add heavy dependencies for trivial behavior.

Bad:

```text
Add a 200KB date library to format one date.
```

Good:

```text
Use platform Intl APIs or existing project utility unless advanced date logic is required.
```

### Performance acceptance requirements

For material pages, define at least:

- expected data volume;
- expected device/browser class;
- acceptable loading behavior;
- bundle impact of new dependencies;
- rendering strategy;
- API request count;
- known performance risk.

---

### WEB-014: Rendering strategy must match product and system constraints

The LLM MUST choose rendering strategy intentionally.

Rendering options:

| Strategy              | Suitable for                         | Risks                                         |
| --------------------- | ------------------------------------ | --------------------------------------------- |
| Static rendering      | stable public content                | stale content, build-time coupling            |
| Server-side rendering | SEO, fast first document, auth pages | server complexity, hydration mismatch         |
| Client-side rendering | rich internal apps                   | slower first load, SEO/accessibility mistakes |
| Hybrid/islands        | content + interactive sections       | complexity, coordination overhead             |
| Streaming             | large/slow server data               | partial state complexity                      |

The LLM MUST NOT default to a single-page app for all problems.

Decision criteria:

- SEO/public discoverability;
- authenticated vs public surface;
- first-load performance;
- interactivity level;
- offline requirement;
- personalization;
- deployment model;
- cacheability;
- team capability;
- observability and debugging.

---

### WEB-015: Components must have explicit contracts

Every reusable component MUST define its contract.

Component contract:

- responsibility;
- props/inputs;
- emitted events/outputs;
- slots/children;
- controlled vs uncontrolled state;
- accessibility behavior;
- loading/disabled/error behavior;
- styling/theming constraints;
- test expectations;
- examples.

The LLM MUST NOT create "god components" that own data fetching, authorization, form validation, routing, rendering, analytics, and mutation logic at once.

Bad:

```text
CaseManagementPage.vue does everything: loads cases, edits case, uploads files, sends email, controls modal, performs audit logging, validates permissions.
```

Good:

```text
CaseManagementPage: route composition
CaseSearchFilters: form state
CaseResultTable: presentation + row actions
useCaseSearchQuery: server state
useCasePermissions: permission projection
useCaseApprovalMutation: mutation behavior
```

---

### WEB-016: Styling must be maintainable, responsive, and accessible

The LLM MUST avoid styling that only works for one viewport, one language, one font, or one data shape.

Required:

- responsive layouts for supported breakpoints;
- avoid fixed heights where content can grow;
- avoid text truncation without accessible full value where meaning matters;
- support long names and translated labels;
- preserve focus indicators;
- avoid low contrast;
- respect reduced motion;
- avoid z-index escalation without a layering policy;
- use design tokens or existing theme system;
- avoid one-off magic values unless justified;
- test empty, short, long, and error states.

Bad:

```css
.card-title {
  width: 120px;
  white-space: nowrap;
  overflow: hidden;
}
```

Better:

```css
.card-title {
  overflow-wrap: anywhere;
}
```

If truncation is required, provide full value via accessible text, tooltip, detail view, or expansion pattern.

---

### WEB-017: JavaScript must be deterministic and lifecycle-safe

The LLM MUST write browser JavaScript that handles lifecycle, cleanup, and concurrency.

Required:

- clean up event listeners;
- clear timers;
- cancel obsolete requests with `AbortController` or framework equivalent;
- avoid memory leaks from retained closures;
- avoid race conditions between overlapping requests;
- guard against double-click and duplicate submit;
- avoid global mutable state unless intentionally shared;
- avoid monkey-patching platform APIs;
- avoid implicit dependency on execution order across unrelated modules;
- handle browser API unavailability.

Bad:

```ts
window.addEventListener("resize", onResize);
// no cleanup
```

Good:

```ts
onMounted(() => window.addEventListener("resize", onResize));
onUnmounted(() => window.removeEventListener("resize", onResize));
```

For request races:

```ts
let requestSeq = 0;

async function loadResults(params: SearchParams) {
  const seq = ++requestSeq;
  const result = await api.search(params);
  if (seq !== requestSeq) return;
  results.value = result;
}
```

Prefer standard cancellation where available.

---

### WEB-018: Network behavior must be resilient

The LLM MUST treat network failure as normal.

Required:

- timeout or cancellation policy;
- retry only for safe/idempotent operations unless idempotency is provided;
- exponential backoff with jitter for retryable calls;
- no infinite request loops;
- distinguish validation, authorization, not found, conflict, rate limit, and server errors;
- show meaningful recovery path;
- preserve user input on failure;
- prevent duplicate mutations;
- handle offline or flaky connectivity where relevant.

Bad:

```ts
while (true) {
  await fetch("/api/status");
}
```

Good:

```text
Poll with capped interval, stop on terminal state, back off on errors, cancel on route leave.
```

---

### WEB-019: Internationalization must be designed early

The LLM MUST avoid assumptions that break under locale, timezone, or language variation.

Required:

- do not hardcode user-facing strings in reusable logic;
- support translation keys when the project uses i18n;
- use locale-aware date, time, number, and currency formatting;
- distinguish instant, date-only, local date-time, and timezone-aware values;
- avoid string sorting when locale-sensitive collation matters;
- allow UI expansion for longer translated text;
- avoid concatenating translated fragments that cannot be reordered;
- support RTL if the product requires it;
- avoid assuming names are first-name/last-name only;
- avoid assuming addresses, phone numbers, and IDs follow one country format unless domain-constrained.

Bad:

```ts
const label = "Created at " + date;
```

Good:

```ts
const label = t("case.createdAt", { date: formatDate(date, locale) });
```

---

### WEB-020: Privacy and data minimization are mandatory

The LLM MUST minimize browser-visible personal and sensitive data.

Required:

- fetch only data required for the view/action;
- avoid placing sensitive data in URLs;
- avoid logging sensitive data to browser console or telemetry;
- mask sensitive fields where appropriate;
- clear sensitive form state after completion when required;
- avoid unnecessary third-party scripts;
- document analytics events and payloads;
- respect consent requirements when applicable;
- avoid exposing internal IDs unless safe and intentional;
- avoid sending full records to the browser when only a projection is needed.

Bad:

```ts
analytics.track("case_viewed", fullCaseRecord);
```

Good:

```ts
analytics.track("case_viewed", {
  caseType: caseSummary.type,
  status: caseSummary.status,
});
```

---

### WEB-021: File upload and download flows must be safe

The LLM MUST treat files as untrusted.

Upload requirements:

- validate file size client-side for UX and server-side for enforcement;
- validate MIME type and content server-side;
- show progress for large uploads;
- handle cancellation and retry;
- prevent duplicate upload where relevant;
- never trust client-provided filename, extension, or MIME type;
- sanitize displayed filenames;
- scan files where required by security policy.

Download requirements:

- use safe `Content-Disposition` from server;
- avoid rendering untrusted documents inline unless safe;
- require authorization for protected files;
- avoid exposing direct object storage URLs unless scoped and time-limited;
- handle expired links gracefully.

---

### WEB-022: Observability must include user-impacting failures

The LLM MUST add useful telemetry for material user journeys.

Required:

- capture route/page load failures;
- capture API failures with safe metadata;
- capture validation failure patterns when useful;
- capture frontend exceptions;
- capture performance metrics where platform supports it;
- include correlation/request IDs from server when available;
- avoid logging personal data, secrets, tokens, or full payloads;
- make errors diagnosable without exposing sensitive details to users.

Bad:

```ts
console.error(error);
```

Better:

```ts
logger.error("case_search_failed", {
  requestId: error.requestId,
  status: error.status,
  route: route.name,
});
```

---

### WEB-023: Testing must cover behavior, not only snapshots

The LLM MUST add or update tests for meaningful web behavior.

Required test categories where applicable:

- component rendering states;
- keyboard interaction;
- form validation;
- API success and error behavior;
- authorization behavior;
- route behavior;
- accessibility checks;
- regression test for bug fixes;
- E2E test for critical user journeys;
- contract tests for API integration;
- visual regression for design-system components when tooling exists.

The LLM MUST NOT rely only on snapshot tests for interactive components.

Bad:

```text
Only snapshot test confirms button exists.
```

Good:

```text
Test user can tab to button, activate with keyboard, submit form, see field error, retry after API failure.
```

---

### WEB-024: Dependencies must be justified

The LLM MUST NOT add browser dependencies casually.

Before adding a dependency, verify:

- whether platform API or existing utility already solves the problem;
- package size and transitive dependencies;
- maintenance health;
- license compatibility;
- security posture;
- tree-shaking behavior;
- browser support;
- SSR compatibility if relevant;
- accessibility quality for UI libraries;
- impact on build time and runtime.

Bad:

```text
Install a full UI framework to add one tooltip.
```

Good:

```text
Use existing design-system tooltip or implement minimal accessible tooltip if design system lacks it.
```

---

### WEB-025: Progressive Web App features require explicit product need

The LLM MUST NOT add service workers, push notifications, background sync, offline caches, or install prompts without explicit requirement.

PWA features require:

- cache strategy;
- offline UX;
- update strategy;
- stale asset handling;
- data privacy review;
- storage quota handling;
- fallback behavior;
- test plan;
- rollback plan.

Bad:

```text
Add service worker because it improves performance.
```

Good:

```text
Add service worker because field users need read-only access to assigned cases while offline; cache policy excludes sensitive documents and clears on logout.
```

---

### WEB-026: Do not break browser defaults without replacing the lost behavior

The LLM MUST NOT remove standard browser behavior unless replacement behavior is intentional and tested.

Risky changes:

- disabling text selection globally;
- preventing default form submission without accessible fallback;
- overriding keyboard shortcuts;
- removing focus outline;
- hijacking scroll;
- replacing native controls with inaccessible components;
- disabling zoom;
- blocking back button;
- overriding context menu;
- suppressing validation messages without replacement.

Bad:

```css
*:focus {
  outline: none;
}
```

Good:

```css
:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
```

---

## 5. Web Security Rules

### 5.1 Mandatory browser-side security model

The LLM MUST assume:

- the browser is not trusted;
- JavaScript can be inspected and modified by the user;
- requests can be replayed outside the UI;
- client validation can be bypassed;
- storage can be read by malware/extensions depending on environment;
- third-party scripts increase risk;
- XSS compromises all data accessible to JavaScript;
- CSRF risk depends on cookie/session architecture;
- CORS is not server-side authorization.

### 5.2 XSS prevention

Mandatory:

- escape output by default;
- avoid raw HTML rendering;
- sanitize rich text with allowlists;
- avoid inline event handlers;
- avoid `eval`, `new Function`, and unsafe dynamic script execution;
- use CSP defense in depth;
- validate URL schemes before rendering links;
- avoid template injection.

### 5.3 CSRF prevention

When using cookie-based authentication, the LLM MUST ensure CSRF controls exist for state-changing operations.

Acceptable controls include, depending on architecture:

- SameSite cookies;
- CSRF tokens;
- origin/referer validation;
- custom request headers with CORS controls;
- double-submit cookie pattern;
- idempotency keys for duplicate submission control.

CSRF controls MUST be enforced server-side.

### 5.4 Clickjacking prevention

For sensitive apps, the LLM MUST ensure frame embedding policy exists:

- CSP `frame-ancestors`; or
- legacy `X-Frame-Options` where needed.

### 5.5 Third-party script control

The LLM MUST treat third-party scripts as privileged code.

Before adding a third-party script:

- justify business need;
- check privacy and security impact;
- use SRI where static resource integrity applies;
- restrict via CSP where possible;
- avoid loading it on pages where not needed;
- avoid sending sensitive data to it;
- document ownership and removal criteria.

---

## 6. Decision Algorithms

### 6.1 Link vs button

Use this decision path:

```text
Does the element navigate to another URL or document state?
  Yes -> use <a href="...">.
  No -> continue.

Does it trigger an action on current page/application state?
  Yes -> use <button type="button|submit|reset">.
  No -> continue.

Is it purely visual/static?
  Yes -> non-interactive semantic element.
  No -> define semantics before coding.
```

### 6.2 Client-side vs server-side rendering

```text
Is page public and SEO-sensitive?
  Yes -> prefer SSR/static/hybrid.

Is page authenticated internal workflow with high interactivity?
  Yes -> CSR or hybrid may be acceptable.

Is first meaningful paint critical on slow devices?
  Yes -> avoid large CSR-only bundle.

Does page need per-user data on first load?
  Yes -> SSR/hybrid may help but cache carefully.

Does team already operate one rendering model safely?
  Yes -> prefer existing model unless requirement contradicts it.
```

### 6.3 Custom component decision

```text
Can native HTML satisfy behavior?
  Yes -> use native.

Does design system already provide accessible component?
  Yes -> use it.

Can the team implement complete keyboard/focus/screen-reader behavior?
  No -> do not build custom component.

Is custom behavior justified by user need?
  No -> simplify.

Otherwise -> build with explicit accessibility contract and tests.
```

### 6.4 State location decision

```text
Does state need to survive refresh/share/back?
  Yes -> URL or server.

Is state authoritative domain data?
  Yes -> server state.

Is state transient visual behavior?
  Yes -> component/client UI state.

Is state sensitive?
  Yes -> avoid browser persistence unless approved.

Is state derived from existing state?
  Yes -> compute it.
```

---

## 7. Anti-Patterns

The LLM MUST avoid these patterns:

### 7.1 Div-button anti-pattern

```html
<div role="button" onclick="submit()">Submit</div>
```

Use native button unless custom behavior is unavoidable.

### 7.2 Raw HTML injection anti-pattern

```ts
container.innerHTML = apiResponse.message;
```

Use text rendering or sanitized rich text.

### 7.3 Local-storage token anti-pattern

```ts
localStorage.setItem("access_token", token);
```

Do not use unless explicitly accepted by security architecture.

### 7.4 One-state-object anti-pattern

Combining route state, server state, form state, UI state, and auth state into one mutable object creates race conditions and unclear ownership.

### 7.5 Invisible authorization anti-pattern

Hiding a button without server authorization is not access control.

### 7.6 Spinner-only anti-pattern

A page that only shows a spinner for loading, empty, failed, unauthorized, and timeout states is incomplete.

### 7.7 Framework magic anti-pattern

Assuming framework behavior without tests or documentation is not acceptable.

### 7.8 CSS pixel-perfect anti-pattern

Hardcoding layout for one viewport and one language breaks real web usage.

### 7.9 Analytics leakage anti-pattern

Sending full domain objects to telemetry leaks data and violates minimization.

### 7.10 Unbounded list anti-pattern

Rendering thousands of DOM rows without pagination or virtualization is not acceptable.

---

## 8. Review Checklist

Before completing web work, the LLM MUST verify:

### Semantics

- [ ] Native HTML elements are used where possible.
- [ ] Links navigate and buttons perform actions.
- [ ] Forms have labels, validation, and error association.
- [ ] Headings and landmarks are meaningful.

### Accessibility

- [ ] Keyboard interaction works.
- [ ] Focus order and visible focus are correct.
- [ ] Screen-reader names are present for controls.
- [ ] Dynamic states are announced where needed.
- [ ] Color is not the only information channel.
- [ ] Reduced motion and zoom are respected.

### State

- [ ] Server, client, form, URL, and derived state are separated.
- [ ] Loading, empty, error, unauthorized, and retry states exist.
- [ ] Refresh/back/forward behavior is correct.
- [ ] Duplicate submission is controlled.

### Security

- [ ] No secrets are delivered to browser code.
- [ ] Untrusted content is escaped/sanitized.
- [ ] Auth is enforced server-side.
- [ ] CSRF model is addressed for cookie auth.
- [ ] CSP/security headers are not weakened.
- [ ] Third-party scripts are justified.

### Performance

- [ ] Bundle impact is acceptable.
- [ ] Large lists are paginated/virtualized.
- [ ] Images/media are optimized.
- [ ] Obsolete requests are cancelled or ignored.
- [ ] Unnecessary dependencies are avoided.

### Maintainability

- [ ] Components have clear contracts.
- [ ] Logic is testable.
- [ ] Styling follows design system.
- [ ] Browser compatibility is considered.
- [ ] Telemetry is safe and useful.

---

## 9. Acceptance Criteria

A web implementation is acceptable only when:

1. It implements the requested user journey, not just isolated markup.
2. It uses semantic HTML and browser behavior correctly.
3. It meets accessibility requirements for the changed surface.
4. It handles loading, empty, error, validation, authorization, and retry states where applicable.
5. It treats browser input/output as untrusted.
6. It does not expose secrets or sensitive data unnecessarily.
7. It enforces security server-side where required.
8. It preserves navigation, refresh, and back/forward behavior where expected.
9. It avoids unnecessary dependencies and complexity.
10. It includes or updates meaningful tests.
11. It adds safe observability for important failures.
12. It documents assumptions and trade-offs when behavior is non-obvious.

---

## 10. LLM Enforcement Prompt

Use this instruction when asking an LLM to implement web work:

```text
You must follow strict-general-standards__web.md.
Before coding, identify user journey, state model, security boundary, accessibility requirements, and failure states.
Use semantic HTML and native browser behavior by default.
Do not put secrets in browser code.
Do not rely on client-side authorization.
Handle loading, empty, validation, unauthorized, not found, network error, and retry states where applicable.
Treat all rendered external/user data as untrusted.
Avoid unnecessary dependencies and framework magic.
Add or update tests for behavior, accessibility, and failure handling.
If you violate any rule, explicitly justify it and mark it as a risk.
```

---

## 11. References

- WHATWG HTML Living Standard: https://html.spec.whatwg.org/multipage/
- WHATWG Fetch Standard: https://fetch.spec.whatwg.org/
- W3C Web Content Accessibility Guidelines 2.2: https://www.w3.org/TR/WCAG22/
- W3C Content Security Policy Level 3: https://www.w3.org/TR/CSP3/
- W3C Subresource Integrity: https://www.w3.org/TR/sri-2/
- OWASP Web Security Testing Guide: https://owasp.org/www-project-web-security-testing-guide/
- MDN Web Docs: https://developer.mozilla.org/en-US/
- web.dev: https://web.dev/
