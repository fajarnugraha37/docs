# Strict General Standards: OWASP

> File: `strict-general-standards__owasp.md`  
> Category: General Engineering Standard  
> Principle: OWASP-aligned application, API, and software security baseline  
> Status: Mandatory for LLM-assisted architecture design, implementation, refactoring, review, testing, and documentation

---

## 1. Purpose

This standard defines how an LLM code agent MUST use OWASP guidance when designing, implementing, modifying, reviewing, and documenting software.

The goal is to prevent the LLM from treating security as an optional late-stage checklist. OWASP guidance MUST be used as a baseline for secure engineering decisions, especially for web applications, APIs, microservices, identity flows, data handling, dependency management, and operational logging.

This standard applies to:

- web applications;
- backend APIs;
- public APIs;
- internal APIs;
- microservices;
- API gateways;
- authentication and authorization flows;
- browser-facing code;
- background jobs;
- event-driven services;
- admin portals;
- data import/export flows;
- file upload/download flows;
- CI/CD pipelines;
- infrastructure and deployment configuration;
- LLM-generated code, tests, documentation, and migration scripts.

This standard MUST be read together with:

- `strict-general-standards__security_design.md`;
- `strict-general-standards__restfull_api.md`;
- `strict-general-standards__open_api.md`;
- `strict-general-standards__web.md`;
- `strict-general-standards__http_for_web.md`;
- `strict-general-standards__microservices_pattern.md`;
- `strict-general-standards__microservices_anti_pattern.md`;
- `strict-general-standards__api_gateway.md`;
- `strict-general-standards__nginx.md`;
- `strict-general-standards__kong.md`.

---

## 2. Source Baseline

The LLM MUST align security work with the following OWASP references:

- OWASP Top 10 Web Application Security Risks.
- OWASP API Security Top 10.
- OWASP Application Security Verification Standard, also called ASVS.
- OWASP Cheat Sheet Series.
- OWASP Testing Guide.
- OWASP Web Security Testing Guide.
- OWASP Software Assurance Maturity Model, also called SAMM, when process maturity is relevant.
- OWASP Dependency-Check or equivalent dependency vulnerability scanning guidance.
- OWASP Threat Modeling guidance.
- OWASP Attack Surface Analysis guidance.

The LLM MUST prefer current OWASP material when available. As of June 2026, the current OWASP Web Top 10 release is 2025, the current OWASP API Security Top 10 release is 2023, and OWASP ASVS 5.0.0 has been released.

The LLM MUST NOT rely on older OWASP Top 10 names or numbering when creating new standards, unless the user or organization explicitly requires backward mapping to an older version.

---

## 3. Core Interpretation

### 3.1 OWASP is a baseline, not a complete security program

The LLM MUST treat OWASP guidance as a practical baseline for common application and API risks.

OWASP guidance MUST NOT be interpreted as:

- proof that a system is secure;
- a complete compliance framework;
- a substitute for threat modeling;
- a substitute for security architecture review;
- a substitute for penetration testing;
- a substitute for secure SDLC;
- a substitute for legal, privacy, or regulatory review.

A system can pass an OWASP checklist and still be insecure if the architecture, data flow, trust boundaries, operational controls, or business authorization model are wrong.

### 3.2 OWASP categories must become engineering controls

The LLM MUST translate every relevant OWASP risk into implementation-level controls.

Bad:

```text
This endpoint follows OWASP.
```

Good:

```text
This endpoint enforces object-level authorization using server-side ownership checks before loading the target aggregate. The request body is allowlisted. The response excludes unauthorized fields. Failed authorization is logged without exposing resource existence.
```

### 3.3 Security must be designed before coding

Before generating or changing code that affects security, the LLM MUST identify:

- protected assets;
- actors;
- trust boundaries;
- authentication assumptions;
- authorization decisions;
- data classification;
- input sources;
- output sinks;
- persistence surfaces;
- external integrations;
- abuse cases;
- failure modes;
- expected logs and alerts.

If this context is missing, the LLM MUST make a conservative best-effort design and explicitly document assumptions.

### 3.4 OWASP applies to internal systems too

The LLM MUST NOT assume that an internal service, intranet portal, admin-only endpoint, private queue, or backend batch job is safe merely because it is not public.

Internal systems still require:

- authentication;
- authorization;
- input validation;
- output control;
- secret management;
- audit logging;
- dependency scanning;
- safe error handling;
- rate/resource controls;
- operational monitoring.

---

## 4. Mandatory OWASP Usage Rules

### 4.1 The LLM MUST identify applicable OWASP domains

For every non-trivial implementation or design task, the LLM MUST classify which OWASP domains apply.

| Context                     | Minimum OWASP reference                                            |
| --------------------------- | ------------------------------------------------------------------ |
| Web application             | OWASP Top 10, ASVS, Cheat Sheets                                   |
| API                         | OWASP API Security Top 10, ASVS, REST Security Cheat Sheet         |
| Authentication              | ASVS, Authentication Cheat Sheet, Session Management Cheat Sheet   |
| Authorization               | ASVS, Authorization Cheat Sheet, Access Control guidance           |
| File upload                 | File Upload Cheat Sheet                                            |
| SSRF risk                   | SSRF Prevention Cheat Sheet                                        |
| XSS risk                    | XSS Prevention Cheat Sheet                                         |
| SQL/NoSQL query             | Injection Prevention guidance, Query Parameterization Cheat Sheets |
| Secrets                     | Secrets Management guidance                                        |
| Logging                     | Logging Cheat Sheet                                                |
| Dependency changes          | Dependency vulnerability guidance, SBOM and supply chain controls  |
| Cloud/infrastructure config | Security Misconfiguration and secure configuration guidance        |
| API gateway                 | OWASP API Security Top 10, gateway vendor hardening guidance       |

### 4.2 The LLM MUST prefer ASVS for verification depth

The LLM MUST use OWASP ASVS as the preferred detailed verification baseline.

Default verification level:

- ASVS Level 1 MAY be used for low-risk prototypes or non-sensitive internal tools.
- ASVS Level 2 SHOULD be the default for production business applications.
- ASVS Level 3 MUST be considered for high-risk systems involving regulated data, financial impact, public administration decisions, privileged administration, safety impact, or sensitive personal data.

If the requested work affects authentication, authorization, sensitive data, auditability, or external exposure, the LLM MUST NOT use the OWASP Top 10 alone as sufficient guidance.

### 4.3 The LLM MUST map OWASP risks to tests

For each relevant security control, the LLM MUST produce or recommend a matching test.

Examples:

| Risk                                | Required test evidence                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Broken object-level authorization   | user A cannot access user B object by changing ID                                                          |
| Broken function-level authorization | lower role cannot call privileged endpoint                                                                 |
| Injection                           | malicious input is treated as data, not code/query syntax                                                  |
| XSS                                 | untrusted data is context-encoded or sanitized before rendering                                            |
| CSRF                                | state-changing browser request requires valid CSRF protection or safe SameSite design                      |
| SSRF                                | server-side URL fetch rejects internal IPs, link-local addresses, metadata endpoints, and private networks |
| Mass assignment                     | forbidden fields in request body are ignored/rejected and cannot change server-owned state                 |
| Excessive data exposure             | response schema excludes sensitive fields by construction                                                  |
| Resource exhaustion                 | rate, size, pagination, timeout, and concurrency controls are tested                                       |
| Security misconfiguration           | dangerous defaults are disabled and config is validated in CI                                              |

### 4.4 The LLM MUST not downgrade security for convenience

The LLM MUST NOT generate code that uses convenience shortcuts such as:

- disabled TLS verification;
- hardcoded secrets;
- plaintext passwords;
- weak hashing;
- custom cryptography;
- broad CORS wildcard with credentials;
- disabled CSRF without alternative protection;
- `permitAll` for sensitive endpoints;
- client-side-only authorization;
- object access based only on hidden UI controls;
- direct SQL string concatenation;
- unrestricted file upload;
- unsafe deserialization;
- verbose stack traces to users;
- dependency version pinning to vulnerable packages;
- production debug endpoints without protection.

If a user explicitly asks for such behavior, the LLM MUST refuse the unsafe part and provide a safe alternative.

### 4.5 The LLM MUST mark security assumptions

If exact security context is not available, the LLM MUST document assumptions such as:

```md
Security assumptions:

- The endpoint is called by an authenticated user.
- User identity is available from a trusted server-side security context.
- Tenant ID must not be accepted from the client unless explicitly authorized.
- Object ownership must be validated in the service layer before returning data.
```

The LLM MUST NOT silently assume safe defaults when the design depends on them.

---

## 5. OWASP Web Top 10 Control Rules

The following rules map OWASP web application risks into mandatory engineering controls. The numbering may change across OWASP releases, so the LLM MUST focus on the risk concept, not only the category number.

### 5.1 Broken Access Control

The LLM MUST treat access control as server-side, deny-by-default, and object-aware.

Mandatory rules:

- Every protected endpoint MUST require authenticated identity unless explicitly public.
- Authorization MUST be checked on the server side.
- Authorization MUST be checked per object, not only per route.
- Authorization MUST be checked per action, not only per screen.
- Authorization MUST be checked per tenant when multi-tenancy exists.
- Resource IDs from the client MUST NOT be trusted as proof of access.
- UI hiding MUST NOT be treated as authorization.
- Backend services MUST not trust the gateway as the only authorization layer for domain-sensitive decisions.
- Admin functions MUST be explicitly isolated from normal user functions.
- Authorization failures SHOULD return a safe response that does not unnecessarily reveal resource existence.

Implementation pattern:

```pseudo
currentUser = securityContext.requireUser()
resource = repository.findById(request.resourceId)
policy.requireCanRead(currentUser, resource)
return mapper.toAuthorizedResponse(resource, currentUser)
```

Forbidden pattern:

```pseudo
resource = repository.findById(request.resourceId)
return resource
```

### 5.2 Security Misconfiguration

The LLM MUST make configuration explicit, minimal, and environment-aware.

Mandatory rules:

- Production debug mode MUST be disabled.
- Default credentials MUST never be accepted.
- Admin interfaces MUST not be exposed publicly without explicit hardening.
- Error pages MUST not expose stack traces, secrets, SQL, internal paths, or dependency versions.
- Security headers MUST be applied where relevant.
- Unused ports, modules, endpoints, plugins, and features MUST be disabled.
- Infrastructure config MUST be reviewed as code.
- Configuration MUST fail closed when a required secret, issuer, key, or allowlist is missing.
- Environment-specific config MUST be separated from source code.

### 5.3 Software Supply Chain Failures

The LLM MUST treat dependency changes as security-relevant.

Mandatory rules:

- Dependencies MUST be pinned or locked according to ecosystem conventions.
- New dependencies MUST be justified.
- Transitive dependency risk MUST be considered.
- Known vulnerable dependencies MUST not be introduced.
- Build plugins, CI actions, containers, and base images MUST be reviewed.
- SBOM generation SHOULD be supported for production services.
- Dependency scanning SHOULD run in CI.
- Container image scanning SHOULD run before deployment.
- Build artifacts SHOULD be reproducible and traceable.
- Internal packages MUST be sourced from trusted registries.

LLM dependency decision rule:

```text
Do not add a dependency unless it reduces risk, complexity, or maintenance burden more than the risk it introduces.
```

### 5.4 Cryptographic Failures

The LLM MUST protect sensitive data in transit and at rest.

Mandatory rules:

- Use TLS for network transport.
- Do not invent cryptographic algorithms.
- Use vetted library primitives.
- Passwords MUST be stored using password hashing algorithms appropriate for passwords, such as Argon2id, bcrypt, scrypt, or PBKDF2 where ecosystem constrained.
- Tokens, passwords, private keys, and API keys MUST not be logged.
- Sensitive data MUST be classified before storage and transmission.
- Encryption keys MUST be managed outside application source code.
- Random values for security MUST use cryptographically secure randomness.
- Sensitive temporary files MUST be protected and cleaned up.
- Data minimization MUST be preferred over encrypting unnecessary data.

### 5.5 Injection

The LLM MUST treat all external input as untrusted.

External input includes:

- HTTP parameters;
- request body fields;
- headers;
- cookies;
- uploaded files;
- queue messages;
- webhook payloads;
- CSV imports;
- database records originally sourced from users;
- environment variables from untrusted deployment paths;
- CLI arguments;
- filenames;
- URLs;
- templates;
- search expressions.

Mandatory rules:

- SQL queries MUST use parameterized queries or safe ORM binding.
- NoSQL queries MUST avoid untrusted operator injection.
- Shell commands MUST avoid concatenating untrusted input.
- LDAP, XPath, template, expression language, and OS command inputs MUST be context-safely handled.
- Input validation MUST be allowlist-based where possible.
- Output encoding MUST match the sink context.
- Sanitization MUST not be used as a universal replacement for proper encoding and parameterization.

Forbidden:

```pseudo
sql = "select * from users where email = '" + request.email + "'"
```

Required:

```pseudo
sql = "select * from users where email = ?"
params = [request.email]
```

### 5.6 Insecure Design

The LLM MUST recognize that some vulnerabilities cannot be fixed by input validation alone because the design itself is unsafe.

Mandatory rules:

- Security requirements MUST be captured before implementation.
- Abuse cases MUST be considered.
- Trust boundaries MUST be documented.
- State transitions MUST be authorization-protected.
- Business invariants MUST be enforced server-side.
- Sensitive workflows MUST be resilient to replay, race conditions, and partial failure.
- High-impact workflows MUST include audit events.
- Risky features MUST have compensating controls.

Example insecure design:

```text
A payment cancellation endpoint allows cancellation by invoice ID only, without verifying ownership, state, cut-off time, or dual approval requirement.
```

### 5.7 Authentication Failures

The LLM MUST treat authentication as a security protocol, not as a login form only.

Mandatory rules:

- Password verification MUST use secure password hashing.
- Authentication errors MUST not leak whether username or password was wrong unless intentionally allowed by policy.
- Session tokens MUST be unpredictable and protected.
- Refresh tokens MUST be rotated or otherwise protected according to risk.
- Account recovery MUST be at least as secure as login.
- MFA SHOULD be supported for privileged users.
- Authentication rate limiting MUST exist for login, OTP, password reset, and token endpoints.
- Tokens MUST have issuer, audience, expiry, and signature validation where applicable.
- Logout and session revocation semantics MUST be defined.

### 5.8 Software or Data Integrity Failures

The LLM MUST protect code, configuration, serialized data, and update channels from unauthorized modification.

Mandatory rules:

- CI/CD pipelines MUST be least-privilege.
- Deployment credentials MUST be protected.
- Artifact provenance SHOULD be recorded.
- Signed artifacts SHOULD be used for high-risk systems.
- Unsafe deserialization MUST be avoided.
- Webhook payloads MUST be authenticated.
- Plugin systems MUST restrict trusted sources.
- Migration scripts MUST be reviewed.
- Critical configuration changes MUST be auditable.

### 5.9 Security Logging and Alerting Failures

The LLM MUST design security logging intentionally.

Mandatory rules:

- Authentication events MUST be logged.
- Authorization denials SHOULD be logged with safe metadata.
- Privileged actions MUST be audited.
- Security-relevant configuration changes MUST be audited.
- Suspicious patterns SHOULD be detectable.
- Logs MUST include correlation/request IDs.
- Logs MUST not contain secrets, tokens, passwords, or sensitive personal data beyond policy.
- Audit logs MUST be tamper-resistant enough for the system risk level.
- Alerting MUST exist for high-risk events, not only passive logging.

### 5.10 Mishandling of Exceptional Conditions

The LLM MUST design safe failure behavior.

Mandatory rules:

- Exceptions MUST not leak internal implementation details to users.
- Security checks MUST fail closed.
- Partial failures MUST not bypass authorization or validation.
- Transaction failures MUST not leave privileged state inconsistent.
- Timeout handling MUST not duplicate unsafe operations without idempotency.
- Circuit breakers and retries MUST not cause retry storms.
- Fallbacks MUST not return stale sensitive data to unauthorized users.
- Error responses MUST be consistent and safe.

---

## 6. OWASP API Security Top 10 Control Rules

APIs tend to expose object identifiers, machine-readable contracts, bulk data, automation surfaces, and integrations. The LLM MUST apply API-specific controls, not only generic web controls.

### 6.1 Broken Object Level Authorization

Every API endpoint that accesses an object by ID MUST verify object-level authorization.

Required checks:

- user can access this object;
- user can perform this action;
- user can access this tenant/context;
- object is in a state that permits the action;
- delegated access is valid if acting on behalf of another party.

### 6.2 Broken Authentication

APIs MUST validate authentication tokens rigorously.

Required checks where applicable:

- issuer;
- audience;
- expiry;
- not-before time;
- signature;
- token type;
- scopes/claims;
- revocation or session state where required;
- mTLS or client credential binding for machine-to-machine high-risk traffic.

### 6.3 Broken Object Property Level Authorization

The LLM MUST separate object access from field/property access.

Mandatory rules:

- Request DTOs MUST not bind directly to persistence entities.
- Server-owned fields MUST not be client-writable.
- Sensitive response fields MUST be excluded unless explicitly authorized.
- Field-level rules MUST be tested for lower-privilege users.
- Mass assignment MUST be prevented with allowlisted request models.

Forbidden:

```pseudo
entity.updateFrom(requestBody)
```

Required:

```pseudo
command = parseAllowedFields(requestBody)
service.updateAllowedFields(currentUser, id, command)
```

### 6.4 Unrestricted Resource Consumption

APIs MUST protect CPU, memory, disk, network, database, downstream services, and third-party quotas.

Mandatory controls:

- request body size limits;
- file size limits;
- pagination limits;
- query complexity limits;
- timeout limits;
- concurrency limits;
- rate limits;
- expensive operation quotas;
- queue depth limits;
- retry budgets;
- downstream timeout and circuit breaker policies.

### 6.5 Broken Function Level Authorization

The LLM MUST protect functions, not only objects.

Mandatory rules:

- Admin endpoints MUST require admin authorization.
- Internal endpoints MUST not be publicly exposed.
- Role and permission checks MUST be server-side.
- API route groups MUST not inherit overly broad permissions.
- Function-level access MUST be tested with lower privilege users.

### 6.6 Unrestricted Access to Sensitive Business Flows

The LLM MUST protect workflows from automation abuse even when each individual request looks valid.

Examples:

- OTP attempts;
- password reset attempts;
- coupon redemption;
- booking/reservation holding;
- account creation;
- scraping;
- batch export;
- document generation;
- case status changes;
- payment attempts;
- search endpoints.

Mandatory controls:

- rate limiting;
- abuse detection;
- friction when necessary;
- idempotency;
- state machine constraints;
- audit logging;
- business-level anomaly monitoring.

### 6.7 Server-Side Request Forgery

Any feature that fetches a URL, imports a remote resource, validates a webhook URL, renders a preview, or calls user-provided destinations MUST protect against SSRF.

Mandatory rules:

- Use allowlists for destinations where possible.
- Reject private, loopback, link-local, multicast, and metadata IP ranges.
- Resolve DNS safely and defend against DNS rebinding.
- Restrict protocols.
- Enforce connect and read timeouts.
- Limit response size.
- Do not forward credentials to arbitrary destinations.
- Block cloud metadata endpoints.
- Log rejected attempts safely.

### 6.8 Security Misconfiguration

API deployments MUST not expose:

- debug endpoints;
- actuator/admin endpoints without protection;
- schema docs containing sensitive internal APIs;
- permissive CORS with credentials;
- unused HTTP methods;
- default credentials;
- stack traces;
- excessive headers revealing implementation details.

### 6.9 Improper Inventory Management

The LLM MUST treat API inventory as a security requirement.

Mandatory rules:

- Every exposed API MUST have an owner.
- Every exposed API MUST have a documented contract.
- Deprecated APIs MUST have a removal plan.
- Shadow APIs MUST not exist.
- Test/staging endpoints MUST not be exposed as production assets.
- Version and lifecycle MUST be documented.
- Gateway routes MUST map to owned services.

### 6.10 Unsafe Consumption of APIs

The LLM MUST validate data received from downstream or third-party APIs.

Mandatory rules:

- Do not trust partner responses blindly.
- Validate response shape and required fields.
- Handle timeout and partial failure safely.
- Do not deserialize untrusted payloads into dangerous types.
- Do not expose raw upstream errors to clients.
- Apply circuit breakers and retry budgets.
- Sanitize or encode data before rendering it to users.

---

## 7. Required Security Controls by Implementation Area

### 7.1 Input validation

The LLM MUST design validation at the boundary of the system.

Validation MUST cover:

- type;
- length;
- range;
- format;
- enum membership;
- cardinality;
- relationship constraints;
- state constraints;
- authorization constraints;
- business invariants.

Validation MUST NOT be confused with authorization. A valid input can still be unauthorized.

### 7.2 Output encoding

The LLM MUST encode output based on sink context.

| Sink               | Required protection                                      |
| ------------------ | -------------------------------------------------------- |
| HTML text          | HTML entity encoding                                     |
| HTML attribute     | Attribute-safe encoding and quoting                      |
| JavaScript context | Avoid inline JS; otherwise JS-safe encoding              |
| URL                | URL encoding by component                                |
| CSS                | Avoid dynamic CSS; otherwise CSS-safe handling           |
| SQL                | Parameterization, not output encoding                    |
| Shell              | Avoid shell; otherwise argument-safe handling            |
| Logs               | Structured safe logging, not raw injection-prone strings |

### 7.3 Authentication

The LLM MUST implement authentication using platform or framework-standard mechanisms where possible.

Mandatory rules:

- Do not store plaintext passwords.
- Do not log credentials.
- Do not return secrets in API responses.
- Do not invent token formats.
- Do not skip token validation in development code that might reach production.
- Do not accept unsigned JWTs.
- Do not validate JWTs without checking issuer and audience when those claims are expected.
- Do not implement custom SSO protocols when standard OIDC/SAML integration is available.

### 7.4 Authorization

The LLM MUST put authorization close to the protected action.

Mandatory rules:

- Route-level authorization is not enough for object-specific access.
- Service-level authorization SHOULD enforce domain-sensitive decisions.
- Repository-level filters MAY support but MUST NOT replace explicit authorization decisions.
- Policy code MUST be testable.
- Authorization failures MUST be observable.
- Privileged bypasses MUST be explicit, reviewed, and audited.

### 7.5 Session management

For browser sessions, the LLM MUST use secure cookie settings:

- `HttpOnly` for session cookies;
- `Secure` in HTTPS environments;
- appropriate `SameSite` value;
- short enough lifetime for risk level;
- server-side revocation support for high-risk sessions;
- CSRF protection for state-changing requests when cookie-based authentication is used.

### 7.6 CORS

The LLM MUST treat CORS as browser access control, not API authentication.

Mandatory rules:

- Do not use `Access-Control-Allow-Origin: *` with credentials.
- Use explicit allowed origins for credentialed requests.
- Restrict methods and headers to what is needed.
- Do not treat CORS as protection against non-browser clients.
- Preflight caching MUST not hide policy changes indefinitely.

### 7.7 CSRF

For browser-authenticated state-changing endpoints, the LLM MUST implement CSRF protection unless an explicitly safe alternative exists.

Acceptable controls may include:

- synchronizer token;
- signed double-submit cookie;
- same-site cookie strategy with careful method/origin controls;
- explicit origin/referrer validation as defense-in-depth;
- token-based authorization in non-cookie clients.

### 7.8 File upload

File upload flows MUST be treated as high-risk.

Mandatory controls:

- authentication and authorization;
- file size limits;
- content type verification;
- extension allowlist;
- malware scanning when appropriate;
- random server-side filenames;
- storage outside webroot or safe object storage;
- no execution permission;
- safe download headers;
- metadata stripping when required;
- audit logging for sensitive uploads.

### 7.9 File download and export

File download/export flows MUST protect confidentiality and resource usage.

Mandatory controls:

- object-level authorization;
- export size limits;
- asynchronous processing for large exports;
- expiring signed links where appropriate;
- audit logs;
- safe filenames;
- `Content-Disposition` handling;
- no path traversal;
- redaction rules for sensitive fields.

### 7.10 Logging and audit

The LLM MUST distinguish application logs from audit logs.

Application logs answer:

```text
What happened technically?
```

Audit logs answer:

```text
Who did what, to which protected resource, when, from where, and with what outcome?
```

Security-relevant events MUST include enough metadata for investigation without exposing secrets.

### 7.11 Secrets management

The LLM MUST never hardcode secrets.

Secrets include:

- passwords;
- API keys;
- tokens;
- private keys;
- database credentials;
- signing keys;
- encryption keys;
- webhook secrets;
- OAuth client secrets;
- SMTP credentials;
- cloud credentials.

Mandatory rules:

- Secrets MUST come from secret manager, environment, vault, or platform-specific secret injection.
- Secrets MUST not be committed.
- Secrets MUST not be logged.
- Secrets MUST be rotatable.
- Secret absence MUST fail closed.
- Example values MUST be fake and clearly marked as examples.

### 7.12 Dependency and build security

The LLM MUST treat generated build files as part of the attack surface.

Mandatory rules:

- Avoid unnecessary dependencies.
- Prefer well-maintained libraries.
- Pin versions according to ecosystem norms.
- Do not disable integrity checks.
- Do not use curl-pipe-shell installation in production scripts unless strongly justified and verified.
- Avoid running builds as root.
- Separate build-time and runtime dependencies.
- Use minimal runtime images.
- Generate SBOMs where required.

---

## 8. LLM-Specific Security Rules

### 8.1 The LLM MUST not create fake security

The LLM MUST NOT create code that appears secure but is ineffective.

Examples of fake security:

```pseudo
if request.role == "admin" then allow
```

```pseudo
if request.userId == path.userId then allow
```

```pseudo
if frontendButtonHidden then assume user cannot perform action
```

```pseudo
if token exists then authenticated
```

```pseudo
if file extension is .jpg then safe image
```

### 8.2 The LLM MUST not leave security TODOs in critical paths

Forbidden:

```java
// TODO: add authorization later
```

```typescript
// temporary: disable TLS verification
```

```yaml
# TODO restrict CORS before prod
```

If implementation cannot complete the control, the LLM MUST fail closed or clearly block release.

### 8.3 The LLM MUST not use mock security in production-like code

Mock users, fake roles, disabled filters, test tokens, and dummy identity providers MUST be limited to tests or local development with explicit safeguards.

Mandatory safeguards:

- test-only package or profile;
- cannot run in production profile;
- visible warning;
- CI check when possible;
- no default admin backdoor.

### 8.4 The LLM MUST explain security trade-offs

When choosing a security design, the LLM MUST explain:

- what asset is protected;
- what threat is reduced;
- what residual risk remains;
- what assumptions are required;
- what operational control is needed.

### 8.5 The LLM MUST refuse unsafe weakening requests

The LLM MUST refuse requests to:

- bypass authentication;
- bypass authorization;
- exfiltrate secrets;
- disable TLS verification in production;
- weaken password hashing;
- hardcode real credentials;
- make exploit payloads for unauthorized use;
- hide malicious behavior;
- create backdoors;
- bypass audit logs;
- evade detection.

The LLM MAY provide safe alternatives such as local test-only mocks, secure debugging, or defensive verification guidance.

---

## 9. Secure Review Checklist

Before finalizing code or design, the LLM MUST check:

### 9.1 Identity and access

- [ ] Is every protected endpoint authenticated?
- [ ] Is authorization enforced server-side?
- [ ] Are object-level checks present?
- [ ] Are function-level checks present?
- [ ] Are tenant boundaries enforced?
- [ ] Are privileged actions audited?
- [ ] Are policy checks tested?

### 9.2 Data protection

- [ ] Is sensitive data classified?
- [ ] Is sensitive data minimized?
- [ ] Is sensitive data encrypted in transit?
- [ ] Is sensitive data encrypted at rest when required?
- [ ] Are secrets excluded from code, logs, and responses?
- [ ] Are exports/downloads authorized and audited?

### 9.3 Input/output safety

- [ ] Is input validated at boundaries?
- [ ] Are SQL/NoSQL queries parameterized?
- [ ] Are shell/template/expression sinks protected?
- [ ] Is output encoded for the correct context?
- [ ] Is file upload restricted?
- [ ] Is SSRF prevented where remote fetch exists?

### 9.4 API safety

- [ ] Are request bodies allowlisted?
- [ ] Are response fields minimized?
- [ ] Are pagination and size limits enforced?
- [ ] Are rate limits applied to sensitive flows?
- [ ] Are idempotency and replay risks handled?
- [ ] Is OpenAPI aligned with implementation?

### 9.5 Operational security

- [ ] Are errors safe?
- [ ] Are security events logged?
- [ ] Are alerts defined for high-risk events?
- [ ] Are dependencies scanned?
- [ ] Are containers/base images scanned?
- [ ] Is production debug disabled?
- [ ] Are admin endpoints protected?

---

## 10. Required Security Test Categories

The LLM MUST recommend or generate tests for:

- authentication required;
- invalid authentication rejected;
- expired token rejected;
- wrong issuer/audience rejected;
- role-based function access;
- object-level access control;
- tenant isolation;
- mass assignment rejection;
- sensitive field exclusion;
- injection attempts;
- XSS output behavior;
- CSRF behavior;
- CORS behavior;
- SSRF rejection;
- upload limits;
- file type restrictions;
- rate limiting;
- request size limits;
- safe error responses;
- audit log creation;
- dependency/security scan gates where applicable.

---

## 11. Anti-Patterns

The LLM MUST reject these patterns:

### 11.1 OWASP name-dropping

Claiming OWASP compliance without mapping risks to concrete controls.

### 11.2 Top-10-only security

Using the OWASP Top 10 as the only security requirement for a production system.

### 11.3 Gateway-only security

Putting all access control in the gateway and leaving backend services unprotected.

### 11.4 UI-only authorization

Hiding buttons or routes in the frontend without backend enforcement.

### 11.5 Entity binding from request body

Binding untrusted request bodies directly into persistence entities.

### 11.6 Wildcard CORS with credentials

Allowing credentialed browser requests from arbitrary origins.

### 11.7 Password hashing with general-purpose hashes

Using MD5, SHA-1, SHA-256, or SHA-512 directly for password storage.

### 11.8 Disabled TLS verification

Skipping certificate validation in production code.

### 11.9 Raw upstream error exposure

Returning stack traces, SQL errors, dependency errors, or internal service details to clients.

### 11.10 Secret in code

Embedding credentials in source code, config files, tests, examples, Dockerfiles, scripts, or documentation.

### 11.11 Security TODO in production path

Leaving security-critical behavior incomplete.

### 11.12 Rate limit after incident only

Adding resource protection only after abuse occurs instead of designing it up front.

### 11.13 Logging everything

Dumping request bodies, tokens, cookies, secrets, or personal data into logs.

### 11.14 Vulnerability scanner as security design

Assuming SAST/DAST/dependency scanning replaces secure architecture and code review.

---

## 12. Required Output When LLM Produces Security-Relevant Code

When the LLM generates security-relevant implementation, it SHOULD include:

```md
Security notes:

- Authentication: ...
- Authorization: ...
- Input validation: ...
- Output/data exposure: ...
- Error handling: ...
- Logging/audit: ...
- Rate/resource control: ...
- Relevant OWASP risks: ...
- Residual assumptions: ...
```

For high-risk changes, it MUST include this section.

---

## 13. Decision Algorithm

Before writing or modifying code, the LLM MUST run this decision process:

```text
1. Is the code reachable by a user, client, integration, job, queue, or file input?
   - If yes, identify input boundary and authentication assumption.

2. Does it access, change, export, or delete protected data?
   - If yes, define object-level and function-level authorization.

3. Does it parse or execute user-controlled content?
   - If yes, add validation, encoding, and injection controls.

4. Does it call a URL, third-party API, webhook, or internal network location?
   - If yes, evaluate SSRF, timeout, retry, and trust assumptions.

5. Does it store or transmit sensitive data?
   - If yes, classify data, minimize exposure, and protect secrets/keys.

6. Does it add a dependency, container, build plugin, or CI action?
   - If yes, evaluate supply chain risk.

7. Does it affect authentication, authorization, audit, logging, crypto, or config?
   - If yes, require tests and explicit security notes.
```

If any answer is unknown, the LLM MUST assume the safer path and document the assumption.

---

## 14. Acceptance Criteria

A change satisfies this standard only if:

- relevant OWASP risk domains are identified;
- authentication and authorization are explicit;
- object-level authorization is implemented where object IDs are accepted;
- function-level authorization is implemented for privileged actions;
- request models are allowlisted;
- sensitive response fields are intentionally selected;
- inputs are validated;
- dangerous sinks are protected;
- secrets are not hardcoded;
- security-relevant failures are safe;
- logs are useful but do not leak secrets;
- security tests exist or are explicitly recommended;
- residual assumptions are documented;
- no known OWASP anti-pattern is introduced.

---

## 15. Enforcement Snippet for LLM Code Agents

Use this snippet in coding-agent instructions:

```md
When implementing or changing code, apply OWASP-aligned security controls by default.
Do not merely mention OWASP. Translate applicable OWASP risks into concrete controls, tests, and safe failure behavior.
For every endpoint or entry point, identify authentication, authorization, input validation, output exposure, resource limits, error handling, logging, and relevant abuse cases.
Never generate production code with disabled TLS verification, hardcoded secrets, client-side-only authorization, direct query concatenation, wildcard credentialed CORS, unsafe deserialization, unrestricted file upload, or security TODOs in critical paths.
If security context is incomplete, choose the safer design and document assumptions.
```

---

## 16. References

- OWASP Top 10 Web Application Security Risks: https://owasp.org/www-project-top-ten/
- OWASP Top 10:2025: https://owasp.org/Top10/2025/en/
- OWASP API Security Top 10 2023: https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- OWASP API Security Project: https://owasp.org/www-project-api-security/
- OWASP Application Security Verification Standard: https://owasp.org/www-project-application-security-verification-standard/
- OWASP Cheat Sheet Series: https://cheatsheetseries.owasp.org/
- OWASP REST Security Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html
- OWASP Authentication Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- OWASP Threat Modeling Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html
- OWASP Broken Access Control: https://owasp.org/www-community/Broken_Access_Control
