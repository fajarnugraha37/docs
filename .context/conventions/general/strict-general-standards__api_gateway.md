# Strict General Standards: API Gateway

> File: `strict-general-standards__api_gateway.md`  
> Category: General Engineering Standard  
> Principle: API Gateway, Edge API Governance, Client Boundary, Traffic Policy, and Contract Protection  
> Status: Mandatory for LLM-assisted architecture design, implementation, refactoring, review, and documentation involving API gateways

---

## 1. Purpose

This standard defines how an LLM code agent MUST design, implement, modify, review, and document an API Gateway.

The goal is to prevent API gateways from becoming unstable business-logic hubs, hidden distributed monoliths, or security theater. An API Gateway is an edge/API boundary component. It exists to simplify client access, enforce cross-cutting API policies, route traffic safely, protect backend services, and expose stable external contracts.

This standard applies to:

- public API gateways;
- internal API gateways;
- partner API gateways;
- mobile/web backend gateways;
- BFF-style gateways;
- Kubernetes ingress controllers used as API gateways;
- cloud-managed API gateway services;
- self-hosted gateways such as Spring Cloud Gateway, Kong, NGINX, Envoy, APISIX, KrakenD, Traefik, or similar tools.

This standard MUST be read together with:

- `strict-general-standards__restfull_api.md`;
- `strict-general-standards__open_api.md`;
- `strict-general-standards__http_for_web.md`;
- `strict-general-standards__microservices_pattern.md`;
- `strict-general-standards__microservices_anti_pattern.md`;
- `strict-general-standards__reverse_proxy.md`;
- `strict-general-standards__forward_proxy.md`.

---

## 2. Source Baseline

The LLM MUST align API Gateway work with these baseline references:

- Chris Richardson / Microservices.io API Gateway and Backends-for-Frontends pattern.
- HTTP Semantics, especially method semantics, status codes, header semantics, connection-independent request behavior, and proxy-related behavior.
- OWASP API Security Top 10 for API authorization, authentication, resource consumption, asset management, and logging risks.
- Cloud provider API gateway documentation for authentication, throttling, access logging, request validation, and usage plans.
- Envoy, NGINX, Kong, APISIX, Spring Cloud Gateway, or equivalent production gateway documentation when using those technologies.
- Enterprise API, security, logging, privacy, data retention, auditability, and incident response standards.

References are listed at the end of this document.

---

## 3. Core Interpretation

### 3.1 API Gateway is an API boundary, not the application

The LLM MUST treat an API Gateway as a boundary component that controls how clients access backend capabilities.

An API Gateway MAY handle:

- request routing;
- protocol mediation;
- authentication enforcement;
- coarse-grained authorization gates;
- request validation;
- response shaping;
- rate limiting;
- quota enforcement;
- throttling;
- CORS policy;
- API version routing;
- service discovery integration;
- TLS termination or TLS policy coordination;
- request/response header policy;
- correlation ID propagation;
- access logging;
- metrics and tracing;
- simple API composition;
- client-specific BFF adaptation;
- safe backward-compatible transformations.

An API Gateway MUST NOT become the owner of:

- core domain rules;
- aggregate invariants;
- business state machines;
- object-level authorization decisions that require domain data;
- database transactions;
- long-running business workflows;
- compensation logic;
- reporting query engines;
- service-specific persistence;
- hidden shared domain libraries that couple every service to the gateway.

### 3.2 API Gateway is not a reverse proxy by default

A reverse proxy mainly handles inbound traffic forwarding, TLS, buffering, compression, caching, routing, and load balancing. An API Gateway is a higher-level API policy boundary.

A component may technically perform both roles, but the LLM MUST keep the responsibilities conceptually separate:

| Concern             | API Gateway                                              | Reverse Proxy                                                 |
| ------------------- | -------------------------------------------------------- | ------------------------------------------------------------- |
| Primary abstraction | API contract and client access                           | Network/application traffic forwarding                        |
| Main owner          | API/platform team                                        | Platform/network/SRE team                                     |
| Typical policy      | Auth, quota, API key, schema validation, version routing | TLS, upstream routing, load balancing, buffering, compression |
| Business logic      | Prohibited except thin client adaptation                 | Prohibited                                                    |
| Contract awareness  | Required                                                 | Optional                                                      |
| OpenAPI awareness   | Required for APIs                                        | Usually not required                                          |

### 3.3 API Gateway is not a forward proxy

A forward proxy acts on behalf of clients for outbound traffic. An API Gateway acts on behalf of backend APIs toward inbound clients.

The LLM MUST NOT use an API Gateway as an outbound egress-control substitute unless the product explicitly supports that role and the design documents the security boundary.

### 3.4 Gateway policy does not remove service responsibility

The LLM MUST NOT assume that gateway enforcement makes backend services safe by itself.

Every backend service MUST still enforce:

- resource ownership;
- object-level authorization;
- tenant boundaries;
- input validation relevant to domain correctness;
- idempotency;
- invariants;
- audit rules;
- rate or concurrency protection where service-local exhaustion is possible;
- trace/log propagation.

The gateway is a perimeter and policy enforcement point, not the single source of truth for domain security.

---

## 4. Mandatory Decision Gate Before Introducing an API Gateway

Before adding, modifying, or replacing an API Gateway, the LLM MUST produce a decision record.

```md
# API Gateway Decision Record

## Gateway Name

- Name:
- Environment:
- Public/Internal/Partner:
- Owning team:

## Problem Being Solved

- Client access problem:
- Security/policy problem:
- Routing/versioning problem:
- Operational problem:

## Gateway Scope

- Clients served:
- Backend services exposed:
- Protocols exposed externally:
- Protocols used internally:

## Non-Goals

- Business logic not owned by gateway:
- Authorization not owned by gateway:
- Persistence not owned by gateway:

## Mandatory Policies

- Authentication:
- Authorization handoff:
- Rate limiting:
- Quotas:
- Request validation:
- CORS:
- TLS:
- Logging:
- Tracing:
- Error format:

## Failure Behavior

- Gateway timeout:
- Upstream timeout:
- Retry policy:
- Circuit breaker/load shedding:
- Fallback policy:
- Error response policy:

## Contract Governance

- OpenAPI source:
- Versioning policy:
- Deprecation policy:
- Compatibility testing:

## Operational Ownership

- Deployment owner:
- Config owner:
- On-call owner:
- Dashboard:
- Alerts:
```

If the decision record cannot be filled with specific answers, the LLM MUST NOT introduce the gateway.

---

## 5. Mandatory Responsibility Boundaries

### 5.1 Allowed gateway responsibilities

The LLM MAY implement the following responsibilities in the gateway when justified:

1. **Routing**
   - Route requests by host, path, method, header, API version, client type, or tenant partition.
   - Route to stable service names, not hard-coded container IPs.
   - Keep routing rules deterministic and testable.

2. **Authentication enforcement**
   - Validate tokens, API keys, mTLS client certificates, signed requests, or session credentials.
   - Reject unauthenticated requests before they reach backend services.
   - Propagate verified identity claims in a controlled, tamper-resistant way.

3. **Coarse-grained authorization**
   - Enforce broad access decisions such as client app eligibility, scope presence, partner access, subscription tier, or route-level permission.
   - Do not replace domain-level authorization.

4. **Rate limiting and quota**
   - Protect backend systems from abusive clients, accidental loops, and traffic spikes.
   - Apply limits by client, token, user, tenant, IP, route, or API product as appropriate.

5. **Request validation**
   - Validate HTTP method, content type, size limit, schema shape, required headers, and supported API version.
   - Reject invalid requests early with clear errors.

6. **Protocol mediation**
   - Expose REST/HTTP externally while using gRPC, messaging, or service-specific protocols internally only when justified.
   - Keep protocol translation explicit and documented.

7. **API composition**
   - Aggregate data from multiple backend services only for read-oriented, client-shaping use cases.
   - Avoid creating new consistency requirements inside the gateway.

8. **BFF adaptation**
   - Provide client-specific API surfaces for web, mobile, partner, admin, or machine clients.
   - Keep BFFs thin and focused on client experience.

9. **Observability**
   - Generate and propagate correlation IDs.
   - Emit access logs, latency metrics, error counts, rate-limit metrics, and traces.

10. **API lifecycle control**
    - Route legacy and new versions.
    - Apply deprecation headers.
    - Block retired versions after approved sunset windows.

### 5.2 Prohibited gateway responsibilities

The LLM MUST NOT implement these responsibilities in the gateway:

- domain aggregate validation;
- final object-level authorization requiring database state;
- database writes for business entities;
- direct access to service databases;
- cross-service transaction coordination;
- saga orchestration unless the gateway is explicitly a workflow API façade and the actual saga owner is a backend workflow service;
- complex business branching;
- hidden dependency on internal service entity classes;
- service-specific SQL queries;
- report generation from multiple service databases;
- background jobs;
- business event publishing as source of truth;
- compensating actions;
- permanent request payload storage, except short-lived buffering required by gateway mechanics;
- acting as a catch-all place for code that “does not fit elsewhere.”

---

## 6. Routing Standards

### 6.1 Route ownership

Every route MUST have a declared backend owner.

```yaml
route: GET /api/v1/cases/{caseId}
owner: case-service
gateway_policy:
  auth: required
  scopes: [case.read]
  rate_limit: standard-user-read
  timeout_ms: 2500
  request_validation: openapi
  response_error_format: problem-details
```

The LLM MUST NOT create anonymous or ownerless routes.

### 6.2 Route determinism

Routing rules MUST be deterministic.

Prohibited:

- overlapping wildcard routes without explicit precedence;
- route behavior depending on mutable request body content;
- route behavior depending on untrusted client-supplied internal headers;
- production traffic routing based on ad hoc query parameters unless part of an approved canary strategy;
- multiple gateways owning the same public path without a clear delegation boundary.

### 6.3 Path rewriting

Path rewriting MUST be explicit and documented.

Allowed:

```text
External: /api/v1/customers/{customerId}/cases
Internal: /cases/api/v1/customers/{customerId}/cases
Reason: service base path normalization during migration
```

Prohibited:

```text
External: /v1/search
Internal: /random/internal/legacy/doEverything
Reason: none
```

### 6.4 Host-based routing

Host-based routing MUST define ownership.

Examples:

```text
api.example.gov       -> public API gateway
partner-api.example.gov -> partner API gateway
admin-api.example.gov -> admin API gateway
mobile-api.example.gov -> mobile BFF gateway
```

The LLM MUST NOT mix public, partner, and admin APIs behind the same hostname unless route-level policy isolation is documented and tested.

---

## 7. Authentication Standards

### 7.1 Authentication must happen before backend routing when possible

The gateway MUST reject unauthenticated requests before forwarding to backend services for protected APIs.

Allowed authentication mechanisms include:

- OAuth2/OIDC JWT validation;
- opaque token introspection;
- API keys for machine or partner APIs;
- mTLS client certificates;
- signed requests;
- session cookies where appropriate for web applications;
- HMAC signatures for specific integrations.

### 7.2 Token validation

JWT validation MUST verify:

- issuer;
- audience;
- signature;
- expiry;
- not-before when used;
- algorithm allowlist;
- key ID and JWKS resolution;
- clock skew tolerance;
- required claims;
- tenant or realm when multi-tenant.

The LLM MUST NOT accept unsigned tokens, algorithm confusion, dynamic algorithm selection from untrusted input, or tokens without audience checks.

### 7.3 Identity propagation

The gateway MAY propagate identity to backend services by:

- forwarding the original Authorization token;
- exchanging it for an internal token;
- adding signed identity headers;
- using mTLS plus identity context;
- injecting workload identity metadata.

The LLM MUST NOT forward arbitrary client-provided identity headers such as `X-User-Id`, `X-Role`, or `X-Tenant-Id` without stripping and replacing them at the trust boundary.

Mandatory rule:

```text
Strip untrusted identity headers at the gateway.
Recreate identity context only from verified authentication material.
```

### 7.4 Backend services must not blindly trust plain headers

If backend services rely on gateway-injected headers, the system MUST ensure:

- only the gateway can reach the service;
- mTLS, network policy, or service mesh identity protects the path;
- headers are overwritten by the gateway;
- direct bypass access is blocked;
- tests verify spoofed headers are rejected or overwritten.

---

## 8. Authorization Standards

### 8.1 Gateway authorization is coarse-grained unless proven otherwise

The gateway MAY enforce:

- route-level scopes;
- API product subscriptions;
- client allowlists;
- IP or network restrictions;
- partner entitlements;
- tenant-to-route access;
- admin route segregation.

The gateway MUST NOT be the only enforcement point for:

- “user can access this case”;
- “officer can act on this enforcement record”;
- “customer owns this order”;
- “agent is assigned to this workflow step”;
- “tenant can view this document”;
- “state transition is allowed for this actor.”

Those decisions require domain context and MUST be enforced by the owning backend service.

### 8.2 No confused deputy

When the gateway calls backend services, backend services MUST know:

- who the original caller is;
- which client application initiated the request;
- which scopes/roles were verified;
- whether the gateway is acting as itself or on behalf of a user;
- which tenant/context is active.

The LLM MUST NOT collapse end-user identity and gateway identity into a single ambiguous principal.

### 8.3 Authorization failure responses

The gateway MUST return consistent errors:

- `401 Unauthorized` when authentication is missing or invalid;
- `403 Forbidden` when authentication is valid but access is denied;
- optionally `404 Not Found` for resource hiding only when this is an approved security policy and consistently applied;
- Problem Details body where API standards require it.

---

## 9. Rate Limiting, Throttling, Quotas, and Load Shedding

### 9.1 Every exposed route must have a resource protection policy

Every gateway route MUST define at least one protection policy:

- per-client rate limit;
- per-user rate limit;
- per-tenant quota;
- burst limit;
- concurrent request limit;
- request body size limit;
- upstream timeout;
- circuit breaker;
- load shedding policy.

For low-risk internal routes, the decision record may justify inherited defaults.

### 9.2 Rate-limit dimensions

The LLM MUST choose the limit dimension based on the abuse/failure mode:

| Failure Mode                       | Recommended Dimension           |
| ---------------------------------- | ------------------------------- |
| One API key abuses API             | API key/client ID               |
| One user loops requests            | user ID                         |
| One tenant creates system pressure | tenant ID                       |
| Anonymous traffic spike            | IP / subnet / edge fingerprint  |
| Costly endpoint abuse              | route + client/user             |
| Partner bulk integration           | partner ID + quota window       |
| Login brute force                  | account ID + IP + device signal |

### 9.3 Rate-limit response

Rate-limited requests SHOULD return:

- `429 Too Many Requests`;
- `Retry-After` when a retry time is known;
- a stable error code;
- a human-readable message;
- correlation ID;
- no sensitive quota internals.

Example:

```json
{
  "type": "https://api.example.com/problems/rate-limit-exceeded",
  "title": "Rate limit exceeded",
  "status": 429,
  "detail": "Too many requests for this API client. Retry later.",
  "instance": "/api/v1/cases",
  "errorCode": "RATE_LIMIT_EXCEEDED",
  "correlationId": "01HX..."
}
```

### 9.4 Do not retry unsafe requests by default

The gateway MUST NOT retry non-idempotent upstream requests by default.

Allowed default retries:

- `GET`, `HEAD`, `OPTIONS` when upstream failure is transient;
- explicitly idempotent `PUT` or `DELETE` when idempotency semantics are guaranteed;
- `POST` only when an idempotency key and backend idempotency handling are enforced.

The gateway MUST NOT hide partial writes behind automatic retries.

### 9.5 Load shedding

The gateway MUST fail fast when backend systems are unavailable or saturated.

The LLM SHOULD prefer:

- bounded queues;
- concurrency limits;
- circuit breakers;
- health-aware routing;
- explicit `503 Service Unavailable`;
- `Retry-After` when appropriate;
- clear metrics and alerts.

The LLM MUST NOT allow unbounded gateway buffering to protect clients while silently destroying backend recovery.

---

## 10. Timeout and Retry Standards

### 10.1 Timeouts are mandatory

Every upstream call from the gateway MUST define:

- connect timeout;
- request/write timeout;
- response/read timeout;
- total route timeout;
- idle timeout for streaming protocols;
- max retry budget.

Missing timeouts are prohibited.

### 10.2 Timeout hierarchy

Timeouts MUST be ordered so callers give up after the gateway, and the gateway gives up after upstream-specific budgets.

Recommended model:

```text
client total timeout > gateway total route timeout > upstream service timeout > database/external dependency timeout
```

This prevents the gateway from continuing work after the client has already abandoned the request.

### 10.3 Retry budget

Retries MUST be bounded by:

- max attempts;
- total retry duration;
- backoff;
- jitter;
- per-route allowlist;
- idempotency rules;
- circuit breaker state.

Prohibited:

- infinite retries;
- synchronized retries without jitter;
- retrying all 5xx by default;
- retrying 4xx except specific transient cases like `409` retryable conflict or `429` with policy;
- gateway retries plus client retries plus service retries without a total retry budget.

---

## 11. Request and Response Transformation

### 11.1 Transformations must be thin and reversible

The gateway MAY perform transformations such as:

- header normalization;
- external-to-internal path mapping;
- field renaming for backward compatibility;
- response envelope normalization;
- error format normalization;
- protocol translation;
- compression;
- removing sensitive internal fields.

Transformations MUST be documented and covered by contract tests.

### 11.2 No semantic mutation without owner approval

The gateway MUST NOT change business meaning.

Prohibited examples:

```text
- Change status APPROVED to COMPLETED because a client expects it.
- Convert missing permission into missing resource without an approved resource-hiding policy.
- Rewrite monetary precision.
- Infer domain defaults not provided by the client.
- Convert validation errors into success responses.
```

### 11.3 Backward compatibility transformations

Backward compatibility transformations MUST have:

- reason;
- source and target API version;
- owner;
- sunset date;
- tests;
- migration plan.

---

## 12. API Composition and BFF Standards

### 12.1 API composition is allowed only for client convenience

The gateway MAY compose multiple backend calls when:

- the composition is read-oriented;
- it reduces client round trips;
- it does not create a transaction boundary;
- stale or partial data behavior is documented;
- failure behavior is explicit;
- latency budget is still met.

Example allowed:

```text
GET /api/v1/case-dashboard/{caseId}
- case summary from case-service
- assigned officer display name from profile-service
- latest document metadata from document-service
```

### 12.2 Composition must declare partial failure behavior

The gateway MUST define whether partial backend failure results in:

- full failure;
- partial response with warnings;
- stale cached segment;
- omitted optional section;
- fallback placeholder.

The LLM MUST NOT silently omit failed sections.

### 12.3 BFFs must be client-specific, not team-specific dumping grounds

A BFF is justified when different clients have genuinely different needs.

Allowed:

- `web-bff` for browser application needs;
- `mobile-bff` for mobile bandwidth/latency needs;
- `partner-bff` for partner integration contracts.

Prohibited:

- `team-a-bff` just because a team wants ownership;
- `misc-bff` for unrelated APIs;
- `gateway-service` with all presentation and business logic.

### 12.4 Avoid gateway fan-out explosion

The gateway MUST NOT create unbounded fan-out.

If one gateway request calls many backend services, the LLM MUST evaluate:

- latency amplification;
- partial failure probability;
- aggregate timeout;
- retry multiplication;
- backend saturation;
- observability clarity;
- whether a read model or query service is more appropriate.

---

## 13. Contract Governance

### 13.1 OpenAPI is mandatory for HTTP APIs

Every externally exposed HTTP API route MUST be represented in OpenAPI or an equivalent contract standard.

The gateway configuration MUST be consistent with the contract:

- path;
- method;
- parameters;
- request body size and schema;
- response status codes;
- error format;
- authentication requirements;
- rate limit semantics where documented;
- deprecation metadata;
- examples.

### 13.2 Gateway config must not be the only API documentation

The LLM MUST NOT treat gateway YAML, ingress manifests, route definitions, or Terraform resources as the API contract.

Gateway config describes routing and policy. OpenAPI describes the API contract.

### 13.3 Contract-first route creation

For new public APIs, the LLM SHOULD follow this order:

1. define or update OpenAPI;
2. review compatibility;
3. generate or validate contract tests;
4. implement backend service behavior;
5. configure gateway route and policy;
6. verify end-to-end behavior;
7. publish documentation.

### 13.4 operationId and route traceability

Each gateway route MUST be traceable to:

- OpenAPI `operationId`;
- backend service owner;
- gateway route ID;
- access log route key;
- metrics label.

---

## 14. Versioning and Deprecation

### 14.1 Version routing must be explicit

Gateway version routing MUST use explicit rules such as:

- path version: `/api/v1/...`;
- host version: `v1.api.example.com`;
- media type version where approved;
- header version only where clients and tooling support it.

The LLM MUST NOT implement hidden version selection based on user agent, random client behavior, or undocumented query parameters.

### 14.2 Deprecation policy

Deprecated APIs SHOULD include:

- `Deprecation` response header when supported by organizational policy;
- `Sunset` response header when a sunset date exists;
- documentation link;
- migration guide;
- telemetry for remaining consumers.

### 14.3 Compatibility checks

The LLM MUST reject gateway changes that break consumers without an approved versioning plan.

Breaking gateway changes include:

- removing route;
- changing required auth scheme;
- narrowing allowed methods;
- changing path parameter meaning;
- changing response status behavior;
- changing error format;
- changing CORS behavior for browser clients;
- changing rate limits materially without notice;
- changing payload size limits below known client usage.

---

## 15. Error Handling Standards

### 15.1 Error source must be distinguishable

Gateway errors MUST allow operators to distinguish:

- authentication failure;
- authorization failure;
- request validation failure;
- rate-limit rejection;
- gateway timeout;
- upstream timeout;
- upstream connection failure;
- upstream application error;
- gateway internal error.

The response body must not leak sensitive internals, but logs/metrics must preserve the source.

### 15.2 Use consistent error format

Where HTTP APIs use Problem Details, the gateway MUST emit Problem Details for gateway-originated errors.

Gateway-originated errors include:

- `400` malformed request;
- `401` authentication missing/invalid;
- `403` route access denied;
- `404` route not found;
- `405` method not allowed;
- `413` payload too large;
- `415` unsupported media type;
- `429` rate limited;
- `502` bad gateway;
- `503` service unavailable;
- `504` gateway timeout.

### 15.3 Do not normalize away useful semantics

The gateway MUST NOT convert every backend failure into `500`.

The LLM MUST preserve meaningful status codes unless policy requires abstraction.

---

## 16. CORS and Browser Client Policy

### 16.1 CORS must be explicit

For browser-facing APIs, CORS policy MUST define:

- allowed origins;
- allowed methods;
- allowed headers;
- exposed headers;
- credentials policy;
- max age;
- environment-specific differences;
- admin/partner restrictions.

Wildcard CORS with credentials is prohibited.

### 16.2 CORS is not authorization

The LLM MUST NOT treat CORS as an access-control system for non-browser clients.

CORS is a browser-enforced policy. Backend and gateway authentication/authorization are still required.

### 16.3 Preflight behavior must be tested

Routes requiring custom headers, non-simple methods, credentials, or non-simple content types MUST have preflight tests.

---

## 17. Payload Size, Streaming, Upload, and Download

### 17.1 Request size limits

Every route MUST define or inherit request size limits.

Large upload APIs MUST define:

- max body size;
- streaming vs buffering behavior;
- timeout budget;
- virus/malware scanning boundary where applicable;
- object storage handoff pattern;
- retry/resume policy;
- error handling;
- audit logging.

### 17.2 Prefer direct object storage for large files

The LLM SHOULD NOT route large binary files through the gateway unless required.

Preferred pattern:

```text
Client -> API: request upload session
API -> Storage: generate pre-signed upload target
Client -> Storage: upload file
Storage/Event -> Backend: process file
Client -> API: check status
```

### 17.3 Streaming APIs

For SSE, WebSocket, gRPC streaming, or long polling, the gateway MUST define:

- idle timeout;
- max connection duration;
- max concurrent connections;
- heartbeat behavior;
- backpressure behavior;
- auth refresh behavior;
- disconnect behavior;
- logging strategy that does not explode cardinality.

---

## 18. Security Standards

### 18.1 Gateway must be part of defense-in-depth

The gateway MUST contribute to security by enforcing:

- TLS policy;
- authentication;
- route-level authorization;
- request size limits;
- content type restrictions;
- schema validation;
- header sanitization;
- rate limiting;
- bot or abuse control where applicable;
- logging and auditability;
- WAF integration where appropriate.

But the gateway MUST NOT be the only security control.

### 18.2 Header sanitization

The gateway MUST strip or rewrite inbound client-controlled headers that could spoof internal trust.

Common headers to strip/recreate:

- `X-Forwarded-For`;
- `X-Forwarded-Host`;
- `X-Forwarded-Proto`;
- `Forwarded`;
- `X-Real-IP`;
- `X-User-Id`;
- `X-User-Roles`;
- `X-Tenant-Id`;
- `X-Client-Cert`;
- `X-Internal-*`;
- `X-Request-Id` when not conforming to accepted format.

### 18.3 Secrets must not live in route logic

The LLM MUST NOT hard-code secrets, API keys, tokens, private keys, or certificate material in gateway config.

Secrets MUST be loaded from approved secret managers or secure platform mechanisms.

### 18.4 mTLS

When using mTLS, the gateway configuration MUST define:

- trusted CA bundle;
- certificate validation rules;
- revocation/rotation approach;
- client identity mapping;
- failure behavior;
- observability fields;
- backend mTLS if using gateway-to-service TLS.

### 18.5 WAF does not replace validation

WAF integration is allowed but MUST NOT replace route schema validation, authorization, or domain validation.

### 18.6 API inventory

Every gateway route MUST be inventoried.

The LLM MUST NOT create shadow APIs, temporary undocumented routes, debug endpoints, or backdoor admin routes.

---

## 19. Observability Standards

### 19.1 Access logs are mandatory

Gateway access logs MUST include:

- timestamp;
- route ID;
- method;
- path template, not raw high-cardinality path only;
- status code;
- response time;
- upstream service;
- upstream status;
- upstream latency;
- client ID where available;
- user or subject ID where policy allows;
- tenant ID where policy allows;
- source IP or trusted client IP;
- request size;
- response size;
- correlation ID;
- trace ID;
- rate-limit decision;
- auth decision summary;
- error class.

Logs MUST NOT include secrets, full tokens, passwords, raw PII payloads, or large request/response bodies by default.

### 19.2 Metrics are mandatory

Gateway metrics MUST include:

- request count by route/method/status;
- latency percentiles by route and upstream;
- upstream error rate;
- gateway-originated error rate;
- authentication failures;
- authorization denials;
- rate-limit rejections;
- request validation failures;
- timeout count;
- retry count;
- circuit breaker state;
- active connections;
- saturation indicators;
- configuration reload/deploy events.

### 19.3 Tracing

The gateway MUST propagate trace context to backend services.

The LLM MUST NOT break existing tracing headers without migration.

Accepted patterns include:

- W3C Trace Context;
- B3 where legacy systems require it;
- platform-specific trace propagation where standardized internally.

### 19.4 Alerting

Alerts SHOULD exist for:

- high `5xx` rate;
- high `4xx` anomalies;
- high latency;
- upstream timeout spike;
- rate-limit spike;
- auth failure spike;
- gateway saturation;
- route misconfiguration;
- certificate expiry;
- failed config reload;
- unhealthy upstream pool;
- sudden traffic drop for critical APIs.

---

## 20. Deployment and Configuration Standards

### 20.1 Configuration as code

Gateway configuration MUST be version-controlled.

Configuration changes MUST pass review and automated validation before production.

### 20.2 Environment parity

Gateway behavior SHOULD be consistent across environments except for explicitly documented differences.

Allowed differences:

- hostnames;
- certificates;
- rate-limit values;
- logging sinks;
- upstream endpoints;
- allowed CORS origins;
- test-only routes in non-production.

Prohibited differences:

- production-only authentication behavior not tested elsewhere;
- different error format in production;
- missing request validation outside production;
- broader production CORS than lower environments;
- undocumented route rewrites.

### 20.3 Safe rollout

Gateway changes SHOULD support:

- staged rollout;
- canary deployment;
- blue/green deployment;
- quick rollback;
- config validation;
- route-level smoke tests;
- automated health checks.

### 20.4 Config reload safety

The gateway MUST define behavior for invalid config:

- fail deployment before reload;
- keep last known good config;
- alert on reload failure;
- prevent partial config activation where unsupported.

---

## 21. Testing Standards

### 21.1 Required tests

Gateway changes MUST include tests for:

- route matching;
- method handling;
- auth required/missing/invalid;
- route-level authorization;
- header sanitization;
- CORS preflight;
- request validation;
- payload size rejection;
- rate limiting;
- timeout behavior;
- upstream unavailable behavior;
- error format;
- correlation ID propagation;
- trace propagation;
- OpenAPI consistency;
- route owner mapping.

### 21.2 Contract tests

Gateway behavior MUST be tested against OpenAPI or equivalent API contracts.

The LLM MUST NOT rely only on manual curl testing.

### 21.3 Security tests

Security tests SHOULD include:

- spoofed identity headers;
- missing/expired/forged tokens;
- wrong audience tokens;
- insufficient scopes;
- CORS misuse;
- oversized payload;
- invalid content type;
- path traversal attempts;
- malicious query parameters;
- rate-limit abuse;
- direct backend bypass attempt where testable.

---

## 22. Common API Gateway Anti-Patterns

### 22.1 Gateway as god service

Prohibited.

Symptoms:

- gateway owns business rules;
- gateway calls many services for every request;
- backend services become CRUD-only;
- every release requires gateway changes;
- gateway has direct database access;
- gateway has domain entities from every service.

Correction:

- move domain logic to owning services;
- introduce read models/query services for complex reads;
- split BFFs by client when needed;
- reduce gateway composition.

### 22.2 Security only at gateway

Prohibited.

Symptoms:

- backend services trust any request from internal network;
- object-level authorization only in gateway;
- direct service access bypasses checks;
- identity headers can be spoofed.

Correction:

- enforce domain authorization in services;
- restrict network access;
- use signed identity or token propagation;
- add service-level tests.

### 22.3 Gateway as integration spaghetti

Prohibited.

Symptoms:

- gateway contains custom code for every partner;
- request transformations are undocumented;
- API behavior differs per client in hidden ways;
- migration hacks never expire.

Correction:

- create explicit partner APIs/BFFs;
- document transformations;
- use anti-corruption services;
- set sunset dates.

### 22.4 Gateway retry storm

Prohibited.

Symptoms:

- gateway retries failed calls aggressively;
- clients also retry;
- services also retry;
- no jitter;
- backend outage gets amplified.

Correction:

- define retry budgets;
- add jitter;
- use circuit breakers;
- fail fast;
- retry only idempotent operations.

### 22.5 Gateway route shadowing

Prohibited.

Symptoms:

- wildcard route captures unintended APIs;
- route precedence unclear;
- new route works in dev but not prod;
- old route keeps receiving traffic silently.

Correction:

- add route tests;
- remove broad catch-all rules;
- define precedence explicitly;
- use route inventory.

### 22.6 Gateway as API documentation

Prohibited.

Symptoms:

- no OpenAPI;
- clients reverse-engineer gateway config;
- error responses undocumented;
- auth scopes only in YAML comments.

Correction:

- publish OpenAPI;
- enforce spec/config consistency;
- add examples and error schemas.

---

## 23. LLM Implementation Rules

When implementing gateway-related work, the LLM MUST:

1. Identify whether the requested component is an API Gateway, reverse proxy, forward proxy, ingress, load balancer, BFF, or service mesh gateway.
2. Ask whether API contract, security policy, and route ownership are known; if not, make conservative assumptions and document them.
3. Avoid adding business logic to gateway code.
4. Use OpenAPI or equivalent contracts as source of API truth.
5. Define route-level policy explicitly.
6. Add timeouts for every upstream route.
7. Add rate limits or document inherited defaults.
8. Strip untrusted identity and forwarding headers.
9. Propagate correlation and trace IDs.
10. Emit structured logs and metrics.
11. Test route, auth, validation, CORS, timeout, and error behavior.
12. Prefer declarative configuration over custom gateway code where possible.
13. Document all transformations.
14. Reject direct database access from the gateway.
15. Reject gateway changes that break existing clients without migration.

---

## 24. Gateway Route Template

```yaml
route_id: case-service.get-case.v1
public_contract:
  openapi_operation_id: getCaseById
  method: GET
  path: /api/v1/cases/{caseId}
  visibility: internal
owner:
  backend_service: case-service
  owning_team: case-domain-team
routing:
  upstream: http://case-service
  upstream_path: /internal/api/v1/cases/{caseId}
  path_rewrite: true
security:
  authentication: oidc-jwt
  required_scopes:
    - case.read
  strip_identity_headers: true
  propagate_identity: original-token
cors:
  enabled: true
  allowed_origins:
    - https://app.example.gov
  allow_credentials: true
limits:
  request_body_max_bytes: 0
  rate_limit:
    key: user_id
    requests: 120
    window: 1m
  concurrency_limit: 50
timeouts:
  connect_ms: 300
  upstream_ms: 2500
  total_ms: 3000
retries:
  enabled: true
  max_attempts: 2
  methods: [GET]
  backoff: exponential_jitter
errors:
  format: problem-details
  preserve_upstream_status: true
observability:
  access_log: true
  metrics: true
  tracing: true
  correlation_id: required
lifecycle:
  deprecated: false
  sunset: null
```

---

## 25. Review Checklist

Before approving API Gateway work, verify:

- [ ] Gateway purpose and scope are documented.
- [ ] The component is not being used as a business service.
- [ ] Route owners are declared.
- [ ] OpenAPI operation mapping exists.
- [ ] Authentication is enforced where required.
- [ ] Domain authorization remains in backend services.
- [ ] Spoofable identity headers are stripped or overwritten.
- [ ] CORS is explicit for browser APIs.
- [ ] Rate limits, quotas, or inherited protection policies exist.
- [ ] Request size limits exist.
- [ ] Timeouts exist for every upstream route.
- [ ] Retry policy is bounded and idempotency-aware.
- [ ] Gateway errors use standard format.
- [ ] Upstream errors are not blindly converted to generic `500`.
- [ ] Correlation ID and trace propagation are implemented.
- [ ] Access logs avoid secrets and PII payloads.
- [ ] Metrics and alerts exist for critical routes.
- [ ] Deployment/configuration is version-controlled.
- [ ] Config validation and rollback are possible.
- [ ] Security tests cover spoofed headers, invalid auth, rate limits, and oversized requests.
- [ ] No direct database access exists from the gateway.
- [ ] No undocumented transformation exists.

---

## 26. Acceptance Criteria

API Gateway work is acceptable only if:

1. Gateway responsibility is clearly separated from backend domain responsibility.
2. Every route has an owner, contract, policy, timeout, and observability behavior.
3. Authentication and coarse authorization are enforced consistently.
4. Backend services still enforce resource-level security and invariants.
5. Rate limiting and load protection exist.
6. Error behavior is stable, documented, and safe.
7. OpenAPI and gateway config are consistent.
8. Header trust boundaries are handled explicitly.
9. Gateway does not introduce hidden coupling or distributed monolith behavior.
10. Tests prove routing, security, validation, timeout, and failure behavior.

---

## 27. Enforcement Snippet for LLM Agents

```text
When modifying API Gateway behavior:
- Do not put domain business logic in the gateway.
- Do not treat gateway authorization as a replacement for service authorization.
- Do not create routes without owner, contract, timeout, rate limit, and observability.
- Strip spoofable headers at the trust boundary.
- Use OpenAPI as API contract source, not gateway YAML.
- Retry only idempotent operations within a bounded retry budget.
- Prefer declarative policy over custom gateway code.
- Document all transformations and versioning behavior.
- Reject direct database access from gateway.
```

---

## 28. References

- Chris Richardson, Microservices.io, “Pattern: API Gateway / Backends for Frontends.”
- IETF RFC 9110, “HTTP Semantics.”
- OWASP API Security Top 10, 2023 edition.
- AWS API Gateway documentation for access control, throttling, logging, and monitoring.
- Envoy Proxy documentation for request lifecycle, retries, circuit breaking, rate limiting, and observability.
- NGINX documentation for proxying behavior where NGINX is used as gateway infrastructure.
