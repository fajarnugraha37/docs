# learn-jaxrs-advanced-part-019.md

# Bagian 019 — CORS, CSRF, Cookies, Browser Security, and REST APIs: Preflight, Credentialed Requests, SameSite, Token Storage, XSS Interaction, Security Headers, dan JAX-RS Implementation

> Target pembaca: Java/Jakarta engineer yang ingin memahami **browser-facing REST API security** secara mendalam. Bagian ini membahas CORS, CSRF, cookies, SameSite, credentialed requests, token storage, browser threat model, XSS interaction, security headers, CORS filter di JAX-RS, CSRF filter, gateway integration, testing, observability, dan production checklist.
>
> Namespace utama: `jakarta.ws.rs.container.ContainerRequestFilter`, `ContainerResponseFilter`, `@PreMatching`, `ContainerRequestContext`, `ContainerResponseContext`, `NewCookie`, `Response`.

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Browser Security Tidak Sama dengan API Security](#2-mental-model-browser-security-tidak-sama-dengan-api-security)
3. [Same-Origin Policy](#3-same-origin-policy)
4. [Origin vs Site vs Host vs Domain](#4-origin-vs-site-vs-host-vs-domain)
5. [CORS: Apa yang Sebenarnya Dilakukan Browser](#5-cors-apa-yang-sebenarnya-dilakukan-browser)
6. [CORS Bukan Authentication/Authorization](#6-cors-bukan-authenticationauthorization)
7. [Simple Request vs Preflighted Request](#7-simple-request-vs-preflighted-request)
8. [Preflight Request: `OPTIONS` + `Origin` + `Access-Control-Request-*`](#8-preflight-request-options--origin--access-control-request-)
9. [CORS Response Headers](#9-cors-response-headers)
10. [`Access-Control-Allow-Origin`](#10-access-control-allow-origin)
11. [`Access-Control-Allow-Credentials`](#11-access-control-allow-credentials)
12. [`Access-Control-Allow-Methods`](#12-access-control-allow-methods)
13. [`Access-Control-Allow-Headers`](#13-access-control-allow-headers)
14. [`Access-Control-Expose-Headers`](#14-access-control-expose-headers)
15. [`Access-Control-Max-Age`](#15-access-control-max-age)
16. [`Vary: Origin`, `Vary: Access-Control-Request-*`](#16-vary-origin-vary-access-control-request-)
17. [Credentialed CORS Requests](#17-credentialed-cors-requests)
18. [Kenapa `Allow-Origin: *` Tidak Boleh untuk Credentials](#18-kenapa-allow-origin--tidak-boleh-untuk-credentials)
19. [Origin Allowlist Strategy](#19-origin-allowlist-strategy)
20. [Dynamic Origin Reflection: Aman atau Berbahaya?](#20-dynamic-origin-reflection-aman-atau-berbahaya)
21. [CORS di JAX-RS: Pre-Matching Request Filter](#21-cors-di-jax-rs-pre-matching-request-filter)
22. [CORS di JAX-RS: Response Filter](#22-cors-di-jax-rs-response-filter)
23. [CORS Filter Production Skeleton](#23-cors-filter-production-skeleton)
24. [CORS dengan Gateway/Load Balancer](#24-cors-dengan-gatewayload-balancer)
25. [CSRF: Apa Itu dan Kenapa Cookie Auth Rentan](#25-csrf-apa-itu-dan-kenapa-cookie-auth-rentan)
26. [CSRF vs CORS vs XSS](#26-csrf-vs-cors-vs-xss)
27. [Kapan REST API Butuh CSRF Protection](#27-kapan-rest-api-butuh-csrf-protection)
28. [CSRF Defense Patterns](#28-csrf-defense-patterns)
29. [Synchronizer Token Pattern](#29-synchronizer-token-pattern)
30. [Double Submit Cookie Pattern](#30-double-submit-cookie-pattern)
31. [Signed Double Submit Cookie](#31-signed-double-submit-cookie)
32. [Custom Header CSRF Defense](#32-custom-header-csrf-defense)
33. [Origin/Referer Validation](#33-originreferer-validation)
34. [SameSite Cookies](#34-samesite-cookies)
35. [`SameSite=Strict`, `Lax`, `None`](#35-samesitestrict-lax-none)
36. [`Secure`, `HttpOnly`, `Path`, `Domain`, `Max-Age`, `Expires`](#36-secure-httponly-path-domain-max-age-expires)
37. [`__Host-` and `__Secure-` Cookie Prefixes](#37-__host--and-__secure--cookie-prefixes)
38. [Cookie Scope and Subdomain Risk](#38-cookie-scope-and-subdomain-risk)
39. [Session Cookie vs JWT Cookie](#39-session-cookie-vs-jwt-cookie)
40. [Bearer Token di Browser: LocalStorage, SessionStorage, Memory](#40-bearer-token-di-browser-localstorage-sessionstorage-memory)
41. [XSS Interaction: Kenapa Token Storage Selalu Trade-Off](#41-xss-interaction-kenapa-token-storage-selalu-trade-off)
42. [BFF Pattern: Backend-for-Frontend](#42-bff-pattern-backend-for-frontend)
43. [SPA + API Security Patterns](#43-spa--api-security-patterns)
44. [Security Headers untuk Browser-Facing APIs](#44-security-headers-untuk-browser-facing-apis)
45. [Content Security Policy/CSP](#45-content-security-policycsp)
46. [`X-Content-Type-Options: nosniff`](#46-x-content-type-options-nosniff)
47. [Frame Protection: `frame-ancestors` dan `X-Frame-Options`](#47-frame-protection-frame-ancestors-dan-x-frame-options)
48. [Referrer Policy](#48-referrer-policy)
49. [HSTS](#49-hsts)
50. [COOP, COEP, CORP, Fetch Metadata](#50-coop-coep-corp-fetch-metadata)
51. [Fetch Metadata Headers: `Sec-Fetch-*`](#51-fetch-metadata-headers-sec-fetch-)
52. [JAX-RS CSRF Filter Skeleton](#52-jax-rs-csrf-filter-skeleton)
53. [JAX-RS Cookie Issuing with `NewCookie`](#53-jax-rs-cookie-issuing-with-newcookie)
54. [Login, Refresh, Logout Flow](#54-login-refresh-logout-flow)
55. [Refresh Token Rotation](#55-refresh-token-rotation)
56. [Logout and Cookie Clearing](#56-logout-and-cookie-clearing)
57. [Preflight Caching and Operational Effects](#57-preflight-caching-and-operational-effects)
58. [CORS Error Debugging](#58-cors-error-debugging)
59. [CSRF Error Debugging](#59-csrf-error-debugging)
60. [Observability and Safe Logging](#60-observability-and-safe-logging)
61. [Testing CORS](#61-testing-cors)
62. [Testing CSRF](#62-testing-csrf)
63. [Testing Cookies](#63-testing-cookies)
64. [Testing Token Storage/Browser Flows](#64-testing-token-storagebrowser-flows)
65. [Runtime Differences and Deployment Topology](#65-runtime-differences-and-deployment-topology)
66. [Common Failure Modes](#66-common-failure-modes)
67. [Best Practices](#67-best-practices)
68. [Anti-Patterns](#68-anti-patterns)
69. [Production Checklist](#69-production-checklist)
70. [Latihan](#70-latihan)
71. [Referensi Resmi](#71-referensi-resmi)
72. [Penutup](#72-penutup)

---

# 1. Tujuan Part Ini

Pada part sebelumnya, kita membahas security JAX-RS secara umum:

```text
authentication
authorization
SecurityContext
roles/scopes
tenant/data authorization
```

Sekarang kita masuk ke satu konteks khusus yang sangat sering salah dipahami:

```text
REST API yang dipanggil dari browser.
```

Browser punya aturan security sendiri:

- same-origin policy;
- CORS;
- cookie behavior;
- SameSite;
- preflight;
- credentialed requests;
- forbidden headers;
- automatic cookie sending;
- JavaScript-readable storage;
- XSS/CSRF interactions.

Banyak vulnerability muncul karena engineer mengira:

```text
CORS sudah aman, jadi auth tidak perlu ketat.
SameSite sudah cukup, jadi CSRF token tidak perlu.
HttpOnly cookie aman dari semua serangan.
Bearer token di localStorage praktis, jadi aman.
API hanya JSON, jadi browser security tidak penting.
```

Semua pernyataan ini terlalu menyederhanakan masalah.

## 1.1 Target akhir

Setelah bagian ini, kamu bisa:

- menjelaskan CORS dengan benar;
- mendesain preflight handling di JAX-RS;
- membedakan CORS, CSRF, XSS;
- memilih cookie/session/token strategy untuk browser;
- mengatur `SameSite`, `Secure`, `HttpOnly`;
- membangun CSRF filter;
- menghindari `Access-Control-Allow-Origin: *` untuk credentialed requests;
- menguji browser-facing API secara benar;
- menentukan apakah CORS di app atau gateway;
- membuat production checklist security browser.

---

# 2. Mental Model: Browser Security Tidak Sama dengan API Security

Browser adalah special client.

Server-to-server client seperti curl, backend service, atau mobile app tidak tunduk pada CORS seperti browser.

## 2.1 Browser has ambient authority

Jika user login ke `https://api.example.com` dengan cookie, browser dapat otomatis mengirim cookie pada request yang memenuhi aturan cookie.

Ini berbahaya untuk CSRF.

## 2.2 Browser protects reading, not always sending

Same-origin/CORS terutama membatasi apakah JavaScript di origin A boleh membaca response dari origin B.

Namun dalam banyak situasi, browser masih bisa mengirim request ke origin lain.

## 2.3 API authentication tetap wajib

CORS bukan auth.

Jika endpoint protected:

```text
Always authenticate and authorize.
```

## 2.4 Top-tier rule

```text
CORS controls browser access to responses.
CSRF controls unwanted authenticated state-changing requests.
XSS controls attacker JavaScript inside your trusted origin.
Authentication/authorization controls API access.
```

---

# 3. Same-Origin Policy

Same-origin policy membatasi interaksi script antar origin.

Origin terdiri dari:

```text
scheme + host + port
```

Contoh:

```text
https://app.example.com:443
```

## 3.1 Same origin

```text
https://app.example.com/page
https://app.example.com/api
```

Same origin jika scheme/host/port sama.

## 3.2 Cross origin

```text
https://app.example.com
https://api.example.com
```

Cross origin karena host berbeda.

```text
http://app.example.com
https://app.example.com
```

Cross origin karena scheme berbeda.

```text
https://app.example.com:443
https://app.example.com:8443
```

Cross origin karena port berbeda.

## 3.3 Why important?

Browser JavaScript di satu origin tidak bebas membaca data dari origin lain kecuali server target mengizinkan via CORS.

## 3.4 Rule

Origin is stricter than “same domain family”.

---

# 4. Origin vs Site vs Host vs Domain

## 4.1 Origin

```text
scheme + host + port
```

Used by CORS.

## 4.2 Site

Used by SameSite cookie semantics.

Roughly scheme + registrable domain.

Examples:

```text
app.example.com
api.example.com
```

may be same-site but cross-origin.

## 4.3 Host

Exact hostname.

```text
api.example.com
```

## 4.4 Domain attribute

Cookie Domain controls which hosts receive cookie.

## 4.5 Why matters?

CORS works by origin.

SameSite works by site.

Cookies may be scoped by domain/path.

## 4.6 Example

```text
https://app.example.com → https://api.example.com
```

Cross-origin for CORS.

Potentially same-site for cookies.

## 4.7 Rule

Do not confuse same-site cookies with same-origin CORS.

---

# 5. CORS: Apa yang Sebenarnya Dilakukan Browser

CORS adalah mekanisme berbasis HTTP headers yang memungkinkan server menyatakan origin mana yang boleh membaca response dari browser.

## 5.1 Server says

```http
Access-Control-Allow-Origin: https://app.example.com
```

Browser sees this and allows frontend JavaScript from that origin to access response.

## 5.2 Without CORS

The browser may still send request, but JavaScript cannot read response.

## 5.3 CORS does not protect server

Server must still authenticate/authorize.

## 5.4 CORS is enforced by browser

Backend-to-backend clients ignore it.

## 5.5 Rule

CORS is a browser-enforced read permission model.

---

# 6. CORS Bukan Authentication/Authorization

## 6.1 Bad assumption

```text
Only allowed origin can call API.
```

Wrong.

Non-browser clients can call API without CORS.

## 6.2 Origin header can be absent/spoofed outside browser

Do not use Origin as sole authentication.

## 6.3 CORS allowlist reduces browser exposure

It helps prevent malicious websites from reading responses via victim browser.

## 6.4 Still need

- authentication;
- authorization;
- CSRF protection if cookies;
- rate limiting;
- validation.

## 6.5 Rule

CORS is not access control for your API as a whole.

---

# 7. Simple Request vs Preflighted Request

Browsers classify some cross-origin requests as simple and others as preflighted.

## 7.1 Simple request

Can be sent directly if method/header/content type qualify.

Common simple methods:

```text
GET
HEAD
POST
```

with restricted headers and content types.

## 7.2 Preflighted request

Browser sends `OPTIONS` first to ask permission.

Common triggers:

- `Authorization` header;
- custom headers;
- methods like PUT/PATCH/DELETE;
- JSON `Content-Type: application/json`;
- non-simple request headers.

## 7.3 Important

A POST form request may be simple and skip preflight.

This is why CSRF can still happen.

## 7.4 Rule

Preflight is not a security guarantee by itself.

---

# 8. Preflight Request: `OPTIONS` + `Origin` + `Access-Control-Request-*`

Preflight request shape:

```http
OPTIONS /api/customers
Origin: https://app.example.com
Access-Control-Request-Method: POST
Access-Control-Request-Headers: authorization, content-type, idempotency-key
```

## 8.1 Server response

```http
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,OPTIONS
Access-Control-Allow-Headers: authorization,content-type,idempotency-key
Access-Control-Allow-Credentials: true
Access-Control-Max-Age: 600
Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers
```

## 8.2 No business method invoked

Preflight should not create/update/delete data.

## 8.3 Auth on preflight?

Usually do not require application auth for preflight because browser typically does not include credentials in preflight in the same way actual request does.

But still validate origin/method/headers.

## 8.4 Rule

Preflight validates browser permission, not business authorization.

---

# 9. CORS Response Headers

Important headers:

```text
Access-Control-Allow-Origin
Access-Control-Allow-Credentials
Access-Control-Allow-Methods
Access-Control-Allow-Headers
Access-Control-Expose-Headers
Access-Control-Max-Age
Vary
```

## 9.1 Actual response

For actual request, usually include:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Vary: Origin
```

If frontend needs to read custom headers:

```http
Access-Control-Expose-Headers: X-Correlation-ID, Location, ETag
```

## 9.2 Preflight response

Includes allowed methods/headers/max age.

## 9.3 Rule

CORS headers differ between preflight and actual response.

---

# 10. `Access-Control-Allow-Origin`

## 10.1 Specific origin

```http
Access-Control-Allow-Origin: https://app.example.com
```

## 10.2 Wildcard

```http
Access-Control-Allow-Origin: *
```

Allows any origin for non-credentialed reads.

## 10.3 Dynamic allowlist

If request origin is allowed:

```http
Access-Control-Allow-Origin: <request Origin>
Vary: Origin
```

## 10.4 Do not blindly reflect

Bad:

```java
response.header("Access-Control-Allow-Origin", requestOrigin);
```

without allowlist.

## 10.5 Rule

Allow only known origins. Reflect only after allowlist validation.

---

# 11. `Access-Control-Allow-Credentials`

This header tells browser whether credentials are allowed in cross-origin requests.

```http
Access-Control-Allow-Credentials: true
```

Credentials include cookies, TLS client certificates, and authentication headers.

## 11.1 Only valid value

`true`.

If credentials are not needed, omit the header.

## 11.2 Client side

Fetch:

```js
fetch(url, { credentials: "include" })
```

XHR:

```js
xhr.withCredentials = true
```

## 11.3 Security impact

Credentialed CORS plus cookies means CSRF considerations become very important.

## 11.4 Rule

Do not enable credentials unless the API really needs browser-sent credentials.

---

# 12. `Access-Control-Allow-Methods`

Preflight response header:

```http
Access-Control-Allow-Methods: GET,POST,PUT,PATCH,DELETE,OPTIONS
```

## 12.1 Should match policy

Do not allow every method if not needed.

## 12.2 Preflight request asks one method

```http
Access-Control-Request-Method: PATCH
```

Server should allow only if origin/method combination is valid.

## 12.3 Rule

Allowed methods should be policy-driven, not universal by habit.

---

# 13. `Access-Control-Allow-Headers`

Preflight response header:

```http
Access-Control-Allow-Headers: authorization,content-type,idempotency-key,x-csrf-token
```

## 13.1 Custom headers trigger preflight

Examples:

```text
Authorization
X-CSRF-Token
Idempotency-Key
X-Request-ID
```

## 13.2 Do not blindly echo

Bad:

```java
allowHeaders = request.getHeader("Access-Control-Request-Headers")
```

without validation.

## 13.3 Header allowlist

Maintain allowed headers.

## 13.4 Rule

Allow only headers your API actually supports.

---

# 14. `Access-Control-Expose-Headers`

By default, browser JavaScript can only read simple response headers.

If frontend needs custom headers, expose them.

## 14.1 Example

```http
Access-Control-Expose-Headers: Location, ETag, X-Correlation-ID, X-RateLimit-Remaining
```

## 14.2 Use cases

- `Location` after create;
- `ETag` for conditional update;
- correlation ID for support;
- rate limit headers.

## 14.3 Do not expose sensitive headers

Never expose tokens/secrets.

## 14.4 Rule

Expose only headers frontend needs.

---

# 15. `Access-Control-Max-Age`

Preflight response can be cached by browser.

```http
Access-Control-Max-Age: 600
```

## 15.1 Benefit

Reduces OPTIONS traffic.

## 15.2 Risk

Policy changes may take time to apply to browser cache.

## 15.3 Browser caps

Browsers may cap max age.

## 15.4 Recommendation

Use moderate values.

Example:

```text
300–600 seconds
```

for dynamic APIs.

## 15.5 Rule

Preflight cache is operational tuning, not security control.

---

# 16. `Vary: Origin`, `Vary: Access-Control-Request-*`

If response CORS headers vary by request origin, caches must know.

## 16.1 Actual response

```http
Vary: Origin
```

## 16.2 Preflight response

```http
Vary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers
```

## 16.3 Without Vary

A proxy/CDN can cache response for one origin and serve it to another.

## 16.4 Rule

Dynamic CORS responses require `Vary`.

---

# 17. Credentialed CORS Requests

Credentialed request means browser includes credentials.

## 17.1 Cookies

```js
fetch("https://api.example.com/me", {
  credentials: "include"
})
```

## 17.2 Authorization header

```js
fetch(url, {
  headers: { Authorization: `Bearer ${token}` }
})
```

This is a credential and triggers CORS rules/preflight.

## 17.3 Server requirements

For cookies:

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
```

## 17.4 Wildcard not allowed with credentials

Browser rejects credentialed CORS response with wildcard origin.

## 17.5 Rule

Credentialed CORS must use specific allowed origin, not `*`.

---

# 18. Kenapa `Allow-Origin: *` Tidak Boleh untuk Credentials

If server allows credentials and any origin, malicious websites could read authenticated responses from victim browser.

Browsers prevent this combination.

## 18.1 Bad config

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

Browser will reject.

## 18.2 Correct

```http
Access-Control-Allow-Origin: https://app.example.com
Access-Control-Allow-Credentials: true
Vary: Origin
```

## 18.3 Rule

Wildcard is only for non-credentialed public resources.

---

# 19. Origin Allowlist Strategy

## 19.1 Static allowlist

```text
https://app.example.com
https://admin.example.com
```

## 19.2 Environment-specific

DEV/UAT/PROD have different origins.

## 19.3 Avoid regex too broad

Bad:

```text
*.example.com
```

if subdomains are not equally trusted.

## 19.4 Normalize origin

Compare scheme/host/port exactly.

## 19.5 Store config

Use environment config, not hardcoded scattered strings.

## 19.6 Rule

Origin allowlist is security configuration.

---

# 20. Dynamic Origin Reflection: Aman atau Berbahaya?

Dynamic reflection means:

```http
Origin: https://foo.example
```

Response:

```http
Access-Control-Allow-Origin: https://foo.example
```

## 20.1 Safe only with allowlist

```java
if (allowedOrigins.contains(origin)) {
    allowOrigin(origin);
}
```

## 20.2 Dangerous without allowlist

Allows any malicious origin to read responses.

## 20.3 Null origin

Requests can have:

```text
Origin: null
```

Do not allow unless specific need.

## 20.4 Rule

Never reflect Origin blindly.

---

# 21. CORS di JAX-RS: Pre-Matching Request Filter

Preflight should be handled before resource matching because many resources don't implement `OPTIONS`.

## 21.1 Filter

```java
@Provider
@PreMatching
@Priority(Priorities.HEADER_DECORATOR)
public class CorsPreflightFilter implements ContainerRequestFilter {
    ...
}
```

## 21.2 Detect preflight

```java
boolean isPreflight =
    "OPTIONS".equalsIgnoreCase(ctx.getMethod())
    && ctx.getHeaderString("Origin") != null
    && ctx.getHeaderString("Access-Control-Request-Method") != null;
```

## 21.3 Abort with 204

```java
ctx.abortWith(Response.noContent()
    .header("Access-Control-Allow-Origin", origin)
    .header("Access-Control-Allow-Methods", methods)
    .header("Access-Control-Allow-Headers", headers)
    .build());
```

## 21.4 Rule

CORS preflight is a protocol response; do not route it to business resource methods.

---

# 22. CORS di JAX-RS: Response Filter

Actual responses also need CORS headers.

## 22.1 Response filter

```java
@Provider
public class CorsActualResponseFilter implements ContainerResponseFilter {

    @Override
    public void filter(ContainerRequestContext req, ContainerResponseContext res) {
        String origin = req.getHeaderString("Origin");
        if (origin == null || !corsPolicy.isAllowedOrigin(origin)) {
            return;
        }

        res.getHeaders().putSingle("Access-Control-Allow-Origin", origin);
        res.getHeaders().putSingle("Access-Control-Allow-Credentials", "true");
        res.getHeaders().add("Vary", "Origin");
    }
}
```

## 22.2 Run for errors too

Global response filter ensures errors include CORS headers, so frontend can read Problem Details.

## 22.3 Security

Only add headers for allowed origins.

## 22.4 Rule

CORS headers must be applied consistently to success and error responses.

---

# 23. CORS Filter Production Skeleton

## 23.1 Policy

```java
public interface CorsPolicy {
    boolean isAllowedOrigin(String origin);
    boolean isAllowedMethod(String origin, String method);
    boolean areAllowedHeaders(String origin, Set<String> headers);
    boolean allowCredentials(String origin);
    Set<String> exposedHeaders(String origin);
    Duration maxAge(String origin);
}
```

## 23.2 Preflight filter

```java
@Provider
@PreMatching
public class CorsPreflightFilter implements ContainerRequestFilter {

    private final CorsPolicy policy;

    public CorsPreflightFilter(CorsPolicy policy) {
        this.policy = policy;
    }

    @Override
    public void filter(ContainerRequestContext ctx) {
        String origin = ctx.getHeaderString("Origin");
        String requestedMethod = ctx.getHeaderString("Access-Control-Request-Method");

        if (!"OPTIONS".equalsIgnoreCase(ctx.getMethod()) || origin == null || requestedMethod == null) {
            return;
        }

        Set<String> requestedHeaders = parseHeaderList(
            ctx.getHeaderString("Access-Control-Request-Headers")
        );

        if (!policy.isAllowedOrigin(origin)
            || !policy.isAllowedMethod(origin, requestedMethod)
            || !policy.areAllowedHeaders(origin, requestedHeaders)) {
            ctx.abortWith(Response.status(Response.Status.FORBIDDEN)
                .type("application/problem+json")
                .entity(problem("CORS_PREFLIGHT_DENIED"))
                .build());
            return;
        }

        Response.ResponseBuilder rb = Response.noContent()
            .header("Access-Control-Allow-Origin", origin)
            .header("Access-Control-Allow-Methods", requestedMethod)
            .header("Access-Control-Allow-Headers", String.join(",", requestedHeaders))
            .header("Access-Control-Max-Age", policy.maxAge(origin).toSeconds())
            .header("Vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers");

        if (policy.allowCredentials(origin)) {
            rb.header("Access-Control-Allow-Credentials", "true");
        }

        ctx.abortWith(rb.build());
    }
}
```

## 23.3 Actual response filter

```java
@Provider
public class CorsActualResponseFilter implements ContainerResponseFilter {

    private final CorsPolicy policy;

    public CorsActualResponseFilter(CorsPolicy policy) {
        this.policy = policy;
    }

    @Override
    public void filter(ContainerRequestContext req, ContainerResponseContext res) {
        String origin = req.getHeaderString("Origin");
        if (origin == null || !policy.isAllowedOrigin(origin)) {
            return;
        }

        res.getHeaders().putSingle("Access-Control-Allow-Origin", origin);
        res.getHeaders().add("Vary", "Origin");

        if (policy.allowCredentials(origin)) {
            res.getHeaders().putSingle("Access-Control-Allow-Credentials", "true");
        }

        Set<String> exposed = policy.exposedHeaders(origin);
        if (!exposed.isEmpty()) {
            res.getHeaders().putSingle("Access-Control-Expose-Headers", String.join(",", exposed));
        }
    }
}
```

## 23.4 Notes

- Use DI/constructor according to runtime.
- Normalize header names.
- Avoid blind echo.
- Add tests.

## 23.5 Rule

Production CORS should be policy-driven, not string concatenation scattered in filters.

---

# 24. CORS dengan Gateway/Load Balancer

CORS can be handled at:

- application;
- API gateway;
- ingress;
- load balancer;
- CDN.

## 24.1 Gateway advantages

- centralized;
- consistent;
- preflight handled before app;
- easier ops config;
- reduces app code.

## 24.2 App advantages

- endpoint-specific policy;
- access to resource metadata;
- easier tests with app contract;
- dynamic per-tenant origin if needed.

## 24.3 Avoid double CORS

If both gateway and app set CORS, headers may conflict.

## 24.4 Rule

Choose one owner for CORS unless you have a very clear layered reason.

---

# 25. CSRF: Apa Itu dan Kenapa Cookie Auth Rentan

CSRF happens when a malicious site tricks authenticated user's browser into sending unwanted request to trusted site.

## 25.1 Core issue

Browser automatically includes cookies for eligible requests.

## 25.2 Example

User logged into:

```text
https://bank.example.com
```

Malicious page triggers:

```html
<form action="https://bank.example.com/transfer" method="POST">
...
</form>
```

Browser may include session cookie.

## 25.3 Target cannot distinguish

Without CSRF defense, server sees authenticated request.

## 25.4 CORS is not enough

CSRF can exploit requests even if malicious site cannot read response.

## 25.5 Rule

Cookie-authenticated state-changing browser endpoints need CSRF defense.

---

# 26. CSRF vs CORS vs XSS

## 26.1 CSRF

Attacker causes victim browser to send request with victim credentials.

Goal:

```text
perform unwanted action
```

## 26.2 CORS

Browser rule deciding whether JS can read cross-origin response.

Goal:

```text
control cross-origin read access
```

## 26.3 XSS

Attacker runs JavaScript inside trusted origin.

Goal:

```text
steal data, call API as user, modify page, exfiltrate tokens
```

## 26.4 Relationship

- CORS does not stop CSRF.
- CSRF token does not stop XSS if attacker can read token.
- HttpOnly cookie helps against token theft via JS, but XSS can still perform actions as user.
- SameSite helps CSRF but not XSS.

## 26.5 Rule

Browser security requires layered defenses.

---

# 27. Kapan REST API Butuh CSRF Protection

## 27.1 Needs CSRF protection

If all are true:

- browser can call API;
- API uses cookies/session or browser-automatically-sent credentials;
- endpoint changes state or exposes sensitive action.

## 27.2 Usually less CSRF-prone

If API uses bearer token stored in JS memory and sent via Authorization header manually.

But XSS risk increases.

## 27.3 Still consider CSRF

If bearer token is stored in cookie and automatically sent.

## 27.4 Safe methods

GET/HEAD should be safe and not change state.

If GET changes state, CSRF becomes worse.

## 27.5 Rule

CSRF protection depends on credential delivery model.

---

# 28. CSRF Defense Patterns

Common patterns:

- Synchronizer token;
- Double submit cookie;
- Signed double submit cookie;
- Custom header;
- SameSite cookies;
- Origin/Referer validation;
- re-authentication for sensitive actions.

## 28.1 Defense in depth

Use multiple when appropriate.

Example:

```text
SameSite=Lax/Strict + CSRF token + Origin check
```

## 28.2 Do not rely on one weak signal

Origin/Referer can be absent in some cases.

SameSite has compatibility/flow trade-offs.

## 28.3 Rule

Use at least one strong anti-CSRF token pattern for cookie-authenticated state-changing APIs.

---

# 29. Synchronizer Token Pattern

Server stores CSRF token in session.

## 29.1 Flow

1. User loads page.
2. Server generates token and stores in session.
3. Page sends token with state-changing request.
4. Server compares token to session.

## 29.2 Header

```http
X-CSRF-Token: <token>
```

## 29.3 Pros

- strong;
- token bound to session;
- common.

## 29.4 Cons

- requires server session;
- token distribution to frontend;
- XSS can read token if exposed to JS.

## 29.5 Rule

Synchronizer token is strong for server-rendered/session apps.

---

# 30. Double Submit Cookie Pattern

Server sends CSRF token cookie.

Client JS reads token and sends same value in header.

## 30.1 Flow

```http
Set-Cookie: csrf_token=random; SameSite=...
```

JS reads cookie and sends:

```http
X-CSRF-Token: random
```

Server checks header equals cookie.

## 30.2 Pros

- stateless;
- simple for SPA.

## 30.3 Weakness

Naive double-submit can be vulnerable if attacker can set cookie for domain/subdomain.

## 30.4 Better

Use signed double-submit token bound to session/user.

## 30.5 Rule

If using double submit, prefer signed token bound to session.

---

# 31. Signed Double Submit Cookie

Token contains random value plus HMAC over session/user binding.

## 31.1 Example conceptual token

```text
base64(random).base64(hmac(secret, sessionId + "." + random))
```

## 31.2 Server verifies

- cookie token equals header token;
- signature valid;
- binding matches session/user;
- token not expired if encoded.

## 31.3 Pros

- stateless verification;
- resists cookie injection better than naive pattern.

## 31.4 Do not put raw session ID in token

Use HMAC binding internally.

## 31.5 Rule

Signed double-submit is a strong SPA-friendly CSRF pattern.

---

# 32. Custom Header CSRF Defense

Browsers cannot send arbitrary custom headers from simple HTML forms.

Requiring a custom header can force CORS preflight.

## 32.1 Example

```http
X-CSRF-Token: ...
```

or even:

```http
X-Requested-With: XMLHttpRequest
```

## 32.2 Better with token

Custom header alone is weaker than token validation.

## 32.3 CORS allowlist required

Only trusted origins should be allowed to send that custom header cross-origin.

## 32.4 Rule

Custom header is useful, but stronger when combined with CSRF token and CORS allowlist.

---

# 33. Origin/Referer Validation

Server can check:

```http
Origin
Referer
```

## 33.1 Origin

Often present for CORS and state-changing requests.

## 33.2 Referer

Can include full URL; may be suppressed by privacy policy.

## 33.3 Use as defense-in-depth

Reject state-changing cookie-auth requests from unexpected origins.

## 33.4 Do not rely solely

Headers can be absent in legitimate cases and are not a replacement for token pattern.

## 33.5 Rule

Origin/Referer checks are useful secondary CSRF controls.

---

# 34. SameSite Cookies

SameSite limits when cookies are sent with cross-site requests.

## 34.1 Values

```text
Strict
Lax
None
```

## 34.2 Security value

Reduces CSRF by limiting cross-site cookie sending.

## 34.3 Compatibility

Some login/OIDC/payment flows need cross-site cookies.

## 34.4 Same-site is not same-origin

`app.example.com` and `api.example.com` may be same-site but cross-origin.

## 34.5 Rule

SameSite helps CSRF but does not replace full CSRF strategy for all apps.

---

# 35. `SameSite=Strict`, `Lax`, `None`

## 35.1 Strict

Cookie sent only for same-site requests.

Best CSRF protection but can break cross-site navigation/login flows.

## 35.2 Lax

Cookie sent for same-site requests and some top-level cross-site navigations.

Often default-ish modern baseline.

## 35.3 None

Cookie sent for same-site and cross-site requests.

Requires `Secure` in modern browsers.

Needed for third-party/cross-site embedding scenarios.

## 35.4 Recommendation

- session cookie: `Lax` or `Strict` if flow allows;
- cross-site SPA/API with cookies: often needs `None; Secure`, then CSRF controls are critical;
- sensitive admin: prefer Strict if possible.

## 35.5 Rule

SameSite choice is product/auth-flow decision, not default copy-paste.

---

# 36. `Secure`, `HttpOnly`, `Path`, `Domain`, `Max-Age`, `Expires`

## 36.1 Secure

Cookie only sent over secure channels.

Use for all auth cookies.

## 36.2 HttpOnly

Cookie not accessible to JavaScript via `document.cookie`.

Helps reduce token theft under XSS.

## 36.3 Path

Limits URL path scope.

Not a strong security boundary.

## 36.4 Domain

Controls host/subdomain scope.

Omit Domain for host-only cookie when possible.

## 36.5 Max-Age/Expires

Controls lifetime.

Use short sessions for sensitive systems.

## 36.6 Rule

Auth cookies should normally be `Secure; HttpOnly; SameSite=...` and host-scoped if possible.

---

# 37. `__Host-` and `__Secure-` Cookie Prefixes

Cookie prefixes add browser-enforced restrictions.

## 37.1 `__Secure-`

Cookie name beginning with `__Secure-` requires `Secure`.

## 37.2 `__Host-`

Cookie name beginning with `__Host-` requires:

- `Secure`;
- `Path=/`;
- no `Domain` attribute.

This makes cookie host-only and closer to origin boundary.

## 37.3 Example

```http
Set-Cookie: __Host-session=abc; Path=/; Secure; HttpOnly; SameSite=Lax
```

## 37.4 Rule

Use `__Host-` prefix for high-value host-scoped session cookies when possible.

---

# 38. Cookie Scope and Subdomain Risk

## 38.1 Domain cookie

```http
Domain=.example.com
```

Cookie can be sent to subdomains.

## 38.2 Risk

If any subdomain is compromised, cookie scope can be abused depending protections.

## 38.3 Host-only cookie

Omit Domain.

Cookie only for exact host.

## 38.4 Path not enough

Path cannot be relied on as strong security isolation.

## 38.5 Rule

Prefer host-only cookies for authentication.

---

# 39. Session Cookie vs JWT Cookie

## 39.1 Session cookie

Cookie stores opaque session ID.

Server stores session state.

Pros:

- revocation easy;
- small cookie;
- no claims leakage;
- mature.

Cons:

- server state;
- scaling session store.

## 39.2 JWT cookie

Cookie stores JWT.

Pros:

- stateless-ish;
- carries claims.

Cons:

- revocation harder;
- larger;
- claims exposure if not encrypted;
- rotation complexity.

## 39.3 Both can be CSRF-prone

If browser sends cookie automatically, CSRF matters.

## 39.4 Rule

Cookie transport drives CSRF risk regardless of token format.

---

# 40. Bearer Token di Browser: LocalStorage, SessionStorage, Memory

## 40.1 LocalStorage

Persists across tabs/restarts.

Readable by JavaScript.

XSS can steal.

## 40.2 SessionStorage

Per-tab-ish.

Readable by JavaScript.

XSS can steal.

## 40.3 Memory

Not persisted.

Still accessible to running malicious JS if XSS exists in same context.

Better against persistent theft but harder UX.

## 40.4 HttpOnly cookie

Not readable by JS, but automatically sent, creating CSRF considerations.

## 40.5 Rule

There is no perfect token storage in browser. Choose based on threat model.

---

# 41. XSS Interaction: Kenapa Token Storage Selalu Trade-Off

## 41.1 Token in JS storage

XSS can read and exfiltrate token.

## 41.2 Token in HttpOnly cookie

XSS cannot read cookie directly, but can call API as user from same origin.

## 41.3 CSRF token

XSS can read CSRF token if exposed to JS.

## 41.4 CSP helps

CSP reduces XSS impact but does not replace secure coding.

## 41.5 Rule

Prevent XSS aggressively regardless of token strategy.

---

# 42. BFF Pattern: Backend-for-Frontend

BFF places a backend between browser and API.

## 42.1 Flow

```text
Browser ↔ BFF ↔ Backend APIs
```

Browser uses secure same-site cookies to BFF.

BFF calls backend APIs server-to-server.

## 42.2 Benefits

- tokens not exposed to JS;
- CORS simplified;
- CSRF manageable;
- backend tokens stored server-side;
- UI-specific aggregation.

## 42.3 Costs

- extra service;
- operational complexity;
- BFF must enforce security.

## 42.4 Good fit

High-security browser apps.

## 42.5 Rule

BFF is often safer than exposing long-lived API tokens to browser JS.

---

# 43. SPA + API Security Patterns

## 43.1 SPA same-origin with API

Serve SPA and API from same origin.

Simplifies CORS.

Cookies can be SameSite.

## 43.2 SPA cross-origin with cookie API

Requires credentialed CORS and CSRF.

## 43.3 SPA with OAuth access token in memory

Avoids CSRF from automatic cookies, but XSS risk.

## 43.4 SPA + BFF

Strong pattern for sensitive systems.

## 43.5 Rule

Frontend architecture determines API security controls.

---

# 44. Security Headers untuk Browser-Facing APIs

Useful headers:

```http
Content-Security-Policy
X-Content-Type-Options
Referrer-Policy
Strict-Transport-Security
X-Frame-Options
Permissions-Policy
Cross-Origin-Opener-Policy
Cross-Origin-Resource-Policy
Cross-Origin-Embedder-Policy
```

## 44.1 API vs HTML

JSON API still benefits from some headers, especially:

```http
X-Content-Type-Options: nosniff
Cache-Control
Referrer-Policy
```

## 44.2 HTML-serving endpoints need more

If JAX-RS serves HTML, CSP/frame headers become critical.

## 44.3 Rule

Security headers should be set consistently, often at gateway/server plus app where needed.

---

# 45. Content Security Policy/CSP

CSP helps reduce XSS impact by restricting script/resource loading.

## 45.1 Example

```http
Content-Security-Policy: default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'
```

## 45.2 For JSON API

If endpoint only returns JSON:

```http
Content-Security-Policy: default-src 'none'; frame-ancestors 'none'
```

can be useful.

## 45.3 CSP is not replacement

CSP does not replace input/output encoding.

## 45.4 Rule

CSP is defense-in-depth against browser injection and embedding risks.

---

# 46. `X-Content-Type-Options: nosniff`

## 46.1 Purpose

Prevents browsers from MIME sniffing response as different content type.

```http
X-Content-Type-Options: nosniff
```

## 46.2 Useful for APIs

If JSON is accidentally served with wrong content type, sniffing can create risks.

## 46.3 Pair with correct Content-Type

```http
Content-Type: application/json
```

## 46.4 Rule

Set `nosniff` for browser-facing API responses.

---

# 47. Frame Protection: `frame-ancestors` dan `X-Frame-Options`

## 47.1 CSP frame-ancestors

Modern control:

```http
Content-Security-Policy: frame-ancestors 'none'
```

## 47.2 X-Frame-Options

Legacy:

```http
X-Frame-Options: DENY
```

or:

```http
SAMEORIGIN
```

## 47.3 API relevance

If API returns JSON only, frame risk lower but still can be set.

For admin UI/HTML, critical.

## 47.4 Rule

Prevent clickjacking for browser-rendered sensitive pages.

---

# 48. Referrer Policy

Controls `Referer` header sent by browser.

## 48.1 Example

```http
Referrer-Policy: no-referrer
```

or:

```http
strict-origin-when-cross-origin
```

## 48.2 Why

URLs can contain sensitive data.

## 48.3 API design

Do not put secrets in URL.

## 48.4 Rule

Use referrer policy and avoid sensitive query parameters.

---

# 49. HSTS

Strict-Transport-Security tells browser to use HTTPS.

```http
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

## 49.1 Only over HTTPS

Do not set incorrectly in mixed environments.

## 49.2 Gateway

Usually set at edge/gateway.

## 49.3 IncludeSubDomains caution

Only if all subdomains support HTTPS.

## 49.4 Rule

HSTS is deployment-level HTTPS commitment.

---

# 50. COOP, COEP, CORP, Fetch Metadata

Modern browser isolation/security headers include:

```text
Cross-Origin-Opener-Policy
Cross-Origin-Embedder-Policy
Cross-Origin-Resource-Policy
Sec-Fetch-*
```

## 50.1 CORP

Controls who can load resource.

```http
Cross-Origin-Resource-Policy: same-origin
```

## 50.2 COOP/COEP

Used for cross-origin isolation, advanced browser security.

## 50.3 Fetch Metadata

Browser sends request metadata headers like `Sec-Fetch-Site`.

Server can reject suspicious cross-site requests.

## 50.4 Rule

For high-security browser apps, evaluate Fetch Metadata and cross-origin isolation headers.

---

# 51. Fetch Metadata Headers: `Sec-Fetch-*`

Common headers:

```text
Sec-Fetch-Site
Sec-Fetch-Mode
Sec-Fetch-Dest
Sec-Fetch-User
```

## 51.1 Use case

Reject cross-site state-changing requests.

Example:

```text
Sec-Fetch-Site: cross-site
```

with POST to sensitive endpoint → reject.

## 51.2 Defense-in-depth

Not all clients send these headers.

Do not replace CSRF token entirely.

## 51.3 Rule

Fetch Metadata is useful modern defense layer for browser endpoints.

---

# 52. JAX-RS CSRF Filter Skeleton

## 52.1 Annotation

```java
@NameBinding
@Target({TYPE, METHOD})
@Retention(RUNTIME)
public @interface CsrfProtected {
}
```

## 52.2 Filter

```java
@CsrfProtected
@Provider
@Priority(Priorities.AUTHORIZATION + 50)
public class CsrfFilter implements ContainerRequestFilter {

    private final CsrfTokenService csrf;

    public CsrfFilter(CsrfTokenService csrf) {
        this.csrf = csrf;
    }

    @Override
    public void filter(ContainerRequestContext ctx) {
        if (isSafeMethod(ctx.getMethod())) {
            return;
        }

        String headerToken = ctx.getHeaderString("X-CSRF-Token");
        String cookieToken = getCookieValue(ctx, "csrf_token");

        if (!csrf.isValid(headerToken, cookieToken, currentSession(ctx))) {
            ctx.abortWith(Response.status(Response.Status.FORBIDDEN)
                .type("application/problem+json")
                .entity(problem("CSRF_TOKEN_INVALID"))
                .build());
        }
    }

    private boolean isSafeMethod(String method) {
        return "GET".equals(method) || "HEAD".equals(method) || "OPTIONS".equals(method);
    }
}
```

## 52.3 Scope

Apply to state-changing endpoints using cookie auth.

## 52.4 Also check Origin

Add Origin/Referer validation if appropriate.

## 52.5 Rule

CSRF filter is endpoint/security policy, not generic validation.

---

# 53. JAX-RS Cookie Issuing with `NewCookie`

## 53.1 Basic concept

```java
NewCookie cookie = new NewCookie.Builder("__Host-session")
    .value(sessionId)
    .path("/")
    .secure(true)
    .httpOnly(true)
    .sameSite(NewCookie.SameSite.LAX)
    .maxAge(3600)
    .build();

return Response.ok(body)
    .cookie(cookie)
    .build();
```

## 53.2 SameSite support

Modern Jakarta REST has `NewCookie` builder and SameSite support depending API version.

Check runtime.

## 53.3 Host-only

Do not set Domain for `__Host-`.

## 53.4 Clearing cookie

Set same name/path/domain and max-age zero.

## 53.5 Rule

Cookie attributes are part of auth security contract.

---

# 54. Login, Refresh, Logout Flow

## 54.1 Login

- authenticate credentials;
- create session/issue tokens;
- set cookies with secure attributes;
- return current user profile.

## 54.2 Refresh

- rotate refresh token/session;
- detect reuse;
- set new cookie;
- expire old.

## 54.3 Logout

- invalidate server session/refresh token;
- clear cookies;
- audit event.

## 54.4 Browser storage

Do not return long-lived tokens to JS unless design accepts XSS trade-off.

## 54.5 Rule

Auth lifecycle endpoints are security-critical APIs.

---

# 55. Refresh Token Rotation

## 55.1 Purpose

Reduce impact of stolen refresh token.

## 55.2 Flow

Each refresh request returns new refresh token and invalidates old one.

## 55.3 Reuse detection

If old token used again, assume compromise.

## 55.4 Cookie transport

Refresh token often stored in HttpOnly Secure cookie.

## 55.5 Rule

Long-lived credentials need rotation/revocation strategy.

---

# 56. Logout and Cookie Clearing

## 56.1 Clear cookie

```http
Set-Cookie: __Host-session=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax
```

## 56.2 Same attributes

Use same Path/Domain as original cookie.

## 56.3 Server invalidation

For session/refresh tokens, server must invalidate state too.

## 56.4 Client-only delete is insufficient

If token remains valid server-side, attacker with token can still use it.

## 56.5 Rule

Logout clears browser state and invalidates server-side credential.

---

# 57. Preflight Caching and Operational Effects

## 57.1 High OPTIONS traffic

Every non-simple cross-origin request may preflight unless cached.

## 57.2 Max-Age

Set moderate cache.

## 57.3 Gateway logs

Preflight can dominate request logs.

## 57.4 Do not require auth on preflight

Can cause browser failure.

## 57.5 Rule

Monitor preflight rate and cache behavior.

---

# 58. CORS Error Debugging

## 58.1 Browser error

CORS failures often appear as “network error” to JavaScript.

The response may not be visible.

## 58.2 Check

- request Origin;
- preflight request method/headers;
- allow origin;
- allow methods;
- allow headers;
- allow credentials;
- wildcard with credentials;
- Vary/caching;
- gateway vs app double headers.

## 58.3 Tools

Use browser devtools Network tab.

curl does not enforce CORS.

## 58.4 Rule

CORS must be debugged in browser context.

---

# 59. CSRF Error Debugging

## 59.1 Check

- cookie present?
- CSRF token cookie/header match?
- token bound to session?
- SameSite value?
- Origin/Referer?
- credentials include mode?
- CORS allow credentials?
- preflight custom header allowed?

## 59.2 Common SPA issue

Frontend forgot:

```js
credentials: "include"
```

or did not send CSRF header.

## 59.3 Common backend issue

CSRF filter applied to OPTIONS preflight.

## 59.4 Rule

Do not apply CSRF validation to preflight OPTIONS.

---

# 60. Observability and Safe Logging

## 60.1 Log safely

Include:

- origin;
- route template;
- method;
- status;
- CORS decision;
- CSRF failure code;
- correlation ID.

## 60.2 Do not log

- cookies;
- CSRF token values;
- Authorization header;
- session IDs;
- refresh tokens.

## 60.3 Metrics

```text
cors_preflight_total{decision,origin_group}
csrf_failures_total{reason,route}
cookie_auth_requests_total
```

## 60.4 Origin cardinality

Do not label raw arbitrary Origin if unbounded.

Group:

```text
allowed
denied
missing
```

or known origin key.

## 60.5 Rule

Security observability must not leak secrets.

---

# 61. Testing CORS

## 61.1 Preflight allowed

Send:

```http
OPTIONS /api/customers
Origin: https://app.example.com
Access-Control-Request-Method: POST
Access-Control-Request-Headers: authorization,content-type
```

Assert 204 and headers.

## 61.2 Preflight denied origin

Assert no allow headers or 403 policy.

## 61.3 Actual response

GET/POST with Origin, assert CORS headers on success and error.

## 61.4 Credentials

Assert:

```text
Allow-Origin specific
Allow-Credentials true
```

not wildcard.

## 61.5 Browser/E2E

Use real browser tests for final confidence.

## 61.6 Rule

curl can inspect headers but cannot prove browser CORS behavior fully.

---

# 62. Testing CSRF

## 62.1 Missing token

Cookie-auth POST without CSRF token → 403.

## 62.2 Wrong token

Header/cookie mismatch → 403.

## 62.3 Correct token

Pass.

## 62.4 Safe methods

GET/HEAD/OPTIONS should not require CSRF token, but must remain safe.

## 62.5 Origin check

Unexpected Origin → 403.

## 62.6 Rule

Test CSRF with browser-like cookies and credential mode.

---

# 63. Testing Cookies

## 63.1 Set-Cookie attributes

Assert:

```text
Secure
HttpOnly
SameSite
Path
Domain absent if __Host-
Max-Age
```

## 63.2 Cookie clearing

Logout sets max-age zero with same path/domain.

## 63.3 SameSite browser behavior

Use browser integration test for cross-site scenarios.

## 63.4 Rule

Cookie tests must check attributes, not only existence.

---

# 64. Testing Token Storage/Browser Flows

## 64.1 XSS simulation

If token in localStorage/sessionStorage, confirm XSS could read it.

This informs risk decision.

## 64.2 Cookie flow

Confirm JS cannot read HttpOnly cookie.

## 64.3 API call flow

- same-origin;
- cross-origin with credentials;
- refresh token;
- logout.

## 64.4 Rule

Browser auth architecture must be tested end-to-end.

---

# 65. Runtime Differences and Deployment Topology

## 65.1 App server

JAX-RS filter behavior standard, but cookie builder support varies by version.

## 65.2 Gateway

May add/remove CORS/security headers.

## 65.3 CDN

Can cache preflight/actual responses.

Must respect Vary.

## 65.4 TLS termination

Affects Secure cookies/HSTS/link generation.

## 65.5 Rule

Browser security behavior emerges from app + gateway + browser + cookie attributes.

---

# 66. Common Failure Modes

## 66.1 `Access-Control-Allow-Origin: *` with credentials

Browser rejects.

## 66.2 Reflect Origin blindly

Malicious origin reads authenticated responses.

## 66.3 Missing `Vary: Origin`

Cache leaks CORS decision.

## 66.4 CSRF filter blocks preflight

Browser request fails.

## 66.5 Cookie auth without CSRF

State-changing CSRF vulnerability.

## 66.6 SameSite=None without Secure

Browser rejects/ignores cookie in modern behavior.

## 66.7 Token in localStorage with XSS

Token theft.

## 66.8 HttpOnly cookie but no CSRF

XSS theft reduced, CSRF risk remains.

## 66.9 CORS handled in app and gateway

Duplicate/conflicting headers.

## 66.10 Secure cookie issued while app thinks HTTP behind gateway

Cookie missing in dev/prod mismatch.

## 66.11 `Set-Cookie` expected readable by JS

Browser filters it from frontend exposure.

## 66.12 Exposing sensitive response headers

Token leak.

---

# 67. Best Practices

## 67.1 Treat CORS as browser read policy

Not authentication.

## 67.2 Use explicit origin allowlist

No blind reflection.

## 67.3 Use specific origin for credentials

Never wildcard with credentials.

## 67.4 Add Vary

For dynamic CORS.

## 67.5 Protect cookie-auth state-changing endpoints from CSRF

Token + SameSite + Origin check.

## 67.6 Prefer host-only Secure HttpOnly cookies

Use `__Host-` where possible.

## 67.7 Avoid storing long-lived tokens in JS storage

Consider BFF or short-lived memory tokens.

## 67.8 Set security headers consistently

At gateway/app.

## 67.9 Test in browser

CORS/cookies need browser tests.

## 67.10 Log safely

No tokens/cookies/CSRF values.

---

# 68. Anti-Patterns

## 68.1 “CORS allows only frontend, so API is secure”

Wrong.

## 68.2 “SameSite means no CSRF ever”

Too simplistic.

## 68.3 “HttpOnly cookie solves XSS”

XSS can still act as user.

## 68.4 Blind origin reflection

Critical CORS misconfig.

## 68.5 Allow all headers/methods/origins

Overly broad.

## 68.6 CSRF token in URL

Leaks via logs/referrer.

## 68.7 Sensitive data in query string

Leaks in logs/referrer/history.

## 68.8 GET changes state

CSRF and caching disaster.

## 68.9 CORS config differs success/error

Frontend cannot read error body.

## 68.10 No negative security tests

Browser flows fail in production.

---

# 69. Production Checklist

## 69.1 CORS

- [ ] CORS owner decided: gateway or app.
- [ ] Allowed origins explicit.
- [ ] No blind Origin reflection.
- [ ] Credentials only where needed.
- [ ] No wildcard with credentials.
- [ ] Allowed methods/header allowlist defined.
- [ ] Exposed headers allowlist defined.
- [ ] `Vary` set correctly.
- [ ] Preflight not authenticated by app auth filter incorrectly.
- [ ] CORS headers applied to errors too.

## 69.2 CSRF

- [ ] Cookie-auth state-changing endpoints protected.
- [ ] Safe methods remain safe.
- [ ] CSRF token pattern chosen.
- [ ] Token bound/signed if double submit.
- [ ] Origin/Referer check considered.
- [ ] CSRF filter skips OPTIONS.
- [ ] CSRF token not logged.

## 69.3 Cookies

- [ ] Auth cookie `Secure`.
- [ ] Auth cookie `HttpOnly`.
- [ ] SameSite chosen intentionally.
- [ ] Domain omitted if possible.
- [ ] `__Host-` prefix used if possible.
- [ ] Logout clears cookie correctly.
- [ ] Server-side invalidation exists.

## 69.4 Browser tokens

- [ ] Token storage threat model documented.
- [ ] XSS mitigation in place.
- [ ] Refresh rotation if used.
- [ ] Long-lived tokens not exposed to JS unless accepted risk.
- [ ] BFF considered for high-security apps.

## 69.5 Headers

- [ ] `X-Content-Type-Options: nosniff`.
- [ ] CSP for HTML/app or restrictive for API.
- [ ] Referrer-Policy set.
- [ ] HSTS at edge.
- [ ] Frame protection where relevant.
- [ ] Cache-Control for sensitive data.

## 69.6 Testing/observability

- [ ] Browser CORS tests.
- [ ] Preflight tests.
- [ ] Credentialed request tests.
- [ ] CSRF negative tests.
- [ ] Cookie attribute tests.
- [ ] Logs redact cookies/tokens.
- [ ] Metrics for CORS/CSRF failures.

---

# 70. Latihan

## Latihan 1 — CORS Preflight Filter

Implement `@PreMatching` filter untuk preflight.

Test:

- allowed origin;
- denied origin;
- allowed method;
- denied method;
- allowed headers;
- denied headers.

## Latihan 2 — Actual CORS Response Filter

Tambahkan CORS headers pada success dan error responses.

Pastikan `Vary: Origin`.

## Latihan 3 — Credentialed CORS

Setup frontend cross-origin dengan cookies.

Pastikan:

```text
credentials: include
Allow-Credentials: true
Allow-Origin: exact origin
```

## Latihan 4 — CSRF Filter

Buat `@CsrfProtected`.

Apply ke POST/PUT/PATCH/DELETE.

Test missing/wrong/correct token.

## Latihan 5 — Signed Double Submit

Implement token:

```text
random + HMAC(sessionBinding + random)
```

Validate header and cookie.

## Latihan 6 — Cookie Attributes

Issue session cookie:

```text
__Host-session
Secure
HttpOnly
SameSite=Lax
Path=/
No Domain
```

Test header.

## Latihan 7 — SameSite Matrix

Test browser behavior for:

- Lax;
- Strict;
- None; Secure.

## Latihan 8 — Token Storage Threat Model

Bandingkan:

- localStorage token;
- memory token;
- HttpOnly cookie;
- BFF.

Tulis trade-off untuk app internal high-security.

## Latihan 9 — Fetch Metadata

Implement filter yang reject state-changing cross-site requests using `Sec-Fetch-Site`.

Test with browser-like headers.

---

# 71. Referensi Resmi

Referensi utama:

1. MDN — Cross-Origin Resource Sharing (CORS)  
   https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS

2. MDN — Preflight request  
   https://developer.mozilla.org/en-US/docs/Glossary/Preflight_request

3. MDN — Access-Control-Allow-Credentials  
   https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Access-Control-Allow-Credentials

4. MDN — Set-Cookie header  
   https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie

5. OWASP — Cross-Site Request Forgery Prevention Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

6. IETF HTTP State Management Mechanism Draft / RFC6265bis  
   https://datatracker.ietf.org/doc/html/draft-ietf-httpbis-rfc6265bis-20

7. Jakarta RESTful Web Services 4.0 — `ContainerRequestFilter` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/container/containerrequestfilter

8. Jakarta RESTful Web Services 4.0 — `ContainerResponseFilter` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/container/containerresponsefilter

9. Jakarta RESTful Web Services 4.0 — `NewCookie` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/newcookie

10. RFC 9110 — HTTP Semantics  
    https://www.rfc-editor.org/rfc/rfc9110.html

11. OWASP API Security Top 10  
    https://owasp.org/API-Security/

---

# 72. Penutup

Browser-facing REST API security membutuhkan pemahaman lintas layer.

Mental model final:

```text
Same-Origin Policy limits browser script access.
CORS lets server grant cross-origin read access.
Cookies may be sent automatically by browser.
CSRF exploits automatic credentials.
XSS runs inside trusted origin.
SameSite reduces some cross-site cookie sends.
HttpOnly reduces JS cookie theft.
CSP reduces XSS impact.
Authentication/authorization still enforce API security.
```

Prinsip final:

```text
CORS is not auth.
CSRF is about unwanted authenticated actions.
Cookie attributes are part of auth design.
Token storage is a threat-model trade-off.
Browser tests are mandatory.
```

Top-tier JAX-RS engineer memastikan:

- CORS policy explicit dan tested;
- CSRF protection sesuai credential model;
- cookies aman dan scoped;
- frontend architecture dipahami;
- errors tetap readable oleh frontend tanpa bocor;
- security headers konsisten;
- logs tidak membocorkan token/cookie;
- gateway/app responsibility jelas.

Part berikutnya:

```text
Bagian 020 — Pagination, Sorting, Filtering, Search, and Query Contract Design
```

Kita akan membahas desain query contract enterprise: pagination offset vs cursor, sorting allowlist, filtering grammar, search semantics, query DTO, index-aware design, stable ordering, consistency, and performance.

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: learn-jaxrs-advanced-part-018.md](./learn-jaxrs-advanced-part-018.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-jaxrs-advanced-part-020.md](./learn-jaxrs-advanced-part-020.md)

</div>