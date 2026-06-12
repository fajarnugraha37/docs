# learn-jaxrs-advanced-part-042.md

# Bagian 042 — Production Security Hardening for JAX-RS APIs: Authentication, Authorization, JWT/OIDC, CORS/CSRF, Input Limits, Security Headers, Rate Limit, Request Smuggling, SSRF, Deserialization Safety, File Upload Security, Audit, and Security Testing

> Target pembaca: Java/Jakarta engineer yang ingin melakukan **hardening production-grade untuk Jakarta REST/JAX-RS APIs**. Fokus bagian ini bukan hanya “pasang auth filter”, tetapi membangun defense-in-depth: authentication, authorization, object-level authorization, JWT/OIDC validation, tenant isolation, CORS/CSRF, input validation, request size limits, security headers, rate limiting, resource consumption protection, request smuggling awareness, SSRF prevention, deserialization safety, file upload security, error leakage control, audit logging, security testing, dan operational security.
>
> Namespace utama: `jakarta.ws.rs.container.ContainerRequestFilter`, `ContainerResponseFilter`, `SecurityContext`, `ExceptionMapper`, `@RolesAllowed`, `@PermitAll`, `@DenyAll`, `jakarta.annotation.security.*`, MicroProfile JWT/OIDC runtime integration, gateway/WAF/service mesh, OWASP API Security guidance.
>
> Prinsip utama:
>
> ```text
> API security is not one filter.
> It is a layered contract across identity, authorization, input, resource usage, data exposure, observability, and operations.
> ```

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Security Boundary di REST API](#2-mental-model-security-boundary-di-rest-api)
3. [Threat Modeling untuk JAX-RS API](#3-threat-modeling-untuk-jax-rs-api)
4. [OWASP API Security Top 10 Mapping](#4-owasp-api-security-top-10-mapping)
5. [Authentication](#5-authentication)
6. [Bearer Token, Session Cookie, API Key, mTLS](#6-bearer-token-session-cookie-api-key-mtls)
7. [OIDC/JWT Validation](#7-oidcjwt-validation)
8. [JWT Best Current Practices](#8-jwt-best-current-practices)
9. [Token Claims Validation](#9-token-claims-validation)
10. [JWKS and Key Rotation](#10-jwks-and-key-rotation)
11. [SecurityContext Design](#11-securitycontext-design)
12. [Authorization](#12-authorization)
13. [Function-Level Authorization](#13-function-level-authorization)
14. [Object-Level Authorization / BOLA](#14-object-level-authorization--bola)
15. [Object Property-Level Authorization](#15-object-property-level-authorization)
16. [Tenant Isolation](#16-tenant-isolation)
17. [Method Security Annotations](#17-method-security-annotations)
18. [Filter-Based Authorization vs Service-Layer Authorization](#18-filter-based-authorization-vs-service-layer-authorization)
19. [CORS](#19-cors)
20. [CSRF](#20-csrf)
21. [Cookies and SameSite](#21-cookies-and-samesite)
22. [Security Headers](#22-security-headers)
23. [Input Validation and Canonicalization](#23-input-validation-and-canonicalization)
24. [Request Size, Depth, and Complexity Limits](#24-request-size-depth-and-complexity-limits)
25. [Unrestricted Resource Consumption](#25-unrestricted-resource-consumption)
26. [Rate Limiting and Quotas](#26-rate-limiting-and-quotas)
27. [Business Flow Abuse Protection](#27-business-flow-abuse-protection)
28. [Request Smuggling and Proxy Boundary](#28-request-smuggling-and-proxy-boundary)
29. [SSRF Prevention](#29-ssrf-prevention)
30. [Deserialization Safety](#30-deserialization-safety)
31. [XML, XXE, and Entity Expansion](#31-xml-xxe-and-entity-expansion)
32. [JSON Safety](#32-json-safety)
33. [File Upload Security](#33-file-upload-security)
34. [Multipart Hardening](#34-multipart-hardening)
35. [Path Traversal and Filename Safety](#35-path-traversal-and-filename-safety)
36. [Error Leakage Prevention](#36-error-leakage-prevention)
37. [Problem Details Security](#37-problem-details-security)
38. [Audit Logging](#38-audit-logging)
39. [Security Observability](#39-security-observability)
40. [Secrets Management](#40-secrets-management)
41. [TLS/mTLS](#41-tlsmtls)
42. [API Gateway, WAF, Service Mesh](#42-api-gateway-waf-service-mesh)
43. [JAX-RS Security Filter Architecture](#43-jax-rs-security-filter-architecture)
44. [Response Security Filter Architecture](#44-response-security-filter-architecture)
45. [Secure Client Calls](#45-secure-client-calls)
46. [Security Testing Strategy](#46-security-testing-strategy)
47. [Negative Security Tests](#47-negative-security-tests)
48. [Fuzzing and Property-Based Tests](#48-fuzzing-and-property-based-tests)
49. [SAST, DAST, SCA, Secret Scanning](#49-sast-dast-sca-secret-scanning)
50. [VAPT/Pentest Readiness](#50-vaptpentest-readiness)
51. [Incident Response and Kill Switches](#51-incident-response-and-kill-switches)
52. [Common Failure Modes](#52-common-failure-modes)
53. [Best Practices](#53-best-practices)
54. [Anti-Patterns](#54-anti-patterns)
55. [Production Checklist](#55-production-checklist)
56. [Latihan](#56-latihan)
57. [Referensi Resmi](#57-referensi-resmi)
58. [Penutup](#58-penutup)

---

# 1. Tujuan Part Ini

REST API production sering terekspos ke:

- browser;
- mobile app;
- internal services;
- partner integration;
- API gateway;
- batch jobs;
- public internet;
- attacker automation.

Masalah keamanan jarang hanya berasal dari satu bug.

Biasanya kombinasi:

```text
endpoint accepts too much
auth filter too trusting
authorization only checks role, not object ownership
CORS too permissive
JWT validation incomplete
file upload insufficiently validated
pagination no limit
error leaks stack trace
logs leak token
rate limit missing
tenant filter inconsistent
downstream URL user-controlled
```

## 1.1 Target akhir

Setelah bagian ini, kamu bisa:

- membuat threat model REST API;
- menghubungkan JAX-RS security dengan OWASP API risks;
- mendesain authentication dan authorization boundary;
- memvalidasi JWT/OIDC dengan benar;
- mencegah BOLA/object-level authorization bug;
- mengatur CORS/CSRF/cookies;
- membatasi input/resource consumption;
- mencegah SSRF/request smuggling/deserialization/file upload risks;
- membuat Problem Details yang tidak leak;
- membuat audit/security observability;
- menulis security tests dan readiness checklist.

## 1.2 Prinsip utama

```text
Every API endpoint is an attack surface.
Security must be explicit, testable, observable, and enforced at multiple layers.
```

---

# 2. Mental Model: Security Boundary di REST API

Security boundary untuk JAX-RS API tidak hanya resource method.

Lapisan boundary:

```text
TLS / network
  ↓
gateway / WAF / load balancer
  ↓
container HTTP parser
  ↓
JAX-RS filters
  ↓
authentication
  ↓
authorization
  ↓
input validation
  ↓
service/domain rules
  ↓
persistence tenant filter
  ↓
response mapping/redaction
  ↓
security headers/audit/logging
```

## 2.1 Defense-in-depth

Jika satu lapisan gagal, lapisan berikutnya tetap mengurangi risiko.

## 2.2 Example

Tenant check sebaiknya ada di:

- token claim validation;
- service authorization;
- repository query;
- audit/monitoring.

## 2.3 Rule

Do not rely on a single filter to secure the whole system.

---

# 3. Threat Modeling untuk JAX-RS API

Sebelum hardening, jawab:

## 3.1 Asset

Apa yang dilindungi?

- PII;
- payment data;
- documents;
- credentials;
- workflow state;
- tenant data;
- admin operations.

## 3.2 Actor

Siapa caller?

- anonymous;
- authenticated user;
- admin;
- service account;
- partner;
- attacker.

## 3.3 Entry point

Endpoint mana exposed?

- public GET;
- authenticated POST;
- file upload;
- webhook;
- admin API;
- internal service API.

## 3.4 Trust boundary

Di mana data berubah dari untrusted menjadi trusted?

- request headers;
- JWT claims;
- gateway-injected headers;
- client IP;
- file metadata;
- callback URL.

## 3.5 Abuse case

Apa yang attacker coba?

- enumerate IDs;
- bypass role;
- access other tenant;
- upload malware;
- create huge payload;
- brute force login;
- abuse expensive workflow;
- trigger SSRF;
- exploit deserialization.

## 3.6 Rule

Security design starts with abuse cases, not with annotations.

---

# 4. OWASP API Security Top 10 Mapping

OWASP API Security Top 10 2023 categories map directly to REST API design.

## 4.1 Key risks

- Broken Object Level Authorization;
- Broken Authentication;
- Broken Object Property Level Authorization;
- Unrestricted Resource Consumption;
- Broken Function Level Authorization;
- Unrestricted Access to Sensitive Business Flows;
- Server Side Request Forgery;
- Security Misconfiguration;
- Improper Inventory Management;
- Unsafe Consumption of APIs.

## 4.2 JAX-RS mapping

| OWASP API Risk | JAX-RS Hardening Area |
|---|---|
| BOLA | object-level authorization in service/repository |
| Broken Auth | auth filter/token validation |
| BOPLA | DTO redaction/field-level auth |
| Resource Consumption | limits, rate limit, pagination, upload size |
| Function Auth | roles/scopes per operation |
| Business Flow Abuse | quotas, bot detection, workflow limits |
| SSRF | outbound URL allowlist |
| Misconfiguration | CORS, headers, TLS, error handling |
| Inventory | OpenAPI, gateway route inventory |
| Unsafe API Consumption | client validation, timeout, schema validation |

## 4.3 Rule

Use OWASP API Top 10 as checklist, not complete security model.

---

# 5. Authentication

Authentication answers:

```text
Who is calling?
```

Not:

```text
What are they allowed to do?
```

## 5.1 Common mechanisms

- OAuth2/OIDC bearer JWT;
- opaque token introspection;
- session cookie;
- API key;
- mTLS client certificate;
- signed request;
- service mesh identity.

## 5.2 JAX-RS implementation

Common place:

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class AuthenticationFilter implements ContainerRequestFilter {
    @Override
    public void filter(ContainerRequestContext ctx) {
        // validate credential
        // set SecurityContext
    }
}
```

## 5.3 Rule

Authentication must produce a trusted principal/context, not just parse a header.

---

# 6. Bearer Token, Session Cookie, API Key, mTLS

## 6.1 Bearer token

Common for APIs.

Risk: anyone with token can use it.

Protect via TLS, expiry, audience, issuer, scope.

## 6.2 Session cookie

Common for browser apps.

Risk: CSRF if mutation endpoints accept cookie automatically.

Use SameSite, CSRF token, Origin checks.

## 6.3 API key

Identifies application/client, not always user.

Should be:

- hashed at rest;
- scoped;
- rotatable;
- rate limited;
- not in URL query.

## 6.4 mTLS

Strong client/service identity.

Useful for privileged service-to-service.

## 6.5 Rule

Authentication mechanism must match caller type and threat model.

---

# 7. OIDC/JWT Validation

JWT validation is more than signature.

## 7.1 Validate

- signature;
- algorithm allowlist;
- issuer (`iss`);
- audience (`aud`);
- expiry (`exp`);
- not before (`nbf`);
- issued at (`iat`) if policy;
- token type/use;
- scopes/roles;
- tenant claim;
- subject (`sub`);
- client ID;
- key ID (`kid`) against trusted JWKS.

## 7.2 Reject

- unsigned tokens;
- `alg=none`;
- unexpected algorithm;
- wrong issuer/audience;
- expired token;
- token from wrong environment;
- token with missing required claims.

## 7.3 Rule

JWT parsing without full validation is not authentication.

---

# 8. JWT Best Current Practices

RFC 8725 gives best current practices for JWT deployment.

## 8.1 Important principles

- perform algorithm verification;
- use explicit typing where needed;
- validate cryptographic inputs;
- avoid weak algorithms;
- validate issuer/audience;
- use mutually exclusive validation rules for different token kinds;
- do not trust claims before signature validation.

## 8.2 Algorithm confusion

Do not let token header choose arbitrary algorithm.

Configure accepted algorithms.

## 8.3 Rule

JWT libraries help, but secure configuration is your responsibility.

---

# 9. Token Claims Validation

## 9.1 Required claims

Example:

```text
iss
sub
aud
exp
iat
scope/roles
tenant_id
client_id
```

## 9.2 Environment isolation

Production API should not accept staging issuer.

## 9.3 Clock skew

Allow small clock skew, not huge.

## 9.4 Tenant claim

Validate tenant against resource/query.

## 9.5 Rule

Token claims are untrusted until validated and mapped to application identity.

---

# 10. JWKS and Key Rotation

JWT signature validation often uses JWKS.

## 10.1 Cache keys

Cache JWKS with TTL.

## 10.2 Rotation

If `kid` unknown:

- refresh JWKS;
- retry validation once;
- reject if still unknown.

## 10.3 Do not fetch untrusted JWKS from token header

Issuer/JWKS URL must be configured/trusted.

## 10.4 Rule

JWKS retrieval is security-critical outbound dependency.

---

# 11. SecurityContext Design

JAX-RS `SecurityContext` exposes:

- principal;
- role checks;
- secure channel;
- auth scheme.

## 11.1 Custom SecurityContext

```java
ctx.setSecurityContext(new SecurityContext() {
    @Override
    public Principal getUserPrincipal() { return principal; }

    @Override
    public boolean isUserInRole(String role) {
        return actor.hasRole(role);
    }

    @Override
    public boolean isSecure() { return true; }

    @Override
    public String getAuthenticationScheme() { return "Bearer"; }
});
```

## 11.2 Convert to application actor

Do not pass `SecurityContext` deep into domain.

Create:

```java
CurrentActor
TenantContext
PermissionSet
```

## 11.3 Rule

SecurityContext is HTTP boundary; domain uses application identity model.

---

# 12. Authorization

Authorization answers:

```text
Is this caller allowed to perform this action on this resource?
```

Authorization dimensions:

- role;
- scope;
- tenant;
- object ownership;
- workflow state;
- field/property;
- data classification;
- time/location/device risk.

## 12.1 Rule

Authentication without authorization is incomplete security.

---

# 13. Function-Level Authorization

Function-level authorization checks access to operation.

Example:

```text
POST /admin/users requires admin:user:create
DELETE /cases/{id} requires case:delete
```

## 13.1 JAX-RS

Can use annotations:

```java
@RolesAllowed("ADMIN")
@DELETE
@Path("/{id}")
public Response delete(...) { ... }
```

## 13.2 Caveat

Role checks are often too coarse.

Need scopes/permissions/action model.

## 13.3 Rule

Every operation should have explicit authorization policy.

---

# 14. Object-Level Authorization / BOLA

Broken Object Level Authorization happens when caller can access object by manipulating ID.

Example:

```http
GET /customers/C001
GET /customers/C999
```

If user can access someone else's customer by changing ID, BOLA.

## 14.1 Fix

Load resource through authorized/tenant-safe query:

```java
repository.findByTenantAndId(actor.tenantId(), customerId)
```

not:

```java
repository.findById(customerId)
```

then check later.

## 14.2 Service check

```java
authorization.checkCanView(actor, customer);
```

## 14.3 Rule

Object-level authorization belongs near resource lookup and mutation.

---

# 15. Object Property-Level Authorization

Some callers can access object but not all fields.

## 15.1 Example

Support agent can view:

```json
{
  "id": "C001",
  "displayName": "Fajar"
}
```

but not:

```json
{
  "nationalId": "...",
  "riskScore": 87
}
```

## 15.2 DTO redaction

Use mapper with actor/permission context.

```java
CustomerResponse toResponse(Customer customer, CurrentActor actor)
```

## 15.3 Request field authorization

PATCH must reject fields caller cannot modify.

## 15.4 Rule

DTO mapping is authorization boundary.

---

# 16. Tenant Isolation

Tenant isolation must be enforced consistently.

## 16.1 Avoid

```java
Customer c = repo.findById(id);
if (!c.tenantId().equals(actor.tenantId())) throw forbidden;
```

This can leak existence and risk accidental use.

## 16.2 Prefer

```java
Optional<Customer> findByTenantAndId(TenantId tenant, CustomerId id);
```

## 16.3 DB-level defense

Consider:

- row-level security;
- tenant-aware indexes;
- schema/database per tenant;
- mandatory tenant filters.

## 16.4 Rule

Tenant ID should be part of every data access boundary.

---

# 17. Method Security Annotations

Jakarta annotations:

```java
@RolesAllowed
@PermitAll
@DenyAll
```

## 17.1 Good for

- coarse operation access;
- admin endpoints;
- clear documentation.

## 17.2 Not enough for

- object ownership;
- tenant isolation;
- field-level access;
- workflow authorization.

## 17.3 Rule

Use method annotations for coarse gate; enforce fine-grained policy in service/domain.

---

# 18. Filter-Based Authorization vs Service-Layer Authorization

## 18.1 Filter authorization

Good for:

- authentication required;
- role/scope per route;
- blocking obviously unauthorized requests early.

## 18.2 Service authorization

Needed for:

- resource ownership;
- workflow state;
- domain rule;
- object property;
- tenant query.

## 18.3 Rule

Route-level authorization in filters, object-level authorization in service/repository.

---

# 19. CORS

CORS controls browser cross-origin access.

## 19.1 Not authentication

CORS is browser policy, not API auth.

Non-browser clients ignore it.

## 19.2 Bad

```http
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

Invalid/dangerous combination.

## 19.3 Good

- allowlist origins;
- exact match;
- minimal methods/headers;
- credentials only if needed;
- `Vary: Origin`.

## 19.4 Rule

CORS must be strict and environment-specific.

---

# 20. CSRF

CSRF matters when browser automatically attaches credentials such as cookies.

## 20.1 Bearer token in Authorization header

Usually not vulnerable to classical CSRF if attacker cannot set Authorization header without CORS permission.

## 20.2 Cookie-authenticated API

Needs protection:

- SameSite cookie;
- CSRF token;
- Origin/Referer validation;
- double-submit pattern;
- custom header with token.

## 20.3 Rule

If browser sends credentials automatically, design CSRF protection.

---

# 21. Cookies and SameSite

## 21.1 SameSite

- `Strict`;
- `Lax`;
- `None; Secure`.

## 21.2 Secure

Use `Secure` for HTTPS-only.

## 21.3 HttpOnly

Protect cookie from JavaScript access.

## 21.4 Rule

Session/auth cookies should be `HttpOnly`, `Secure`, and appropriate `SameSite`.

---

# 22. Security Headers

Common response headers:

```http
Strict-Transport-Security
Content-Security-Policy
X-Content-Type-Options: nosniff
Referrer-Policy
Permissions-Policy
Cache-Control
```

## 22.1 API-specific

For JSON APIs:

- `X-Content-Type-Options: nosniff`;
- no caching for sensitive data;
- HSTS at HTTPS boundary;
- CSP less relevant for pure JSON but important if serving HTML/docs.

## 22.2 Rule

Security headers are defense-in-depth, not replacement for auth.

---

# 23. Input Validation and Canonicalization

Validate:

- path params;
- query params;
- headers;
- JSON body;
- multipart metadata;
- filenames;
- content type;
- file magic;
- IDs;
- cursor;
- enum;
- date/time;
- numbers.

## 23.1 Canonicalization

Normalize before validation when needed:

- Unicode;
- path;
- hostname;
- URL;
- file extension;
- content type.

## 23.2 Rule

Validate at boundary and again in domain for invariants.

---

# 24. Request Size, Depth, and Complexity Limits

Protect against large payloads.

## 24.1 Limits

- max request body size;
- max JSON depth;
- max array length;
- max string length;
- max query params;
- max header size;
- max multipart parts;
- max file size;
- max page size;
- max search complexity.

## 24.2 Enforcement layers

- gateway;
- app server;
- JAX-RS provider;
- application validation.

## 24.3 Rule

Every untrusted input dimension needs a limit.

---

# 25. Unrestricted Resource Consumption

OWASP API4:2023 covers APIs that fail to limit client resource consumption.

Resources include:

- CPU;
- memory;
- bandwidth;
- storage;
- DB connections;
- threads;
- emails/SMS;
- third-party API cost.

## 25.1 Examples

- unlimited pagination size;
- unlimited file upload;
- expensive search with no rate limit;
- bulk API with huge array;
- repeated OTP/SMS sending;
- async job creation without quota;
- unbounded SSE connections.

## 25.2 Rule

Resource limits are security controls, not only performance controls.

---

# 26. Rate Limiting and Quotas

## 26.1 Dimensions

- IP;
- user;
- tenant;
- client ID;
- API key;
- endpoint;
- business action;
- cost unit.

## 26.2 Types

- fixed window;
- sliding window;
- token bucket;
- leaky bucket;
- concurrency limit;
- quota per day/month.

## 26.3 Response

```http
429 Too Many Requests
Retry-After: 60
```

## 26.4 Rule

Rate limit must align with business abuse and resource cost.

---

# 27. Business Flow Abuse Protection

Some attacks use valid API calls but abusive automation.

Examples:

- buying all tickets;
- creating fake reviews;
- scraping search;
- repeatedly sending OTP;
- mass reservation;
- coupon abuse.

## 27.1 Controls

- per-user quotas;
- bot detection;
- proof-of-work/captcha for public flows;
- velocity checks;
- business limits;
- anomaly detection;
- manual review.

## 27.2 Rule

Valid requests can still be malicious at business-flow level.

---

# 28. Request Smuggling and Proxy Boundary

Request smuggling exploits inconsistencies between proxy and backend HTTP parsing, often around `Content-Length` and `Transfer-Encoding`.

## 28.1 App-level awareness

JAX-RS app may not see raw ambiguity, but platform must:

- use patched server/proxy;
- normalize requests at edge;
- reject ambiguous requests;
- avoid unsupported HTTP versions/config;
- test gateway/backend compatibility.

## 28.2 Rule

Request smuggling defense is mostly infrastructure/server configuration, but API teams must know the boundary.

---

# 29. SSRF Prevention

SSRF occurs when API fetches server-side URL controlled by attacker.

## 29.1 Dangerous endpoints

```http
POST /fetch?url=http://...
POST /webhooks/test
POST /imports/from-url
```

## 29.2 Controls

- allowlist hostnames;
- block private/link-local IPs;
- resolve DNS and validate final IP;
- prevent redirects to blocked addresses;
- restrict schemes to HTTPS;
- set timeout/size limit;
- no metadata service access;
- use egress firewall.

## 29.3 Rule

Never let user-provided URL directly drive server-side HTTP client.

---

# 30. Deserialization Safety

JAX-RS entity providers deserialize untrusted input.

## 30.1 JSON

Avoid dangerous polymorphic deserialization.

Do not deserialize to arbitrary `Object`/class based on input type.

## 30.2 Java native serialization

Do not accept Java serialized objects.

## 30.3 XML

Disable unsafe external entity behavior.

## 30.4 Rule

Deserialize only into explicit DTOs with safe providers/config.

---

# 31. XML, XXE, and Entity Expansion

If API supports XML:

Risks:

- XXE;
- entity expansion/billion laughs;
- SSRF via external entity;
- local file read.

## 31.1 Controls

- disable external entities;
- disable DTD where possible;
- limit expansion/depth/size;
- use safe parser config;
- test malicious XML.

## 31.2 Rule

If you do not need XML, do not enable XML providers.

---

# 32. JSON Safety

JSON risks:

- huge body;
- deep nesting;
- big arrays;
- unknown fields;
- polymorphic type metadata;
- number precision;
- duplicate keys ambiguity;
- control characters/log injection.

## 32.1 Controls

- size/depth limits;
- DTO validation;
- reject/ignore unknown fields by policy;
- no default typing/polymorphic deserialization from untrusted input;
- canonicalize strings if needed.

## 32.2 Rule

JSON is safer than native serialization, not automatically safe.

---

# 33. File Upload Security

File upload is high-risk.

## 33.1 Risks

- malware;
- web shell;
- path traversal;
- zip bomb;
- content-type spoofing;
- extension bypass;
- oversized files;
- storage exhaustion;
- XSS via uploaded HTML/SVG;
- parser exploitation;
- unauthorized download.

## 33.2 Controls

- allowlist extensions;
- validate MIME and magic bytes;
- file size limit;
- random server-side filename;
- store outside web root;
- malware scan;
- CDR if needed;
- quarantine before publish;
- authorization on download;
- safe content disposition;
- no execute permission.

## 33.3 Rule

Treat every uploaded file as hostile until proven safe.

---

# 34. Multipart Hardening

## 34.1 Limits

- max request size;
- max part size;
- max number of parts;
- max filename length;
- max metadata JSON size;
- temp disk quota.

## 34.2 Streaming

Avoid loading entire file into heap.

## 34.3 Metadata

Validate metadata separately.

## 34.4 Rule

Multipart parser settings are security settings.

---

# 35. Path Traversal and Filename Safety

Never trust client filename.

## 35.1 Bad

```java
Path target = uploadDir.resolve(entityPart.getFileName().get());
```

## 35.2 Good

- generate server-side object key;
- store original filename as metadata only after sanitization;
- normalize and validate if file path needed;
- reject `..`, slashes, control chars.

## 35.3 Rule

Uploaded filename is display metadata, not storage path.

---

# 36. Error Leakage Prevention

Do not expose:

- stack traces;
- SQL;
- table/column names;
- internal class names;
- downstream URLs;
- file system paths;
- token validation details;
- user existence where policy hides it.

## 36.1 Map errors

Use `ExceptionMapper`.

## 36.2 Log internally

Keep detailed error in secure logs with correlation ID.

## 36.3 Rule

Client gets stable safe error; operators get detailed secure log.

---

# 37. Problem Details Security

Problem Details should include:

- safe `type`;
- `title`;
- `status`;
- stable `code`;
- optional safe `detail`;
- correlation ID.

## 37.1 Avoid

```json
{
  "detail": "ORA-00001 unique constraint SYS.C003921 violated"
}
```

## 37.2 Good

```json
{
  "title": "Conflict",
  "status": 409,
  "code": "CUSTOMER_EMAIL_ALREADY_EXISTS",
  "correlationId": "..."
}
```

## 37.3 Rule

Problem Details must be useful without leaking internals.

---

# 38. Audit Logging

Audit security-relevant actions:

- login/auth failure if app handles auth;
- token validation failure categories;
- privileged action;
- data export;
- document download;
- permission change;
- tenant access denied;
- admin operation;
- file upload scan result;
- idempotency conflict;
- security config change.

## 38.1 Audit fields

- actor;
- tenant;
- action;
- resource;
- result;
- timestamp;
- correlation ID;
- source IP/device if policy;
- reason.

## 38.2 Integrity

Protect audit logs from tampering.

## 38.3 Rule

Audit is evidence, not debug logging.

---

# 39. Security Observability

Metrics:

```text
security.auth.failure.total
security.authorization.denied.total
security.tenant.denied.total
security.csrf.failure.total
security.rate_limited.total
security.upload.rejected.total
security.ssrp.blocked.total
```

Logs:

- structured;
- redacted;
- correlation/trace IDs;
- severity.

Alerts:

- spike auth failures;
- tenant access denied spike;
- file malware detections;
- rate limit abuse;
- SSRF block attempts.

## 39.1 Rule

Security controls should be visible.

---

# 40. Secrets Management

Do not store secrets in:

- source code;
- config repo plaintext;
- logs;
- OpenAPI examples;
- docker image layers;
- command line args if exposed;
- exception messages.

## 40.1 Use

- secret manager;
- environment injection with care;
- rotation;
- least privilege;
- separate secrets per env;
- audit access.

## 40.2 Rule

API security depends on secret lifecycle.

---

# 41. TLS/mTLS

## 41.1 TLS

All production APIs should use HTTPS.

## 41.2 HSTS

For browser-facing HTTPS endpoints.

## 41.3 mTLS

For service-to-service high assurance.

## 41.4 Backend TLS

If gateway terminates TLS, consider TLS between gateway and service depending trust boundary.

## 41.5 Rule

Do not rely on bearer tokens over plaintext transport.

---

# 42. API Gateway, WAF, Service Mesh

## 42.1 Gateway can enforce

- TLS termination;
- auth integration;
- rate limit;
- request size;
- CORS;
- schema validation;
- routing;
- API inventory;
- threat protection.

## 42.2 App still must enforce

- object authorization;
- domain invariants;
- tenant isolation;
- field authorization;
- business flow limits.

## 42.3 Rule

Gateway is outer guardrail; application owns business authorization.

---

# 43. JAX-RS Security Filter Architecture

Suggested filter order:

```text
request id / trace
  ↓
request size/basic sanity if app-level
  ↓
CORS preflight handling
  ↓
authentication
  ↓
route/function-level authorization
  ↓
tenant context setup
  ↓
rate limit / quota if app-level
  ↓
resource method
```

## 43.1 Use priorities

```java
@Priority(Priorities.AUTHENTICATION)
```

## 43.2 Fail closed

If security context cannot be established, reject.

## 43.3 Rule

Security filters should be deterministic, ordered, and tested.

---

# 44. Response Security Filter Architecture

Add security headers in `ContainerResponseFilter`.

## 44.1 Example

```java
@Provider
public class SecurityHeadersFilter implements ContainerResponseFilter {
    @Override
    public void filter(ContainerRequestContext request, ContainerResponseContext response) {
        response.getHeaders().putSingle("X-Content-Type-Options", "nosniff");
        response.getHeaders().putSingle("Referrer-Policy", "no-referrer");
        response.getHeaders().putSingle("Cache-Control", "no-store");
    }
}
```

## 44.2 Conditional headers

Do not blindly `no-store` for public cacheable resources if caching intended.

## 44.3 Rule

Response security policy should be endpoint/data-class aware.

---

# 45. Secure Client Calls

JAX-RS Client outbound calls must be hardened:

- TLS validation;
- mTLS if needed;
- no disabling hostname verification;
- timeout;
- response size limit;
- redirect policy;
- allowlist destinations;
- SSRF prevention;
- token propagation rules;
- no secret logging.

## 45.1 Token relay

Do not blindly forward user token to every downstream.

Use token exchange or service token if appropriate.

## 45.2 Rule

Unsafe API consumption is also API security risk.

---

# 46. Security Testing Strategy

Layers:

- unit tests for validators/policies;
- integration tests for filters/security context;
- authorization matrix tests;
- tenant isolation tests;
- negative tests;
- fuzz tests;
- SAST;
- dependency scan/SCA;
- DAST;
- container/image scan;
- VAPT/pentest.

## 46.1 Rule

Security controls are not real until tested.

---

# 47. Negative Security Tests

Test:

- missing token;
- invalid token;
- expired token;
- wrong issuer;
- wrong audience;
- missing scope;
- wrong tenant;
- object ID from another user;
- forbidden PATCH field;
- oversized payload;
- malformed JSON;
- malicious filename;
- SSRF URL;
- CORS disallowed origin;
- CSRF missing token;
- invalid content type.

## 47.1 Rule

Security test suite should be mostly negative cases.

---

# 48. Fuzzing and Property-Based Tests

Good targets:

- ID parser;
- cursor parser;
- URL allowlist;
- filename sanitizer;
- JSON Patch paths;
- Range header parser;
- content type parser;
- query filter parser.

## 48.1 Properties

Example:

```text
sanitize(filename) never returns path separator
urlValidator(url) rejects private IP
cursor decode rejects tampering
```

## 48.2 Rule

Fuzz parsers and security-sensitive input handling.

---

# 49. SAST, DAST, SCA, Secret Scanning

## 49.1 SAST

Find code-level issues.

## 49.2 DAST

Test running app externally.

## 49.3 SCA

Dependency vulnerability scanning.

## 49.4 Secret scanning

Detect leaked secrets.

## 49.5 Rule

Automated scans are guardrails, not replacement for threat modeling and tests.

---

# 50. VAPT/Pentest Readiness

Prepare:

- API inventory/OpenAPI;
- test accounts by role/tenant;
- auth flows;
- rate limit policy;
- environment scope;
- data handling rules;
- logging/monitoring;
- contact/escalation.

## 50.1 Rule

A good pentest needs good API inventory and clear scope.

---

# 51. Incident Response and Kill Switches

Security incident needs controls:

- disable client/API key;
- revoke tokens;
- rotate keys;
- block tenant/user/IP/client;
- tighten rate limit;
- disable vulnerable endpoint;
- force re-auth;
- quarantine uploads;
- rollback deployment.

## 51.1 Rule

Hardening includes operational emergency controls.

---

# 52. Common Failure Modes

## 52.1 Role check but no object check

BOLA.

## 52.2 Trusting tenant ID from request body

Tenant bypass.

## 52.3 JWT signature validated but audience ignored

Token confusion.

## 52.4 CORS wildcard with credentials

Browser data leak risk.

## 52.5 Cookie auth without CSRF

CSRF.

## 52.6 Unlimited page size/upload size

DoS/resource consumption.

## 52.7 File extension-only validation

Upload bypass.

## 52.8 User-provided URL fetch

SSRF.

## 52.9 Default polymorphic deserialization

Deserialization risk.

## 52.10 Stack trace in Problem Details

Information leakage.

## 52.11 Token logged

Credential compromise.

## 52.12 Gateway auth but app trusts spoofable headers

Header spoofing.

---

# 53. Best Practices

## 53.1 Deny by default

Require explicit authorization.

## 53.2 Validate JWT fully

Issuer, audience, expiry, algorithm, claims.

## 53.3 Enforce object-level authorization

At repository/service boundary.

## 53.4 Use DTO redaction

Do not expose unauthorized fields.

## 53.5 Limit everything

Size, rate, complexity, concurrency.

## 53.6 Harden file upload

Allowlist, magic, scan, quarantine, safe storage.

## 53.7 Use strict CORS

Allowlist origins.

## 53.8 Protect cookie APIs from CSRF

SameSite + token/origin checks.

## 53.9 Use safe errors

Problem Details without internals.

## 53.10 Test security controls

Negative tests and automation.

---

# 54. Anti-Patterns

## 54.1 “Authenticated means authorized”

False.

## 54.2 “Gateway already checks auth”

App still needs object/domain authorization.

## 54.3 “CORS protects API”

Only browser behavior.

## 54.4 “JWT is valid if it decodes”

Wrong.

## 54.5 “File MIME from browser is trusted”

Wrong.

## 54.6 “Internal API does not need auth”

Lateral movement risk.

## 54.7 “Rate limit only login”

Other flows can be abused.

## 54.8 “Hide endpoint from docs”

Security by obscurity.

## 54.9 “Detailed errors help clients”

Not if they leak internals.

## 54.10 “Security tests slow delivery”

Security bugs are delivery failure.

---

# 55. Production Checklist

## 55.1 Authentication

- [ ] All protected endpoints require authentication.
- [ ] JWT signature validated.
- [ ] Algorithm allowlist.
- [ ] Issuer validated.
- [ ] Audience validated.
- [ ] Expiry/nbf validated.
- [ ] Required claims validated.
- [ ] JWKS cache/rotation handled.
- [ ] Token not logged.

## 55.2 Authorization

- [ ] Function-level auth per operation.
- [ ] Object-level auth per resource.
- [ ] Tenant-safe repository queries.
- [ ] Field-level response redaction.
- [ ] PATCH field authorization.
- [ ] Default deny.
- [ ] Authorization tests by role/tenant.

## 55.3 Browser/API boundary

- [ ] CORS allowlist.
- [ ] `Vary: Origin` where needed.
- [ ] Credentialed CORS safe.
- [ ] CSRF protection for cookie-auth mutation.
- [ ] Cookies `HttpOnly`, `Secure`, SameSite.

## 55.4 Input/resource

- [ ] Request body size limit.
- [ ] JSON depth/array limits.
- [ ] Query/page size limits.
- [ ] Header size limits.
- [ ] Multipart/file limits.
- [ ] Rate limits/quotas.
- [ ] SSRF allowlist.
- [ ] Safe deserialization.
- [ ] XML XXE disabled if XML enabled.

## 55.5 Output/observability

- [ ] Security headers.
- [ ] No stack trace to client.
- [ ] Problem Details safe.
- [ ] Audit logs for sensitive actions.
- [ ] Security metrics/alerts.
- [ ] Secrets management.
- [ ] TLS/mTLS policy.
- [ ] Incident kill switches.

## 55.6 Testing

- [ ] Negative auth tests.
- [ ] BOLA tests.
- [ ] Tenant isolation tests.
- [ ] CORS/CSRF tests.
- [ ] Upload security tests.
- [ ] SSRF tests.
- [ ] Fuzz/property tests for parsers.
- [ ] SAST/SCA/secret scans.
- [ ] DAST/VAPT readiness.

---

# 56. Latihan

## Latihan 1 — JWT Validation Filter

Buat `ContainerRequestFilter` yang:

- membaca bearer token;
- validasi signature/issuer/audience/expiry;
- reject missing/invalid token;
- set `SecurityContext`;
- tidak log token.

## Latihan 2 — BOLA Test

Endpoint:

```text
GET /customers/{id}
```

Buat data tenant A/B.

User tenant A mencoba akses tenant B.

Pastikan 403/404 sesuai policy dan data tidak leak.

## Latihan 3 — Field-Level Authorization

Role SUPPORT boleh melihat `displayName`, tidak boleh melihat `nationalId`.

Test mapper response.

## Latihan 4 — CORS Matrix

Test origins:

- allowed origin;
- disallowed origin;
- credentialed request;
- preflight custom header.

Assert headers benar.

## Latihan 5 — CSRF Protection

Untuk cookie-auth POST:

- tanpa CSRF token → reject;
- token salah → reject;
- origin salah → reject;
- token valid → success.

## Latihan 6 — Resource Limits

Test:

- JSON body too large;
- array too large;
- page size too high;
- upload too large.

Assert 413/400/422 per policy.

## Latihan 7 — SSRF Validator

Property-test URL validator agar reject:

- localhost;
- 127.0.0.1;
- private IP;
- link-local metadata IP;
- redirect to private IP.

## Latihan 8 — File Upload Security

Upload:

- `.jsp`;
- double extension;
- spoofed MIME;
- path traversal filename;
- zip bomb sample in safe test env.

Assert rejection/quarantine.

## Latihan 9 — Security Observability

Instrument metric:

```text
security.authorization.denied.total
security.upload.rejected.total
security.rate_limited.total
```

Simulate failures and verify metrics/logs.

---

# 57. Referensi Resmi

Referensi utama:

1. OWASP API Security Top 10 2023  
   https://owasp.org/API-Security/editions/2023/en/0x00-header/

2. OWASP API4:2023 — Unrestricted Resource Consumption  
   https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/

3. OWASP REST Security Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html

4. OWASP Authorization Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html

5. OWASP CSRF Prevention Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html

6. OWASP HTTP Headers Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html

7. OWASP File Upload Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html

8. OWASP Unrestricted File Upload  
   https://owasp.org/www-community/vulnerabilities/Unrestricted_File_Upload

9. OWASP XML External Entity Prevention Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/XML_External_Entity_Prevention_Cheat_Sheet.html

10. RFC 8725 — JSON Web Token Best Current Practices  
    https://www.rfc-editor.org/rfc/rfc8725.html

11. Jakarta RESTful Web Services 4.0 Specification  
    https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

---

# 58. Penutup

Security hardening untuk JAX-RS API bukan satu library dan bukan satu filter.

Mental model final:

```text
identity
  ↓
coarse authorization
  ↓
object/tenant authorization
  ↓
input/resource limits
  ↓
safe processing/deserialization
  ↓
safe response/error mapping
  ↓
audit/security observability
  ↓
operational controls
```

Prinsip final:

```text
Authenticate strongly.
Authorize specifically.
Validate and limit aggressively.
Never trust client-controlled identifiers, URLs, files, or claims.
Avoid leaking internals.
Observe security events.
Test negative cases.
Plan incident controls.
```

Top-tier JAX-RS engineer memastikan:

- JWT/OIDC validation lengkap;
- object-level authorization tidak bisa dibypass;
- tenant isolation enforced di query;
- CORS/CSRF sesuai caller model;
- input size/complexity/rate dibatasi;
- SSRF/file upload/deserialization risks dikontrol;
- Problem Details aman;
- audit/security telemetry tersedia;
- security tests menjadi bagian CI;
- gateway membantu, tetapi app tetap enforce domain authorization.

Part berikutnya:

```text
Bagian 043 — REST API Design for Enterprise Domains
```

Kita akan membahas desain REST API untuk domain enterprise: aggregate/resource modeling, command vs resource endpoints, workflows, state machines, domain errors, idempotency, tenant/security boundaries, event/outbox integration, and long-term evolvability.
