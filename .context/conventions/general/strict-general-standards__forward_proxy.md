# Strict General Standards: Forward Proxy

> File: `strict-general-standards__forward_proxy.md`  
> Category: General Engineering Standard  
> Principle: Outbound Proxying, Egress Governance, Client-Side Mediation, Destination Control, Auditability, and Data Protection  
> Status: Mandatory for LLM-assisted architecture design, implementation, refactoring, review, and documentation involving forward proxies

---

## 1. Purpose

This standard defines how an LLM code agent MUST design, implement, modify, review, and document forward proxy behavior.

A forward proxy is an intermediary that acts on behalf of clients when they make outbound requests to other networks or destinations. It is commonly used for egress control, destination allowlisting, corporate internet access, malware filtering, TLS tunneling, audit logging, privacy mediation, caching, and outbound traffic governance.

The goal is to prevent uncontrolled egress, data leakage, proxy bypass, broken TLS assumptions, weak audit trails, and accidental use of forward proxies as insecure network shortcuts.

This standard applies to:

- corporate forward proxies;
- outbound internet proxies;
- egress proxies in Kubernetes or service mesh environments;
- HTTP proxy configuration for backend services;
- proxies used by CI/CD pipelines;
- proxies for package managers and dependency fetching;
- proxies for partner/external API access;
- proxy auto-configuration/PAC setups;
- explicit HTTP proxies;
- transparent/intercepting proxies;
- SOCKS proxies where approved;
- custom forward proxy code.

This standard MUST be read together with:

- `strict-general-standards__http_for_web.md`;
- `strict-general-standards__api_gateway.md`;
- `strict-general-standards__reverse_proxy.md`;
- security, privacy, observability, and network standards.

---

## 2. Source Baseline

The LLM MUST align forward proxy work with these baseline references:

- HTTP Semantics, including CONNECT, intermediaries, header semantics, authentication, caching, and status codes.
- MDN proxy documentation for forward proxy, reverse proxy, tunneling, and proxy auto-configuration concepts.
- RFC 7239 Forwarded HTTP Extension where forwarding metadata is used.
- Vendor/tool documentation for the chosen proxy, such as Squid, Envoy, HAProxy, NGINX, cloud egress gateway, service mesh egress gateway, or enterprise secure web gateway.
- OWASP and enterprise security standards for egress control, SSRF mitigation, logging, secrets protection, TLS interception, and data loss prevention.
- Compliance requirements for audit logging, retention, privacy, and outbound data transfer.

References are listed at the end of this document.

---

## 3. Core Interpretation

### 3.1 Forward proxy acts on behalf of clients

The LLM MUST understand a forward proxy as a client-side/outbound intermediary.

Forward proxy concern:

```text
Which outbound destinations may this client/workload reach, under what policy, with what auditability?
```

Reverse proxy concern:

```text
Which inbound requests may reach internal origin servers?
```

API Gateway concern:

```text
Which API contracts may clients consume and under what API policy?
```

### 3.2 Forward proxy is an egress control point

A forward proxy SHOULD usually be treated as a security and governance control, not just a network convenience.

It MAY enforce:

- destination allowlists/denylists;
- protocol restrictions;
- port restrictions;
- method restrictions;
- authentication;
- workload identity;
- malware scanning;
- data loss prevention;
- TLS inspection where legally and operationally approved;
- audit logging;
- rate limiting;
- package repository mirroring/caching;
- outbound dependency governance;
- SSRF containment;
- partner API access control.

### 3.3 Forward proxy must not become a bypass tunnel

The LLM MUST NOT configure a forward proxy that allows arbitrary outbound access without identity, policy, logging, and destination control.

A forward proxy without policy is often worse than direct egress because it centralizes bypass capability.

### 3.4 Explicit and transparent proxies have different risk models

The LLM MUST distinguish:

- **Explicit forward proxy**: client is configured to use a proxy.
- **Transparent/intercepting proxy**: network redirects traffic without application-level proxy configuration.
- **PAC/WPAD-based proxy**: client selects proxy based on proxy auto-configuration.
- **Service mesh egress gateway**: workload outbound traffic goes through mesh-managed egress.
- **SOCKS proxy**: generic circuit-level proxy, often less HTTP-policy-aware.

Each model MUST document bypass risk, TLS implications, and observability.

---

## 4. Mandatory Decision Gate Before Introducing a Forward Proxy

Before adding or materially changing a forward proxy, the LLM MUST produce a decision record.

```md
# Forward Proxy Decision Record

## Proxy Name

- Name:
- Environment:
- Owning team:
- Explicit/Transparent/PAC/Mesh/SOCKS:

## Clients / Workloads

- Client groups:
- Service accounts/workload identities:
- Networks/subnets:
- CI/CD systems:

## Destination Scope

- Allowed domains:
- Allowed IP ranges:
- Allowed ports:
- Allowed protocols:
- Denied destinations:
- Private/internal IP handling:

## Security Policy

- Authentication:
- Authorization:
- TLS tunneling:
- TLS inspection:
- Malware/DLP scanning:
- SSRF protection:
- Secret redaction:

## Failure Behavior

- Proxy unavailable behavior:
- DNS failure behavior:
- Destination blocked response:
- Timeout:
- Retry:

## Observability

- Access log fields:
- Audit fields:
- Metrics:
- Alerts:
- Retention:

## Bypass Control

- Network egress restrictions:
- NO_PROXY policy:
- Firewall rules:
- Kubernetes/network policy:
- Direct internet access prevention:

## Operations

- Config source:
- Validation:
- Rollout:
- Rollback:
- Certificate rotation:
```

If these fields cannot be answered, the LLM MUST NOT introduce a production forward proxy.

---

## 5. Mandatory Responsibility Boundaries

### 5.1 Allowed forward proxy responsibilities

The LLM MAY implement:

- outbound request routing;
- destination allowlisting;
- destination denylisting;
- DNS policy enforcement;
- method/port/protocol control;
- client/workload authentication;
- egress authorization;
- TLS CONNECT tunneling;
- TLS inspection where approved;
- outbound audit logs;
- package/dependency caching;
- malware scanning integration;
- DLP integration;
- outbound rate limits;
- bandwidth controls;
- external API access centralization;
- partner network egress control;
- proxy auto-configuration;
- SSRF containment for untrusted URL fetchers.

### 5.2 Prohibited forward proxy responsibilities

The LLM MUST NOT implement:

- arbitrary internet tunnel without policy;
- hidden bypass around firewall restrictions;
- exfiltration-friendly CONNECT to all hosts/ports;
- logging of full secrets or sensitive payloads by default;
- TLS interception without explicit governance;
- domain authorization for backend business resources;
- inbound API access policy that belongs to an API Gateway;
- origin-server routing that belongs to a reverse proxy;
- data transformation that changes business meaning;
- proxy credentials embedded in application code.

---

## 6. Destination Governance

### 6.1 Default-deny is preferred

Production forward proxies SHOULD use default-deny outbound policy.

Allowed destinations MUST be explicitly declared by:

- domain;
- wildcard domain with narrow scope;
- IP/CIDR where stable and justified;
- port;
- protocol;
- owning application/team;
- business reason;
- data classification;
- expiry/review date.

Example:

```yaml
allowlist:
  - id: payment-provider-api
    owner: billing-service-team
    domains:
      - api.payment-provider.example
    ports: [443]
    protocols: [https]
    methods: [GET, POST]
    reason: payment authorization and settlement
    data_classification: confidential
    review_by: 2026-12-31
```

### 6.2 Wildcards must be narrow

Broad wildcards are prohibited unless explicitly justified.

Prohibited:

```text
*.com
*.amazonaws.com
*.googleapis.com
*:*
0.0.0.0/0
```

Allowed only with controls:

```text
*.s3.ap-southeast-1.amazonaws.com  # if bucket restrictions and IAM policy also exist
*.corp-approved-vendor.example     # if vendor owns entire zone and risk accepted
```

### 6.3 Block private and metadata destinations by default

Forward proxies handling untrusted or user-controlled URLs MUST block access to:

- loopback ranges;
- link-local ranges;
- private RFC1918 ranges unless explicitly approved;
- cloud metadata endpoints;
- Kubernetes service IP ranges unless explicitly approved;
- internal DNS zones unless explicitly approved;
- multicast/broadcast ranges;
- file URLs or non-HTTP protocols if applicable.

This is mandatory for SSRF-resistant URL fetching.

### 6.4 DNS rebinding protection

For untrusted URL fetches, the proxy or caller MUST protect against DNS rebinding:

- resolve hostname through trusted resolver;
- validate resolved IP against allow/deny policy;
- revalidate after redirects;
- revalidate on connection;
- do not rely only on the original hostname string;
- cache DNS decisions carefully.

### 6.5 Redirect policy

Outbound requests following redirects MUST re-evaluate destination policy after each redirect.

The LLM MUST NOT allow an initially approved URL to redirect to an unapproved internal or malicious destination.

---

## 7. Authentication and Authorization

### 7.1 Proxy authentication

Production forward proxies SHOULD authenticate clients/workloads unless network isolation provides equivalent control.

Allowed authentication mechanisms include:

- mTLS workload identity;
- service account identity;
- Kerberos/NTLM in corporate environments where appropriate;
- OAuth2/OIDC token;
- proxy username/password stored in approved secret manager;
- cloud IAM identity;
- Kubernetes service account identity via mesh policy.

### 7.2 No shared proxy identity for unrelated workloads

The LLM MUST NOT use one shared proxy credential for unrelated applications unless a documented exception exists.

Shared credentials destroy auditability and make least privilege impossible.

### 7.3 Authorization dimensions

Proxy authorization SHOULD consider:

- workload/service identity;
- user identity where applicable;
- source network;
- destination domain/IP;
- port;
- protocol;
- HTTP method;
- data classification;
- environment;
- time window;
- partner/API product.

### 7.4 Credential storage

Proxy credentials MUST NOT be hard-coded in source code, Dockerfiles, build logs, shell history, CI logs, `.npmrc`, `.pip.conf`, `.m2/settings.xml`, `.gradle/gradle.properties`, or environment files committed to source control.

Credentials MUST be stored in approved secret managers or secure runtime configuration.

---

## 8. HTTP CONNECT and TLS Tunneling

### 8.1 CONNECT must be restricted

The HTTP `CONNECT` method creates a tunnel to a destination. The LLM MUST restrict CONNECT by:

- allowed host/domain;
- allowed port, usually `443`;
- client identity;
- destination category;
- environment;
- logging policy.

Prohibited:

```text
CONNECT *:* allowed for all clients
CONNECT to internal metadata services
CONNECT to arbitrary private IP ranges
CONNECT to non-standard ports without justification
```

### 8.2 TLS inspection must be explicitly approved

TLS interception/inspection is sensitive and MUST require explicit approval.

The decision record MUST document:

- legal/compliance basis;
- user/workload notification where required;
- CA distribution;
- certificate pinning impact;
- excluded destinations;
- privacy constraints;
- key management;
- audit logging;
- failure behavior;
- incident response.

The LLM MUST NOT casually add TLS interception as a default feature.

### 8.3 End-to-end TLS expectations

If CONNECT is used without interception, the proxy can usually see destination host/port but not encrypted HTTP content.

The LLM MUST NOT claim payload-level filtering is possible without TLS inspection or endpoint integration.

### 8.4 Certificate pinning

Applications using certificate pinning may fail under TLS inspection.

The LLM MUST document pinning implications before enabling TLS inspection for mobile apps, partner integrations, payment APIs, identity providers, or security-sensitive endpoints.

---

## 9. Application Configuration Standards

### 9.1 Proxy configuration must be explicit

Applications using a forward proxy MUST define:

- `HTTP_PROXY` / `HTTPS_PROXY` behavior where used;
- lowercase/uppercase environment variable handling;
- `NO_PROXY` entries;
- per-library proxy settings;
- proxy authentication;
- timeout behavior;
- DNS behavior;
- TLS trust store behavior.

### 9.2 NO_PROXY must be controlled

`NO_PROXY` can accidentally bypass security controls.

The LLM MUST document:

- which hosts bypass proxy;
- why bypass is needed;
- whether bypass is allowed in production;
- whether bypass breaks auditability;
- how bypass is enforced by network policy.

Prohibited broad bypass examples:

```text
NO_PROXY=*
NO_PROXY=.com
NO_PROXY=10.0.0.0/8,172.16.0.0/12,192.168.0.0/16 # if this permits uncontrolled internal access
```

Allowed examples:

```text
NO_PROXY=localhost,127.0.0.1,.svc.cluster.local
```

Only if internal traffic is governed separately.

### 9.3 Library behavior must be verified

Different HTTP clients handle proxies differently.

The LLM MUST verify behavior for the specific runtime/library:

- Java `HttpClient`, Apache HttpClient, OkHttp, Spring `WebClient`;
- Node.js `fetch`, `axios`, `undici`, proxy agents;
- Go `http.Transport.Proxy`;
- .NET `HttpClientHandler.Proxy`;
- Python `requests`/`httpx`;
- curl/wget;
- package managers.

The LLM MUST NOT assume environment variables are honored by every HTTP client.

### 9.4 Timeout and retry behavior

Client applications using forward proxies MUST define:

- proxy connect timeout;
- TLS handshake timeout;
- request timeout;
- response timeout;
- retry policy;
- proxy authentication failure behavior;
- blocked destination behavior.

---

## 10. CI/CD, Build Tools, and Package Repositories

### 10.1 Dependency fetches must be governed

Forward proxies used by CI/CD MUST enforce dependency-source policy.

Allowed patterns:

- internal artifact repository mirror;
- approved package registry;
- allowlisted vendor domains;
- checksum/signature verification;
- SBOM generation;
- dependency scanning.

Prohibited:

- CI runners with unrestricted internet access;
- build scripts downloading arbitrary URLs;
- curl-pipe-shell through proxy without verification;
- proxy credentials printed in build logs;
- bypassing artifact repositories without approval.

### 10.2 Package manager proxy config

The LLM MUST avoid committing secrets in package manager config.

Sensitive files include:

- `.npmrc`;
- `.yarnrc`;
- `.pypirc`;
- `pip.conf`;
- `settings.xml`;
- `gradle.properties`;
- `.curlrc`;
- `.wgetrc`;
- NuGet config;
- Docker build args and layer history.

### 10.3 Reproducible builds

Forward proxy caching SHOULD support reproducibility, not hide nondeterminism.

The LLM SHOULD prefer:

- pinned dependency versions;
- lock files;
- immutable artifact repositories;
- checksums;
- build provenance;
- cache eviction policy.

---

## 11. SSRF and Untrusted URL Fetching

### 11.1 Untrusted URL fetches must use hardened egress

Any service fetching user-provided URLs MUST use a hardened outbound access path.

Mandatory controls:

- allowlist or strict URL policy;
- scheme allowlist (`https` preferred);
- hostname normalization;
- DNS resolution validation;
- private IP blocking;
- metadata endpoint blocking;
- redirect revalidation;
- max response size;
- timeout;
- content type validation;
- no credential forwarding;
- audit logging.

### 11.2 Metadata endpoint blocking

The proxy and network layer MUST block cloud metadata endpoints from untrusted fetchers.

Examples to block include platform-specific metadata addresses such as link-local metadata endpoints and internal metadata hostnames.

### 11.3 No ambient credentials

Outbound URL fetchers MUST NOT send ambient credentials to arbitrary destinations.

Prohibited:

- forwarding user cookies;
- forwarding internal bearer tokens;
- using cloud instance credentials for arbitrary external requests;
- using internal service identity for untrusted destinations without policy.

---

## 12. Data Protection and Privacy

### 12.1 Minimize logged data

Forward proxy logs MUST avoid recording:

- full query strings containing secrets;
- authorization headers;
- cookies;
- POST bodies;
- access tokens;
- API keys;
- personal data beyond approved audit fields;
- file contents.

### 12.2 Auditability

Forward proxy audit logs SHOULD include:

- timestamp;
- client/workload identity;
- source IP/subnet;
- destination host/IP;
- destination port;
- protocol;
- method where visible;
- action allowed/blocked;
- policy rule ID;
- bytes sent/received;
- status/result;
- TLS inspected/tunneled indicator;
- correlation ID where available;
- user identity where applicable and allowed.

### 12.3 Data residency and cross-border transfer

For regulated systems, outbound proxy policy MUST consider:

- destination country/region;
- vendor data processing role;
- data classification;
- contractual approval;
- retention policy;
- audit requirement.

The LLM MUST NOT add new external destinations for regulated data without governance review.

---

## 13. Caching Standards

### 13.1 Forward proxy caching must be safe

Forward proxy caching MAY be used for:

- static public web assets;
- dependency artifacts;
- package indexes;
- OS package repositories;
- approved vendor static content.

The LLM MUST NOT cache:

- authenticated API responses unless explicitly safe;
- tenant-specific data;
- personal data;
- secrets;
- dynamic payment/identity responses;
- legal/regulatory content requiring freshness unless policy allows.

### 13.2 Cache key and validation

Cache policy MUST define:

- cache key;
- TTL;
- validation headers;
- stale behavior;
- purge process;
- storage limit;
- privacy rules;
- corruption handling;
- observability.

### 13.3 Dependency cache integrity

Package/dependency caches MUST preserve integrity:

- checksums;
- signatures where available;
- immutable artifact behavior;
- upstream provenance;
- malware scanning where applicable.

---

## 14. Failure Behavior

### 14.1 Proxy unavailable behavior

The system MUST define what happens when the forward proxy is unavailable.

Options:

- fail closed: block outbound traffic;
- fail open: allow direct egress;
- fail over to secondary proxy;
- degraded mode for critical destinations.

Security-sensitive systems SHOULD fail closed unless availability requirements justify otherwise.

### 14.2 Blocked destination response

When destination is blocked, the proxy SHOULD return a clear machine-readable error where possible.

Example:

```json
{
  "error": "EGRESS_DESTINATION_BLOCKED",
  "message": "Outbound destination is not approved for this workload.",
  "policyRuleId": "egress-allowlist-042",
  "correlationId": "01HX..."
}
```

For browser/corporate user proxies, a human-readable block page may also be appropriate.

### 14.3 Timeouts

Forward proxy paths MUST define:

- client-to-proxy timeout;
- proxy DNS timeout;
- proxy-to-destination connect timeout;
- TLS handshake timeout;
- response header timeout;
- idle timeout;
- max download duration;
- max upload duration.

### 14.4 Retries

Forward proxies SHOULD NOT retry unsafe HTTP methods by default.

When retries are used, they MUST be:

- bounded;
- idempotency-aware;
- jittered;
- logged;
- compatible with client retry behavior.

---

## 15. Bypass Prevention

### 15.1 Network egress must enforce proxy use

If the forward proxy is a security control, network policy MUST prevent direct egress bypass.

Controls may include:

- firewall deny rules;
- Kubernetes NetworkPolicy;
- cloud security groups/NACLs;
- service mesh egress policy;
- route table restrictions;
- DNS controls;
- NAT gateway restrictions;
- endpoint policies.

The LLM MUST NOT assume application proxy configuration alone prevents bypass.

### 15.2 DNS bypass

Systems MUST define whether clients resolve DNS directly or through the proxy.

Risk:

- direct DNS can leak destinations;
- inconsistent DNS can bypass policy;
- split-horizon DNS can produce different results for proxy and client.

### 15.3 Alternative protocol bypass

Blocking HTTP egress but allowing arbitrary TCP, UDP, SSH, or SOCKS may bypass policy.

The LLM MUST evaluate non-HTTP egress paths when proxy is a security boundary.

---

## 16. Observability Standards

### 16.1 Metrics

Forward proxy metrics SHOULD include:

- allowed requests;
- blocked requests;
- destination categories;
- top clients/workloads;
- top destinations;
- latency;
- DNS failures;
- connect failures;
- TLS errors;
- authentication failures;
- authorization denials;
- bytes sent/received;
- cache hit ratio;
- malware/DLP events;
- proxy saturation;
- policy reload success/failure.

### 16.2 Alerts

Alerts SHOULD exist for:

- proxy unavailable;
- high blocked request spike;
- unusual destination spike;
- high egress volume;
- new destination category;
- repeated auth failures;
- TLS inspection failure spike;
- malware/DLP detection;
- metadata/private IP access attempts;
- policy reload failure;
- certificate expiry;
- disk pressure from cache/logs.

### 16.3 Correlation

Applications SHOULD propagate correlation IDs to outbound requests where safe.

Forward proxy logs SHOULD preserve correlation IDs without logging secrets.

---

## 17. Configuration and Deployment Standards

### 17.1 Policy as code

Forward proxy policy MUST be version-controlled.

Policy changes MUST include:

- owner;
- reason;
- destination;
- data classification;
- expiry/review date;
- security approval where required;
- tests;
- rollback plan.

### 17.2 Separation of duties

For regulated environments, the LLM SHOULD preserve separation between:

- application team requesting egress;
- security/network team approving egress;
- platform team deploying policy;
- audit team reviewing logs.

### 17.3 Safe rollout

Policy changes SHOULD support:

- dry-run mode;
- shadow evaluation;
- staged rollout;
- emergency rollback;
- deny-by-default fallback;
- validation before reload.

### 17.4 Environment parity

Lower environments SHOULD mirror production egress policy as closely as possible.

Prohibited:

- development has unrestricted internet while production is locked down, causing untested dependencies;
- production has emergency allowlists not represented in source control;
- CI/CD has broader egress than runtime without justification.

---

## 18. Testing Standards

Forward proxy changes MUST be tested for:

- allowed destination access;
- denied destination blocking;
- private IP blocking;
- metadata endpoint blocking;
- redirect revalidation;
- DNS rebinding defense where applicable;
- proxy authentication;
- authorization by workload identity;
- CONNECT restrictions;
- TLS tunnel behavior;
- TLS inspection behavior if enabled;
- NO_PROXY behavior;
- client library proxy usage;
- timeout behavior;
- proxy unavailable behavior;
- logging/audit fields;
- cache integrity where enabled;
- direct egress bypass prevention.

CI/CD proxy changes MUST test:

- package manager behavior;
- secret redaction in logs;
- artifact checksum/signature verification;
- failure when unapproved registry is used.

---

## 19. Forward Proxy Anti-Patterns

### 19.1 Open proxy

Prohibited.

Symptoms:

- no authentication;
- arbitrary destination access;
- arbitrary CONNECT;
- public exposure;
- no audit logs.

Correction:

- require authentication;
- restrict destinations;
- block external use;
- audit all decisions;
- enforce network access controls.

### 19.2 Proxy as firewall bypass

Prohibited.

Symptoms:

- firewall blocks direct access but proxy allows everything;
- teams use proxy to reach unapproved vendors;
- no egress review.

Correction:

- align proxy policy with firewall policy;
- default deny;
- approve destinations as code.

### 19.3 Shared proxy credential

Prohibited unless narrowly justified.

Symptoms:

- many services use one username/password;
- audit logs cannot identify workload;
- credential rotation breaks all applications.

Correction:

- use workload identity;
- issue per-service credentials;
- rotate safely.

### 19.4 TLS inspection by surprise

Prohibited.

Symptoms:

- applications fail due to certificate pinning;
- users/workloads are unaware traffic is intercepted;
- legal/privacy review absent.

Correction:

- require explicit governance;
- distribute CA properly;
- define exclusions;
- document impact.

### 19.5 NO_PROXY wildcard

Prohibited.

Symptoms:

- `NO_PROXY=*`;
- direct egress bypasses audit;
- production behaves differently from security design.

Correction:

- narrow NO_PROXY;
- enforce egress at network layer;
- test proxy usage.

### 19.6 SSRF filter only in application code

Weak pattern.

Symptoms:

- application validates URL once;
- redirect goes to internal IP;
- DNS rebinding bypasses check;
- metadata endpoint reachable.

Correction:

- enforce destination policy at hardened proxy/egress layer;
- revalidate redirects and resolved IPs;
- block private/metadata ranges.

### 19.7 Logging secrets

Prohibited.

Symptoms:

- proxy logs full URLs with tokens;
- headers include API keys;
- POST bodies logged for debugging.

Correction:

- redact sensitive headers/query parameters;
- log metadata, not secrets;
- restrict debug logging.

---

## 20. Forward Proxy Policy Template

```yaml
proxy_policy_id: billing-service-egress
owner:
  application: billing-service
  team: billing-domain-team
  environment: production
client_identity:
  type: workload-identity
  identity: billing-service.prod
mode:
  type: explicit-http-proxy
  proxy_url_secret: prod/network/forward-proxy-url
destination_policy:
  default: deny
  allow:
    - id: payment-provider
      domains:
        - api.payment-provider.example
      ports: [443]
      protocols: [https]
      methods: [GET, POST]
      connect_allowed: true
      tls_inspection: false
      data_classification: confidential
      reason: payment processing
      review_by: 2026-12-31
  deny:
    - private_ip_ranges
    - loopback
    - link_local
    - cloud_metadata
    - unknown_domains
security:
  proxy_authentication: required
  tls_inspection: disabled
  strip_sensitive_headers_on_untrusted_redirect: true
  redirect_revalidation: true
limits:
  max_response_size: 20MiB
  connect_timeout: 2s
  response_timeout: 30s
  idle_timeout: 60s
observability:
  audit_log: true
  log_query_string: redacted
  log_headers: allowlist
  metrics: true
  alerts: true
bypass:
  no_proxy:
    - localhost
    - 127.0.0.1
    - .svc.cluster.local
  direct_egress_blocked_by_network_policy: true
```

---

## 21. Review Checklist

Before approving forward proxy work, verify:

- [ ] Proxy mode is explicit: explicit, transparent, PAC, mesh, or SOCKS.
- [ ] Client/workload identities are known.
- [ ] Default-deny destination policy exists or exception is justified.
- [ ] Allowed destinations have owner, reason, port, protocol, and review date.
- [ ] Wildcards are narrow and justified.
- [ ] Private IP, loopback, link-local, and metadata endpoints are blocked where needed.
- [ ] DNS rebinding and redirect revalidation are handled for untrusted URLs.
- [ ] Proxy authentication exists or network isolation equivalent is documented.
- [ ] Shared credentials are avoided.
- [ ] CONNECT is restricted.
- [ ] TLS inspection is not enabled without approval.
- [ ] Secrets are not hard-coded in application/package manager config.
- [ ] NO_PROXY is narrow and reviewed.
- [ ] Client libraries are verified to actually use the proxy.
- [ ] Direct egress bypass is prevented at network layer if proxy is a security control.
- [ ] Logs redact secrets and sensitive payloads.
- [ ] Audit logs include identity, destination, decision, and policy rule.
- [ ] Timeout and failure behavior are defined.
- [ ] CI/CD dependency fetching is governed.
- [ ] Tests cover allowed, denied, bypass, and failure paths.

---

## 22. Acceptance Criteria

Forward proxy work is acceptable only if:

1. The proxy is clearly defined as an outbound/effective egress control point.
2. Clients/workloads and destination policies are explicit.
3. Default-deny or equivalent governance is implemented for production.
4. Authentication and auditability exist.
5. CONNECT and TLS behavior are restricted and documented.
6. Private/internal/metadata destinations are blocked where SSRF risk exists.
7. NO_PROXY and direct egress bypass are controlled.
8. Secrets are not exposed in config, logs, or build outputs.
9. Failure behavior is deliberate: fail closed/open/failover is documented.
10. Tests prove destination allow/deny, proxy usage, logging, and bypass prevention.

---

## 23. Enforcement Snippet for LLM Agents

```text
When modifying forward proxy behavior:
- Treat it as outbound egress governance, not just a convenience proxy.
- Do not create an open proxy or arbitrary CONNECT tunnel.
- Use default-deny destination policy for production unless explicitly justified.
- Require client/workload identity and audit logs.
- Block private, loopback, link-local, and metadata endpoints for untrusted URL fetchers.
- Revalidate redirects and resolved IPs.
- Do not hard-code proxy credentials or leak them in package manager/build config.
- Keep NO_PROXY narrow and enforce direct-egress prevention at the network layer.
- Do not enable TLS inspection without explicit governance approval.
```

---

## 24. References

- IETF RFC 9110, “HTTP Semantics,” including CONNECT and intermediary behavior.
- IETF RFC 7239, “Forwarded HTTP Extension.”
- MDN Web Docs, “Proxy server” and “Proxy servers and tunneling.”
- Squid, Envoy, HAProxy, NGINX, service mesh, and secure web gateway documentation where applicable.
- OWASP guidance for SSRF, data leakage, security misconfiguration, logging, and access control.
- Enterprise security standards for egress control, audit logging, TLS interception, and data loss prevention.
