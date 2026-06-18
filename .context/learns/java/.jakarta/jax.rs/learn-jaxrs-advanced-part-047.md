# learn-jaxrs-advanced-part-047.md

# Bagian 047 — API Gateway, Reverse Proxy, Load Balancer, and JAX-RS Apps: Forwarded Headers, Base URI, TLS Termination, Path Rewriting, Auth Offload, Rate Limit, Request Size, Timeout, Buffering, Streaming/SSE, Observability, and Security Boundaries

> Target pembaca: Java/Jakarta engineer yang menjalankan Jakarta REST/JAX-RS apps di belakang API Gateway, reverse proxy, ingress controller, load balancer, WAF, atau service mesh. Fokus bagian ini bukan konfigurasi satu produk tertentu, tetapi memahami **kontrak antara edge/proxy dan aplikasi**: forwarded headers, original scheme/host/client IP, base URI generation, path rewriting, TLS termination, CORS, auth offload, rate limit, request size, timeout, buffering, streaming/SSE, file upload/download, observability, dan trust boundary.
>
> Prinsip utama:
>
> ```text
> A JAX-RS app behind a proxy does not see the internet as it really is.
> You must explicitly define which proxy information is trusted, normalized, propagated, and used.
> ```

---

## Daftar Isi

1. [Tujuan Part Ini](#1-tujuan-part-ini)
2. [Mental Model: Edge-to-App Contract](#2-mental-model-edge-to-app-contract)
3. [Komponen: Gateway, Reverse Proxy, Load Balancer, WAF, Ingress, Mesh](#3-komponen-gateway-reverse-proxy-load-balancer-waf-ingress-mesh)
4. [Apa yang Berubah Saat Ada Proxy](#4-apa-yang-berubah-saat-ada-proxy)
5. [Trust Boundary](#5-trust-boundary)
6. [Forwarded Headers](#6-forwarded-headers)
7. [`Forwarded` vs `X-Forwarded-*`](#7-forwarded-vs-x-forwarded-)
8. [Client IP Handling](#8-client-ip-handling)
9. [Scheme/Protocol Handling](#9-schemeprotocol-handling)
10. [Host and Port Handling](#10-host-and-port-handling)
11. [Base URI and Link Generation in JAX-RS](#11-base-uri-and-link-generation-in-jax-rs)
12. [Path Rewriting and Prefix Stripping](#12-path-rewriting-and-prefix-stripping)
13. [Context Path and `@ApplicationPath`](#13-context-path-and-applicationpath)
14. [Location Header Correctness](#14-location-header-correctness)
15. [Absolute vs Relative URLs](#15-absolute-vs-relative-urls)
16. [TLS Termination](#16-tls-termination)
17. [HSTS and HTTPS Enforcement](#17-hsts-and-https-enforcement)
18. [mTLS at Gateway vs App](#18-mtls-at-gateway-vs-app)
19. [Auth Offload](#19-auth-offload)
20. [JWT Validation at Gateway and App](#20-jwt-validation-at-gateway-and-app)
21. [Gateway-Injected Identity Headers](#21-gateway-injected-identity-headers)
22. [CORS at Gateway vs App](#22-cors-at-gateway-vs-app)
23. [Rate Limiting and Quotas](#23-rate-limiting-and-quotas)
24. [Request Size Limits](#24-request-size-limits)
25. [Timeout Budget Across Layers](#25-timeout-budget-across-layers)
26. [Connection Keep-Alive and Idle Timeout](#26-connection-keep-alive-and-idle-timeout)
27. [Retry at Gateway](#27-retry-at-gateway)
28. [Buffering](#28-buffering)
29. [Request Buffering and Uploads](#29-request-buffering-and-uploads)
30. [Response Buffering and Streaming](#30-response-buffering-and-streaming)
31. [SSE Through Proxy](#31-sse-through-proxy)
32. [Large Download and Range Requests](#32-large-download-and-range-requests)
33. [Compression at Gateway vs App](#33-compression-at-gateway-vs-app)
34. [Caching at Gateway](#34-caching-at-gateway)
35. [Header Normalization and Hop-by-Hop Headers](#35-header-normalization-and-hop-by-hop-headers)
36. [Request Smuggling Awareness](#36-request-smuggling-awareness)
37. [Observability Across Gateway and App](#37-observability-across-gateway-and-app)
38. [Correlation ID and Trace Propagation](#38-correlation-id-and-trace-propagation)
39. [Access Logs: Gateway vs App](#39-access-logs-gateway-vs-app)
40. [Health Checks and Readiness](#40-health-checks-and-readiness)
41. [Load Balancing Behavior](#41-load-balancing-behavior)
42. [Sticky Sessions and Stateless APIs](#42-sticky-sessions-and-stateless-apis)
43. [Blue-Green/Canary and Routing](#43-blue-greencanary-and-routing)
44. [Multi-Tenant Gateway Routing](#44-multi-tenant-gateway-routing)
45. [API Version Routing](#45-api-version-routing)
46. [JAX-RS Implementation Sketch](#46-jax-rs-implementation-sketch)
47. [Proxy Contract Test Strategy](#47-proxy-contract-test-strategy)
48. [Common Failure Modes](#48-common-failure-modes)
49. [Best Practices](#49-best-practices)
50. [Anti-Patterns](#50-anti-patterns)
51. [Production Checklist](#51-production-checklist)
52. [Latihan](#52-latihan)
53. [Referensi Resmi](#53-referensi-resmi)
54. [Penutup](#54-penutup)

---

# 1. Tujuan Part Ini

Di production, JAX-RS app jarang langsung menerima request dari public client.

Biasanya chain-nya:

```text
Client
  ↓
CDN / WAF
  ↓
API Gateway
  ↓
Load Balancer
  ↓
Ingress / Reverse Proxy
  ↓
Service Mesh Sidecar
  ↓
JAX-RS App
```

JAX-RS app melihat request dari proxy, bukan dari client asli.

Jika tidak dirancang, bug muncul:

- generated `Location` header memakai internal host;
- redirect ke `http://localhost:8080`;
- `UriInfo.getBaseUri()` salah;
- client IP salah;
- auth header spoofed;
- CORS double headers;
- upload gagal karena proxy size limit;
- SSE buffered dan event terlambat;
- streaming download ditahan proxy;
- timeout gateway lebih pendek dari app;
- retry gateway menggandakan POST;
- trace putus di edge;
- `X-Forwarded-For` dipercaya dari internet;
- tenant header spoofed;
- request smuggling karena proxy/backend parsing tidak selaras.

## 1.1 Target akhir

Setelah bagian ini, kamu bisa:

- memahami edge-to-app contract;
- memakai forwarded headers secara aman;
- memastikan base URI/link/Location benar;
- menentukan TLS/auth/CORS/rate limit di gateway vs app;
- mengatur timeout/request size/buffering untuk REST, upload, download, SSE;
- mencegah header spoofing;
- menyiapkan observability end-to-end;
- menulis proxy contract tests;
- membuat checklist production gateway untuk JAX-RS apps.

---

# 2. Mental Model: Edge-to-App Contract

Gateway/proxy dan app harus punya kontrak eksplisit.

Kontrak itu menjawab:

```text
Header apa yang ditambahkan gateway?
Header apa yang dihapus gateway?
Header mana yang trusted?
Apakah path di-rewrite?
Apakah TLS terminate di gateway?
Apakah app tahu original scheme/host?
Siapa validasi auth?
Siapa enforce CORS?
Siapa enforce request size?
Siapa compress?
Siapa buffer?
Timeout berapa di setiap layer?
Bagaimana trace/correlation dipropagate?
```

## 2.1 Tanpa kontrak

Setiap layer membuat asumsi sendiri.

## 2.2 Dengan kontrak

App bisa membuat URL benar, security boundary jelas, dan streaming tidak rusak.

## 2.3 Rule

Treat gateway/proxy behavior as part of the API runtime contract.

---

# 3. Komponen: Gateway, Reverse Proxy, Load Balancer, WAF, Ingress, Mesh

## 3.1 Load balancer

Mendistribusikan traffic ke instance.

Fokus:

- health check;
- balancing algorithm;
- connection handling;
- TLS termination;
- target group.

## 3.2 Reverse proxy

Menerima request, meneruskan ke backend.

Fokus:

- header forwarding;
- path rewrite;
- buffering;
- compression;
- timeout;
- caching.

## 3.3 API Gateway

Layer API management.

Fokus:

- auth;
- rate limit;
- quota;
- API key;
- request/response transform;
- version routing;
- analytics;
- developer portal.

## 3.4 WAF

Melindungi dari pola attack.

Fokus:

- malicious payload;
- bot/abuse;
- managed rules;
- IP reputation;
- request anomalies.

## 3.5 Ingress controller

Kubernetes entrypoint.

Fokus:

- host/path routing;
- TLS;
- annotations/config;
- service routing.

## 3.6 Service mesh

Sidecar/proxy internal.

Fokus:

- mTLS;
- retries;
- traffic splitting;
- telemetry;
- policy.

## 3.7 Rule

Know which layer owns which responsibility.

---

# 4. Apa yang Berubah Saat Ada Proxy

Without proxy:

```text
client → app
```

App sees:

- client IP;
- public host;
- public scheme;
- original path.

With proxy:

```text
client → proxy → app
```

App sees:

- proxy IP;
- internal host;
- internal scheme maybe HTTP;
- rewritten path maybe;
- modified headers.

## 4.1 Example

External:

```http
GET https://api.example.com/v1/customers/C001
```

Internal to app:

```http
GET http://customers-service:8080/customers/C001
Host: customers-service:8080
X-Forwarded-Proto: https
X-Forwarded-Host: api.example.com
X-Forwarded-Prefix: /v1
```

## 4.2 Rule

The app must know how to reconstruct external request context if it emits links/redirects.

---

# 5. Trust Boundary

Forwarded headers are easy to spoof if accepted directly from public clients.

## 5.1 Bad

Internet client sends:

```http
X-Forwarded-For: 127.0.0.1
X-Forwarded-Proto: https
X-User-ID: admin
```

App trusts it.

## 5.2 Good

At edge:

- strip incoming `X-Forwarded-*`;
- generate new forwarded headers;
- app only trusts headers from known proxy IP/network;
- internal channel protected.

## 5.3 Rule

Never trust forwarded or identity headers unless inserted by a trusted proxy after stripping client-supplied values.

---

# 6. Forwarded Headers

RFC 7239 defines standard `Forwarded` header.

Example:

```http
Forwarded: for=192.0.2.60;proto=https;host=api.example.com
```

It can preserve information lost by proxying:

- original client;
- original host;
- original protocol;
- proxy chain.

## 6.1 Important fields

```text
for
by
host
proto
```

## 6.2 Rule

Prefer standard `Forwarded` where ecosystem supports it, but be ready for `X-Forwarded-*` de facto headers.

---

# 7. `Forwarded` vs `X-Forwarded-*`

## 7.1 Standard

```http
Forwarded: for=203.0.113.10;proto=https;host=api.example.com
```

## 7.2 De facto

```http
X-Forwarded-For: 203.0.113.10
X-Forwarded-Proto: https
X-Forwarded-Host: api.example.com
X-Forwarded-Port: 443
X-Forwarded-Prefix: /v1
```

## 7.3 Reality

Many gateways/LBs use `X-Forwarded-*`.

## 7.4 Rule

Choose supported convention, document it, normalize it, and test it.

---

# 8. Client IP Handling

## 8.1 Why client IP matters

- audit;
- rate limiting;
- geo policy;
- abuse detection;
- allowlist;
- logs.

## 8.2 Problem

`ContainerRequestContext` may see proxy IP, not real client IP.

## 8.3 `X-Forwarded-For`

Can contain chain:

```http
X-Forwarded-For: client, proxy1, proxy2
```

Which IP to trust depends on known proxy chain.

## 8.4 Rule

Client IP extraction is infrastructure policy, not string split in random app code.

---

# 9. Scheme/Protocol Handling

If TLS terminates at gateway, app receives HTTP internally.

## 9.1 Problem

App generates:

```text
http://internal-service:8080/...
```

instead of:

```text
https://api.example.com/...
```

## 9.2 Forwarded proto

```http
X-Forwarded-Proto: https
Forwarded: proto=https
```

## 9.3 Rule

External scheme must be reconstructed from trusted forwarded headers or configured external base URL.

---

# 10. Host and Port Handling

## 10.1 Host rewrite

Proxy may call backend with:

```http
Host: customers-service:8080
```

while public host is:

```http
api.example.com
```

## 10.2 Fix

Use trusted:

```http
X-Forwarded-Host
Forwarded: host=...
```

or configured public base URL.

## 10.3 Rule

Do not use untrusted Host header for security decisions or generated links without normalization.

---

# 11. Base URI and Link Generation in JAX-RS

JAX-RS `UriInfo` helps build URLs.

```java
@Context UriInfo uriInfo;
```

## 11.1 Example

```java
URI location = uriInfo.getAbsolutePathBuilder()
    .path(newId)
    .build();
```

## 11.2 Behind proxy

If runtime does not process forwarded headers, generated URI may be internal.

## 11.3 Strategies

- configure runtime/framework forwarded header support;
- use gateway-injected normalized headers;
- use configured external base URL;
- generate relative links where acceptable.

## 11.4 Rule

Test generated `Location` and links through the real proxy path.

---

# 12. Path Rewriting and Prefix Stripping

External:

```text
/api/v1/customers/C001
```

Gateway strips `/api/v1`.

Internal:

```text
/customers/C001
```

## 12.1 Problem

App-generated links miss `/api/v1`.

## 12.2 Common header

```http
X-Forwarded-Prefix: /api/v1
```

Not standardized like RFC 7239, but common.

## 12.3 Alternatives

- app deployed with same context path;
- gateway does not strip prefix;
- configured external base URL;
- link generation aware of prefix.

## 12.4 Rule

Path rewriting must be part of API contract, not an invisible ops trick.

---

# 13. Context Path and `@ApplicationPath`

JAX-RS base path may come from:

```java
@ApplicationPath("/api")
```

Servlet context path.

Proxy path prefix.

## 13.1 Risk

Double prefix:

```text
/api/api/customers
```

or missing prefix:

```text
/customers
```

## 13.2 Rule

Decide whether version/prefix lives in app, gateway, or both. Do not duplicate.

---

# 14. Location Header Correctness

For creation:

```http
201 Created
Location: https://api.example.com/v1/customers/C001
```

## 14.1 Common bug

```http
Location: http://customers-service:8080/customers/C001
```

## 14.2 Test

Integration test through gateway:

```text
POST external URL
assert Location starts with external public URL/prefix
```

## 14.3 Rule

`Location` is public contract; do not leak internal host.

---

# 15. Absolute vs Relative URLs

## 15.1 Absolute

Good when clients need complete URL.

Risk behind proxy if base URI wrong.

## 15.2 Relative

```http
Location: /v1/customers/C001
```

Can avoid scheme/host issue.

But some clients/specs/tools may expect absolute depending context.

## 15.3 Rule

Choose policy and apply consistently.

---

# 16. TLS Termination

TLS can terminate at:

- CDN;
- gateway;
- load balancer;
- ingress;
- service mesh;
- app.

## 16.1 Common pattern

```text
Client HTTPS → Gateway
Gateway HTTP/mTLS → App
```

## 16.2 App awareness

App may need know original secure scheme for:

- generated links;
- secure cookies;
- redirects;
- HSTS;
- security checks.

## 16.3 Rule

TLS termination point must be documented and app must not falsely assume direct HTTPS.

---

# 17. HSTS and HTTPS Enforcement

For browser-facing APIs/domains, HSTS can instruct browsers to use HTTPS.

## 17.1 Where set

Often gateway/CDN.

Could also app response filter.

## 17.2 Caveat

Only set HSTS when HTTPS is reliable for domain/subdomains per policy.

## 17.3 Rule

HTTPS enforcement is edge responsibility, but app security should assume secure transport only after trust boundary is verified.

---

# 18. mTLS at Gateway vs App

## 18.1 mTLS at gateway

Gateway validates client cert.

App receives identity via trusted header.

Needs header spoofing protection.

## 18.2 mTLS to app

App validates client cert directly.

More direct but operationally heavier.

## 18.3 Service mesh mTLS

Sidecars provide workload identity.

App still needs application authorization.

## 18.4 Rule

mTLS proves channel/workload/client identity, not domain authorization by itself.

---

# 19. Auth Offload

Gateway may validate:

- API key;
- OAuth token;
- mTLS cert;
- session;
- WAF rules.

## 19.1 Benefits

- centralized auth;
- consistent policy;
- less app burden;
- analytics/rate limit.

## 19.2 Risks

- app blindly trusts spoofable headers;
- missing object-level authorization;
- gateway route misconfiguration exposes endpoint;
- token claims lost/over-transformed.

## 19.3 Rule

Gateway can authenticate; app must still authorize domain actions.

---

# 20. JWT Validation at Gateway and App

## 20.1 Gateway-only validation

App trusts gateway identity headers.

Needs protected internal network and header stripping.

## 20.2 App validation

App validates JWT itself.

More defense-in-depth.

## 20.3 Hybrid

Gateway validates coarse auth; app validates token/claims or signed identity header for sensitive APIs.

## 20.4 Rule

For high-risk APIs, avoid making app completely blind to credential/claim validity.

---

# 21. Gateway-Injected Identity Headers

Examples:

```http
X-User-ID
X-Tenant-ID
X-Scopes
X-Client-ID
```

## 21.1 Requirements

- strip incoming headers with same names;
- inject at trusted gateway;
- protect gateway-to-app link;
- document schema;
- validate in app;
- audit.

## 21.2 Better

Use signed internal token or JWT from gateway to app.

## 21.3 Rule

Identity headers are credentials inside your network. Treat them as sensitive.

---

# 22. CORS at Gateway vs App

## 22.1 Gateway CORS

Centralized and useful.

## 22.2 App CORS

Better when origin policy depends on resource/tenant/user.

## 22.3 Avoid double CORS

If both set headers inconsistently, browser behavior breaks.

## 22.4 Rule

One layer should own CORS policy for a route, unless coordination is exact.

---

# 23. Rate Limiting and Quotas

Gateway often enforces:

- IP rate limit;
- API key quota;
- client ID quota;
- route limits.

App enforces:

- business operation quota;
- tenant quota;
- active job count;
- domain cost limits.

## 23.1 Rule

Gateway rate limit protects edge; app quota protects domain/resources.

---

# 24. Request Size Limits

Set limits at multiple layers:

- CDN/WAF;
- gateway;
- ingress/proxy;
- app server;
- JAX-RS multipart/provider;
- domain validation.

## 24.1 Failure mode

Gateway rejects upload at 10MB while app docs say 50MB.

## 24.2 Rule

Published API limits must match the smallest effective limit in the chain.

---

# 25. Timeout Budget Across Layers

Timeouts exist at:

- client;
- CDN/gateway;
- LB;
- ingress;
- app server;
- JAX-RS async;
- DB;
- outbound client;
- worker/job.

## 25.1 Bad

Gateway timeout: 30s.

App tries to process for 60s.

Client sees 504 while app may continue side effect.

## 25.2 Design

Timeout order should be intentional.

For synchronous request:

```text
client timeout > gateway timeout > app timeout > downstream timeout
```

or a known budget propagation model.

## 25.3 Rule

Timeouts are distributed system contract.

---

# 26. Connection Keep-Alive and Idle Timeout

Long-lived connections affected by idle timeouts.

## 26.1 Affects

- SSE;
- streaming download;
- long polling;
- large upload;
- slow clients.

## 26.2 Heartbeat

SSE should send heartbeat/comment before idle timeout.

## 26.3 Rule

Long-lived endpoints must be designed against the shortest idle timeout in the chain.

---

# 27. Retry at Gateway

Gateway may retry upstream requests.

## 27.1 Safe for

- GET;
- HEAD;
- maybe idempotent PUT/DELETE depending semantics.

## 27.2 Dangerous for

- POST without idempotency key;
- payment;
- submission;
- side-effecting commands.

## 27.3 Rule

Disable or constrain gateway retries for non-idempotent operations unless idempotency is enforced.

---

# 28. Buffering

Proxies may buffer request and response bodies.

## 28.1 Benefits

- protect backend from slow clients;
- enable retries/caching/compression;
- smooth network.

## 28.2 Costs

- streaming delayed;
- memory/disk usage;
- time-to-first-byte worse;
- SSE broken;
- upload not streamed to app.

## 28.3 Rule

Buffering is good by default for normal responses, but must be disabled/tuned for streaming/SSE.

---

# 29. Request Buffering and Uploads

Proxy request buffering means gateway reads full upload before sending to app.

## 29.1 Pros

- app not tied to slow client;
- gateway can enforce size;
- backend receives fast local stream.

## 29.2 Cons

- app cannot process stream early;
- temp disk pressure at proxy;
- upload progress semantics differ;
- large file latency before app sees request.

## 29.3 Rule

For large uploads, decide where buffering, scanning, and size limits happen.

---

# 30. Response Buffering and Streaming

Response buffering means proxy reads response from app into buffer/temp file before sending to client.

## 30.1 Good for

- normal JSON;
- small responses;
- slow clients;
- compression/caching.

## 30.2 Bad for

- SSE;
- chunked progress;
- live stream;
- time-to-first-byte-sensitive downloads.

## 30.3 NGINX behavior

When proxy buffering is enabled, NGINX stores proxied response in memory buffers and may use temporary files; when disabled, it passes response to the client synchronously as received.

## 30.4 Rule

Streaming endpoints need proxy-specific buffering configuration.

---

# 31. SSE Through Proxy

SSE requires:

```http
Content-Type: text/event-stream
Cache-Control: no-cache
```

and long-lived connection.

## 31.1 Proxy concerns

- response buffering;
- idle timeout;
- compression;
- connection headers;
- HTTP version;
- gateway max duration;
- load balancer draining.

## 31.2 App headers

Often useful:

```http
X-Accel-Buffering: no
```

for NGINX-compatible proxies.

## 31.3 Still configure proxy

Do not rely only on app header; ingress/proxy may strip/ignore it.

## 31.4 Rule

SSE must be tested through the exact production proxy chain.

---

# 32. Large Download and Range Requests

## 32.1 Download concerns

- buffering;
- sendfile;
- range requests;
- Content-Length;
- Content-Disposition;
- checksum;
- client abort;
- timeout.

## 32.2 Gateway offload

For large static/object storage files, consider:

- signed URL;
- redirect to object storage;
- gateway acceleration;
- internal redirect mechanism.

## 32.3 Rule

JAX-RS app should not always be data plane for huge files if object storage/CDN can serve safely.

---

# 33. Compression at Gateway vs App

## 33.1 Gateway compression

Centralized and often preferred.

## 33.2 App compression

Useful if app-specific and gateway does not.

## 33.3 Avoid double compression

Ensure only one layer compresses.

## 33.4 Streaming caveat

Compression can buffer output and break real-time delivery.

## 33.5 Rule

Compression policy belongs to edge/app contract.

---

# 34. Caching at Gateway

Gateway can cache:

- public GET;
- static metadata;
- idempotent safe responses.

## 34.1 Must respect

- `Cache-Control`;
- `ETag`;
- `Vary`;
- authorization;
- tenant/user-specific data.

## 34.2 Dangerous

Caching authenticated user data without `Vary`/private policy.

## 34.3 Rule

Gateway cache key must include all dimensions that affect response.

---

# 35. Header Normalization and Hop-by-Hop Headers

Some headers are hop-by-hop and should not be forwarded end-to-end.

Examples include:

```text
Connection
Keep-Alive
Transfer-Encoding
Upgrade
```

depending HTTP version and semantics.

## 35.1 Proxy responsibility

Normalize and remove unsafe/hop-by-hop headers.

## 35.2 App responsibility

Do not build security logic on ambiguous/proxy-controlled hop headers.

## 35.3 Rule

Header forwarding must be allowlist-based for sensitive headers.

---

# 36. Request Smuggling Awareness

Request smuggling exploits disagreement between proxy and backend about request boundaries.

## 36.1 Risk factors

- conflicting `Content-Length`;
- `Transfer-Encoding`;
- HTTP/1.1 parsing differences;
- proxy/backend mismatch;
- lax header normalization.

## 36.2 Defense

- patched proxy/backend;
- normalize/reject ambiguous requests;
- avoid unsupported HTTP parsing modes;
- WAF/gateway rules;
- test edge/backends.

## 36.3 Rule

Request smuggling is edge/backend contract bug, not only app code bug.

---

# 37. Observability Across Gateway and App

Need correlate:

- gateway request log;
- app access log;
- downstream trace;
- error response;
- client report.

## 37.1 Common fields

- correlation ID;
- trace ID;
- route;
- status;
- duration;
- upstream duration;
- client IP;
- gateway status;
- app status;
- retry attempt.

## 37.2 Rule

Every request should be traceable across gateway and app.

---

# 38. Correlation ID and Trace Propagation

## 38.1 At edge

If absent, generate correlation ID.

If present, validate.

## 38.2 Propagate

```http
X-Correlation-ID
traceparent
tracestate
```

## 38.3 App

Include in logs/Problem Details/outbound calls.

## 38.4 Rule

Correlation and trace context must enter at first trusted edge.

---

# 39. Access Logs: Gateway vs App

## 39.1 Gateway access log

Knows:

- client IP;
- TLS;
- public host/path;
- WAF/rate decisions;
- upstream latency.

## 39.2 App access log

Knows:

- resource route;
- domain error code;
- authenticated actor;
- tenant;
- downstream calls.

## 39.3 Rule

Gateway log and app log are complementary, not substitutes.

---

# 40. Health Checks and Readiness

Load balancer needs health endpoint.

## 40.1 Liveness

Process alive.

```text
GET /health/live
```

## 40.2 Readiness

Can serve traffic.

```text
GET /health/ready
```

Check critical dependencies based on policy.

## 40.3 Avoid heavy health

Do not make health check overload DB.

## 40.4 Rule

Health checks should match LB traffic decisions.

---

# 41. Load Balancing Behavior

## 41.1 Algorithms

- round-robin;
- least connections;
- weighted;
- latency-based;
- consistent hashing.

## 41.2 JAX-RS impact

Stateless APIs scale better.

Stateful sessions/SSE may need special routing.

## 41.3 Rule

App design should not assume one client always reaches same instance unless configured.

---

# 42. Sticky Sessions and Stateless APIs

## 42.1 Avoid sticky when possible

REST APIs should be stateless.

## 42.2 When sticky matters

- in-memory session;
- WebSocket;
- local SSE registry;
- local upload state.

## 42.3 Better

Externalize state:

- DB;
- Redis;
- message broker;
- distributed event bus.

## 42.4 Rule

Sticky sessions are operational coupling; use deliberately.

---

# 43. Blue-Green/Canary and Routing

Gateway/LB often controls rollout.

## 43.1 Risks

- old and new versions produce different response shape;
- sticky users split across versions;
- idempotency store not shared;
- async operation created by v1 polled by v2.

## 43.2 Rule

Rolling/canary deploy requires backward-compatible API and shared durable state.

---

# 44. Multi-Tenant Gateway Routing

Gateway may route by:

- host/subdomain;
- path prefix;
- tenant header;
- mTLS cert;
- API key.

## 44.1 Risk

Tenant header spoofing.

## 44.2 App verification

App should validate tenant from trusted identity, not only route.

## 44.3 Rule

Gateway routing helps, but app still enforces tenant authorization.

---

# 45. API Version Routing

Gateway may route:

```text
/v1 → service-v1
/v2 → service-v2
```

or use header/media type.

## 45.1 App impact

Generated links must include correct version path.

## 45.2 Rule

Version routing and app link generation must be aligned.

---

# 46. JAX-RS Implementation Sketch

## 46.1 Forwarded context filter

```java
@Provider
@Priority(Priorities.HEADER_DECORATOR)
public class ForwardedContextFilter implements ContainerRequestFilter {

    @Override
    public void filter(ContainerRequestContext ctx) {
        // Prefer runtime/container support if available.
        // If implemented here:
        // 1. ensure request came from trusted proxy
        // 2. validate/sanitize forwarded headers
        // 3. store normalized external context as request property
    }
}
```

## 46.2 ExternalUriBuilder

```java
@ApplicationScoped
public class ExternalUriBuilder {

    public URI customerUri(ContainerRequestContext ctx, CustomerId id) {
        ExternalRequestContext ext = (ExternalRequestContext) ctx.getProperty("externalRequestContext");

        return URI.create(ext.baseUrl() + "/customers/" + encode(id.value()));
    }
}
```

## 46.3 Prefer platform support

Many runtimes/containers have built-in forwarded header support.

Use it when reliable and tested.

## 46.4 Rule

Do not hand-roll forwarded parsing unless you must; if you do, keep it strict.

---

# 47. Proxy Contract Test Strategy

## 47.1 Test through proxy

Spin proxy + app in integration test or staging.

Test:

- external path;
- `Location`;
- links;
- CORS;
- auth headers;
- client IP;
- request size;
- timeout;
- SSE;
- streaming;
- upload.

## 47.2 Contract tests

Given external request:

```text
https://api.example.com/v1/customers
```

Assert app response:

```text
Location: https://api.example.com/v1/customers/{id}
```

## 47.3 Security tests

- spoofed `X-Forwarded-For`;
- spoofed identity header;
- wrong Host;
- direct backend access blocked.

## 47.4 Rule

Proxy behavior must be tested as part of API contract.

---

# 48. Common Failure Modes

## 48.1 Internal host leak

`Location` shows service DNS.

## 48.2 Wrong scheme

App generates HTTP link after HTTPS termination.

## 48.3 Missing prefix

Links miss `/v1`.

## 48.4 Double CORS

Browser rejects.

## 48.5 Trusted spoofed header

Security bypass.

## 48.6 Gateway retries POST

Duplicate side effects.

## 48.7 Gateway timeout shorter than app

504 but app continues.

## 48.8 SSE buffered

Events arrive in batch.

## 48.9 Upload limit mismatch

Docs say 50MB, proxy rejects 10MB.

## 48.10 Cache ignores Authorization

Data leak.

## 48.11 Trace starts at app, not edge

Missing gateway latency.

## 48.12 Direct backend exposed

Bypasses gateway controls.

---

# 49. Best Practices

## 49.1 Document edge-to-app contract

Headers, path, timeout, auth, CORS.

## 49.2 Strip untrusted forwarded headers

At edge.

## 49.3 Trust only known proxies

For forwarded information.

## 49.4 Test generated links

Through real proxy.

## 49.5 Align timeout budgets

Across layers.

## 49.6 Disable/tune buffering for streaming/SSE

Route-specific.

## 49.7 Keep app stateless

Avoid sticky sessions.

## 49.8 Use gateway for coarse controls

TLS, WAF, rate limit, size.

## 49.9 Keep app domain authorization

Object/tenant rules.

## 49.10 Correlate gateway and app logs

Trace/correlation ID.

---

# 50. Anti-Patterns

## 50.1 Trust all `X-Forwarded-*`

Spoofing risk.

## 50.2 Use `Host` header blindly

Host header attack/internal link issue.

## 50.3 Put domain authorization only in gateway

Insufficient.

## 50.4 Rewrite paths without app awareness

Broken links.

## 50.5 Return bare absolute internal URLs

Leaks infra.

## 50.6 Buffer SSE

Breaks realtime.

## 50.7 Retry all methods at gateway

Duplicate writes.

## 50.8 Different limits per layer without docs

Confusing failures.

## 50.9 Direct app access allowed

Bypasses gateway security.

## 50.10 No proxy integration tests

Production-only bugs.

---

# 51. Production Checklist

## 51.1 Forwarded/base URI

- [ ] Forwarded header convention chosen.
- [ ] Incoming spoofed headers stripped.
- [ ] App trusts only known proxies.
- [ ] External scheme/host/prefix handled.
- [ ] `Location` tested externally.
- [ ] Links tested externally.
- [ ] Path rewrite documented.

## 51.2 Security

- [ ] TLS termination documented.
- [ ] HSTS policy.
- [ ] Auth ownership gateway/app defined.
- [ ] Identity headers protected.
- [ ] App still enforces object/tenant auth.
- [ ] CORS owned by one layer.
- [ ] Direct backend access blocked.
- [ ] Request smuggling mitigations reviewed.

## 51.3 Reliability/performance

- [ ] Timeout budget aligned.
- [ ] Request size limits aligned.
- [ ] Rate limits/quotas aligned.
- [ ] Buffering policy per route.
- [ ] SSE tested.
- [ ] Upload/download tested.
- [ ] Compression ownership defined.
- [ ] Cache key policy defined.

## 51.4 Observability

- [ ] Correlation ID generated at edge.
- [ ] Trace context propagated.
- [ ] Gateway/app logs correlated.
- [ ] Gateway and app status visible.
- [ ] Upstream latency measured.
- [ ] Health/readiness endpoints configured.

---

# 52. Latihan

## Latihan 1 — Location Header Through Proxy

Deploy app behind proxy with external prefix `/v1`.

Create resource:

```http
POST /v1/customers
```

Assert `Location` includes `https://public-host/v1/customers/{id}`.

## Latihan 2 — Spoofed Forwarded Header

Send from public client:

```http
X-Forwarded-For: 127.0.0.1
X-User-ID: admin
```

Ensure gateway strips/overwrites and app does not trust spoofed value.

## Latihan 3 — CORS Ownership

Configure CORS at gateway only.

Ensure app does not emit conflicting CORS headers.

Test preflight.

## Latihan 4 — Timeout Budget

Map all timeouts:

```text
client
gateway
ingress
app
DB
downstream
```

Fix inconsistent values.

## Latihan 5 — SSE Proxy Test

Run SSE endpoint through proxy.

Test event arrives immediately, not batched.

Disable buffering for SSE route.

## Latihan 6 — Upload Limit Alignment

Set documented upload limit 50MB.

Verify CDN/gateway/ingress/app all allow 50MB and reject >50MB consistently.

## Latihan 7 — Gateway Retry Safety

Enable gateway retry only for GET.

Confirm POST is not retried unless idempotency key policy exists.

## Latihan 8 — Trace Correlation

Generate request through gateway.

Verify same trace/correlation ID appears in gateway log, app log, downstream trace.

---

# 53. Referensi Resmi

Referensi utama:

1. RFC 7239 — Forwarded HTTP Extension  
   https://datatracker.ietf.org/doc/html/rfc7239

2. RFC 9110 — HTTP Semantics  
   https://www.rfc-editor.org/rfc/rfc9110.html

3. NGINX `ngx_http_proxy_module` documentation  
   https://nginx.org/en/docs/http/ngx_http_proxy_module.html

4. NGINX Reverse Proxy Admin Guide  
   https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/

5. OWASP REST Security Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html

6. OWASP HTTP Headers Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html

7. OWASP HTTP Strict Transport Security Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Strict_Transport_Security_Cheat_Sheet.html

8. Jakarta RESTful Web Services 4.0 Specification  
   https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0

9. Jakarta RESTful Web Services 4.0 — `UriInfo` API Docs  
   https://jakarta.ee/specifications/restful-ws/4.0/apidocs/jakarta.ws.rs/jakarta/ws/rs/core/uriinfo

---

# 54. Penutup

Gateway/proxy/LB bukan “infrastruktur di luar aplikasi”. Untuk REST API, ia adalah bagian dari runtime contract.

Mental model final:

```text
external request
  ↓
edge normalization
  ↓
trusted forwarded context
  ↓
JAX-RS app
  ↓
correct links/security/observability
```

Prinsip final:

```text
Do not trust forwarded headers from clients.
Strip then set at the edge.
Generate public links from trusted external context.
Align path rewriting with JAX-RS base URI.
Gateway can authenticate, but app authorizes domain.
Timeouts and retries must be coordinated.
Buffering must be route-aware.
Streaming/SSE must be tested through proxy.
Observability must correlate edge and app.
```

Top-tier JAX-RS engineer memastikan:

- edge-to-app contract terdokumentasi;
- forwarded headers aman;
- URI/link/Location benar;
- auth/CORS/rate limit/request size/timeout punya owner jelas;
- upload/download/SSE diuji melewati proxy;
- retry gateway tidak menggandakan side effect;
- direct backend access diblokir;
- logs/traces menghubungkan gateway dan app.

Part berikutnya:

```text
Bagian 048 — Advanced HTTP Client and Service-to-Service Communication
```

Kita akan membahas service-to-service HTTP secara mendalam: client lifecycle, connection pools, DNS, TLS/mTLS, auth token propagation, timeout budget, retries, circuit breaker, request signing, idempotency, schema compatibility, and safe downstream consumption.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-jaxrs-advanced-part-046.md">⬅️ Bagian 046 — Multi-Tenancy and Data Authorization in JAX-RS: Tenant Context Propagation, Tenant-Aware Resource Design, Object-Level Authorization, Row-Level Security, Repository Safeguards, DTO Redaction, Cross-Tenant Leakage Prevention, Testing, and Observability</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-jaxrs-advanced-part-048.md">Bagian 048 — Advanced HTTP Client and Service-to-Service Communication: Client Lifecycle, Connection Pools, DNS, TLS/mTLS, Auth Token Propagation, Timeout Budget, Retry, Circuit Breaker, Request Signing, Idempotency, Schema Compatibility, and Safe Downstream Consumption ➡️</a>
</div>
