# Strict General Standards: HTTP for Web

> File: `strict-general-standards__http_for_web.md`  
> Category: General Engineering Standard  
> Principle: Browser-Oriented HTTP Correctness, Security, Caching, and Resilience  
> Status: Mandatory for LLM-assisted web HTTP integration, API consumption, backend web responses, refactoring, review, and documentation

---

## 1. Purpose

This standard defines how an LLM code agent MUST use HTTP in web applications.

The goal is to prevent browser-facing HTTP behavior that is inconsistent, unsafe, uncacheable, over-fetching, under-specified, inaccessible through normal browser flows, or brittle under CORS, cookies, redirects, caching, authentication expiry, and network failure.

This standard applies to:

- browser `fetch` / XHR usage;
- HTML navigation and form submission behavior;
- server responses consumed by browsers;
- API calls made by frontend applications;
- cookies and browser credentials;
- CORS and same-origin behavior;
- HTTP caching for HTML, static assets, and APIs;
- redirects;
- status code handling;
- security headers;
- content negotiation;
- upload and download flows;
- observability and correlation across browser and server.

This standard complements:

- `strict-general-standards__web.md` for general web application behavior;
- `strict-general-standards__restfull_api.md` for RESTful API design;
- `strict-general-standards__open_api.md` for OpenAPI contract quality.

---

## 2. Source Baseline

The LLM MUST align browser-facing HTTP work with:

- RFC 9110 HTTP Semantics;
- RFC 9111 HTTP Caching;
- WHATWG Fetch Standard;
- WHATWG HTML navigation and form behavior;
- HTTP cookie specifications and current browser cookie behavior;
- W3C Content Security Policy and Subresource Integrity;
- OWASP web security guidance;
- MDN Web Docs for browser compatibility and practical behavior notes;
- local platform/gateway/CDN/security standards.

References are listed at the end of this document.

---

## 3. Core Interpretation

### 3.1 Browser HTTP is not generic server-to-server HTTP

The LLM MUST distinguish browser HTTP from backend HTTP clients.

Browsers enforce special behavior:

- same-origin policy;
- CORS preflight and response checks;
- credential modes;
- cookie scope and SameSite behavior;
- redirect handling;
- forbidden request headers;
- mixed-content restrictions;
- cache behavior;
- service worker interception;
- connection and request scheduling;
- opaque responses for certain cross-origin modes;
- automatic form/navigation behavior.

A request that works with `curl` or Postman may fail in a browser because browser security model is stricter.

### 3.2 HTTP semantics are part of the application contract

The LLM MUST use methods, status codes, headers, media types, redirects, and caching semantics intentionally.

HTTP is not only a transport pipe. It is part of the contract among:

- browser;
- frontend code;
- backend;
- CDN/proxy/cache;
- API gateway;
- observability tooling;
- security controls;
- user-agent features.

### 3.3 Security controls must not depend on frontend code alone

Frontend HTTP code can improve UX, but cannot enforce security.

The LLM MUST ensure server-side enforcement for:

- authentication;
- authorization;
- CSRF protection;
- content-type validation;
- rate limiting;
- input validation;
- file validation;
- audit logging;
- cache protection of sensitive data.

---

## 4. Mandatory Rules

### HTTPWEB-001: Use HTTP methods according to semantics

The LLM MUST use HTTP methods correctly.

| Method    | Browser/web use                                          | Requirement                                 |
| --------- | -------------------------------------------------------- | ------------------------------------------- |
| `GET`     | read/navigate/fetch safe representation                  | MUST NOT mutate server state                |
| `HEAD`    | metadata check                                           | same semantics as GET without body          |
| `POST`    | create resource, submit command, non-idempotent mutation | protect against duplicate submission        |
| `PUT`     | replace resource at known URI                            | idempotent by contract                      |
| `PATCH`   | partial update                                           | document patch format and conflict behavior |
| `DELETE`  | delete/remove resource                                   | idempotency behavior MUST be defined        |
| `OPTIONS` | capability/preflight                                     | usually browser/gateway handled for CORS    |

Bad:

```http
GET /api/cases/123/approve
```

Good:

```http
POST /api/cases/123/approval
```

The LLM MUST NOT use `GET` for state-changing actions, especially actions reachable from links, images, crawlers, prefetchers, or browser restore behavior.

---

### HTTPWEB-002: Set `Content-Type` and `Accept` deliberately

The LLM MUST specify request and response media types deliberately.

For JSON API requests:

```http
Content-Type: application/json
Accept: application/json
```

For Problem Details errors:

```http
Content-Type: application/problem+json
```

For file upload:

```http
Content-Type: multipart/form-data; boundary=...
```

Browser code MUST NOT manually set the `multipart/form-data` boundary. Let the browser set it when using `FormData`.

Bad:

```ts
await fetch("/api/files", {
  method: "POST",
  headers: { "Content-Type": "multipart/form-data" },
  body: formData,
});
```

Good:

```ts
await fetch("/api/files", {
  method: "POST",
  body: formData,
});
```

The LLM MUST NOT rely on server content sniffing.

---

### HTTPWEB-003: Encode URLs and query parameters safely

The LLM MUST construct URLs using URL APIs or equivalent safe encoders.

Bad:

```ts
const url = "/api/cases?keyword=" + keyword + "&status=" + status;
```

Good:

```ts
const url = new URL("/api/cases", window.location.origin);
url.searchParams.set("keyword", keyword);
url.searchParams.set("status", status);
```

Mandatory:

- path parameters MUST be encoded;
- query parameters MUST be encoded;
- arrays MUST follow project convention consistently;
- date/time parameters MUST use documented format;
- sensitive values MUST NOT be placed in URLs;
- large or complex filters SHOULD use POST search resource if URL length, privacy, or semantics require it.

Bad:

```text
/api/search?token=secret-access-token
```

Good:

```text
Authorization header or secure cookie, depending on architecture.
```

---

### HTTPWEB-004: Handle browser credential mode explicitly

The LLM MUST understand whether a request uses cookies, authorization headers, or no credentials.

For `fetch`, define credential behavior:

```ts
await fetch("/api/me", {
  credentials: "same-origin",
});
```

For cross-origin cookie-authenticated requests:

```ts
await fetch("https://api.example.com/me", {
  credentials: "include",
});
```

But cross-origin credentials also require correct server-side CORS response headers.

Mandatory:

- do not send credentials to untrusted origins;
- do not use wildcard CORS origin with credentials;
- do not assume cookies are sent on cross-origin requests;
- do not assume `Authorization` header is automatically attached;
- handle expired sessions and token refresh safely;
- distinguish unauthenticated (`401`) from unauthorized (`403`).

---

### HTTPWEB-005: Treat CORS as browser access control, not authorization

The LLM MUST NOT confuse CORS with backend authorization.

CORS controls whether browser JavaScript may read a cross-origin response. It does not prove the requester is authorized.

Mandatory CORS rules:

- allow only required origins;
- avoid `Access-Control-Allow-Origin: *` for authenticated APIs;
- do not combine wildcard origin with credentials;
- allow only required methods and headers;
- expose only required response headers;
- set appropriate `Vary: Origin` when responses differ by origin;
- handle preflight requests at gateway/server;
- keep preflight cache duration intentional;
- never use CORS errors as the only user-facing error model.

Bad:

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

Good:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Vary: Origin
```

Server authorization MUST still check identity and permissions.

---

### HTTPWEB-006: Use cookies only with explicit security attributes

When setting authentication/session cookies, the LLM MUST use secure attributes appropriate to the architecture.

Recommended session cookie pattern:

```http
Set-Cookie: __Host-session=<opaque>; Path=/; Secure; HttpOnly; SameSite=Lax
```

Mandatory:

- `Secure` for production HTTPS cookies;
- `HttpOnly` for cookies not meant to be read by JavaScript;
- `SameSite=Lax` or `Strict` when possible;
- `SameSite=None; Secure` only when third-party/cross-site use is required;
- narrow `Path` and `Domain` where appropriate;
- short and explicit expiry for sensitive cookies;
- clear cookies on logout using matching scope;
- do not store sensitive data directly in cookies unless encrypted/signed and policy-approved;
- do not exceed practical cookie size limits.

The LLM MUST NOT store session secrets in JavaScript-readable cookies unless explicitly required and risk-accepted.

Bad:

```http
Set-Cookie: session=abc123
```

Better:

```http
Set-Cookie: __Host-session=opaque-id; Path=/; Secure; HttpOnly; SameSite=Lax
```

---

### HTTPWEB-007: Protect state-changing cookie-authenticated requests from CSRF

If the web app uses cookies for authentication, the LLM MUST ensure state-changing requests have CSRF protection.

Controls may include:

- SameSite cookies;
- CSRF token bound to session;
- Origin/Referer validation;
- custom request headers with strict CORS;
- double-submit cookie pattern;
- re-authentication for high-risk actions.

Mandatory:

- CSRF validation MUST happen server-side;
- state-changing endpoints MUST NOT use `GET`;
- frontend MUST include CSRF token/header if architecture requires it;
- token refresh and CSRF refresh MUST be coordinated;
- failure MUST produce a clear but safe error response.

Bad:

```http
GET /api/account/delete
```

Good:

```http
DELETE /api/account
X-CSRF-Token: <token>
```

---

### HTTPWEB-008: Handle status codes intentionally

The LLM MUST map status codes to behavior explicitly.

Common browser/API handling:

| Status                       | Meaning                       | Web behavior                                       |
| ---------------------------- | ----------------------------- | -------------------------------------------------- |
| `200 OK`                     | successful read/update        | render result                                      |
| `201 Created`                | resource created              | use `Location` when provided                       |
| `202 Accepted`               | async processing accepted     | poll/SSE/websocket/status resource                 |
| `204 No Content`             | success no body               | do not parse JSON body                             |
| `304 Not Modified`           | cache validation success      | browser/cache handles or client reuses cached data |
| `400 Bad Request`            | malformed request             | show safe error                                    |
| `401 Unauthorized`           | not authenticated             | login/refresh session                              |
| `403 Forbidden`              | authenticated but not allowed | show no-access UX                                  |
| `404 Not Found`              | resource missing or hidden    | show not found where safe                          |
| `409 Conflict`               | state/version conflict        | reload/merge/conflict UX                           |
| `412 Precondition Failed`    | failed conditional request    | handle optimistic locking failure                  |
| `415 Unsupported Media Type` | wrong content type            | fix client/server contract                         |
| `422 Unprocessable Content`  | semantic validation error     | map field errors                                   |
| `429 Too Many Requests`      | rate limited                  | honor `Retry-After` where provided                 |
| `500`                        | server failure                | retry/support flow                                 |
| `502/503/504`                | upstream/unavailable/timeout  | retry/backoff/degraded UX                          |

Bad:

```ts
const data = await response.json();
```

Good:

```ts
if (response.status === 204) return undefined;
if (response.status === 401) return handleUnauthenticated();
if (response.status === 403) return handleForbidden();
if (response.status === 409)
  return handleConflict(await parseProblem(response));
if (!response.ok) throw await parseHttpError(response);
return await response.json();
```

---

### HTTPWEB-009: Use Problem Details or equivalent structured errors

For API responses consumed by web clients, the LLM MUST prefer structured machine-readable errors.

Recommended response:

```http
HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json
```

```json
{
  "type": "https://example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 422,
  "detail": "One or more fields are invalid.",
  "instance": "/cases/123/submissions/abc",
  "errors": [
    {
      "field": "incidentDate",
      "message": "Incident date cannot be in the future."
    }
  ]
}
```

The frontend MUST not parse human text to determine behavior.

Bad:

```ts
if (error.message.includes("duplicate")) showDuplicateDialog();
```

Good:

```ts
if (problem.type === PROBLEM_TYPES.DUPLICATE_CASE) showDuplicateDialog();
```

---

### HTTPWEB-010: Do not blindly parse all responses as JSON

The LLM MUST parse responses based on status and content type.

Required:

- handle `204` and empty responses without JSON parsing;
- inspect `Content-Type` before parsing;
- handle `application/problem+json` separately when useful;
- handle binary/file responses as `blob`/stream;
- handle text responses only when contract says text;
- reject unexpected content type for security-sensitive flows;
- avoid rendering server error HTML inside application UI.

Example:

```ts
async function parseResponse(response: Response) {
  if (response.status === 204) return undefined;

  const contentType = response.headers.get("content-type") ?? "";

  if (
    contentType.includes("application/json") ||
    contentType.includes("application/problem+json")
  ) {
    return response.json();
  }

  if (contentType.startsWith("text/plain")) {
    return response.text();
  }

  throw new Error(`Unsupported response content type: ${contentType}`);
}
```

---

### HTTPWEB-011: Cache HTML, APIs, and static assets differently

The LLM MUST not use one cache policy for all responses.

Recommended defaults:

| Response type             | Suggested cache policy                                     |
| ------------------------- | ---------------------------------------------------------- |
| Main authenticated HTML   | `Cache-Control: no-store` or private policy based on risk  |
| Public HTML               | short TTL + revalidation                                   |
| Hashed static assets      | `Cache-Control: public, max-age=31536000, immutable`       |
| Non-hashed static assets  | short TTL or revalidation                                  |
| Personalized API response | `Cache-Control: private, no-store` or explicit private TTL |
| Public API reference data | explicit TTL + validators                                  |
| Sensitive downloads       | `Cache-Control: no-store`                                  |

Bad:

```http
Cache-Control: public, max-age=31536000
```

for authenticated case details.

Good:

```http
Cache-Control: no-store
```

for sensitive personalized data.

The LLM MUST understand that browser cache, CDN cache, reverse proxy cache, and service worker cache are different layers.

---

### HTTPWEB-012: Use validators for cacheable changing resources

For cacheable resources that change, the LLM SHOULD use validators.

Recommended headers:

```http
ETag: "case-search-v42"
Last-Modified: Wed, 10 Jun 2026 08:00:00 GMT
Cache-Control: private, max-age=60, must-revalidate
```

Conditional request:

```http
If-None-Match: "case-search-v42"
```

Response:

```http
304 Not Modified
```

Mandatory:

- validators MUST represent the selected representation;
- weak vs strong ETags MUST be chosen intentionally;
- personalized responses MUST not be shared-cacheable unless explicitly safe;
- `Vary` MUST be set when representation varies by header such as `Accept-Encoding`, `Accept-Language`, `Origin`, or authorization-related context.

---

### HTTPWEB-013: Use optimistic concurrency for editing stale resources

For web edit flows where stale updates matter, the LLM MUST use versioning or conditional requests.

Preferred HTTP pattern:

```http
GET /api/cases/123
ETag: "v7"
```

```http
PATCH /api/cases/123
If-Match: "v7"
Content-Type: application/json
```

Conflict response:

```http
412 Precondition Failed
Content-Type: application/problem+json
```

The UI MUST provide a recovery path:

- reload latest;
- compare changes;
- reapply changes;
- abandon edit;
- contact support for complex workflow conflicts.

The LLM MUST NOT silently overwrite newer server data.

---

### HTTPWEB-014: Redirects must preserve security and method semantics

The LLM MUST handle redirects intentionally.

Rules:

- use `301/308` for permanent redirects only when safe;
- use `302/303` for post-action navigation when appropriate;
- use `307/308` when method and body must be preserved;
- do not redirect sensitive tokens in URLs;
- avoid open redirects;
- validate redirect targets;
- avoid redirect loops;
- handle login redirect return URLs safely;
- preserve user intent after authentication where safe.

Bad:

```text
/login?returnUrl=https://evil.example/phish
```

Good:

```text
Validate returnUrl is same-origin relative path before redirecting.
```

---

### HTTPWEB-015: Avoid duplicate mutations

The LLM MUST protect mutation flows from accidental duplicate submission.

Required for important actions:

- disable submit while pending;
- show pending state;
- use idempotency keys for retryable create/command requests;
- handle browser refresh after POST safely;
- use POST-Redirect-GET for traditional form flows where appropriate;
- make server mutation idempotency explicit for retries;
- avoid retrying non-idempotent requests unless idempotency key exists.

Example:

```http
POST /api/payment-requests
Idempotency-Key: 5cf4d7f8-...
```

The LLM MUST NOT rely only on disabled buttons. The server MUST be safe under duplicate requests.

---

### HTTPWEB-016: Retry only when safe

The LLM MUST define retry behavior by method, status, idempotency, and user impact.

Safe retry candidates:

- GET failures due to network/timeout;
- idempotent PUT/DELETE where contract confirms safety;
- POST with idempotency key;
- 429/503 when `Retry-After` is present;
- transient gateway errors with capped backoff.

Do not auto-retry:

- non-idempotent POST without idempotency;
- payment/approval/submission actions without duplicate protection;
- validation errors;
- authorization failures;
- user-cancelled requests.

Retry rules:

- cap retry attempts;
- use exponential backoff with jitter;
- cancel retries on route leave or user cancellation;
- show progress/recovery for long operations;
- log safe metadata.

---

### HTTPWEB-017: Polling, SSE, and WebSocket must have lifecycle rules

The LLM MUST not create unbounded realtime loops.

Polling requirements:

- interval defined;
- timeout/maximum duration defined;
- terminal states defined;
- backoff on errors;
- cancellation on route leave;
- visibility/page lifecycle behavior considered;
- auth expiry handled.

SSE/WebSocket requirements:

- reconnection policy;
- heartbeat/idle timeout;
- authentication renewal behavior;
- message schema/versioning;
- duplicate message handling;
- ordering assumptions;
- fallback where required;
- cleanup on page unload/route change.

Bad:

```ts
setInterval(() => fetch("/api/jobs/1"), 1000);
```

Good:

```text
Poll every 2s while job is RUNNING, back off after failures, stop after terminal state or 2 minutes, cancel on route leave.
```

---

### HTTPWEB-018: File downloads must use safe headers and safe client handling

For downloads, the LLM MUST ensure server and client behavior are safe.

Server headers:

```http
Content-Type: application/pdf
Content-Disposition: attachment; filename="case-report.pdf"; filename*=UTF-8''case-report.pdf
Cache-Control: no-store
X-Content-Type-Options: nosniff
```

Client rules:

- do not infer file type solely from filename;
- do not render untrusted HTML inline;
- do not expose sensitive file URLs permanently;
- revoke object URLs after use;
- handle expired signed URLs;
- handle large files with progress where possible;
- require authorization for protected downloads.

Bad:

```ts
window.open(userProvidedUrl);
```

Good:

```ts
const blob = await downloadAuthorizedFile(fileId);
const objectUrl = URL.createObjectURL(blob);
try {
  triggerDownload(objectUrl, safeFilename);
} finally {
  URL.revokeObjectURL(objectUrl);
}
```

---

### HTTPWEB-019: File uploads must not trust browser metadata

The LLM MUST implement upload flows with both UX validation and server enforcement.

Client-side:

- show selected file name safely;
- validate size for immediate feedback;
- show progress for large upload;
- support cancellation;
- handle network failure;
- do not manually set multipart boundary;
- avoid reading entire file into memory unless required.

Server-side:

- enforce size limit;
- validate content type and magic bytes where needed;
- sanitize filename;
- virus/malware scan where required;
- authorize upload target;
- store outside web root or with safe object storage policy;
- return structured errors.

---

### HTTPWEB-020: Security headers must be explicit

For web HTML responses, the LLM SHOULD ensure appropriate security headers exist.

Common baseline:

```http
Content-Security-Policy: default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), microphone=(), camera=()
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

Rules:

- exact CSP MUST be tailored and tested;
- HSTS MUST only be enabled when HTTPS is correctly deployed for the domain/subdomains;
- `frame-ancestors` MUST reflect embedding requirements;
- `Permissions-Policy` SHOULD disable unused powerful APIs;
- do not weaken headers to fix a local integration without security review.

---

### HTTPWEB-021: Avoid mixed content and insecure origins

The LLM MUST NOT introduce HTTP resources into HTTPS pages.

Forbidden on production HTTPS pages:

- `http://` scripts;
- `http://` styles;
- `http://` iframes;
- insecure API calls;
- insecure websocket `ws://` where `wss://` is required;
- insecure image/media when blocked or privacy-sensitive.

All production active content MUST use HTTPS.

---

### HTTPWEB-022: Use `AbortController` or equivalent cancellation for obsolete requests

The LLM MUST cancel or ignore obsolete browser requests when user intent changes.

Examples:

- typeahead search;
- route changes;
- switching tabs;
- closing modal;
- submitting newer form version;
- re-running same query with different filters.

Example:

```ts
let currentController: AbortController | undefined;

async function searchCases(params: SearchParams) {
  currentController?.abort();
  currentController = new AbortController();

  const response = await fetch(buildSearchUrl(params), {
    signal: currentController.signal,
  });

  return parseCaseSearchResponse(response);
}
```

The LLM MUST distinguish cancellation from actual failure in UX and logs.

---

### HTTPWEB-023: Use timeout policy deliberately

Browser `fetch` does not automatically enforce a business timeout for all use cases.

The LLM MUST define timeout behavior where user experience requires it.

Example:

```ts
async function fetchWithTimeout(
  input: RequestInfo,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}
```

Rules:

- timeout value MUST match use case;
- long-running operations SHOULD use async job resources instead of long blocking requests;
- cancellation MUST not leave server mutation ambiguous without recovery status;
- user-facing message MUST distinguish timeout from validation error.

---

### HTTPWEB-024: API clients must centralize cross-cutting HTTP behavior

The LLM MUST avoid scattering raw `fetch` calls with duplicated behavior across the codebase.

A web API client SHOULD centralize:

- base URL;
- credentials mode;
- headers;
- CSRF token injection;
- request ID/correlation ID;
- JSON serialization;
- response parsing;
- Problem Details parsing;
- 401/403 handling;
- retry/backoff rules;
- timeout/cancellation behavior;
- telemetry;
- typed request/response contracts.

Bad:

```ts
// hundreds of inconsistent raw calls
fetch("/api/cases");
fetch(API_URL + "/users", { headers: { token } });
```

Good:

```ts
const cases = await apiClient.get<CaseSearchResult>("/cases", {
  query: { status: "OPEN" },
});
```

The abstraction MUST remain thin and inspectable. Do not build a hidden framework inside an API client.

---

### HTTPWEB-025: Do not expose sensitive data through URLs, headers, logs, or caches

The LLM MUST treat HTTP metadata as potentially visible to logs, browser history, proxies, analytics, and support tooling.

Avoid sensitive data in:

- URL path;
- query string;
- referrer;
- frontend logs;
- analytics events;
- error messages;
- cache keys;
- browser storage;
- source maps;
- custom headers unless required and protected.

Bad:

```text
/reset-password?token=secret-reset-token
```

Better:

```text
Use short-lived one-time token only when required, avoid referrer leakage, and render with no-store/referrer-policy protections.
```

For very sensitive workflows, prefer out-of-band verification and server-side state.

---

### HTTPWEB-026: Use `Vary` when response representation varies

The LLM MUST set `Vary` correctly for cacheable responses.

Common cases:

```http
Vary: Accept-Encoding
Vary: Accept-Language
Vary: Origin
Vary: Accept
```

Rules:

- use `Vary: Origin` for CORS responses that vary by origin;
- use `Vary: Accept-Language` when localized representation is cacheable;
- use `Vary: Accept` when content negotiation changes representation;
- avoid unnecessary `Vary: *` because it disables useful caching;
- never allow shared caches to mix personalized responses.

---

### HTTPWEB-027: Design rate-limit handling for users and clients

When APIs return rate limits, the LLM MUST handle them intentionally.

Required:

- detect `429 Too Many Requests`;
- honor `Retry-After` where provided;
- show useful user message;
- prevent immediate repeated retries;
- avoid multiplying requests from many components;
- log safe metadata;
- consider client-side request coalescing/debouncing.

Bad:

```ts
if (response.status === 429) retryImmediately();
```

Good:

```ts
if (response.status === 429) {
  const retryAfter = parseRetryAfter(response.headers.get("Retry-After"));
  showRateLimitMessage(retryAfter);
  scheduleRetryIfSafe(retryAfter);
}
```

---

### HTTPWEB-028: HTML form fallback behavior must be intentional

For form-based web flows, the LLM MUST decide whether native form submission is supported, enhanced, or replaced.

Rules:

- use `method="post"` for state-changing forms;
- include CSRF token where required;
- use correct input `name` attributes;
- preserve server validation behavior;
- avoid relying only on JavaScript for critical submissions unless product accepts it;
- prevent duplicate submissions;
- use POST-Redirect-GET after successful traditional form submission;
- handle browser password manager/autocomplete behavior intentionally.

Bad:

```html
<form onsubmit="save(); return false;">
  <input id="email" />
</form>
```

Good:

```html
<form method="post" action="/account/email">
  <label for="email">Email</label>
  <input id="email" name="email" type="email" autocomplete="email" required />
  <input type="hidden" name="csrfToken" value="..." />
  <button type="submit">Save</button>
</form>
```

JavaScript may enhance this behavior, but must not accidentally remove validation, accessibility, or recovery behavior.

---

## 5. Recommended Browser HTTP Client Shape

The LLM SHOULD implement or use a project-standard API client with this shape:

```ts
type ApiClientOptions = {
  baseUrl: string;
  credentials?: RequestCredentials;
  getCsrfToken?: () => string | undefined;
  getCorrelationId?: () => string;
  onUnauthenticated?: () => void;
  onForbidden?: () => void;
};

type RequestOptions = {
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
  idempotencyKey?: string;
};

class ApiClient {
  async get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("GET", path, undefined, options);
  }

  async post<T>(
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    return this.request<T>("POST", path, body, options);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    // Build URL safely.
    // Inject Accept, Content-Type, CSRF, correlation ID, idempotency key.
    // Apply credentials mode.
    // Apply timeout/cancellation.
    // Parse by status and content type.
    // Map Problem Details.
    // Handle 401/403 consistently.
    // Emit safe telemetry.
    throw new Error("implementation omitted");
  }
}
```

This is a shape, not a mandate to implement this exact class.

---

## 6. Cache Policy Matrix

The LLM SHOULD use this matrix unless local policy overrides it.

| Surface                               | Cache-Control                            | Notes                                       |
| ------------------------------------- | ---------------------------------------- | ------------------------------------------- |
| Login page                            | `no-store`                               | avoid stale auth UI and token leakage       |
| Authenticated app shell               | `no-store` or controlled private cache   | depends on risk and SSR strategy            |
| Public static HTML                    | short `max-age` + `must-revalidate`      | content freshness matters                   |
| Hashed JS/CSS assets                  | `public, max-age=31536000, immutable`    | filename hash must change on content change |
| API: current user/session             | `no-store`                               | sensitive and changes often                 |
| API: public reference data            | public/private TTL + validators          | depends on data sensitivity                 |
| API: search results with user filters | `private, no-store` or short private TTL | avoid shared cache leakage                  |
| File download sensitive               | `no-store`                               | avoid browser/proxy persistence             |
| Error responses                       | short/no-store depending on status       | avoid caching transient errors incorrectly  |

The LLM MUST check CDN/gateway behavior before assuming headers are honored end-to-end.

---

## 7. Failure Model

The LLM MUST consider these failure modes:

| Failure                  | Expected handling                           |
| ------------------------ | ------------------------------------------- |
| DNS/network failure      | user-visible retry path                     |
| timeout                  | cancel, message, safe retry if applicable   |
| CORS failure             | diagnose as configuration, not API response |
| 401                      | refresh session or redirect to login        |
| 403                      | no-access UX                                |
| 404                      | not found or hidden resource UX             |
| 409/412                  | conflict resolution UX                      |
| 422                      | map validation errors                       |
| 429                      | rate-limit UX and retry-after handling      |
| 500                      | server error UX and correlation ID          |
| 503/504                  | transient unavailable UX                    |
| invalid JSON             | contract error telemetry                    |
| unexpected HTML response | likely gateway/login/proxy issue            |
| aborted request          | no scary error; user changed intent         |

The LLM MUST NOT collapse all failures into "Something went wrong" in critical workflows unless detailed safe logging exists and the UI still provides recovery.

---

## 8. Anti-Patterns

The LLM MUST avoid these patterns:

### 8.1 GET mutation anti-pattern

```http
GET /delete?id=123
```

Use state-changing methods and CSRF/idempotency controls.

### 8.2 Parse-everything-as-JSON anti-pattern

```ts
return response.json();
```

Handle `204`, files, Problem Details, and unexpected content types.

### 8.3 Wildcard authenticated CORS anti-pattern

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

Never use for credentialed APIs.

### 8.4 No-store-everything anti-pattern

Using `no-store` for all assets destroys performance. Static hashed assets should be aggressively cacheable.

### 8.5 Public-cache-private-data anti-pattern

Caching personalized data in shared caches leaks data.

### 8.6 Local retry storm anti-pattern

Many components retrying independently can overload the backend.

### 8.7 Ignoring `Retry-After` anti-pattern

A client that ignores rate-limit hints behaves badly under load.

### 8.8 Manual multipart boundary anti-pattern

Manually setting `Content-Type: multipart/form-data` breaks browser boundary generation.

### 8.9 CORS as auth anti-pattern

CORS is not authorization.

### 8.10 URL secrets anti-pattern

Tokens in URLs leak through history, logs, referrers, and screenshots.

---

## 9. Review Checklist

Before completing browser HTTP work, the LLM MUST verify:

### Request construction

- [ ] Method matches semantics.
- [ ] URLs and query parameters are safely encoded.
- [ ] Sensitive values are not placed in URLs.
- [ ] `Content-Type` and `Accept` are correct.
- [ ] Multipart upload does not manually set boundary.
- [ ] Credentials mode is intentional.
- [ ] CSRF token/header exists where required.

### Response handling

- [ ] Status codes are handled explicitly.
- [ ] `204` is not parsed as JSON.
- [ ] Errors use structured Problem Details or equivalent.
- [ ] File/binary responses are handled safely.
- [ ] Unexpected content types produce safe errors.
- [ ] Correlation IDs are captured when available.

### CORS/cookies/security

- [ ] CORS origins are restricted.
- [ ] Wildcard CORS is not used with credentials.
- [ ] Cookies use `Secure`, `HttpOnly`, and `SameSite` intentionally.
- [ ] State-changing cookie-auth requests have CSRF protection.
- [ ] Security headers are not weakened.
- [ ] Mixed content is not introduced.

### Caching

- [ ] HTML, APIs, and static assets have different cache policies.
- [ ] Sensitive responses are not shared-cacheable.
- [ ] Hashed assets are immutable-cacheable.
- [ ] Validators are used where useful.
- [ ] `Vary` is set when representation varies.

### Resilience

- [ ] Timeouts/cancellation are defined.
- [ ] Obsolete requests are cancelled or ignored.
- [ ] Retry only happens when safe.
- [ ] Duplicate mutation protection exists.
- [ ] Rate limits honor `Retry-After`.
- [ ] Polling/realtime flows have lifecycle cleanup.

### Testing

- [ ] API client behavior is unit tested.
- [ ] Error/status mappings are tested.
- [ ] CORS/cookie assumptions are covered in integration/config tests where possible.
- [ ] Cache/security headers are verified where possible.
- [ ] Critical user journey E2E tests cover failure cases.

---

## 10. Acceptance Criteria

Browser HTTP work is acceptable only when:

1. HTTP method, status, header, body, and media-type semantics are correct.
2. Browser-specific constraints such as CORS, credentials, cookies, redirects, and fetch behavior are handled.
3. Sensitive data is not exposed through URLs, logs, caches, or browser-readable storage.
4. Cookie and CSRF behavior is safe for the authentication model.
5. Caching policy distinguishes HTML, static assets, APIs, and sensitive responses.
6. Status codes map to meaningful UI and recovery behavior.
7. Network failure, timeout, cancellation, retry, and duplicate mutation scenarios are addressed.
8. File upload/download flows are safe.
9. Cross-cutting behavior is centralized enough to avoid inconsistent raw HTTP calls.
10. Tests or verification steps cover meaningful behavior and failure modes.

---

## 11. LLM Enforcement Prompt

Use this instruction when asking an LLM to implement web HTTP work:

```text
You must follow strict-general-standards__http_for_web.md.
Use HTTP methods, status codes, media types, headers, cookies, CORS, caching, redirects, and security headers according to browser-facing HTTP semantics.
Do not use GET for mutations.
Do not expose secrets or sensitive data in URLs, logs, caches, or browser-visible code.
Handle credentials mode, SameSite cookies, CSRF, CORS preflight, 401/403, 409/412, 422, 429, 5xx, timeout, cancellation, and retry behavior explicitly.
Parse responses by status and Content-Type; do not blindly parse every response as JSON.
Use safe cache policies for HTML, APIs, static assets, and sensitive responses.
Centralize cross-cutting HTTP client behavior where appropriate.
If you violate any rule, explicitly justify it and mark it as a risk.
```

---

## 12. References

- RFC 9110 HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110.html
- RFC 9111 HTTP Caching: https://www.rfc-editor.org/rfc/rfc9111.html
- WHATWG Fetch Standard: https://fetch.spec.whatwg.org/
- WHATWG HTML Living Standard: https://html.spec.whatwg.org/multipage/
- RFC 6265 HTTP State Management Mechanism: https://datatracker.ietf.org/doc/html/rfc6265
- HTTPbis Cookies draft / RFC6265bis: https://httpwg.org/http-extensions/draft-ietf-httpbis-rfc6265bis.html
- W3C Content Security Policy Level 3: https://www.w3.org/TR/CSP3/
- W3C Subresource Integrity: https://www.w3.org/TR/sri-2/
- OWASP Web Security Testing Guide: https://owasp.org/www-project-web-security-testing-guide/
- MDN HTTP documentation: https://developer.mozilla.org/en-US/docs/Web/HTTP
