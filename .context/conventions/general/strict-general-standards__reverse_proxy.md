# Strict General Standards: Reverse Proxy

> File: `strict-general-standards__reverse_proxy.md`  
> Category: General Engineering Standard  
> Principle: Inbound Proxying, Traffic Routing, TLS Boundary, Load Balancing, Header Trust, and Origin Protection  
> Status: Mandatory for LLM-assisted architecture design, implementation, refactoring, review, and documentation involving reverse proxies

---

## 1. Purpose

This standard defines how an LLM code agent MUST design, implement, modify, review, and document reverse proxy behavior.

A reverse proxy is an intermediary that receives inbound traffic on behalf of origin servers and forwards that traffic to internal upstream services. It is commonly used for TLS termination, routing, load balancing, buffering, compression, caching, request size control, security filtering, and origin hiding.

The goal is to prevent reverse proxies from becoming fragile hidden application layers, accidental security bypasses, or opaque points of failure.

This standard applies to:

- NGINX;
- Envoy;
- HAProxy;
- Apache HTTPD reverse proxy;
- Traefik;
- Caddy;
- cloud load balancers with reverse proxy behavior;
- Kubernetes ingress controllers;
- service mesh ingress gateways;
- CDN origin reverse proxy configurations;
- custom reverse proxy code.

This standard MUST be read together with:

- `strict-general-standards__http_for_web.md`;
- `strict-general-standards__api_gateway.md`;
- `strict-general-standards__forward_proxy.md`;
- `strict-general-standards__web.md`;
- security, observability, and deployment standards.

---

## 2. Source Baseline

The LLM MUST align reverse proxy work with these baseline references:

- HTTP Semantics for request methods, status codes, URI, fields, forwarding behavior, and proxy semantics.
- MDN proxy server and proxy tunneling documentation for forward versus reverse proxy concepts.
- RFC 7239 Forwarded HTTP Extension for standardized forwarding metadata.
- NGINX, Envoy, HAProxy, Apache, Traefik, Caddy, or cloud provider documentation for selected implementation details.
- OWASP guidance for header trust, TLS, access control, security misconfiguration, and logging risks.
- Enterprise infrastructure standards for TLS, secrets, certificate rotation, observability, incident response, and network segmentation.

References are listed at the end of this document.

---

## 3. Core Interpretation

### 3.1 Reverse proxy acts on behalf of origin servers

The LLM MUST understand a reverse proxy as a server-side intermediary. Clients connect to the reverse proxy as if it were the origin endpoint. The reverse proxy forwards accepted requests to upstream origin servers.

A reverse proxy MAY provide:

- TLS termination;
- HTTP to upstream routing;
- load balancing;
- upstream health checks;
- compression;
- response caching;
- static asset serving;
- request buffering;
- response buffering;
- upload/download controls;
- timeout enforcement;
- header normalization;
- origin protection;
- basic access restrictions;
- WAF integration;
- observability.

A reverse proxy MUST NOT own:

- business logic;
- domain authorization;
- database access;
- workflow state transitions;
- persistent business state;
- hidden API semantics;
- user session mutation beyond approved edge/session policy;
- complex response rewriting that changes business meaning.

### 3.2 Reverse proxy is not API Gateway by default

A reverse proxy can be part of an API Gateway implementation, but the LLM MUST distinguish the roles.

Reverse proxy concern:

```text
How does inbound traffic safely reach the correct upstream service?
```

API Gateway concern:

```text
How do clients consume governed API contracts with auth, quota, validation, and lifecycle policy?
```

If a reverse proxy starts enforcing API product policy, contract validation, per-client quota, or API version lifecycle, the LLM MUST evaluate whether the design is actually an API Gateway.

### 3.3 Reverse proxy is a trust boundary

A reverse proxy commonly sits at a boundary between untrusted clients and trusted internal networks.

The LLM MUST treat all inbound headers, hostnames, paths, and protocol metadata as untrusted until explicitly validated and normalized.

### 3.4 Proxy configuration is production code

Reverse proxy configuration MUST be treated as code:

- version-controlled;
- reviewed;
- tested;
- linted;
- deployed through controlled pipeline;
- rollback-capable;
- observable;
- documented.

The LLM MUST NOT treat proxy config as low-risk “ops glue.”

---

## 4. Mandatory Decision Gate Before Adding or Changing a Reverse Proxy

Before adding or materially changing a reverse proxy, the LLM MUST produce a decision record.

```md
# Reverse Proxy Decision Record

## Proxy Name

- Name:
- Environment:
- Public/Internal:
- Owning team:

## Traffic Scope

- Client-facing hosts:
- Upstream services:
- Protocols accepted:
- Protocols forwarded:

## Proxy Responsibilities

- TLS termination:
- Load balancing:
- Routing:
- Compression:
- Caching:
- Buffering:
- Static serving:
- Security headers:
- WAF/filtering:

## Trust Boundary

- Trusted upstream network:
- Allowed inbound networks:
- Client IP handling:
- Forwarded/X-Forwarded handling:
- Headers stripped/recreated:

## Failure Behavior

- Connect timeout:
- Read timeout:
- Send timeout:
- Upstream retry:
- Unhealthy upstream response:
- Error page/body:

## Observability

- Access log fields:
- Error log fields:
- Metrics:
- Trace propagation:
- Alerts:

## Operations

- Config location:
- Validation command:
- Reload strategy:
- Rollback strategy:
- Certificate rotation:
```

If these fields cannot be answered, the LLM MUST NOT introduce or modify reverse proxy behavior beyond a minimal local-development proxy.

---

## 5. Mandatory Responsibility Boundaries

### 5.1 Allowed reverse proxy responsibilities

The LLM MAY implement:

- host-based routing;
- path-based routing;
- TLS termination;
- upstream TLS initiation;
- connection pooling;
- load balancing;
- health-check-based routing;
- static file serving;
- compression;
- response caching where safe;
- request body size limits;
- buffering policies;
- timeout policies;
- request/response header normalization;
- redirect rewriting;
- WebSocket/SSE pass-through;
- HTTP/2 or HTTP/3 edge support;
- WAF or security filter integration;
- maintenance responses;
- access logs and metrics.

### 5.2 Prohibited reverse proxy responsibilities

The LLM MUST NOT implement:

- domain decisions;
- database queries;
- business validation;
- state machine transitions;
- tenant ownership checks as the only control;
- object-level authorization as the only control;
- arbitrary response body transformations;
- hidden route-specific business patches;
- user role mapping from raw client headers;
- application session mutation unless the proxy is explicitly part of an approved auth/session architecture;
- broad wildcard routing to unknown internal destinations.

---

## 6. Host, Path, and Upstream Routing

### 6.1 Host validation is mandatory

The reverse proxy MUST validate expected hostnames.

Prohibited:

- accepting arbitrary `Host` headers;
- reflecting unvalidated host values in redirects;
- using untrusted `Host` to select sensitive upstreams;
- allowing host header injection to influence generated URLs.

Allowed:

```text
server_name app.example.gov api.example.gov;
Reject or default-deny all unknown hosts.
```

### 6.2 No unsafe default upstream

The LLM MUST NOT configure a default route that forwards unknown traffic into an internal service.

Preferred default behavior:

- return `404` for unknown route;
- return `421 Misdirected Request` for wrong host where appropriate;
- return controlled maintenance page;
- do not reveal internal service names.

### 6.3 Path routing must be deterministic

Path rules MUST have explicit precedence.

Prohibited:

- overlapping wildcard locations without tests;
- regex routes that unintentionally capture admin paths;
- path routing that depends on unvalidated query strings;
- different route precedence across environments.

### 6.4 Path normalization

The proxy MUST define behavior for:

- duplicate slashes;
- percent-encoded path separators;
- dot segments such as `.` and `..`;
- case sensitivity;
- trailing slash redirects;
- encoded Unicode normalization where relevant.

The LLM MUST NOT assume upstream frameworks normalize paths identically to the proxy.

### 6.5 Upstream naming

Upstreams MUST use stable service identifiers, not ephemeral pod/container IPs, unless generated by controlled service discovery.

Allowed:

```text
upstream case-service { server case-service.namespace.svc.cluster.local:8080; }
```

Prohibited:

```text
proxy_pass http://10.42.17.9:8080; # hard-coded pod IP
```

---

## 7. TLS and Certificate Standards

### 7.1 TLS policy is mandatory

The reverse proxy MUST define:

- accepted TLS versions;
- cipher policy;
- certificate chain;
- private key source;
- OCSP/stapling policy where applicable;
- HSTS policy where applicable;
- certificate rotation process;
- expiry monitoring;
- upstream TLS policy when proxying to HTTPS services.

### 7.2 No plaintext exposure by accident

If TLS terminates at the reverse proxy, the LLM MUST document whether upstream traffic is:

- plaintext inside a trusted network;
- TLS re-encrypted;
- mTLS authenticated;
- service mesh encrypted.

Sensitive systems SHOULD use TLS or mTLS for proxy-to-upstream traffic unless a documented network security model justifies plaintext.

### 7.3 HSTS

For public HTTPS sites, HSTS SHOULD be enabled only after confirming:

- HTTPS works for all subdomains affected;
- certificate rotation is reliable;
- rollback implications are understood;
- preload decision is deliberate if used.

The LLM MUST NOT blindly enable `includeSubDomains; preload` without confirming domain-wide readiness.

### 7.4 Client certificate authentication

If the proxy validates client certificates, it MUST define:

- trusted CA;
- certificate revocation/rotation process;
- identity mapping;
- header propagation policy;
- backend trust model;
- rejection behavior;
- audit log fields.

Client certificate details propagated to upstreams MUST be sanitized and protected from spoofing.

---

## 8. Forwarded Headers and Client Identity

### 8.1 Treat incoming forwarding headers as untrusted

Clients can send fake forwarding headers. The reverse proxy MUST strip, validate, or overwrite forwarding headers at the first trusted boundary.

Sensitive headers include:

- `Forwarded`;
- `X-Forwarded-For`;
- `X-Forwarded-Host`;
- `X-Forwarded-Proto`;
- `X-Real-IP`;
- `X-Client-IP`;
- `X-Original-URI`;
- `X-Rewrite-URL`;
- `X-Forwarded-Prefix`.

### 8.2 Use standard Forwarded where supported

Where application/framework/tooling supports it, the LLM SHOULD prefer standardized `Forwarded` semantics.

However, because many stacks still depend on `X-Forwarded-*`, the LLM MAY use de-facto headers if:

- they are generated only by trusted proxies;
- inbound versions from clients are stripped;
- backend trust configuration is explicit;
- chain parsing is documented.

### 8.3 Client IP chain handling

Client IP resolution MUST define:

- trusted proxy CIDR ranges;
- which header is authoritative;
- how to parse multiple values;
- what to do with malformed values;
- how to prevent spoofing;
- privacy/logging policy.

The LLM MUST NOT use the leftmost `X-Forwarded-For` blindly unless the full proxy chain is trusted and controlled.

### 8.4 Scheme and host reconstruction

Backends generating absolute URLs MUST receive trusted scheme/host information.

The proxy MUST ensure:

- `X-Forwarded-Proto` or `Forwarded; proto=` reflects client-facing scheme;
- `X-Forwarded-Host` or `Forwarded; host=` reflects validated host;
- upstream applications trust these headers only from the proxy;
- redirects do not downgrade HTTPS.

---

## 9. Load Balancing and Health Checks

### 9.1 Load balancing strategy must match workload

The LLM MUST choose load balancing strategy deliberately.

Examples:

| Workload                     | Possible Strategy                                        |
| ---------------------------- | -------------------------------------------------------- |
| Stateless HTTP API           | round-robin, least-connections, EWMA                     |
| Long-lived WebSocket         | least-connections, consistent hashing if affinity needed |
| Cache-heavy session affinity | cookie or hash-based routing, only if justified          |
| Expensive requests           | least-request or adaptive load balancing                 |
| Multi-zone deployment        | locality-aware with failover                             |

### 9.2 Health checks are mandatory

Production reverse proxy upstream pools MUST have health checks or rely on platform health signals.

Health checks MUST define:

- endpoint;
- interval;
- timeout;
- success threshold;
- failure threshold;
- expected status;
- dependency depth.

Health checks SHOULD NOT require all downstream dependencies to be healthy unless the service truly cannot handle any traffic.

### 9.3 Avoid sticky sessions unless justified

Sticky sessions are allowed only when:

- application state cannot be externalized yet;
- migration plan exists;
- failure behavior is known;
- scaling impact is accepted;
- session affinity is tested.

Preferred: stateless upstream services or external session storage.

### 9.4 Outlier detection and circuit breaking

For advanced proxies, the LLM SHOULD configure or document:

- passive outlier detection;
- circuit breaking;
- connection pool limits;
- max pending requests;
- ejection behavior;
- panic/fail-open behavior.

---

## 10. Timeout, Retry, and Buffering Standards

### 10.1 Timeouts are mandatory

Every reverse proxy route MUST define or inherit:

- client header timeout;
- client body timeout;
- upstream connect timeout;
- upstream send timeout;
- upstream read timeout;
- idle timeout;
- keepalive timeout;
- total request timeout where supported.

Missing timeouts are prohibited.

### 10.2 Timeout hierarchy

The LLM MUST align timeout budgets across client, proxy, upstream service, and dependencies.

Recommended order:

```text
client timeout > reverse proxy total timeout > upstream app timeout > database/external dependency timeout
```

### 10.3 Retry policy must be conservative

The reverse proxy MUST NOT retry unsafe or non-idempotent requests by default.

Allowed default retry candidates:

- `GET`;
- `HEAD`;
- `OPTIONS`;
- idempotent `PUT`/`DELETE` only if service semantics are known;
- `POST` only with explicit idempotency key and backend support.

Retry policy MUST define:

- retriable status/error;
- max tries;
- timeout budget;
- backoff/jitter if supported;
- upstream selection behavior;
- logging of retried requests.

### 10.4 Buffering must be deliberate

Proxy buffering affects memory, latency, streaming behavior, and backpressure.

The LLM MUST document buffering behavior for:

- normal JSON APIs;
- file uploads;
- downloads;
- SSE;
- WebSocket;
- gRPC;
- large request bodies;
- slow clients.

Prohibited:

- buffering unbounded request bodies;
- disabling buffering globally without understanding upstream impact;
- enabling response buffering for streaming endpoints;
- allowing large uploads to fill proxy disk without quotas.

---

## 11. Compression, Caching, and Static Assets

### 11.1 Compression

Compression MAY be enabled for compressible responses.

The LLM MUST avoid:

- compressing already compressed content;
- compressing secrets in contexts vulnerable to compression side-channel attacks;
- wasting CPU on tiny responses;
- applying compression inconsistently across cache variants.

### 11.2 Caching

Reverse proxy caching MUST be explicit.

Cache policy MUST define:

- eligible methods;
- eligible status codes;
- cache key;
- vary dimensions;
- TTL;
- stale behavior;
- authorization handling;
- invalidation/purge behavior;
- privacy constraints;
- observability.

The LLM MUST NOT cache authenticated or tenant-specific responses unless cache keys and privacy constraints are explicitly safe.

### 11.3 Static assets

Reverse proxy static asset serving SHOULD use:

- fingerprinted filenames;
- long cache lifetime for immutable assets;
- short/no-cache for HTML entry documents;
- correct `Content-Type`;
- `X-Content-Type-Options: nosniff`;
- range request behavior for large assets when needed.

---

## 12. Redirect and URL Rewriting

### 12.1 Redirects must preserve security

The proxy MUST NOT generate open redirects.

Redirect targets must be:

- relative; or
- based on a validated allowlist of hosts; or
- generated by trusted application logic.

### 12.2 HTTPS redirects

HTTP-to-HTTPS redirect is allowed and usually recommended for public web systems.

The LLM MUST ensure:

- health checks are not broken;
- ACME/certificate challenge paths still work where applicable;
- internal service calls are not accidentally redirected in loops;
- redirect status code is appropriate (`301`, `302`, `307`, `308`).

### 12.3 Upstream Location rewriting

If upstream services return redirects, the proxy MUST define whether to pass them through or rewrite `Location` headers.

Rewriting must be tested because incorrect rewriting can expose internal hostnames or break clients.

---

## 13. WebSocket, SSE, gRPC, and Long-Lived Connections

### 13.1 WebSocket

WebSocket proxying MUST define:

- upgrade headers;
- idle timeout;
- maximum connection duration;
- upstream load balancing strategy;
- authentication behavior;
- connection draining behavior during deploy;
- per-connection memory limits;
- metrics.

### 13.2 Server-Sent Events

SSE proxying MUST avoid response buffering and define:

- heartbeat interval;
- idle timeout;
- reconnect behavior;
- compression behavior;
- max client connections;
- deploy draining behavior.

### 13.3 gRPC

gRPC proxying MUST define:

- HTTP/2 support;
- TLS/mTLS behavior;
- max message size;
- deadline propagation;
- health checks;
- retry policy;
- status mapping;
- observability.

---

## 14. Security Header Standards

For web-facing systems, the reverse proxy MAY set security headers when centrally managed.

Common headers include:

- `Strict-Transport-Security`;
- `Content-Security-Policy`;
- `X-Content-Type-Options`;
- `Referrer-Policy`;
- `Permissions-Policy`;
- `Cross-Origin-Opener-Policy`;
- `Cross-Origin-Resource-Policy`;
- `Cross-Origin-Embedder-Policy` where required;
- `Cache-Control` for sensitive pages;
- removal of `Server` or internal technology headers where policy requires.

The LLM MUST NOT add headers blindly. Header values must match application behavior.

Example: A strict CSP can break legitimate frontend behavior if scripts, styles, images, fonts, workers, and API endpoints are not modeled.

---

## 15. Access Control and Network Restrictions

### 15.1 Reverse proxy access control is coarse-grained

The reverse proxy MAY enforce:

- IP allowlists;
- network restrictions;
- mTLS client authentication;
- basic auth for temporary non-production tools;
- admin path restrictions;
- geo restrictions where policy allows;
- WAF rules.

It MUST NOT replace application authorization for domain resources.

### 15.2 Admin routes

Admin routes MUST be isolated.

Preferred controls:

- separate hostname;
- separate listener;
- network allowlist;
- strong authentication;
- no public exposure;
- explicit route tests;
- additional logging.

Prohibited:

```text
location /admin { proxy_pass http://admin-service; }
# Publicly reachable, no additional restriction.
```

### 15.3 Internal upstream exposure

Upstream services SHOULD NOT be directly reachable from untrusted networks.

The LLM MUST verify that reverse proxy is not merely decorative while clients can bypass it.

---

## 16. Observability Standards

### 16.1 Access logs

Reverse proxy access logs MUST include:

- timestamp;
- request ID/correlation ID;
- client IP after trusted resolution;
- method;
- host;
- path template where available or path with cardinality controls;
- status;
- bytes sent;
- request time;
- upstream address/service;
- upstream status;
- upstream response time;
- TLS protocol/cipher where relevant;
- user agent if policy allows;
- referrer if policy allows;
- cache status if caching is enabled;
- retry/upstream attempt count where supported.

Logs MUST avoid secrets, authorization headers, cookies, and sensitive payloads.

### 16.2 Metrics

Reverse proxy metrics SHOULD include:

- request count;
- status code distribution;
- latency percentiles;
- upstream latency;
- active connections;
- connection errors;
- TLS handshake errors;
- upstream health;
- retry count;
- timeout count;
- cache hit ratio;
- request/response size;
- config reload success/failure.

### 16.3 Tracing

Where used, the proxy MUST propagate trace context.

If the proxy creates trace spans, it MUST label:

- route;
- upstream service;
- status;
- latency;
- retry count;
- error class.

### 16.4 Alerts

Alerts SHOULD exist for:

- high 5xx;
- high upstream 5xx;
- high 499/client abort if relevant;
- high latency;
- upstream pool unhealthy;
- config reload failure;
- certificate expiry;
- TLS handshake failures;
- disk pressure from buffering/cache;
- sudden traffic drop;
- WAF/security spike.

---

## 17. Configuration and Deployment Standards

### 17.1 Configuration as code

Reverse proxy configuration MUST be stored in version control.

Manual production edits are prohibited except documented emergency procedures with reconciliation back to source control.

### 17.2 Validation before reload

The deployment pipeline MUST validate configuration before applying it.

Examples:

```text
nginx -t
haproxy -c -f haproxy.cfg
envoy --mode validate -c envoy.yaml
traefik config validation where supported
```

### 17.3 Safe reload

Reload strategy MUST define:

- zero-downtime reload where supported;
- connection draining;
- rollback;
- last-known-good config;
- alert on failure;
- canary or staged deployment for risky changes.

### 17.4 Environment differences

Environment-specific config must be explicit.

Allowed differences:

- hostname;
- certificate;
- upstream addresses;
- rate/size limits;
- logging destination;
- test-only routes.

Prohibited:

- security headers only in production but never tested;
- different route precedence;
- missing TLS verification in lower environments;
- broad CORS/header policy differences hidden in templates.

---

## 18. Testing Standards

Reverse proxy changes MUST be tested for:

- host matching;
- route matching;
- unknown route behavior;
- TLS handshake;
- HTTP-to-HTTPS redirect;
- upstream routing;
- health check behavior;
- client IP handling;
- forwarded header behavior;
- header stripping;
- request size limit;
- timeout behavior;
- retry behavior;
- WebSocket/SSE/gRPC behavior where relevant;
- caching behavior where enabled;
- compression behavior where enabled;
- access logs and metrics;
- config reload/rollback.

Security tests SHOULD include:

- host header injection;
- spoofed `X-Forwarded-*`;
- path traversal attempts;
- encoded slash/dot segment edge cases;
- oversized headers;
- oversized body;
- open redirect attempts;
- admin path exposure;
- direct upstream bypass.

---

## 19. Reverse Proxy Anti-Patterns

### 19.1 Proxy as hidden application layer

Prohibited.

Symptoms:

- proxy rewrites response bodies with business rules;
- proxy decides domain state;
- proxy contains many route-specific scripts;
- application behavior is impossible to understand without proxy config.

Correction:

- move business logic to application/service;
- keep proxy behavior infrastructural;
- document unavoidable transformations.

### 19.2 Blindly trusting forwarding headers

Prohibited.

Symptoms:

- app trusts client-supplied `X-Forwarded-For`;
- attacker can spoof IP allowlist;
- wrong scheme causes insecure redirects;
- audit logs contain fake client IP.

Correction:

- strip inbound forwarding headers;
- recreate at trusted boundary;
- configure trusted proxies in app.

### 19.3 Catch-all proxy to internal network

Prohibited.

Symptoms:

- unknown hosts/routes forwarded to internal default service;
- admin services accidentally exposed;
- route typo reaches wrong backend.

Correction:

- default deny;
- explicit hosts/routes;
- route tests;
- separate admin/public hosts.

### 19.4 Infinite or unsafe retries

Prohibited.

Symptoms:

- proxy retries `POST` writes;
- duplicate orders/cases/payments;
- outage amplified by retry storm.

Correction:

- retry only idempotent operations;
- bound retry budget;
- use circuit breakers/load shedding.

### 19.5 Missing timeouts

Prohibited.

Symptoms:

- hung upstream consumes proxy workers;
- slow clients exhaust connections;
- deployment drain never finishes.

Correction:

- define client, upstream, idle, and total timeouts;
- monitor timeout metrics.

### 19.6 Regex route trap

Prohibited.

Symptoms:

- one broad regex captures sensitive paths;
- route precedence differs from intended behavior;
- encoded paths bypass restrictions.

Correction:

- prefer explicit routes;
- test route matrix;
- normalize paths;
- deny unknown paths.

---

## 20. Reverse Proxy Route Template

```yaml
virtual_host: api.example.gov
listener:
  port: 443
  protocol: https
  tls:
    min_version: TLSv1.2
    certificate_secret: prod/api-example-gov
    hsts: true
routes:
  - route_id: case-service-api
    match:
      path_prefix: /api/v1/cases
      methods: [GET, POST, PUT, DELETE]
    upstream:
      service: case-service
      url: http://case-service.namespace.svc.cluster.local:8080
      tls_to_upstream: false
      health_check: /health/ready
    forwarding_headers:
      strip_inbound_forwarded_headers: true
      set_forwarded: true
      set_x_forwarded: true
      trusted_proxy_cidrs:
        - 10.0.0.0/8
    limits:
      max_body_size: 5MiB
      max_header_size: 16KiB
    timeouts:
      client_header: 10s
      client_body: 30s
      upstream_connect: 500ms
      upstream_read: 30s
      upstream_send: 30s
      idle: 60s
    retries:
      enabled: true
      methods: [GET, HEAD]
      max_attempts: 2
    buffering:
      request_buffering: true
      response_buffering: true
      streaming_exceptions:
        - /api/v1/events
    observability:
      access_log: true
      metrics: true
      tracing: true
```

---

## 21. Review Checklist

Before approving reverse proxy work, verify:

- [ ] Proxy purpose and owner are documented.
- [ ] It is not being used as an application/business logic layer.
- [ ] Host validation exists.
- [ ] Unknown hosts/routes are denied safely.
- [ ] Route precedence is deterministic and tested.
- [ ] Path normalization behavior is understood.
- [ ] TLS policy is explicit.
- [ ] Certificate rotation and expiry monitoring exist.
- [ ] Upstream TLS/plaintext decision is documented.
- [ ] Inbound forwarding headers are stripped or controlled.
- [ ] Client IP resolution uses trusted proxy configuration.
- [ ] Upstream health checks exist.
- [ ] Timeouts exist for client and upstream paths.
- [ ] Retry policy is conservative and idempotency-aware.
- [ ] Buffering behavior is deliberate.
- [ ] Upload/download limits are defined.
- [ ] WebSocket/SSE/gRPC routes have special handling where needed.
- [ ] Caching does not leak private data.
- [ ] Redirects cannot become open redirects.
- [ ] Admin/internal routes are isolated.
- [ ] Access logs and metrics exist.
- [ ] Config is version-controlled and validated before reload.
- [ ] Rollback strategy exists.
- [ ] Security tests cover spoofed headers and host/path attacks.

---

## 22. Acceptance Criteria

Reverse proxy work is acceptable only if:

1. Proxy responsibility is infrastructure-level and not business-level.
2. Host/path routing is deterministic and safe.
3. Unknown traffic is denied or handled safely.
4. TLS and certificate behavior are explicit.
5. Forwarded header trust boundary is secure.
6. Client IP handling cannot be trivially spoofed.
7. Timeouts, retries, buffering, and size limits are defined.
8. Upstream health and failure behavior are observable.
9. Config is versioned, validated, and rollback-capable.
10. Tests prove route, header, TLS, timeout, and failure behavior.

---

## 23. Enforcement Snippet for LLM Agents

```text
When modifying reverse proxy behavior:
- Keep the proxy infrastructural; do not add domain business logic.
- Validate hosts and deny unknown routes by default.
- Strip or recreate forwarding headers at the first trusted boundary.
- Never trust client-supplied X-Forwarded-* or Forwarded headers blindly.
- Define TLS, upstream, timeout, retry, buffering, and size-limit behavior.
- Retry only safe/idempotent requests unless idempotency is explicitly guaranteed.
- Do not expose admin/internal services through catch-all routes.
- Treat proxy config as production code with tests and rollback.
```

---

## 24. References

- IETF RFC 9110, “HTTP Semantics.”
- IETF RFC 7239, “Forwarded HTTP Extension.”
- MDN Web Docs, “Proxy server” and “Proxy servers and tunneling.”
- NGINX `ngx_http_proxy_module` documentation.
- Envoy Proxy documentation.
- HAProxy documentation.
- OWASP guidance for security misconfiguration, TLS, access control, and logging.
