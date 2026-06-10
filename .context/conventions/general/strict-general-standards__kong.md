# Strict General Standards: Kong Gateway

> Mandatory standards for LLMs, code agents, and engineers when creating, modifying, reviewing, or operating Kong Gateway configuration.

---

## 1. Purpose

This standard prevents LLM-generated Kong Gateway configuration from becoming insecure, ungoverned, plugin-heavy, route-ambiguous, or operationally opaque.

Kong Gateway may be used for:

- API gateway routing;
- API product exposure;
- service and route abstraction;
- authentication integration;
- coarse-grained authorization policy;
- rate limiting;
- request/response transformation where justified;
- upstream load balancing;
- health checks and circuit breaking;
- traffic control;
- API observability;
- declarative gateway configuration.

Kong must not become a hidden business application, a replacement for domain authorization, or an uncontrolled plugin execution surface.

---

## 2. Core Rule

> Kong configuration must make API ownership, route matching, authentication, authorization boundary, plugin scope, upstream behavior, rate limits, failure behavior, and observability explicit.

LLMs must not generate Kong config by simply creating a Service, Route, and random plugins. Every gateway behavior must be justified against API contract, security model, and operational failure model.

---

## 3. Kong Entity Mental Model

LLMs must understand the Kong entity model before generating config.

Core entities:

- **Service**: represents an upstream API/service that Kong proxies to.
- **Route**: defines how client requests match and reach a Service.
- **Consumer**: represents an API consumer or client identity.
- **Plugin**: attaches behavior globally, to a Service, to a Route, or to a Consumer.
- **Upstream**: virtual hostname for advanced load balancing and health checking.
- **Target**: concrete backend instance behind an Upstream.
- **Certificate/SNI**: TLS identity mapping.

Rule:

> Route controls ingress matching; Service controls upstream destination; Plugin controls gateway behavior; Upstream/Target controls load balancing and health.

Do not blur these responsibilities.

---

## 4. Role Boundary

### 4.1 Kong May Do

Kong may handle:

- route matching;
- API version exposure;
- authentication plugin integration;
- coarse-grained access policy;
- consumer identification;
- rate limiting;
- request size limiting;
- header normalization;
- correlation ID generation/propagation;
- upstream timeout/retry policy;
- circuit breaking and health checks;
- API analytics and logs;
- controlled request/response transformation;
- canary or traffic splitting where supported and governed.

### 4.2 Kong Must Not Do By Default

Kong must not own:

- domain workflow transitions;
- object-level authorization;
- tenant data isolation logic;
- field-level masking decisions;
- complex data validation;
- business compensation logic;
- user-facing error business semantics;
- large payload processing;
- application-specific orchestration.

If an LLM proposes implementing business rules in Kong plugins or request transformers, it must reject that design unless the rule is clearly gateway-level and centrally governed.

---

## 5. Configuration Management Standards

### 5.1 Declarative First

Kong configuration should be managed declaratively whenever possible.

Accepted approaches:

- decK-managed state files;
- DB-less declarative configuration;
- GitOps-managed manifests;
- Kubernetes Ingress/Gateway API/Kong CRDs where applicable;
- controlled Admin API automation with audited pipelines.

Rules:

- production changes must be reviewable as code;
- no manual Admin API drift in production;
- no dashboard-only production changes unless emergency process records the diff;
- all routes/services/plugins must have ownership metadata;
- config must be linted and validated in CI;
- generated config must be deterministic.

### 5.2 DB-Backed vs DB-Less

DB-less mode is acceptable when:

- gateway config fits in memory;
- changes are deployed atomically;
- Git is the source of truth;
- dynamic runtime entity mutation is not required.

DB-backed/hybrid mode is acceptable when:

- central control plane is required;
- larger or dynamic configuration is required;
- enterprise operations need control-plane/data-plane separation;
- Admin API workflows are governed.

LLMs must not choose DB-less or DB-backed mode without stating operational implications.

---

## 6. Naming Standards

Use stable, meaningful names.

Recommended pattern:

```text
service: <domain>-<capability>-svc[-vN]
route:   <domain>-<capability>-route[-public|internal][-vN]
upstream:<domain>-<capability>-upstream[-vN]
plugin:  <scope>-<policy>-plugin
consumer:<client-or-system-name>
```

Examples:

```yaml
services:
  - name: licensing-application-svc-v1
routes:
  - name: licensing-application-public-route-v1
upstreams:
  - name: licensing-application-upstream-v1
```

Rules:

- names must not be generic: `api`, `backend`, `service1`, `route1`;
- public and internal routes must be distinguishable;
- versioned APIs must encode version in route/service names where needed;
- ownership tags must be present.

---

## 7. Service Standards

A Kong Service must define:

- upstream protocol;
- host;
- port;
- path only when intentionally prefixing upstream path;
- connect timeout;
- read timeout;
- write timeout;
- retry count;
- TLS verification behavior;
- tags/ownership.

Example:

```yaml
services:
  - name: case-management-svc-v1
    protocol: https
    host: case-management-upstream-v1
    port: 443
    connect_timeout: 3000
    read_timeout: 30000
    write_timeout: 30000
    retries: 1
    tls_verify: true
    tags:
      - domain:enforcement
      - owner:case-team
      - exposure:public
```

Rules:

- do not use `tls_verify: false` in production;
- do not leave timeout and retry behavior implicit;
- do not point public routes directly to ad hoc hosts without ownership;
- do not encode routing semantics in upstream path unless necessary;
- do not use excessive retries for non-idempotent APIs.

---

## 8. Route Standards

A Kong Route must define:

- stable name;
- matching strategy: hosts, paths, methods, headers, or SNIs;
- protocol;
- strip path behavior;
- preserve host behavior;
- HTTPS redirect behavior if applicable;
- tags;
- associated Service.

Example:

```yaml
routes:
  - name: case-management-public-route-v1
    service:
      name: case-management-svc-v1
    protocols:
      - https
    hosts:
      - api.example.com
    paths:
      - /v1/cases
    methods:
      - GET
      - POST
    strip_path: false
    preserve_host: true
    https_redirect_status_code: 308
    tags:
      - domain:enforcement
      - owner:case-team
```

Rules:

- no broad catch-all route without explicit justification;
- no overlapping routes with different auth requirements unless matching order is proven;
- path versioning must align with OpenAPI contract;
- route methods must be restricted where possible;
- public route must not expose internal/admin paths;
- `strip_path` must be deliberately chosen and tested.

---

## 9. Route Matching Standards

LLMs must prevent ambiguous route matching.

Rules:

- prefer host + path + method constraints for public APIs;
- avoid regex path unless required;
- avoid route overlap between `/api` and `/api/admin` without explicit priority/testing;
- avoid exposing both old and new versions through accidental path prefix matching;
- document matching precedence for sensitive routes;
- test every route with positive and negative examples.

Bad:

```yaml
paths:
  - /
```

Better:

```yaml
hosts:
  - api.example.com
paths:
  - /v1/licences
methods:
  - GET
  - POST
```

---

## 10. Plugin Scope Standards

Plugins must be attached at the narrowest correct scope.

Scope order from broadest to narrowest:

1. Global
2. Service
3. Route
4. Consumer

Rules:

- global plugins require platform-level approval;
- authentication plugins usually belong to Route or Service scope;
- rate limits may be Route, Service, or Consumer scoped depending on product model;
- transformation plugins must be narrowly scoped;
- logging/observability plugins may be global if safe;
- plugin ordering and interaction must be documented when multiple plugins apply.

Bad:

```yaml
plugins:
  - name: request-transformer
    config:
      add:
        headers:
          - X-Internal-Admin:true
```

Better:

- avoid injecting privileged headers unless upstream explicitly trusts Kong and the identity source is authenticated;
- attach header injection only to the exact route that requires it;
- document trust boundary.

---

## 11. Authentication Standards

Every public route must have an explicit authentication decision.

Allowed decisions:

- authenticated with OIDC/JWT/API key/mTLS/etc.;
- public anonymous access by documented business requirement;
- internal-only access enforced by network and gateway policy.

Rules:

- no public route may be unauthenticated by accident;
- authentication plugin config must validate issuer/audience/client as applicable;
- token validation must not disable signature verification;
- API keys must not be used as user identity unless the API is client/system-level;
- OIDC/JWT must align with application authorization model;
- do not place secrets in declarative files; use secret management.

Example decision record:

```text
Route: /v1/cases
Auth: OIDC bearer token
Issuer: corporate IdP
Audience: case-api
Authorization owner: upstream application
Gateway enforcement: token validity + audience only
```

---

## 12. Authorization Standards

Kong may enforce coarse gateway policy, but the upstream service remains responsible for object-level authorization.

Gateway-level authorization may include:

- client is known;
- token is valid;
- token audience is correct;
- required scope/claim exists;
- consumer belongs to allowed API product;
- route is internal-only.

Gateway-level authorization must not replace:

- checking whether user can access specific resource ID;
- tenant isolation;
- role-to-domain-action rules;
- field-level permission;
- workflow state transition permission.

Rule:

> Kong can prove “this caller may call this API class”; the service must prove “this caller may perform this action on this object now.”

---

## 13. Rate Limiting Standards

Rate limiting must define:

- keying strategy;
- window;
- limit;
- scope;
- failure mode;
- distributed consistency expectation;
- response behavior;
- monitoring.

Possible keys:

- Consumer;
- credential;
- IP address;
- route;
- service;
- tenant claim;
- custom header only if trusted.

Rules:

- IP-only rate limit is insufficient for authenticated API product quota;
- rate limit must return predictable `429` behavior;
- limits must be aligned with upstream capacity;
- avoid duplicated conflicting rate limits across Kong, NGINX, CDN, and application;
- define burst behavior where supported;
- rate limit metrics must be monitored.

---

## 14. Request Size Limiting Standards

Every public API must have a request-size policy.

Rules:

- upload APIs must define larger limits explicitly;
- JSON APIs should have conservative limits;
- Kong limit must align with NGINX/load balancer/application limits;
- clients must receive predictable error behavior;
- large payload APIs should prefer object storage pre-signed upload flow where appropriate.

---

## 15. Request and Response Transformation Standards

Transformation must be minimal and justified.

Allowed transformations:

- add correlation ID if missing;
- normalize gateway-owned headers;
- remove hop-by-hop or unsafe headers;
- add version/deprecation headers;
- simple compatibility mapping during migration.

Disallowed by default:

- domain object rewriting;
- permission-based field masking;
- workflow-state mapping;
- large JSON manipulation;
- hiding breaking API changes;
- injecting privileged internal identity without verified auth.

Rules:

- transformations must be documented in OpenAPI or gateway contract notes;
- upstream service must know what Kong injects or strips;
- transformations must be tested as contract behavior.

---

## 16. Upstream and Target Standards

Use Kong Upstreams and Targets when advanced load balancing or health checks are required.

Example concept:

```yaml
upstreams:
  - name: case-management-upstream-v1
    algorithm: round-robin
    healthchecks:
      active:
        type: https
        healthy:
          interval: 10
          successes: 2
        unhealthy:
          interval: 5
          http_failures: 3
      passive:
        healthy:
          successes: 2
        unhealthy:
          http_failures: 3

targets:
  - upstream: case-management-upstream-v1
    target: case-api-1.internal:443
    weight: 100
  - upstream: case-management-upstream-v1
    target: case-api-2.internal:443
    weight: 100
```

Rules:

- define active/passive health check behavior intentionally;
- do not route to unhealthy targets;
- health checks must hit cheap, stable readiness endpoints;
- target weights must be documented;
- DNS/service discovery behavior must be understood;
- load balancing algorithm must match traffic pattern.

---

## 17. Timeout and Retry Standards

Every Service must define timeout and retry behavior.

Rules:

- `connect_timeout` must be short;
- `read_timeout` must match endpoint behavior;
- `write_timeout` must match upload behavior;
- retries must be capped;
- non-idempotent operations must not be retried blindly;
- gateway timeout must align with client, proxy, and application timeout budget.

Example timeout budget:

```text
Client timeout:          60s
CDN/WAF timeout:         58s
Kong read_timeout:       55s
NGINX proxy timeout:     50s
Application timeout:     45s
Database timeout:        40s
```

---

## 18. Correlation ID Standards

Kong must propagate or generate a correlation ID.

Rules:

- use a standard header such as `X-Request-ID` or `Traceparent` depending on organization standard;
- do not overwrite an existing trusted trace ID unless invalid;
- generate if missing at edge;
- forward to upstream;
- include in logs;
- return in response if allowed.

---

## 19. Logging and Observability Standards

Every public API route must be observable.

Required visibility:

- request count;
- latency;
- status code distribution;
- upstream latency;
- upstream failures;
- authentication failures;
- authorization/policy rejections;
- rate-limit rejections;
- request size rejections;
- route/service/plugin attribution;
- consumer/client attribution;
- correlation ID.

Rules:

- logs must not include tokens, secrets, cookies, or sensitive payloads;
- plugin-level failures must be visible;
- dashboards must group by Service, Route, Consumer, and status;
- alerting must include gateway 5xx and upstream 5xx separately.

---

## 20. Error Handling Standards

Gateway errors must be predictable and not leak internals.

Rules:

- authentication failures should return `401`;
- authorization/policy failures should return `403`;
- rate limits should return `429`;
- upstream unavailable should return appropriate `502`, `503`, or `504`;
- custom error bodies must not expose upstream hostnames, stack traces, plugin internals, or secrets;
- error format should align with API standards, preferably Problem Details where supported by architecture.

---

## 21. OpenAPI Alignment Standards

Every public Kong route must map to an API contract.

Rules:

- path and methods must match OpenAPI;
- auth requirements must match OpenAPI security schemes;
- documented status codes must include gateway-level errors where relevant;
- request size limits and rate-limit behavior should be documented;
- deprecated routes must expose deprecation information;
- route versions must align with API version policy.

If Kong route exists but no OpenAPI contract exists, the route must be treated as undocumented exposure and rejected unless explicitly internal and documented elsewhere.

---

## 22. Versioning Standards

Rules:

- API version exposure must be deliberate;
- multiple active versions must have separate routes or explicit matching;
- deprecation policy must define sunset date and migration path;
- do not silently remap `/v1` to `/v2`;
- compatibility transformations must be temporary and tracked.

---

## 23. Internal vs Public API Standards

Public APIs require:

- public hostname;
- explicit authentication decision;
- rate limit;
- request size limit;
- OpenAPI contract;
- logging/monitoring;
- security review.

Internal APIs require:

- internal-only route/hostname/network exposure;
- service identity or mTLS if required;
- no accidental public route;
- explicit consumer/service ownership;
- monitoring.

LLMs must not create public exposure by default.

---

## 24. Admin API Standards

Kong Admin API must be protected as a critical control-plane interface.

Rules:

- never expose Admin API publicly;
- restrict by network and identity;
- enforce TLS;
- audit all changes;
- prefer CI/CD automation over manual mutation;
- rotate credentials;
- monitor failed access;
- disable or isolate Admin API where not needed.

---

## 25. Plugin Governance Standards

Each plugin must have:

- purpose;
- scope;
- owner;
- configuration source;
- security review status;
- failure behavior;
- observability impact;
- performance impact;
- test coverage.

Rules:

- avoid plugin sprawl;
- avoid overlapping plugins that perform similar policy;
- avoid custom plugins unless operational ownership exists;
- custom plugins must have versioning, tests, security review, and rollback;
- plugin configuration must be deterministic and tracked.

---

## 26. Consumer and Credential Standards

Rules:

- Consumers must represent real API clients, systems, partners, or applications;
- do not create generic consumers such as `default`, `test`, or `shared-client` for production;
- credentials must be unique per consumer;
- rotate credentials;
- credentials must not be stored in Git;
- revoke unused consumers;
- consumer ownership must be recorded;
- separate human user identity from API consumer identity.

---

## 27. Secret Management Standards

Rules:

- no client secrets in declarative YAML;
- no API keys in committed files;
- no private keys in repository;
- use environment variables, secret stores, or platform secret injection;
- avoid logging secret-bearing headers;
- document rotation process;
- test startup failure when required secrets are missing.

---

## 28. TLS and mTLS Standards

Rules:

- public listener TLS must follow organization baseline;
- upstream TLS verification must remain enabled;
- mTLS must have certificate lifecycle ownership;
- certificate/SNI mappings must be explicit;
- expiration must be monitored;
- do not bypass TLS verification to “fix” deployment issues;
- internal HTTP may be allowed only inside trusted network and by explicit decision.

---

## 29. Deployment Standards

Every Kong deployment must define:

- topology: DB-less, traditional DB-backed, hybrid, Kubernetes ingress/controller;
- config source of truth;
- deployment pipeline;
- validation command;
- rollback process;
- data-plane/control-plane separation if applicable;
- plugin compatibility;
- version upgrade policy.

Rules:

- do not upgrade Kong without checking breaking changes;
- test route/plugin behavior in staging;
- test rollback with existing config;
- config drift must be detectable.

---

## 30. CI/CD Standards

Gateway config pipeline should include:

- schema validation;
- linting;
- duplicate/overlap route detection;
- forbidden plugin detection;
- missing auth detection;
- missing rate-limit/request-size policy detection;
- OpenAPI alignment check;
- secret scanning;
- dry-run diff;
- smoke tests after deploy.

Example pipeline gates:

```text
1. Validate declarative syntax
2. Run policy linter
3. Check route/auth coverage
4. Check OpenAPI path/method alignment
5. Run secret scan
6. Produce diff
7. Deploy to staging
8. Smoke-test route/auth/rate-limit behavior
9. Promote to production
```

---

## 31. Testing Standards

For every new or changed route, test:

- valid request;
- invalid path;
- invalid method;
- unauthenticated request;
- unauthorized request;
- invalid token/key;
- expired token/key;
- over rate limit;
- oversized body;
- upstream timeout;
- upstream 5xx;
- correlation ID propagation;
- logging output;
- plugin interaction.

For every plugin, test:

- expected behavior;
- misconfiguration behavior;
- failure mode;
- performance impact;
- rollback behavior.

---

## 32. Migration Standards

When migrating APIs into Kong:

- inventory current routes;
- map each route to owner and OpenAPI contract;
- identify auth behavior;
- identify rate limits and body limits;
- compare old and new headers;
- compare error behavior;
- run shadow/canary if possible;
- preserve correlation IDs;
- monitor before and after cutover;
- keep rollback path.

Do not use gateway migration to hide API contract debt.

---

## 33. Anti-Patterns

### 33.1 Gateway as God Service

Putting business orchestration, validation, and domain rules into Kong.

### 33.2 Plugin Sprawl

Adding plugins for every local need until gateway behavior becomes impossible to reason about.

### 33.3 Global Plugin Abuse

Applying global plugins that unexpectedly affect unrelated APIs.

### 33.4 Public Route Without Auth Decision

Leaving route anonymous because authentication was “not configured yet.”

### 33.5 Route Catch-All

Using a broad route that exposes unintended upstream paths.

### 33.6 Object Authorization at Gateway Only

Assuming a token scope means the user can access every resource ID.

### 33.7 `tls_verify: false`

Disabling upstream TLS verification instead of fixing certificate trust.

### 33.8 Manual Admin API Drift

Changing production gateway state outside Git/CI without audit and drift reconciliation.

### 33.9 Transformation as Compatibility Lie

Using transformations to hide breaking changes indefinitely.

### 33.10 Rate Limit Without Product Model

Applying arbitrary IP-based rate limits to authenticated tenant APIs without considering users behind NAT or paid quota model.

### 33.11 Unobservable Gateway

Adding routes/plugins without metrics, logs, and alerting.

### 33.12 Gateway Retry Storm

Enabling retries across multiple layers and multiplying traffic during upstream degradation.

---

## 34. LLM Decision Algorithm

Before generating Kong config, the LLM must answer:

1. Is Kong the correct component for this behavior?
2. Is this public, partner, internal, or admin API exposure?
3. What OpenAPI operation does the route represent?
4. What Service owns the upstream?
5. What is the exact route match?
6. What authentication is required?
7. What authorization remains in the upstream service?
8. Which plugins are required and why?
9. What is each plugin scope?
10. What is the timeout/retry behavior?
11. What is the rate-limit policy?
12. What is the request-size policy?
13. What headers are added, removed, or trusted?
14. What is the upstream health/load-balancing behavior?
15. How are logs, metrics, and traces emitted?
16. How is config deployed, validated, and rolled back?

If any answer is unknown, the LLM must not silently guess. It must either use a safe default and mark the assumption or request a decision from the owner.

---

## 35. Required Output Format for LLMs

When proposing Kong implementation, output:

```text
Kong Change Summary:
- Purpose:
- Exposure type: public / partner / internal / admin
- Service:
- Route match:
- Upstream:
- Authentication:
- Gateway authorization:
- Upstream authorization responsibility:
- Plugins and scopes:
- Timeout/retry behavior:
- Rate limit behavior:
- Request size behavior:
- Header behavior:
- Observability:
- OpenAPI alignment:
- Security impact:
- Test plan:
- Rollback plan:
```

---

## 36. Review Checklist

A Kong change is acceptable only if:

- [ ] Service name is meaningful;
- [ ] Route match is precise;
- [ ] route does not expose unintended paths;
- [ ] public route has explicit auth decision;
- [ ] object-level authorization remains in service;
- [ ] plugin scope is narrowest correct scope;
- [ ] no unnecessary global plugin;
- [ ] timeout and retry behavior are explicit;
- [ ] non-idempotent retry risk is handled;
- [ ] request size policy exists;
- [ ] rate-limit policy exists where required;
- [ ] TLS verification is not disabled;
- [ ] secrets are not committed;
- [ ] Admin API is not publicly exposed;
- [ ] upstream health/load balancing is defined if needed;
- [ ] logs/metrics/traces are available;
- [ ] OpenAPI contract matches route;
- [ ] config is declarative or audited;
- [ ] CI validation exists;
- [ ] rollback path exists.

---

## 37. Acceptance Criteria

A Kong Gateway implementation is accepted only when:

1. every route has an owner and exposure classification;
2. every public route has explicit auth and rate-limit decisions;
3. route matching is deterministic;
4. plugins are scoped and justified;
5. upstream timeout/retry behavior is safe;
6. object-level authorization is not delegated solely to gateway;
7. secrets are externalized;
8. gateway config is versioned and validated;
9. observability supports incident diagnosis;
10. rollback is possible.

---

## 38. References

- Kong Gateway documentation: https://developer.konghq.com/gateway/
- Kong DB-less mode: https://developer.konghq.com/gateway/db-less-mode/
- Kong deployment topologies: https://developer.konghq.com/gateway/deployment-topologies/
- Kong decK documentation: https://developer.konghq.com/deck/
- Kong Rate Limiting plugin: https://developer.konghq.com/plugins/rate-limiting/
- Kong OpenID Connect plugin: https://developer.konghq.com/plugins/openid-connect/
- Kong Upstreams: https://developer.konghq.com/gateway/entities/upstream/
- Kong load balancing reference: https://developer.konghq.com/gateway/traffic-control/load-balancing-reference/
- Kong health checks and circuit breakers: https://developer.konghq.com/gateway/traffic-control/health-checks-circuit-breakers/
- Kong breaking changes: https://developer.konghq.com/gateway/breaking-changes/
- OWASP API Security Top 10 2023: https://owasp.org/API-Security/editions/2023/en/0x11-t10/
