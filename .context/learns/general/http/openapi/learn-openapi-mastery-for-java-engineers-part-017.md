# OpenAPI Mastery for Java Engineers — Part 017
# Security Schemes: Auth Modelling, OAuth2, JWT, API Keys, and Authorization Boundaries

> Filename: `learn-openapi-mastery-for-java-engineers-part-017.md`  
> Series: `learn-openapi-mastery-for-java-engineers`  
> Part: `017 / 030`  
> Previous: `Part 016 — Examples, Samples, Mocks, and Documentation as Executable Understanding`  
> Next: `Part 018 — Pagination, Filtering, Sorting, Search, and Bulk Operations`

---

## 0. Why This Part Matters

Security documentation in OpenAPI is deceptively easy.

You can add this:

```yaml
security:
  - bearerAuth: []

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
```

Then Swagger UI shows a nice **Authorize** button.

A beginner may think:

> “Great, our API security is documented.”

A stronger engineer asks:

> “What exactly did we document? Authentication? Authorization? Token type? Scope? Role? Object-level access? Tenant isolation? Case-level permission? Data classification? Operational policy? Enforcement? Or just the existence of an `Authorization` header?”

That distinction matters.

OpenAPI can describe **how a request authenticates** and which declared security schemes/scopes are required for an operation. It does not fully prove the API is secure. It does not automatically describe row-level authorization, case ownership, tenant boundary checks, policy decisions, entitlement resolution, redaction rules, or regulatory access constraints.

This part teaches how to use OpenAPI security modelling precisely without overclaiming what the contract can guarantee.

---

## 1. Learning Objectives

By the end of this part, you should be able to:

1. Understand what OpenAPI can and cannot express about API security.
2. Model API keys, HTTP authentication, bearer tokens, JWTs, OAuth2, and OpenID Connect correctly.
3. Understand `Security Scheme Object` and `Security Requirement Object` deeply.
4. Distinguish authentication, authorization, scopes, roles, entitlements, and object-level permission.
5. Apply global security and operation-level overrides safely.
6. Document public endpoints, optionally authenticated endpoints, and multi-scheme endpoints.
7. Avoid leaking secrets or misleading security claims in examples.
8. Integrate OpenAPI security declarations with Java/Spring Security architecture.
9. Design security contracts for regulated/high-risk APIs where authorization semantics must be explicit.
10. Build review checklists and governance rules for OpenAPI security.

---

## 2. Baseline: What OpenAPI Security Actually Models

OpenAPI has a `security` field at the root level and at the operation level.

At the root level:

```yaml
security:
  - bearerAuth: []
```

At the operation level:

```yaml
paths:
  /cases/{caseId}:
    get:
      security:
        - bearerAuth:
            - cases:read
```

OpenAPI also defines reusable security schemes under `components.securitySchemes`:

```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
```

Conceptually:

- `securitySchemes` defines **available authentication/security mechanisms**.
- `security` defines **which mechanisms are required**.
- Operation-level `security` can override root-level `security`.
- OAuth2/OpenID Connect security requirements may include scopes.
- Non-OAuth2 security requirements normally use an empty array.

Important: the official OpenAPI Specification describes security requirements as alternative requirement objects. Only one security requirement object in the list must be satisfied. Operation-level security can override the root declaration.

That means this:

```yaml
security:
  - bearerAuth: []
  - apiKeyAuth: []
```

means:

> request may satisfy `bearerAuth` OR `apiKeyAuth`.

Not both.

This means both are required:

```yaml
security:
  - bearerAuth: []
    apiKeyAuth: []
```

That subtle difference is one of the most common OpenAPI security mistakes.

---

## 3. Authentication vs Authorization vs Permission Semantics

Before writing security schemes, separate these concepts.

### 3.1 Authentication

Authentication answers:

> “Who or what is making this request?”

Examples:

- user token,
- service account token,
- API key,
- mTLS client certificate,
- session cookie,
- signed request.

OpenAPI can usually describe the **mechanism**.

Example:

```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
```

This says:

> This API accepts HTTP bearer authentication, and the bearer token is expected to be JWT-shaped.

It does not say:

- who issued the token,
- what claims are mandatory,
- how audience is checked,
- how tenant is resolved,
- how expiration is validated,
- what roles are mapped,
- whether user is allowed to access a specific object.

Those need additional documentation, extensions, external docs, or implementation policy.

### 3.2 Authorization

Authorization answers:

> “Is this authenticated subject allowed to perform this action?”

Examples:

- can this user read this case?
- can this investigator upload evidence?
- can this supervisor approve enforcement action?
- can this integration client call a bulk export endpoint?
- can this user see redacted vs unredacted fields?

OpenAPI can partially document this with OAuth scopes:

```yaml
security:
  - oauth2:
      - cases:read
      - evidence:read
```

But scopes are often only coarse-grained permissions.

They may not express:

- tenant membership,
- case assignment,
- region restriction,
- subject conflict of interest,
- investigation confidentiality level,
- object ownership,
- time-bound access,
- purpose-based access,
- field-level redaction.

### 3.3 Authentication is Not Authorization

This is valid OpenAPI:

```yaml
security:
  - bearerAuth: []
```

But it only says:

> request needs a bearer token.

It does not say:

> bearer token holder is allowed to access this resource.

A production API needs both:

1. authentication check,
2. authorization policy check,
3. object-level check,
4. possibly field-level redaction.

OpenAPI documents the first part well, the second part partially, and the third/fourth only through conventions, descriptions, extensions, or external policy references.

---

## 4. Security Scheme Object Mental Model

Security schemes live here:

```yaml
components:
  securitySchemes:
    <schemeName>:
      type: ...
```

Supported scheme categories include:

1. `apiKey`
2. `http`
3. `mutualTLS`
4. `oauth2`
5. `openIdConnect`

Each scheme is a reusable definition.

Think of it as:

> “This is a way a client may authenticate or present security credentials to the API.”

Not:

> “This operation is protected.”

Protection is declared with `security`.

Example:

```yaml
openapi: 3.2.0
info:
  title: Case Management API
  version: 1.0.0

paths:
  /cases:
    get:
      operationId: listCases
      security:
        - bearerAuth:
            - cases:read
      responses:
        '200':
          description: Cases visible to the authenticated principal.

components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
```

Here:

- `bearerAuth` defines the mechanism.
- `security` says `listCases` requires that mechanism.
- `cases:read` expresses a scope-like authorization requirement only if the scheme supports scopes, usually OAuth2/OpenID Connect.

For plain HTTP bearer schemes not declared as OAuth2/OpenID Connect, tools may not interpret scopes semantically. Be careful.

---

## 5. Security Requirement Object: OR vs AND Semantics

This is the most important syntax rule.

### 5.1 OR Semantics

A list of security requirement objects means alternatives.

```yaml
security:
  - bearerAuth: []
  - apiKeyAuth: []
```

Meaning:

```text
bearerAuth OR apiKeyAuth
```

A client can use either one.

### 5.2 AND Semantics

Multiple schemes in the same object mean all are required.

```yaml
security:
  - bearerAuth: []
    apiKeyAuth: []
```

Meaning:

```text
bearerAuth AND apiKeyAuth
```

A request must provide both.

### 5.3 Mixed OR-of-ANDs

```yaml
security:
  - bearerAuth: []
    mTLS: []
  - apiKeyAuth: []
```

Meaning:

```text
(bearerAuth AND mTLS) OR apiKeyAuth
```

This is useful for APIs where:

- internal service clients use mTLS + bearer token,
- external partner clients use API key,
- migration periods support two mechanisms.

But use this carefully. Complex security alternatives can confuse documentation readers and generated clients.

---

## 6. Global Security vs Operation-Level Security

### 6.1 Global Security

Global security applies to all operations unless overridden.

```yaml
security:
  - bearerAuth: []
```

This is good when almost every endpoint requires the same security mechanism.

### 6.2 Operation-Level Override

An operation can override root security.

```yaml
paths:
  /health:
    get:
      operationId: healthCheck
      security: []
      responses:
        '200':
          description: Service health.
```

`security: []` means:

> no security requirement for this operation.

Use this explicitly for public endpoints.

### 6.3 Public Endpoint Anti-Pattern

Bad:

```yaml
security:
  - bearerAuth: []

paths:
  /public/status:
    get:
      responses:
        '200':
          description: Public status.
```

If `/public/status` is intended to be public, the contract is misleading because it inherits global `bearerAuth`.

Better:

```yaml
paths:
  /public/status:
    get:
      operationId: getPublicStatus
      security: []
      responses:
        '200':
          description: Public status.
```

### 6.4 Optional Authentication

Some endpoints behave differently when authenticated but still allow anonymous access.

Example:

```yaml
paths:
  /announcements:
    get:
      operationId: listAnnouncements
      security:
        - {}
        - bearerAuth: []
      responses:
        '200':
          description: Public announcements. Authenticated callers may receive additional personalized metadata.
```

This means:

```text
anonymous OR bearerAuth
```

Use this sparingly. Optional authentication must be described clearly because it changes response semantics.

---

## 7. API Key Security

API keys are simple to model but often misunderstood.

### 7.1 Header API Key

```yaml
components:
  securitySchemes:
    partnerApiKey:
      type: apiKey
      in: header
      name: X-API-Key
```

Used by operation:

```yaml
security:
  - partnerApiKey: []
```

### 7.2 Query API Key

```yaml
components:
  securitySchemes:
    queryApiKey:
      type: apiKey
      in: query
      name: api_key
```

Avoid query API keys unless forced by legacy constraints.

Why?

- Query strings often appear in logs.
- They may be stored in browser history.
- They may be leaked through referrers.
- They are harder to handle safely across proxies and analytics.

### 7.3 Cookie API Key

```yaml
components:
  securitySchemes:
    sessionCookie:
      type: apiKey
      in: cookie
      name: SESSION
```

This may represent a session cookie, but be careful: cookie security properties such as `HttpOnly`, `Secure`, `SameSite`, rotation, CSRF protection, and domain scoping are not fully captured by the OpenAPI security scheme.

Document those separately.

### 7.4 API Key Does Not Identify User Semantics by Itself

An API key can represent:

- an application,
- a partner organization,
- an environment,
- a service account,
- a tenant,
- a billing plan,
- a legacy user credential.

OpenAPI only describes where the key is sent.

You should document meaning explicitly:

```yaml
components:
  securitySchemes:
    partnerApiKey:
      type: apiKey
      in: header
      name: X-Partner-API-Key
      description: >
        Identifies the partner integration client. The key does not represent an end-user.
        End-user identity, where applicable, must be provided using the X-Acting-User-Id header
        and is subject to partner entitlement validation.
```

### 7.5 API Key + Bearer Token

Some systems require both:

- API key identifies partner application,
- bearer token identifies user or service principal.

```yaml
security:
  - partnerApiKey: []
    bearerAuth: []
```

Meaning:

```text
partnerApiKey AND bearerAuth
```

Use this only if both are truly required.

---

## 8. HTTP Authentication Schemes

OpenAPI supports HTTP authentication through:

```yaml
components:
  securitySchemes:
    basicAuth:
      type: http
      scheme: basic
```

or:

```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
```

The `scheme` value follows HTTP authentication scheme names.

### 8.1 Basic Authentication

```yaml
components:
  securitySchemes:
    basicAuth:
      type: http
      scheme: basic
```

Basic auth may be acceptable for:

- internal tooling over TLS,
- legacy admin endpoint,
- short-lived transitional integration,
- local/dev environments.

But for modern production APIs, basic auth is usually inferior to token-based mechanisms.

Document constraints if used:

```yaml
description: >
  Basic authentication is supported only for legacy batch clients.
  Credentials must be sent over TLS and are scheduled for deprecation.
```

### 8.2 Bearer Authentication

```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
```

`bearerFormat: JWT` is a hint for documentation. It does not enforce JWT validation.

It does not define:

- issuer,
- audience,
- accepted algorithms,
- required claims,
- token lifetime,
- JWKS endpoint,
- replay protection,
- revocation semantics.

For production-grade contracts, add description or external docs:

```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: >
        OAuth2 bearer token issued by the organization identity provider.
        Tokens must contain `iss`, `sub`, `aud`, `exp`, `iat`, and `scope` claims.
        The API validates issuer, audience, signature, expiration, and required scopes.
```

### 8.3 Bearer Token Is Not Always JWT

A bearer token can be opaque.

For opaque tokens:

```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      description: >
        Opaque bearer token. The API validates the token through token introspection.
```

Do not write `bearerFormat: JWT` unless the token is actually a JWT or JWT-like artifact.

---

## 9. JWT Modelling: What OpenAPI Can and Cannot Say

JWT is common in Java/Spring APIs, but OpenAPI only has lightweight support for it.

```yaml
components:
  securitySchemes:
    bearerJwt:
      type: http
      scheme: bearer
      bearerFormat: JWT
```

This tells clients:

> send `Authorization: Bearer <token>`, where token is expected to be JWT.

It does not describe the JWT schema.

A production API may need to document:

- accepted issuers,
- accepted audiences,
- required claims,
- claim-to-authority mapping,
- scope claim format,
- tenant claim,
- region claim,
- subject identifier semantics,
- token expiry rules,
- clock skew tolerance,
- signing algorithm policy,
- JWKS rotation,
- revocation/introspection behavior.

Example:

```yaml
components:
  securitySchemes:
    bearerJwt:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: >
        JWT bearer token issued by the identity provider. The API requires:
        - `iss` to match the configured issuer
        - `aud` to include `case-management-api`
        - `exp` to be in the future
        - `scope` or `scp` to contain operation-specific scopes
        - `tenant_id` for tenant-scoped requests
```

Better with external docs:

```yaml
externalDocs:
  description: Token claim contract and authorization policy
  url: https://docs.example.com/security/token-claims
```

### 9.1 Do Not Put Real Tokens in Examples

Bad:

```yaml
example: eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.real.payload.signature
```

Better:

```yaml
example: Bearer <access-token>
```

Or:

```yaml
example: Bearer eyJhbGciOiJ...<redacted>
```

Even fake JWT-looking examples can create confusion if copied into tests or logs.

---

## 10. OAuth2 Security Schemes

OAuth2 is modelled with:

```yaml
components:
  securitySchemes:
    oauth2:
      type: oauth2
      flows:
        authorizationCode:
          authorizationUrl: https://id.example.com/oauth2/authorize
          tokenUrl: https://id.example.com/oauth2/token
          scopes:
            cases:read: Read cases visible to the authenticated principal.
            cases:write: Create and modify cases.
```

OpenAPI supports OAuth2 flow definitions.

Common flows:

1. authorization code,
2. client credentials,
3. implicit,
4. password.

Modern systems should strongly prefer authorization code with PKCE for user-facing clients and client credentials for machine-to-machine clients. The implicit and password flows are legacy-sensitive and should generally be avoided for new designs.

### 10.1 Authorization Code Flow

Used when a user authorizes a client application.

```yaml
components:
  securitySchemes:
    userOAuth:
      type: oauth2
      description: OAuth2 authorization code flow for user-facing applications.
      flows:
        authorizationCode:
          authorizationUrl: https://id.example.com/oauth2/authorize
          tokenUrl: https://id.example.com/oauth2/token
          scopes:
            cases:read: Read cases assigned or visible to the authenticated user.
            cases:write: Create and update cases where the user has write permission.
            evidence:upload: Upload evidence to cases where the user has contributor permission.
```

Used by operation:

```yaml
paths:
  /cases/{caseId}:
    get:
      operationId: getCase
      security:
        - userOAuth:
            - cases:read
```

### 10.2 Client Credentials Flow

Used for machine-to-machine access.

```yaml
components:
  securitySchemes:
    serviceOAuth:
      type: oauth2
      description: OAuth2 client credentials flow for trusted service integrations.
      flows:
        clientCredentials:
          tokenUrl: https://id.example.com/oauth2/token
          scopes:
            case-events:publish: Publish case lifecycle events.
            case-export:read: Export case data under approved data-sharing agreement.
```

Good for:

- backend service integration,
- scheduled batch jobs,
- partner system integration,
- machine identities.

Not suitable when you need end-user delegated authorization unless additional delegation context is provided.

### 10.3 Implicit Flow

```yaml
components:
  securitySchemes:
    legacyImplicitOAuth:
      type: oauth2
      description: Legacy implicit flow. New clients must not use this scheme.
      flows:
        implicit:
          authorizationUrl: https://id.example.com/oauth2/authorize
          scopes:
            cases:read: Read cases.
```

For new systems, avoid implicit flow unless you have a strong legacy reason.

### 10.4 Password Flow

```yaml
components:
  securitySchemes:
    legacyPasswordOAuth:
      type: oauth2
      description: Legacy password flow. Not allowed for new clients.
      flows:
        password:
          tokenUrl: https://id.example.com/oauth2/token
          scopes:
            cases:read: Read cases.
```

Avoid for new APIs. It requires clients to handle user credentials directly, which is usually unacceptable.

### 10.5 Multiple OAuth2 Schemes

Sometimes you should define separate schemes for separate trust contexts:

```yaml
components:
  securitySchemes:
    userOAuth:
      type: oauth2
      flows:
        authorizationCode:
          authorizationUrl: https://id.example.com/oauth2/authorize
          tokenUrl: https://id.example.com/oauth2/token
          scopes:
            cases:read: Read cases as a user.

    serviceOAuth:
      type: oauth2
      flows:
        clientCredentials:
          tokenUrl: https://id.example.com/oauth2/token
          scopes:
            case-export:read: Export cases as a service integration.
```

This is better than pretending all tokens are semantically identical.

---

## 11. OpenID Connect Security Scheme

OpenID Connect can be modelled with:

```yaml
components:
  securitySchemes:
    oidc:
      type: openIdConnect
      openIdConnectUrl: https://id.example.com/.well-known/openid-configuration
```

This points clients to the OpenID Connect discovery document.

OpenID Connect discovery allows relying parties to discover provider metadata including OAuth2 endpoint locations. This is useful when the identity provider publishes standard metadata.

Example operation:

```yaml
paths:
  /me:
    get:
      operationId: getCurrentUserProfile
      security:
        - oidc:
            - openid
            - profile
      responses:
        '200':
          description: Current authenticated user profile.
```

### 11.1 OIDC vs OAuth2 in OpenAPI

Use `openIdConnect` when:

- you rely on an OIDC provider,
- discovery metadata is available,
- clients should discover authorization/token/JWKS/userinfo endpoints,
- identity claims matter.

Use `oauth2` when:

- you want explicit OAuth2 flow URLs in the spec,
- you are modelling authorization rather than identity discovery,
- the provider does not expose OIDC discovery.

In many real systems, OIDC is used for authentication identity and OAuth2 scopes are used for authorization. OpenAPI can point to either style, but you must document semantics carefully.

---

## 12. Scopes: Useful, But Often Overloaded

OAuth2/OpenID Connect scopes are commonly used in OpenAPI operation security:

```yaml
security:
  - userOAuth:
      - cases:read
      - evidence:read
```

This means the caller must satisfy the OAuth2 scheme with those scopes.

### 12.1 Scope Naming

Good scope names are stable, action-oriented, and resource-oriented:

```text
cases:read
cases:create
cases:update
evidence:upload
evidence:read
enforcement-actions:approve
case-export:read
```

Avoid vague scopes:

```text
admin
user
read
write
api
full_access
basic
```

Why?

Because vague scopes do not reveal the operation-level security intent.

### 12.2 Scope Granularity

Too coarse:

```text
api:access
```

This cannot distinguish read vs write vs approve.

Too fine:

```text
cases:read:title
cases:read:summary
cases:read:status
cases:read:assignedOfficer
cases:read:lastUpdatedAt
```

This creates operational complexity and may be better handled by entitlement or field-level policy.

A practical pattern:

- scopes for coarse API capabilities,
- roles/entitlements for business authorization,
- object-level policy for resource access,
- redaction policy for field-level visibility.

### 12.3 Scopes Are Not Roles

A role says:

> this subject has an organizational function.

A scope says:

> this token is authorized for a capability.

Examples:

```text
Role: Investigator
Scope: cases:read
Scope: evidence:upload
```

Do not use roles as scopes blindly:

```text
investigator
supervisor
admin
```

This couples token authorization to organizational structure.

### 12.4 Scopes Are Not Object-Level Authorization

A user with `cases:read` may not be able to read every case.

Better description:

```yaml
security:
  - userOAuth:
      - cases:read
responses:
  '200':
    description: >
      Returns the case if the caller has `cases:read` scope and is authorized
      for the requested case according to assignment, tenant, confidentiality,
      and disclosure policy.
  '403':
    description: Caller is authenticated but not authorized for this case.
  '404':
    description: Case not found or not visible to the caller.
```

This is more honest.

---

## 13. Modelling Public, Protected, and Partially Protected APIs

### 13.1 Fully Public Endpoint

```yaml
paths:
  /public/health:
    get:
      operationId: getPublicHealth
      security: []
      responses:
        '200':
          description: Public health status.
```

### 13.2 Protected Endpoint

```yaml
paths:
  /cases:
    post:
      operationId: createCase
      security:
        - userOAuth:
            - cases:create
      responses:
        '201':
          description: Case created.
        '401':
          description: Missing or invalid authentication.
        '403':
          description: Authenticated caller lacks required permission.
```

### 13.3 Optional Authentication Endpoint

```yaml
paths:
  /articles:
    get:
      operationId: listArticles
      security:
        - {}
        - bearerAuth: []
      responses:
        '200':
          description: >
            Returns public articles. If authenticated, the response may include
            caller-specific read status and saved flags.
```

### 13.4 Mixed Client Types

```yaml
paths:
  /partner/cases/{caseId}:
    get:
      operationId: getPartnerCase
      security:
        - partnerApiKey: []
          serviceOAuth:
            - partner-cases:read
      responses:
        '200':
          description: Partner-visible case representation.
```

This says:

> partner API key AND service OAuth scope are required.

Useful when partner identity and service authorization are separate controls.

---

## 14. Modelling Authorization Boundaries in High-Risk APIs

OpenAPI does not have a universal standard for expressing fine-grained authorization, but you can document it consistently.

For regulated/case-management APIs, each operation should answer:

1. Who may call this endpoint?
2. What high-level scope is required?
3. What object-level authorization is applied?
4. Is tenant isolation applied?
5. Are fields redacted based on permission?
6. What happens if the object exists but caller cannot see it?
7. Is the operation audit logged?
8. Is privileged access required?
9. Is delegation/acting-on-behalf-of supported?
10. Are approvals or dual control required?

Example:

```yaml
paths:
  /cases/{caseId}/evidence/{evidenceId}/download:
    get:
      operationId: downloadEvidence
      summary: Download evidence file
      description: >
        Downloads an evidence file if the caller is authorized for the case and evidence item.
        Authorization requires `evidence:read`, case visibility, evidence classification access,
        and tenant membership. Access is audit logged. Restricted evidence may be redacted or denied
        according to disclosure policy.
      security:
        - userOAuth:
            - evidence:read
      parameters:
        - name: caseId
          in: path
          required: true
          schema:
            type: string
        - name: evidenceId
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Evidence content.
        '401':
          description: Missing or invalid authentication.
        '403':
          description: Caller is authenticated but not authorized to access this evidence.
        '404':
          description: Evidence not found or not visible to caller.
```

This is not machine-complete authorization modelling, but it is much better than pretending `evidence:read` is enough.

---

## 15. 401 vs 403 vs 404 in Security Contracts

Security-sensitive APIs should be explicit about error semantics.

### 15.1 401 Unauthorized

Despite the name, `401` means authentication is missing or invalid.

Use when:

- token missing,
- token expired,
- token malformed,
- token signature invalid,
- authentication scheme not accepted.

Example:

```yaml
'401':
  description: Missing, expired, or invalid authentication credentials.
```

### 15.2 403 Forbidden

Use when:

- caller is authenticated,
- authentication is valid,
- but caller lacks permission.

Example:

```yaml
'403':
  description: Authenticated caller does not have the required scope, role, entitlement, or object-level permission.
```

### 15.3 404 Not Found for Concealment

Sometimes APIs return `404` when the object exists but is not visible to the caller.

Example:

```yaml
'404':
  description: Resource does not exist or is not visible to the authenticated caller.
```

This avoids revealing existence of sensitive resources.

But make the contract clear for authorized consumers.

### 15.4 Avoid Inconsistent Security Errors

Bad:

- sometimes unauthorized object returns 403,
- sometimes 404,
- sometimes 200 with empty body,
- sometimes 500 due to policy engine failure.

Better:

Define a standard policy:

```text
- 401: authentication missing/invalid.
- 403: caller known but lacks capability or policy permission, when revealing existence is acceptable.
- 404: resource does not exist or caller must not know whether it exists.
```

Then apply consistently.

---

## 16. Problem Details for Security Errors

Security errors should be structured, but not overly revealing.

Example using `application/problem+json`:

```yaml
components:
  schemas:
    Problem:
      type: object
      required:
        - type
        - title
        - status
      properties:
        type:
          type: string
          format: uri
        title:
          type: string
        status:
          type: integer
        detail:
          type: string
        instance:
          type: string
          format: uri
        traceId:
          type: string

  responses:
    Unauthorized:
      description: Missing or invalid authentication credentials.
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'
          examples:
            expiredToken:
              summary: Expired token
              value:
                type: https://api.example.com/problems/authentication-invalid
                title: Authentication invalid
                status: 401
                detail: The access token is missing, expired, or invalid.
                traceId: 01J7ZK4T6Y5DRM7P8QW9H3S2A1

    Forbidden:
      description: Authenticated caller lacks required permission.
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'
          examples:
            insufficientPermission:
              summary: Insufficient permission
              value:
                type: https://api.example.com/problems/permission-denied
                title: Permission denied
                status: 403
                detail: The caller is not allowed to perform this operation.
                traceId: 01J7ZK4T6Y5DRM7P8QW9H3S2A2
```

Do not leak:

- exact missing internal role if sensitive,
- whether a secret object exists,
- policy rule internals,
- user enumeration details,
- tenant membership details.

---

## 17. Java/Spring Security Mapping

OpenAPI security declaration should map to actual enforcement in Java.

### 17.1 Spring Security Conceptual Mapping

| OpenAPI concept | Spring concept |
|---|---|
| `securitySchemes.bearerAuth` | resource server JWT/bearer configuration |
| OAuth2 scopes | authorities such as `SCOPE_cases:read` |
| operation-level security | endpoint authorization matcher or method security |
| 401 response | authentication entry point |
| 403 response | access denied handler |
| object-level policy | service/domain authorization check |
| field redaction | response shaping/redaction layer |

### 17.2 Example: OpenAPI Contract

```yaml
paths:
  /cases/{caseId}:
    get:
      operationId: getCase
      security:
        - userOAuth:
            - cases:read
      responses:
        '200':
          description: Case visible to caller.
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '404':
          description: Case not found or not visible to caller.
```

### 17.3 Matching Spring Method Security

```java
@RestController
@RequestMapping("/cases")
class CaseController {

    private final CaseApplicationService service;

    CaseController(CaseApplicationService service) {
        this.service = service;
    }

    @GetMapping("/{caseId}")
    @PreAuthorize("hasAuthority('SCOPE_cases:read')")
    CaseResponse getCase(@PathVariable String caseId, Authentication authentication) {
        return service.getCase(caseId, Caller.from(authentication));
    }
}
```

But this is incomplete.

`@PreAuthorize("hasAuthority('SCOPE_cases:read')")` checks capability.

You still need object-level authorization:

```java
public CaseResponse getCase(String caseId, Caller caller) {
    CaseRecord caseRecord = caseRepository.findById(caseId)
        .orElseThrow(() -> NotFoundException.resource("case"));

    if (!casePolicy.canRead(caller, caseRecord)) {
        throw NotFoundException.resource("case");
    }

    return mapper.toResponse(redactionPolicy.apply(caller, caseRecord));
}
```

Why return `404` instead of `403` here?

Because this system may choose to conceal existence of unauthorized cases.

Your OpenAPI contract must document that behavior.

### 17.4 Contract Drift Risk

If OpenAPI says:

```yaml
security:
  - userOAuth:
      - cases:read
```

But Spring code checks:

```java
@PreAuthorize("hasAuthority('SCOPE_case:read')")
```

You have drift:

```text
OpenAPI: cases:read
Implementation: case:read
```

This can break consumers and documentation.

Prevent this with:

- constants,
- generated tests,
- endpoint contract tests,
- security integration tests,
- linting rules,
- review checklists.

---

## 18. Springdoc and Annotation Considerations

With code-first generation, security is often declared through annotations/configuration.

Example:

```java
@SecurityScheme(
    name = "bearerAuth",
    type = SecuritySchemeType.HTTP,
    scheme = "bearer",
    bearerFormat = "JWT"
)
@SpringBootApplication
class ApiApplication {}
```

Operation-level:

```java
@Operation(
    operationId = "getCase",
    security = @SecurityRequirement(name = "bearerAuth")
)
@GetMapping("/cases/{caseId}")
CaseResponse getCase(@PathVariable String caseId) {
    ...
}
```

Potential issue:

The annotation may say the endpoint is secured, while actual Spring Security configuration accidentally permits it.

Or the reverse:

Actual endpoint is secured, but generated OpenAPI misses the requirement.

### 18.1 Code-First Security Review Rule

For every protected operation, verify three artifacts:

1. OpenAPI operation security declaration.
2. Framework-level security enforcement.
3. Service/domain-level authorization enforcement if object-specific.

If these three do not align, the API contract is misleading.

---

## 19. Security Extensions and Vendor Metadata

OpenAPI allows extensions using `x-` fields.

You can use them to document organization-specific policies.

Example:

```yaml
paths:
  /cases/{caseId}:
    get:
      operationId: getCase
      security:
        - userOAuth:
            - cases:read
      x-authorization:
        object: case
        action: read
        tenantScoped: true
        concealUnauthorizedAsNotFound: true
        auditEvent: CASE_VIEWED
        policy: case.read.v1
```

This is not standard OpenAPI semantics, but can be useful for:

- governance,
- linting,
- review,
- audit evidence,
- policy engine mapping,
- documentation generation,
- security testing.

### 19.1 Extension Design Guidelines

Good extensions are:

- stable,
- small,
- explicit,
- consistently applied,
- validated by lint rules,
- tied to real enforcement or review process.

Bad extensions are:

- decorative,
- uncontrolled,
- inconsistent,
- duplicated natural-language descriptions,
- not used by any process.

---

## 20. Multi-Tenant APIs

OpenAPI can document tenant-related headers or claims, but actual isolation must be enforced in code/policy.

### 20.1 Tenant from Token Claim

```yaml
components:
  securitySchemes:
    tenantJwt:
      type: http
      scheme: bearer
      bearerFormat: JWT
      description: >
        JWT must include `tenant_id`. All tenant-scoped resources are filtered
        and authorized against this tenant unless otherwise documented.
```

### 20.2 Tenant from Header

```yaml
components:
  parameters:
    TenantIdHeader:
      name: X-Tenant-Id
      in: header
      required: true
      description: >
        Tenant context for multi-tenant operations. The caller must be entitled
        to act in this tenant; the value is validated against token claims.
      schema:
        type: string
```

Endpoint:

```yaml
paths:
  /cases:
    get:
      operationId: listTenantCases
      security:
        - tenantJwt:
            - cases:read
      parameters:
        - $ref: '#/components/parameters/TenantIdHeader'
      responses:
        '200':
          description: Cases visible to the caller within the selected tenant.
```

### 20.3 Tenant Header Anti-Pattern

Bad:

```yaml
parameters:
  - name: tenantId
    in: query
    schema:
      type: string
```

With no security semantics.

This suggests the caller can choose any tenant.

Better:

Document tenant selection as a validated security context, not just a filter.

---

## 21. Acting on Behalf Of and Delegation

Some APIs support delegated actions.

Example:

- a system integration acts on behalf of a user,
- a supervisor performs action for subordinate,
- a partner submits a case for a complainant,
- an admin impersonates for support.

OpenAPI should not hide this.

```yaml
components:
  parameters:
    ActingUserId:
      name: X-Acting-User-Id
      in: header
      required: false
      description: >
        End-user on whose behalf the partner client is acting. Required for delegated
        partner submissions. The API validates that the partner is entitled to act
        for this user and records the delegation in the audit log.
      schema:
        type: string
```

Operation:

```yaml
paths:
  /partner/cases:
    post:
      operationId: submitPartnerCase
      security:
        - partnerApiKey: []
          serviceOAuth:
            - partner-cases:create
      parameters:
        - $ref: '#/components/parameters/ActingUserId'
      responses:
        '201':
          description: Partner case submitted.
        '403':
          description: Partner is not entitled to act for the specified user or tenant.
```

Delegation must be audit logged.

Document that.

---

## 22. Field-Level Authorization and Redaction

OpenAPI schemas describe possible fields, but not always field visibility conditions.

Example response schema:

```yaml
CaseDetail:
  type: object
  required:
    - id
    - status
    - summary
  properties:
    id:
      type: string
    status:
      type: string
    summary:
      type: string
    confidentialNotes:
      type: string
      description: >
        Present only for callers with confidential case note access.
```

But be careful.

If a field is conditionally present, it should usually not be in `required`.

Better:

```yaml
confidentialNotes:
  type: string
  description: >
    Optional field. Returned only when caller is authorized for confidential notes.
```

For more explicit modelling:

```yaml
CaseDetail:
  oneOf:
    - $ref: '#/components/schemas/CaseDetailStandard'
    - $ref: '#/components/schemas/CaseDetailPrivileged'
```

But this may complicate clients.

In many APIs, conditional optional fields with clear documentation are more practical than heavy polymorphism.

---

## 23. Security and Generated Clients

Generated clients may use security schemes to create auth hooks.

For example, a generated Java client may expose:

- API key setter,
- bearer token supplier,
- OAuth2 token integration,
- request interceptor.

But generated clients do not solve:

- token acquisition,
- token refresh,
- secure storage,
- entitlement checks,
- user authorization flow,
- object-level errors,
- retry policy after 401,
- re-consent flow.

Your SDK documentation should explain:

1. how token is obtained,
2. how token is injected,
3. how scopes map to operations,
4. how 401/403/404 are handled,
5. whether clients should retry,
6. how token refresh is triggered,
7. how least privilege is achieved.

---

## 24. Security and Mock Servers

Mock servers often do not enforce real security.

If OpenAPI security is used only for documentation, a mock server may accept any request.

That is useful for frontend development but dangerous if mistaken for security validation.

Document mock behavior:

```yaml
servers:
  - url: https://mock.api.example.com
    description: >
      Mock server. Authentication headers may be accepted syntactically but are not
      validated against the production identity provider.
```

For better mock discipline:

- require placeholder bearer token,
- simulate 401 for missing token,
- simulate 403 for selected cases,
- include realistic error examples,
- do not use real secrets.

---

## 25. Security and API Gateways

Many APIs enforce security partly at gateway level.

Examples:

- API key validation,
- JWT validation,
- mTLS,
- rate limiting,
- IP allowlist,
- request size limits,
- WAF rules,
- bot protection,
- schema validation.

OpenAPI may document some of these, but not all.

### 25.1 Gateway and Implementation Drift

Possible drift:

| Layer | Believes |
|---|---|
| OpenAPI | requires `cases:read` |
| Gateway | checks only token validity |
| Spring controller | checks `cases:view` |
| Service layer | checks case assignment |

This is risky.

Create a security alignment checklist:

```text
For every operation:
- Is the OpenAPI security requirement declared?
- Does gateway enforce the same authentication scheme?
- Does application enforce the same scope/authority?
- Does domain service enforce object-level authorization?
- Are 401/403/404 behaviours consistent with contract?
- Are audit events emitted where required?
```

---

## 26. mTLS in OpenAPI

OpenAPI supports mutual TLS as a security scheme.

```yaml
components:
  securitySchemes:
    mutualTLS:
      type: mutualTLS
      description: >
        Mutual TLS client certificate authentication. Client certificate subject
        is mapped to a registered service identity.
```

Used by operation:

```yaml
security:
  - mutualTLS: []
```

mTLS often proves client/service identity at transport level.

But again, it does not automatically prove operation authorization.

For high-trust machine APIs, combine mTLS with OAuth2 or policy:

```yaml
security:
  - mutualTLS: []
    serviceOAuth:
      - case-export:read
```

Meaning:

```text
mTLS AND serviceOAuth scope
```

Document certificate mapping:

```yaml
components:
  securitySchemes:
    mutualTLS:
      type: mutualTLS
      description: >
        Client certificate authentication. Certificate subject alternative name
        is mapped to a registered service principal. Certificate authentication
        alone does not grant data access; operation-specific scopes and policy
        checks still apply.
```

---

## 27. Rate Limits, Quotas, and Abuse Controls

Rate limiting is not a security scheme in core OpenAPI, but it is security-adjacent.

Document through headers and descriptions.

```yaml
components:
  headers:
    RateLimitLimit:
      description: Maximum number of requests allowed in the current window.
      schema:
        type: integer
    RateLimitRemaining:
      description: Remaining requests in the current window.
      schema:
        type: integer
    RateLimitReset:
      description: Time when the rate limit window resets.
      schema:
        type: string
        format: date-time

  responses:
    TooManyRequests:
      description: Rate limit exceeded.
      headers:
        Retry-After:
          description: Seconds to wait before retrying.
          schema:
            type: integer
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'
```

Operation:

```yaml
responses:
  '429':
    $ref: '#/components/responses/TooManyRequests'
```

If quota differs by plan or credential type, document it:

```yaml
description: >
  Rate limits are applied per client application and may differ by partner plan.
```

---

## 28. Common Anti-Patterns

### 28.1 Declaring Security Scheme But Not Applying It

Bad:

```yaml
components:
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
```

But no root or operation `security`.

This defines a scheme but does not require it.

### 28.2 Applying Global Security to Public Endpoints Accidentally

Bad:

```yaml
security:
  - bearerAuth: []

paths:
  /health:
    get:
      responses:
        '200':
          description: OK
```

If `/health` is public, it must override:

```yaml
security: []
```

### 28.3 OR/AND Confusion

Bad if both are required:

```yaml
security:
  - bearerAuth: []
  - apiKeyAuth: []
```

Correct:

```yaml
security:
  - bearerAuth: []
    apiKeyAuth: []
```

### 28.4 Vague Scopes

Bad:

```yaml
scopes:
  read: Read access.
  write: Write access.
```

Better:

```yaml
scopes:
  cases:read: Read visible cases.
  cases:update: Update cases where caller has edit permission.
  evidence:upload: Upload evidence to authorized cases.
```

### 28.5 Pretending Scope Equals Full Authorization

Bad:

```yaml
security:
  - userOAuth:
      - cases:read
responses:
  '200':
    description: Case returned.
```

Better:

```yaml
responses:
  '200':
    description: Case returned if caller has scope and object-level visibility.
  '403':
    description: Caller lacks required permission.
  '404':
    description: Case not found or not visible to caller.
```

### 28.6 Real Secrets in Examples

Never include:

- real API keys,
- real bearer tokens,
- real refresh tokens,
- real client IDs/secrets,
- real session cookies,
- production tenant IDs if sensitive.

### 28.7 Security Description That Contradicts Implementation

If OpenAPI says OAuth2 but implementation accepts static API key, the contract is wrong.

If OpenAPI says `cases:read` but implementation checks `case.read`, the contract is wrong.

If OpenAPI says 403 but implementation returns 404 to conceal, the contract is wrong.

---

## 29. Production-Grade Security Example

Below is a compact but realistic security setup.

```yaml
openapi: 3.2.0
info:
  title: Enforcement Case API
  version: 1.0.0

security:
  - userOAuth:
      - cases:read

paths:
  /public/health:
    get:
      operationId: getHealth
      security: []
      responses:
        '200':
          description: Service is reachable.

  /cases/{caseId}:
    get:
      operationId: getCase
      summary: Get case detail
      description: >
        Returns case detail if the caller has `cases:read` scope and object-level
        visibility for the case. Unauthorized or non-visible cases may be returned
        as 404 to avoid disclosing case existence.
      security:
        - userOAuth:
            - cases:read
      parameters:
        - name: caseId
          in: path
          required: true
          schema:
            type: string
      x-authorization:
        object: case
        action: read
        tenantScoped: true
        objectLevelCheck: true
        concealUnauthorizedAsNotFound: true
        auditEvent: CASE_VIEWED
      responses:
        '200':
          description: Case visible to caller.
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/CaseDetail'
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '404':
          description: Case not found or not visible to caller.

  /cases/{caseId}/evidence:
    post:
      operationId: uploadEvidence
      summary: Upload evidence
      description: >
        Uploads evidence to a case. Requires evidence upload scope, case contributor
        permission, tenant membership, and case state allowing evidence submission.
      security:
        - userOAuth:
            - evidence:upload
      parameters:
        - name: caseId
          in: path
          required: true
          schema:
            type: string
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required:
                - file
                - evidenceType
              properties:
                file:
                  type: string
                  contentMediaType: application/octet-stream
                evidenceType:
                  type: string
                  enum: [DOCUMENT, IMAGE, AUDIO, VIDEO, OTHER]
      x-authorization:
        object: case
        action: uploadEvidence
        tenantScoped: true
        objectLevelCheck: true
        statePolicy: case.evidence-upload.allowed.v1
        auditEvent: EVIDENCE_UPLOADED
      responses:
        '201':
          description: Evidence uploaded.
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
        '409':
          description: Case state does not allow evidence upload.

components:
  securitySchemes:
    userOAuth:
      type: oauth2
      description: >
        OAuth2 authorization code flow for user-facing applications. Tokens must
        be issued by the organization identity provider and include required scopes.
        Operation access also depends on tenant, assignment, confidentiality, and
        object-level policy checks.
      flows:
        authorizationCode:
          authorizationUrl: https://id.example.com/oauth2/authorize
          tokenUrl: https://id.example.com/oauth2/token
          scopes:
            cases:read: Read cases visible to the authenticated principal.
            cases:create: Create cases where the user has intake permission.
            cases:update: Update cases where the user has edit permission.
            evidence:upload: Upload evidence to authorized cases.
            evidence:read: Read evidence visible to the authenticated principal.

    serviceOAuth:
      type: oauth2
      description: OAuth2 client credentials flow for service integrations.
      flows:
        clientCredentials:
          tokenUrl: https://id.example.com/oauth2/token
          scopes:
            case-export:read: Export case data under approved integration policy.

    partnerApiKey:
      type: apiKey
      in: header
      name: X-Partner-API-Key
      description: >
        Identifies an approved partner integration client. API key authentication
        does not represent an end-user and must be combined with service OAuth
        for protected partner operations.

  schemas:
    Problem:
      type: object
      required:
        - type
        - title
        - status
      properties:
        type:
          type: string
          format: uri
        title:
          type: string
        status:
          type: integer
        detail:
          type: string
        traceId:
          type: string

    CaseDetail:
      type: object
      required:
        - id
        - status
        - summary
      properties:
        id:
          type: string
        status:
          type: string
        summary:
          type: string
        confidentialNotes:
          type: string
          description: Returned only when caller has confidential note access.

  responses:
    Unauthorized:
      description: Missing, expired, or invalid authentication credentials.
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'

    Forbidden:
      description: Authenticated caller lacks required permission.
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Problem'
```

This contract is not perfect, but it is honest:

- it declares OAuth2 flows,
- it uses scopes,
- it distinguishes public endpoint,
- it describes object-level authorization,
- it references audit events via extension,
- it documents concealment behavior,
- it avoids claiming OpenAPI fully enforces security.

---

## 30. Security Review Checklist

Use this checklist during API review.

### 30.1 Scheme Definition

- Are all security schemes defined under `components.securitySchemes`?
- Are scheme names stable and meaningful?
- Is API key location correct?
- Is bearer token format documented honestly?
- Are OAuth2 flow URLs correct?
- Are scopes described clearly?
- Is OIDC discovery URL correct if used?
- Are legacy flows marked as legacy/deprecated?

### 30.2 Operation Security

- Does each protected operation declare security?
- Are public endpoints explicitly marked `security: []`?
- Are optional-auth endpoints documented clearly?
- Are OR vs AND semantics correct?
- Are operation scopes specific enough?
- Are 401 and 403 responses documented?
- Is 404 concealment behavior documented if used?

### 30.3 Authorization Semantics

- Does the operation require object-level authorization?
- Is tenant isolation documented?
- Are field-level visibility/redaction rules documented?
- Are state-based permissions documented?
- Are delegation/acting-on-behalf-of semantics documented?
- Are audit requirements documented?

### 30.4 Implementation Alignment

- Does gateway enforcement match the spec?
- Does Spring Security configuration match the spec?
- Does method-level security match the spec?
- Does domain policy enforcement match the spec?
- Are error handlers aligned with documented 401/403/404?
- Are security tests tied to the contract?

### 30.5 Secret Hygiene

- No real API keys in examples.
- No real bearer tokens in examples.
- No real refresh tokens.
- No client secrets.
- No sensitive tenant/user IDs.
- No internal policy engine details exposed unnecessarily.

---

## 31. Mental Model Summary

OpenAPI security modelling has four layers:

```text
Layer 1: Credential Transport
- API key location
- Authorization header
- Cookie
- mTLS

Layer 2: Authentication Scheme
- HTTP bearer
- JWT
- OAuth2
- OIDC
- Basic

Layer 3: Declared Capability
- OAuth2 scopes
- operation security requirement
- global vs operation override

Layer 4: Real Authorization Policy
- tenant
- role
- entitlement
- object ownership
- case assignment
- state
- classification
- redaction
- audit
```

OpenAPI covers layers 1–3 reasonably well.

Layer 4 must be documented through descriptions, extensions, external policy references, and implementation tests.

Top-tier engineers do not pretend OpenAPI solves authorization. They use OpenAPI to make authorization expectations visible, reviewable, testable, and governable.

---

## 32. Practical Exercises

### Exercise 1 — Fix OR/AND Security

Given:

```yaml
security:
  - bearerAuth: []
  - apiKeyAuth: []
```

Requirement:

> Client must provide both bearer token and API key.

Fix it.

Expected answer:

```yaml
security:
  - bearerAuth: []
    apiKeyAuth: []
```

### Exercise 2 — Make Public Endpoint Explicit

Given global security:

```yaml
security:
  - bearerAuth: []
```

Make `/health` public.

Expected:

```yaml
paths:
  /health:
    get:
      operationId: getHealth
      security: []
      responses:
        '200':
          description: OK
```

### Exercise 3 — Document Object-Level Authorization

For endpoint:

```text
GET /cases/{caseId}
```

Write description and responses for:

- bearer token required,
- `cases:read` scope required,
- caller must be assigned to case,
- unauthorized case may return 404.

### Exercise 4 — Model Partner Auth

Requirement:

- partner must send `X-Partner-API-Key`,
- partner service token must have `partner-cases:create`,
- operation creates a case on behalf of an end-user.

Write security scheme and operation security.

### Exercise 5 — Spring Alignment

Given OpenAPI scope:

```yaml
cases:read
```

Find drift in this Java code:

```java
@PreAuthorize("hasAuthority('SCOPE_case:read')")
```

Explain the risk.

---

## 33. Key Takeaways

1. `securitySchemes` defines available mechanisms; `security` applies requirements.
2. A list of security requirement objects is OR; multiple schemes inside one object are AND.
3. `security: []` explicitly marks an operation as public.
4. Bearer JWT modelling does not define issuer, audience, claims, or authorization policy by itself.
5. OAuth2 scopes are useful but not equivalent to roles or object-level permissions.
6. OpenAPI can document authentication well and authorization partially.
7. Object-level access, tenant isolation, redaction, and audit semantics need explicit descriptions/extensions/policies.
8. Generated clients can use security metadata but do not solve token acquisition or permission handling.
9. Java/Spring enforcement must align with OpenAPI declarations to avoid contract drift.
10. For regulated systems, security documentation must be precise enough to support review, testing, and auditability.

---

## 34. References

- OpenAPI Specification v3.2.0 — Security Scheme Object, Security Requirement Object, root and operation-level `security`.
- OpenAPI Initiative — formal standard for describing HTTP APIs and API lifecycle tooling.
- OAuth 2.0 family of specifications and OAuth2 security best current practices.
- OpenID Connect Discovery 1.0 — provider discovery metadata for OIDC relying parties.
- Spring Security documentation — resource server, OAuth2, JWT, method security.
- springdoc-openapi documentation — Java/Spring OpenAPI generation and annotations.
- RFC 9110 — HTTP semantics for status codes such as 401 and 403.
- RFC 9457 — Problem Details for HTTP APIs.

---

## 35. Completion Status

```text
Current part: 017 / 030
Status: In progress
Series complete: No
Remaining parts: 13
Next: Part 018 — Pagination, Filtering, Sorting, Search, and Bulk Operations
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-openapi-mastery-for-java-engineers-part-016.md">⬅️ OpenAPI Mastery for Java Engineers — Part 016</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-openapi-mastery-for-java-engineers-part-018.md">OpenAPI Mastery for Java Engineers — Part 018 ➡️</a>
</div>
